-- INTEL-04 — depois de cada checkpoint confirmado, encerra a posse e leva o
-- item ao checkpoint humano quando tempo global ou reserva foram consumidos.

CREATE FUNCTION public.interrupt_work_on_budget(
  p_work_item_id uuid,
  p_expected_proposal_version integer,
  p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_uid uuid:=auth.uid();
  v_now timestamptz:=now();
  v_item public.work_items;
  v_decision jsonb;
  v_reason text;
  v_limit text;
  v_checkpoint public.work_events;
  v_claim public.work_claims;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF p_attempt_id IS NULL OR p_expected_proposal_version<1
    THEN RAISE EXCEPTION 'invalid budget check' USING ERRCODE='22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('autonomous_work_budget:'||v_uid::text,0));
  SELECT * INTO v_item FROM public.work_items i
   WHERE i.id=p_work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_checkpoint FROM public.work_events e
   WHERE e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
     AND e.proposal_version=p_expected_proposal_version
     AND e.payload->'data'->>'attempt_id'=p_attempt_id::text
   ORDER BY (e.payload->'data'->>'signal_sequence')::integer DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkpoint required before budget interruption' USING ERRCODE='55000'; END IF;
  IF v_item.state<>'in_progress' OR v_item.proposal_version<>p_expected_proposal_version
    THEN RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000'; END IF;

  v_decision:=private.autonomous_work_budget_decision(v_uid,v_item.id,v_now);
  v_reason:=v_decision->>'reason';
  -- Tentativas são um gate entre tentativas. Dentro de uma tentativa já
  -- admitida, somente os limites de tempo podem interromper após checkpoint.
  IF v_reason IS NULL OR v_reason IN (
    'item_attempt_budget_exhausted','user_attempt_budget_exhausted'
  ) THEN
    RETURN jsonb_build_object('interrupted',false,'budget',v_decision);
  END IF;
  v_limit:=CASE WHEN v_reason='user_runtime_budget_exhausted'
    THEN 'duration' ELSE 'resources' END;

  UPDATE public.work_items SET state='blocked',updated_at=v_now
   WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES
    (v_item.id,'input_requested','anima',v_item.proposal_version,
      jsonb_build_object('schema_version',1,'data',jsonb_build_object(
        'reason','persistent_inability_after_limits',
        'budget_reason',v_reason,
        'reached_limit',v_limit,
        'source_state',jsonb_build_object(
          'work_state','in_progress',
          'proposal_version',v_item.proposal_version,
          'attempt_id',p_attempt_id,
          'checkpoint_event_seq',v_checkpoint.seq),
        'explanation',CASE
          WHEN v_reason='user_runtime_budget_exhausted'
            THEN 'O orçamento global de 120 minutos em 24 horas foi atingido.'
          ELSE 'A execução parou para preservar 15 minutos da janela para uso interativo.'
        END))),
    (v_item.id,'work_blocked','anima',v_item.proposal_version,
      jsonb_build_object('schema_version',1,'data',jsonb_build_object(
        'work_item_id',v_item.id,
        'attempt_id',p_attempt_id,
        'approved_proposal_version',v_item.proposal_version,
        'reason',v_reason,
        'reached_limit',v_limit,
        'checkpoint_event_seq',v_checkpoint.seq,
        'observed_at',v_now)));

  SELECT * INTO v_claim FROM public.work_claims c
   WHERE c.user_id=v_uid AND c.work_item_id=v_item.id
     AND c.attempt_id=p_attempt_id AND c.released_at IS NULL FOR UPDATE;
  IF FOUND THEN
    UPDATE public.work_claims SET released_at=v_now,release_reason='attempt_finished'
     WHERE id=v_claim.id RETURNING * INTO v_claim;
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
    VALUES(v_item.id,'work_claim_released','system',v_item.proposal_version,
      jsonb_build_object('schema_version',1,'data',jsonb_build_object(
        'claim_id',v_claim.id,'work_item_id',v_item.id,
        'approved_proposal_version',v_item.proposal_version,
        'owner_instance_id',v_claim.owner_instance_id,'attempt_id',p_attempt_id,
        'reason','attempt_finished','released_at',v_now)));
  END IF;
  RETURN jsonb_build_object(
    'interrupted',true,
    'reason',v_reason,
    'reachedLimit',v_limit,
    'checkpointEventSeq',v_checkpoint.seq,
    'claimReleased',FOUND,
    'budget',v_decision
  );
END;
$$;

REVOKE ALL ON FUNCTION public.interrupt_work_on_budget(uuid,integer,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.interrupt_work_on_budget(uuid,integer,uuid)
  TO authenticated,service_role;

COMMENT ON FUNCTION public.interrupt_work_on_budget(uuid,integer,uuid) IS
  'INTEL-04: após checkpoint persistido, interrompe atomicamente por orçamento de tempo, registra input_requested e work_blocked com razão tipada e libera o claim sem inventar resultado. Limites de tentativas são aplicados somente antes de uma nova tentativa.';
