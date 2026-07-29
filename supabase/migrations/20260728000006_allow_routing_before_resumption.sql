-- Uma decisão de roteamento é registrada antes da aquisição da posse.
-- Por isso, ela é o único fato que pode anteceder uma tentativa retomada
-- usando o novo attempt_id.

CREATE OR REPLACE FUNCTION public.begin_resumed_work_attempt(
  work_item_id uuid, expected_proposal_version integer,
  source_attempt_id uuid, checkpoint_event_seq bigint, abandonment_event_seq bigint,
  claim_id uuid, attempt_id uuid, owner_instance_id text, lease_seconds integer, executor_id text)
RETURNS public.work_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_uid uuid:=auth.uid(); v_item public.work_items; v_cp public.work_events; v_ab public.work_events;
  v_existing public.work_events; v_target text; v_now timestamptz:=now(); v_claim public.work_claims;
  v_signal_sequence integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid)
    THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  IF claim_id IS NULL OR attempt_id IS NULL OR source_attempt_id IS NULL
     OR checkpoint_event_seq IS NULL OR abandonment_event_seq IS NULL
     OR length(btrim(owner_instance_id))=0 OR length(btrim(executor_id))=0 OR lease_seconds<=0
    THEN RAISE EXCEPTION 'invalid resumption request' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_item FROM public.work_items i
   WHERE i.id=work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_existing FROM public.work_events e WHERE e.work_item_id=v_item.id
    AND e.event_type='execution_started' AND e.payload->'data'->>'attempt_id'=attempt_id::text;
  IF FOUND THEN
    IF v_existing.payload->'data'->>'reason'='resumed_execution'
       AND v_existing.payload->'data'->>'resumed_from_attempt_id'=source_attempt_id::text
       AND (v_existing.payload->'data'->>'resumed_from_checkpoint_event_seq')::bigint=checkpoint_event_seq
      THEN RETURN v_item; END IF;
    RAISE EXCEPTION 'attempt correlation conflict' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_claims c WHERE c.id=claim_id)
    THEN RAISE EXCEPTION 'claim identity conflict' USING ERRCODE='55000'; END IF;
  IF EXISTS (
    SELECT 1
      FROM public.work_events e
     WHERE e.payload->'data'->>'attempt_id'=attempt_id::text
       AND e.event_type<>'work_routing_decided'
  ) THEN RAISE EXCEPTION 'attempt identifier reused' USING ERRCODE='55000'; END IF;
  IF v_item.state<>'approved' OR v_item.proposal_version<>expected_proposal_version
    THEN RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000'; END IF;

  SELECT * INTO v_ab FROM public.work_events e WHERE e.seq=abandonment_event_seq
    AND e.work_item_id=v_item.id AND e.event_type='attempt_abandoned'
    AND e.proposal_version=expected_proposal_version
    AND e.payload->'data'->>'attempt_id'=source_attempt_id::text;
  IF NOT FOUND OR v_ab.payload->'data'->>'reason' NOT IN ('lease_expired','duration_limit_exceeded','declared_bounds_exceeded')
    THEN RAISE EXCEPTION 'abandoned attempt not found' USING ERRCODE='55000'; END IF;

  SELECT * INTO v_cp FROM public.work_events e WHERE e.seq=checkpoint_event_seq
    AND e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
    AND e.seq<v_ab.seq AND e.proposal_version=expected_proposal_version
    AND e.payload->'data'->>'attempt_id'=source_attempt_id::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'valid checkpoint not found' USING ERRCODE='55000'; END IF;
  v_signal_sequence:=(v_cp.payload->'data'->>'signal_sequence')::integer;
  IF EXISTS (SELECT 1 FROM public.work_events newer WHERE newer.work_item_id=v_item.id
    AND newer.event_type='checkpoint_recorded' AND newer.seq<v_ab.seq
    AND newer.proposal_version=expected_proposal_version
    AND newer.payload->'data'->>'attempt_id'=source_attempt_id::text
    AND (newer.payload->'data'->>'signal_sequence')::integer>v_signal_sequence)
    THEN RAISE EXCEPTION 'checkpoint is obsolete' USING ERRCODE='55000'; END IF;

  v_target:=btrim(v_item.intent#>>'{execution_spec,target,reference}');
  IF v_target IS NULL OR length(v_target)=0 THEN RAISE EXCEPTION 'execution target missing' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_target:'||v_uid::text||':'||v_target,0));
  IF EXISTS (SELECT 1 FROM public.work_claims c WHERE c.user_id=v_uid AND c.released_at IS NULL
    AND c.expires_at>v_now AND (c.work_item_id=v_item.id OR c.target_reference=v_target))
    THEN RAISE EXCEPTION 'work target is held by an active claim' USING ERRCODE='55000'; END IF;
  IF EXISTS (SELECT 1 FROM public.work_items i WHERE i.user_id=v_uid AND i.id<>v_item.id
    AND i.state='in_progress' AND btrim(i.intent#>>'{execution_spec,target,reference}')=v_target)
    THEN RAISE EXCEPTION 'work target is busy with a running attempt' USING ERRCODE='55000'; END IF;

  INSERT INTO public.work_claims(id,work_item_id,user_id,approved_proposal_version,owner_instance_id,
    acquired_at,expires_at,attempt_id,target_reference)
  VALUES(claim_id,v_item.id,v_uid,expected_proposal_version,btrim(owner_instance_id),v_now,
    v_now+make_interval(secs=>lease_seconds),attempt_id,v_target) RETURNING * INTO v_claim;
  UPDATE public.work_items SET state='in_progress',updated_at=v_now WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
    (v_item.id,'work_claimed','system',expected_proposal_version,jsonb_build_object('schema_version',1,'data',
      jsonb_build_object('claim_id',claim_id,'work_item_id',v_item.id,'approved_proposal_version',expected_proposal_version,
        'owner_instance_id',btrim(owner_instance_id),'acquired_at',v_now,'expires_at',v_claim.expires_at,'target_reference',v_target))),
    (v_item.id,'work_started','anima',expected_proposal_version,jsonb_build_object('schema_version',1,'data',
      jsonb_build_object('reason','resumed_execution','attempt_id',attempt_id,'claim_id',claim_id,
        'resumed_from_attempt_id',source_attempt_id,'resumed_from_checkpoint_sequence',v_signal_sequence,
        'resumed_from_checkpoint_event_seq',checkpoint_event_seq,'abandonment_event_seq',abandonment_event_seq))),
    (v_item.id,'execution_started','anima',expected_proposal_version,jsonb_build_object('schema_version',1,'data',
      jsonb_build_object('work_item_id',v_item.id,'attempt_id',attempt_id,'approved_proposal_version',expected_proposal_version,
        'origin','anima','executor_id',btrim(executor_id),'claim_id',claim_id,'reason','resumed_execution',
        'resumed_from_attempt_id',source_attempt_id,'resumed_from_checkpoint_sequence',v_signal_sequence,
        'resumed_from_checkpoint_event_seq',checkpoint_event_seq,'abandonment_event_seq',abandonment_event_seq)));
  RETURN v_item;
END $$;

REVOKE ALL ON FUNCTION public.begin_resumed_work_attempt(uuid,integer,uuid,bigint,bigint,uuid,uuid,text,integer,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_resumed_work_attempt(uuid,integer,uuid,bigint,bigint,uuid,uuid,text,integer,text)
  TO authenticated,service_role;
