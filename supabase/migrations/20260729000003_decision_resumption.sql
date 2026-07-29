-- UX-02 ponta a ponta: reutiliza InputRequestedPayloadV1, persiste WorkHandoffV1
-- no pedido e retoma AUTO-05 com novo claim/tentativa a partir desse checkpoint.

CREATE OR REPLACE FUNCTION public.record_work_decision_required(
  p_work_item_id uuid,p_expected_proposal_version integer,p_attempt_id uuid,p_signal jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_uid uuid:=auth.uid(); v_now timestamptz:=now(); v_item public.work_items;
  v_checkpoint public.work_events; v_previous public.work_events; v_request public.work_events;
  v_claim public.work_claims; v_sequence integer; v_reason text; v_options jsonb;
  v_checkpoint_data jsonb; v_input_request jsonb; v_handoff jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid)
    THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
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
    OR jsonb_typeof(v_options) IS DISTINCT FROM 'array' OR jsonb_array_length(v_options)<2 THEN
    RAISE EXCEPTION 'invalid decision signal' USING ERRCODE='22023';
  END IF;
  v_sequence:=(p_signal->>'sequence')::integer;
  IF v_sequence<1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_options) o
      WHERE jsonb_typeof(o) IS DISTINCT FROM 'object' OR length(btrim(o->>'id'))=0
        OR length(btrim(o->>'label'))=0 OR o->>'effect' NOT IN ('resume','cancel'))
    OR (SELECT count(*) FROM jsonb_array_elements(v_options))
      <> (SELECT count(DISTINCT o->>'id') FROM jsonb_array_elements(v_options) o) THEN
    RAISE EXCEPTION 'invalid decision alternatives' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items i WHERE i.id=p_work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_previous FROM public.work_events e WHERE e.work_item_id=v_item.id
    AND e.event_type='input_requested' AND e.payload->'data'->>'attempt_id'=p_attempt_id::text
    AND e.payload->'data'->'executor_signal' IS NOT NULL ORDER BY e.seq DESC LIMIT 1;
  IF FOUND THEN
    IF v_previous.payload->'data'->'executor_signal'=p_signal
      THEN RETURN jsonb_build_object('requestEventId',v_previous.id,'claimReleased',
        NOT EXISTS(SELECT 1 FROM public.work_claims c WHERE c.attempt_id=p_attempt_id AND c.released_at IS NULL)); END IF;
    RAISE EXCEPTION 'attempt already requested a different decision' USING ERRCODE='55000';
  END IF;
  IF v_item.state<>'in_progress' OR v_item.proposal_version<>p_expected_proposal_version
    THEN RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.work_events e WHERE e.work_item_id=v_item.id
    AND e.event_type='execution_started' AND e.proposal_version=p_expected_proposal_version
    AND e.payload->'data'->>'attempt_id'=p_attempt_id::text)
    THEN RAISE EXCEPTION 'attempt not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_checkpoint FROM public.work_events e WHERE e.work_item_id=v_item.id
    AND e.event_type='checkpoint_recorded' AND e.payload->'data'->>'attempt_id'=p_attempt_id::text
    ORDER BY (e.payload->'data'->>'signal_sequence')::integer DESC LIMIT 1;
  IF NOT FOUND OR v_sequence<=(v_checkpoint.payload->'data'->>'signal_sequence')::integer
    THEN RAISE EXCEPTION 'decision must follow a persisted checkpoint' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_claim FROM public.work_claims c WHERE c.user_id=v_uid AND c.work_item_id=v_item.id
    AND c.attempt_id=p_attempt_id AND c.released_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'active attempt claim not found' USING ERRCODE='55000'; END IF;

  v_checkpoint_data:=v_checkpoint.payload->'data'->'checkpoint';
  v_input_request:=jsonb_build_object(
    'schema_version',1,'reason',v_reason,
    'source_state',jsonb_build_object('work_state','in_progress','proposal_version',v_item.proposal_version,
      'attempt_number',(SELECT count(*) FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'),
      'checkpoint_reference',v_checkpoint.id::text),
    'explanation',p_signal->>'explanation');
  v_handoff:=jsonb_build_object(
    'schemaVersion',1,'workItemId',v_item.id,'attemptId',p_attempt_id,
    'approvedProposalVersion',v_item.proposal_version,'claimId',v_claim.id,
    'status','paused','stopReason','human_input_required',
    'handoffReference',v_checkpoint_data->>'handoffReference',
    'completedSteps',v_checkpoint_data->'completedSteps','remainingSteps',v_checkpoint_data->'remainingSteps',
    'decisions',v_checkpoint_data->'decisions','risks',v_checkpoint_data->'risks',
    'nextStep',v_checkpoint_data->>'nextStep','touchedResources',v_checkpoint_data->'touchedResources',
    'validations',v_checkpoint_data->'validations','failures',v_checkpoint_data->'failures',
    'evidenceReferences',v_checkpoint_data->'evidenceReferences');

  UPDATE public.work_items SET state='blocked',updated_at=v_now WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'input_requested','anima',v_item.proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'work_item_id',v_item.id,'attempt_id',p_attempt_id,'approved_proposal_version',v_item.proposal_version,
      'input_request',v_input_request,'reason',v_reason,'explanation',p_signal->>'explanation',
      'source_state',v_input_request->'source_state','options',v_options,'handoff',v_handoff,
      'checkpoint_reference',v_checkpoint.id,'checkpoint_event_seq',v_checkpoint.seq,
      'signal_sequence',v_sequence,'executor_signal',p_signal))) RETURNING * INTO v_request;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'work_blocked','anima',v_item.proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'work_item_id',v_item.id,'attempt_id',p_attempt_id,'approved_proposal_version',v_item.proposal_version,
      'reason','human_input_required','input_requested_event_id',v_request.id,
      'checkpoint_event_seq',v_checkpoint.seq,'observed_at',v_now)));
  UPDATE public.work_claims SET released_at=v_now,release_reason='attempt_finished'
    WHERE id=v_claim.id RETURNING * INTO v_claim;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'work_claim_released','system',v_item.proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'claim_id',v_claim.id,'work_item_id',v_item.id,'approved_proposal_version',v_item.proposal_version,
      'owner_instance_id',v_claim.owner_instance_id,'attempt_id',p_attempt_id,
      'reason','attempt_finished','released_at',v_now)));
  RETURN jsonb_build_object('requestEventId',v_request.id,'claimReleased',true);
END $$;

CREATE FUNCTION public.human_decision_resumption_source(p_work_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog STABLE
AS $$
DECLARE v_uid uuid:=auth.uid(); v_item public.work_items; v_answer public.work_events; v_request public.work_events;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid)
    THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM public.work_items i WHERE i.id=p_work_item_id AND i.user_id=v_uid;
  IF NOT FOUND OR v_item.state<>'approved' THEN RETURN NULL; END IF;
  SELECT * INTO v_answer FROM public.work_events e WHERE e.work_item_id=v_item.id
    AND e.event_type='input_provided' AND e.proposal_version=v_item.proposal_version
    AND e.payload->'data'->>'effect'='resume' ORDER BY e.seq DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_request FROM public.work_events e WHERE e.id=(v_answer.payload->'data'->>'input_requested_event_id')::uuid
    AND e.work_item_id=v_item.id AND e.event_type='input_requested'
    AND e.proposal_version=v_item.proposal_version AND e.payload->'data'->'handoff' IS NOT NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
    AND e.seq>v_answer.seq AND e.payload->'data'->>'resumed_from_input_provided_event_id'=v_answer.id::text)
    THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('kind','human_decision_checkpoint','handoff',v_request.payload->'data'->'handoff',
    'input_requested_event_id',v_request.id,'input_provided_event_id',v_answer.id,
    'checkpoint_event_seq',v_request.payload->'data'->'checkpoint_event_seq',
    'previous_attempt_ids',(SELECT coalesce(jsonb_agg(DISTINCT e.payload->'data'->>'attempt_id'),'[]'::jsonb)
      FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'));
END $$;

CREATE FUNCTION public.begin_human_decision_resumed_attempt(
  work_item_id uuid,expected_proposal_version integer,input_requested_event_id uuid,input_provided_event_id uuid,
  claim_id uuid,attempt_id uuid,owner_instance_id text,lease_seconds integer,executor_id text)
RETURNS public.work_items LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_uid uuid:=auth.uid(); v_now timestamptz:=now(); v_item public.work_items;
  v_request public.work_events; v_answer public.work_events; v_existing public.work_events;
  v_cp public.work_events; v_claim public.work_claims; v_target text; v_source_attempt uuid; v_cp_seq integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid)
    THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  IF input_requested_event_id IS NULL OR input_provided_event_id IS NULL OR claim_id IS NULL OR attempt_id IS NULL
    OR length(btrim(owner_instance_id))=0 OR length(btrim(executor_id))=0 OR lease_seconds<=0
    THEN RAISE EXCEPTION 'invalid decision resumption request' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_existing FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
    AND e.payload->'data'->>'attempt_id'=attempt_id::text;
  IF FOUND THEN
    IF v_existing.payload->'data'->>'resumed_from_input_provided_event_id'=input_provided_event_id::text THEN RETURN v_item; END IF;
    RAISE EXCEPTION 'attempt correlation conflict' USING ERRCODE='55000';
  END IF;
  IF v_item.state<>'approved' OR v_item.proposal_version<>expected_proposal_version
    THEN RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_answer FROM public.work_events e WHERE e.id=input_provided_event_id AND e.work_item_id=v_item.id
    AND e.event_type='input_provided' AND e.proposal_version=expected_proposal_version
    AND e.payload->'data'->>'input_requested_event_id'=input_requested_event_id::text
    AND e.payload->'data'->>'effect'='resume';
  IF NOT FOUND THEN RAISE EXCEPTION 'resume decision not found' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_request FROM public.work_events e WHERE e.id=input_requested_event_id AND e.work_item_id=v_item.id
    AND e.event_type='input_requested' AND e.proposal_version=expected_proposal_version
    AND e.payload->'data'->'handoff' IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'decision checkpoint handoff not found' USING ERRCODE='55000'; END IF;
  v_source_attempt:=(v_request.payload->'data'->>'attempt_id')::uuid;
  SELECT * INTO v_cp FROM public.work_events e WHERE e.seq=(v_request.payload->'data'->>'checkpoint_event_seq')::bigint
    AND e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
    AND e.payload->'data'->>'attempt_id'=v_source_attempt::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'valid checkpoint not found' USING ERRCODE='55000'; END IF;
  v_cp_seq:=(v_cp.payload->'data'->>'signal_sequence')::integer;
  IF EXISTS(SELECT 1 FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
    AND e.payload->'data'->>'attempt_id'=v_source_attempt::text
    AND (e.payload->'data'->>'signal_sequence')::integer>v_cp_seq)
    THEN RAISE EXCEPTION 'checkpoint is obsolete' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM public.work_claims c WHERE c.id=claim_id)
    OR EXISTS(SELECT 1 FROM public.work_events e WHERE e.payload->'data'->>'attempt_id'=attempt_id::text
      AND e.event_type NOT IN ('work_routing_adjusted','work_routing_decided'))
    THEN RAISE EXCEPTION 'resumption identity reused' USING ERRCODE='55000'; END IF;
  v_target:=btrim(v_item.intent#>>'{execution_spec,target,reference}');
  PERFORM pg_advisory_xact_lock(hashtextextended('work_target:'||v_uid::text||':'||v_target,0));
  IF EXISTS(SELECT 1 FROM public.work_claims c WHERE c.user_id=v_uid AND c.released_at IS NULL
    AND c.expires_at>v_now AND (c.work_item_id=v_item.id OR c.target_reference=v_target))
    THEN RAISE EXCEPTION 'work target is held by an active claim' USING ERRCODE='55000'; END IF;
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
      jsonb_build_object('reason','human_decision_resumed','attempt_id',attempt_id,'claim_id',claim_id,
        'resumed_from_attempt_id',v_source_attempt,'resumed_from_checkpoint_sequence',v_cp_seq,
        'resumed_from_checkpoint_event_seq',v_cp.seq,'resumed_from_input_requested_event_id',v_request.id,
        'resumed_from_input_provided_event_id',v_answer.id))),
    (v_item.id,'execution_started','anima',expected_proposal_version,jsonb_build_object('schema_version',1,'data',
      jsonb_build_object('work_item_id',v_item.id,'attempt_id',attempt_id,'approved_proposal_version',expected_proposal_version,
        'origin','anima','executor_id',btrim(executor_id),'claim_id',claim_id,'reason','human_decision_resumed',
        'resumed_from_attempt_id',v_source_attempt,'resumed_from_checkpoint_sequence',v_cp_seq,
        'resumed_from_checkpoint_event_seq',v_cp.seq,'resumed_from_input_requested_event_id',v_request.id,
        'resumed_from_input_provided_event_id',v_answer.id)));
  RETURN v_item;
END $$;

REVOKE ALL ON FUNCTION public.human_decision_resumption_source(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.begin_human_decision_resumed_attempt(uuid,integer,uuid,uuid,uuid,uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.human_decision_resumption_source(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.begin_human_decision_resumed_attempt(uuid,integer,uuid,uuid,uuid,uuid,text,integer,text) TO authenticated,service_role;
