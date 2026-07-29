-- UX-02: interrupção humana tipada, decisão exata e retomada auditável.
--
-- A alternativa apresentada pertence ao sinal do executor e é persistida sem
-- reconstrução pela UI. A resposta referencia o evento exato; versão, tentativa
-- ou alternativa divergentes falham fechado.

INSERT INTO private.work_state_transitions(from_state,event_type,to_state)
VALUES ('blocked','work_approved','approved');

CREATE FUNCTION public.record_work_decision_required(
  p_work_item_id uuid,
  p_expected_proposal_version integer,
  p_attempt_id uuid,
  p_signal jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_uid uuid:=auth.uid(); v_now timestamptz:=now();
  v_item public.work_items; v_checkpoint public.work_events;
  v_previous public.work_events; v_request public.work_events;
  v_claim public.work_claims; v_sequence integer;
  v_reason text; v_options jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF p_attempt_id IS NULL OR p_expected_proposal_version IS NULL OR p_expected_proposal_version<1
     OR jsonb_typeof(p_signal) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid decision signal' USING ERRCODE='22023';
  END IF;
  v_reason:=p_signal->>'reason'; v_options:=p_signal->'options';
  IF p_signal->>'kind' IS DISTINCT FROM 'decision_required'
     OR p_signal->>'workItemId' IS DISTINCT FROM p_work_item_id::text
     OR p_signal->>'attemptId' IS DISTINCT FROM p_attempt_id::text
     OR (p_signal->>'approvedProposalVersion')::integer IS DISTINCT FROM p_expected_proposal_version
     OR p_signal->>'origin' IS DISTINCT FROM 'executor'
     OR jsonb_typeof(p_signal->'sequence') IS DISTINCT FROM 'number'
     OR v_reason NOT IN ('scope_change','architectural_decision','destructive_action',
       'sensitive_credential_required','requirements_conflict','permission_missing',
       'final_integration_approval','persistent_inability_after_limits')
     OR length(btrim(p_signal->>'explanation'))=0
     OR jsonb_typeof(v_options) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_options)<2 THEN
    RAISE EXCEPTION 'invalid decision signal' USING ERRCODE='22023';
  END IF;
  v_sequence:=(p_signal->>'sequence')::integer;
  IF v_sequence<1
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_options) o
       WHERE jsonb_typeof(o) IS DISTINCT FROM 'object'
          OR length(btrim(o->>'id'))=0 OR length(btrim(o->>'label'))=0
          OR o->>'effect' NOT IN ('resume','cancel'))
     OR (SELECT count(*) FROM jsonb_array_elements(v_options))
        <> (SELECT count(DISTINCT o->>'id') FROM jsonb_array_elements(v_options) o) THEN
    RAISE EXCEPTION 'invalid decision alternatives' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items i
   WHERE i.id=p_work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_previous FROM public.work_events e
   WHERE e.work_item_id=v_item.id AND e.event_type='input_requested'
     AND e.payload->'data'->>'attempt_id'=p_attempt_id::text
     AND e.payload->'data'->'executor_signal' IS NOT NULL
   ORDER BY e.seq DESC LIMIT 1;
  IF FOUND THEN
    IF v_previous.payload->'data'->'executor_signal'=p_signal THEN
      RETURN jsonb_build_object('requestEventId',v_previous.id,'claimReleased',true);
    END IF;
    RAISE EXCEPTION 'attempt already requested a different decision' USING ERRCODE='55000';
  END IF;
  IF v_item.state<>'in_progress' OR v_item.proposal_version<>p_expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.work_events e WHERE e.work_item_id=v_item.id
    AND e.event_type='execution_started' AND e.proposal_version=p_expected_proposal_version
    AND e.payload->'data'->>'attempt_id'=p_attempt_id::text) THEN
    RAISE EXCEPTION 'attempt not found' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_checkpoint FROM public.work_events e
   WHERE e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
     AND e.payload->'data'->>'attempt_id'=p_attempt_id::text
   ORDER BY (e.payload->'data'->>'signal_sequence')::integer DESC LIMIT 1;
  IF NOT FOUND OR v_sequence<=(v_checkpoint.payload->'data'->>'signal_sequence')::integer THEN
    RAISE EXCEPTION 'decision must follow a persisted checkpoint' USING ERRCODE='55000';
  END IF;

  UPDATE public.work_items SET state='blocked',updated_at=v_now WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'input_requested','anima',v_item.proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'work_item_id',v_item.id,'attempt_id',p_attempt_id,
      'approved_proposal_version',v_item.proposal_version,'reason',v_reason,
      'explanation',p_signal->>'explanation','options',v_options,
      'checkpoint_reference',v_checkpoint.id,'checkpoint_event_seq',v_checkpoint.seq,
      'signal_sequence',v_sequence,'executor_signal',p_signal)))
  RETURNING * INTO v_request;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'work_blocked','anima',v_item.proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'work_item_id',v_item.id,'attempt_id',p_attempt_id,
      'approved_proposal_version',v_item.proposal_version,
      'reason','human_input_required','input_requested_event_id',v_request.id,
      'checkpoint_event_seq',v_checkpoint.seq,'observed_at',v_now)));

  SELECT * INTO v_claim FROM public.work_claims c WHERE c.user_id=v_uid
    AND c.work_item_id=v_item.id AND c.attempt_id=p_attempt_id
    AND c.released_at IS NULL FOR UPDATE;
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
  RETURN jsonb_build_object('requestEventId',v_request.id,'claimReleased',v_claim.id IS NOT NULL);
END $$;

CREATE FUNCTION public.respond_to_work_decision(
  p_work_item_id uuid,
  p_expected_proposal_version integer,
  p_input_requested_event_id uuid,
  p_option_id text
)
RETURNS public.work_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_uid uuid:=auth.uid(); v_now timestamptz:=now();
  v_item public.work_items; v_request public.work_events;
  v_previous public.work_events; v_option jsonb; v_effect text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF p_expected_proposal_version IS NULL OR p_expected_proposal_version<1
     OR p_input_requested_event_id IS NULL OR length(btrim(p_option_id))=0 THEN
    RAISE EXCEPTION 'invalid decision response' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_item FROM public.work_items i
   WHERE i.id=p_work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_request FROM public.work_events e WHERE e.id=p_input_requested_event_id
    AND e.work_item_id=v_item.id AND e.event_type='input_requested'
    AND e.proposal_version=p_expected_proposal_version
    AND e.payload->'data'->'executor_signal' IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'decision request not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_previous FROM public.work_events e WHERE e.work_item_id=v_item.id
    AND e.event_type='input_provided'
    AND e.payload->'data'->>'input_requested_event_id'=v_request.id::text
    ORDER BY e.seq DESC LIMIT 1;
  IF FOUND THEN
    IF v_previous.payload->'data'->>'option_id'=p_option_id THEN RETURN v_item; END IF;
    RAISE EXCEPTION 'decision was already answered differently' USING ERRCODE='55000';
  END IF;
  IF v_item.state<>'blocked' OR v_item.proposal_version<>p_expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;
  SELECT o INTO v_option FROM jsonb_array_elements(v_request.payload->'data'->'options') o
    WHERE o->>'id'=p_option_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'decision option not presented' USING ERRCODE='22023'; END IF;
  v_effect:=v_option->>'effect';

  UPDATE public.work_items SET state=CASE WHEN v_effect='resume' THEN 'approved'::public.work_state
    ELSE 'cancelled'::public.work_state END,updated_at=v_now WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'input_provided','user',v_item.proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'input_requested_event_id',v_request.id,'option_id',p_option_id,
      'option',v_option,'effect',v_effect,'answered_at',v_now))),
    (v_item.id,CASE WHEN v_effect='resume' THEN 'work_approved'::public.work_event_type
      ELSE 'work_cancelled'::public.work_event_type END,'user',v_item.proposal_version,
      jsonb_build_object('schema_version',1,'data',jsonb_build_object(
        'reason',CASE WHEN v_effect='resume' THEN 'human_decision_resume' ELSE 'human_decision_cancel' END,
        'input_requested_event_id',v_request.id,'option_id',p_option_id,'answered_at',v_now)));
  RETURN v_item;
END $$;

REVOKE ALL ON FUNCTION public.record_work_decision_required(uuid,integer,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.respond_to_work_decision(uuid,integer,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_work_decision_required(uuid,integer,uuid,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.respond_to_work_decision(uuid,integer,uuid,text) TO authenticated,service_role;
