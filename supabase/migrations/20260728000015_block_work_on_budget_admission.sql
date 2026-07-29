-- INTEL-04 — orçamento negado antes da tentativa também vira checkpoint humano.
-- Sem esta materialização, um item com teto próprio esgotado permaneceria na
-- cabeça FIFO e impediria a seleção dos itens seguintes.

INSERT INTO private.work_state_transitions(from_state,event_type,to_state)
VALUES('approved','work_blocked','blocked');

CREATE FUNCTION public.block_work_on_budget(p_work_item_id uuid)
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('autonomous_work_budget:'||v_uid::text,0));
  SELECT * INTO v_item FROM public.work_items i
   WHERE i.id=p_work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  v_decision:=private.autonomous_work_budget_decision(v_uid,v_item.id,v_now);
  v_reason:=v_decision->>'reason';
  IF coalesce((v_decision->>'admitted')::boolean,false) OR v_reason IS NULL THEN
    RETURN jsonb_build_object('blocked',false,'budget',v_decision);
  END IF;
  IF v_item.state='blocked' THEN
    RETURN jsonb_build_object('blocked',true,'reason',v_reason,'replayed',true,'budget',v_decision);
  END IF;
  IF v_item.state<>'approved' THEN
    RAISE EXCEPTION 'work item state changed before budget block' USING ERRCODE='55000';
  END IF;
  v_limit:=CASE
    WHEN v_reason IN ('item_attempt_budget_exhausted','user_attempt_budget_exhausted') THEN 'attempts'
    WHEN v_reason='user_runtime_budget_exhausted' THEN 'duration'
    ELSE 'resources'
  END;
  SELECT * INTO v_checkpoint FROM public.work_events e
   WHERE e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
   ORDER BY e.seq DESC LIMIT 1;

  UPDATE public.work_items SET state='blocked',updated_at=v_now
   WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES
    (v_item.id,'input_requested','anima',v_item.proposal_version,
      jsonb_build_object('schema_version',1,'data',jsonb_strip_nulls(jsonb_build_object(
        'reason','persistent_inability_after_limits',
        'budget_reason',v_reason,
        'reached_limit',v_limit,
        'source_state',jsonb_strip_nulls(jsonb_build_object(
          'work_state','approved',
          'proposal_version',v_item.proposal_version,
          'checkpoint_event_seq',v_checkpoint.seq)),
        'explanation','O orçamento autônomo foi atingido; continuar exige decisão humana.')))),
    (v_item.id,'work_blocked','anima',v_item.proposal_version,
      jsonb_build_object('schema_version',1,'data',jsonb_strip_nulls(jsonb_build_object(
        'work_item_id',v_item.id,
        'approved_proposal_version',v_item.proposal_version,
        'reason',v_reason,
        'reached_limit',v_limit,
        'checkpoint_event_seq',v_checkpoint.seq,
        'observed_at',v_now))));
  RETURN jsonb_build_object(
    'blocked',true,'reason',v_reason,'reachedLimit',v_limit,
    'checkpointEventSeq',v_checkpoint.seq,'budget',v_decision
  );
END;
$$;

REVOKE ALL ON FUNCTION public.block_work_on_budget(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.block_work_on_budget(uuid)
  TO authenticated,service_role;

COMMENT ON FUNCTION public.block_work_on_budget(uuid) IS
  'INTEL-04: materializa orçamento negado antes da tentativa como input_requested + work_blocked, preservando referência ao último checkpoint quando existe. Retira o item da fila derivada e aguarda decisão humana sem adquirir claim.';
