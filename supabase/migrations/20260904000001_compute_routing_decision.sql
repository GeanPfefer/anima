ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'compute_routing_decided';

CREATE OR REPLACE FUNCTION public.record_compute_routing_decision(
  p_work_item_id uuid,
  p_expected_proposal_version integer,
  p_decision_id uuid,
  p_attempt_id uuid,
  p_decision jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_existing public.work_events;
  v_event public.work_events;
  v_status text;
  v_provider text;
  v_authorization text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id)
    THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  IF p_expected_proposal_version IS NULL OR p_expected_proposal_version < 1 OR p_decision_id IS NULL
    OR jsonb_typeof(p_decision) <> 'object'
    OR p_decision->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR p_decision->>'policyVersion' <> 'compute-router-v1'
    OR p_decision->>'workItemId' <> p_work_item_id::text
    OR p_decision->>'approvedProposalVersion' <> p_expected_proposal_version::text
    OR NOT private.jsonb_is_nonblank_string(p_decision->'reasonCode')
    OR NOT private.jsonb_is_nonblank_string(p_decision->'reason')
    OR jsonb_typeof(p_decision->'alternativesConsidered') <> 'array'
    OR jsonb_array_length(p_decision->'alternativesConsidered') <> 2
    OR jsonb_typeof(p_decision->'fallbackChain') <> 'array'
    OR jsonb_typeof(p_decision->'paidAuthorityRequired') <> 'boolean'
    OR jsonb_typeof(p_decision->'economicsBasis') <> 'object'
  THEN RAISE EXCEPTION 'invalid compute routing decision' USING ERRCODE='22023'; END IF;
  v_status := p_decision->>'status';
  v_provider := p_decision->>'selectedProvider';
  v_authorization := p_decision->>'authorizationId';
  IF v_status NOT IN ('selected','waiting_for_human_authorization','blocked')
    OR (v_status='selected' AND (v_provider NOT IN ('ollama','openai') OR p_attempt_id IS NULL))
    OR (v_status<>'selected' AND (v_provider IS NOT NULL OR p_attempt_id IS NOT NULL))
    OR (v_provider='openai' AND (v_authorization IS NULL OR btrim(v_authorization)=''))
    OR (v_provider IS DISTINCT FROM 'openai' AND v_authorization IS NOT NULL)
  THEN RAISE EXCEPTION 'invalid compute routing authority correlation' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_item FROM public.work_items i
    WHERE i.id=p_work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.state <> 'approved' OR v_item.proposal_version <> p_expected_proposal_version
    OR p_decision->>'capability' <> v_item.capability::text
  THEN RAISE EXCEPTION 'work item state, version or capability changed' USING ERRCODE='55000'; END IF;

  SELECT * INTO v_existing FROM public.work_events e
    WHERE e.work_item_id=p_work_item_id AND e.event_type='compute_routing_decided'
      AND e.payload->'data'->>'decision_id'=p_decision_id::text LIMIT 1;
  IF FOUND THEN
    IF v_existing.proposal_version=p_expected_proposal_version
      AND v_existing.payload->'data'->'decision'=p_decision
      AND v_existing.payload->'data'->>'attempt_id' IS NOT DISTINCT FROM p_attempt_id::text
    THEN RETURN jsonb_build_object('action','replayed','event_id',v_existing.id,'event_seq',v_existing.seq); END IF;
    RAISE EXCEPTION 'compute routing decision conflict' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(p_work_item_id,'compute_routing_decided','system',p_expected_proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'work_item_id',p_work_item_id,'approved_proposal_version',p_expected_proposal_version,
      'decision_id',p_decision_id,'attempt_id',p_attempt_id,'decision',p_decision))) RETURNING * INTO v_event;
  RETURN jsonb_build_object('action','recorded','event_id',v_event.id,'event_seq',v_event.seq);
END;
$$;

REVOKE ALL ON FUNCTION public.record_compute_routing_decision(uuid,integer,uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_compute_routing_decision(uuid,integer,uuid,uuid,jsonb) TO authenticated,service_role;
