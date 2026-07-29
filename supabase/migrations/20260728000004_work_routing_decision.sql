-- INTEL-02: persistência auditável da política V0 de roteamento.

CREATE FUNCTION private.required_work_effort(p_classification jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_classification ->> 'complexity' = 'complex'
      OR p_classification ->> 'risk' IN ('high','critical')
      OR p_classification ->> 'reversibility' = 'irreversible'
      OR p_classification ->> 'planClarity' = 'unclear'
      THEN 'strong'
    WHEN p_classification ->> 'complexity' = 'routine'
      AND p_classification ->> 'risk' = 'low'
      AND p_classification ->> 'reversibility' = 'reversible'
      AND p_classification ->> 'planClarity' = 'clear'
      THEN 'light'
    ELSE 'standard'
  END
$$;

REVOKE ALL ON FUNCTION private.required_work_effort(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.required_work_effort(jsonb) TO service_role;

CREATE FUNCTION private.is_valid_work_routing_decision(
  p_decision jsonb,
  p_capability public.work_capability,
  p_classification jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_selected jsonb;
  v_factors jsonb;
  v_rejected jsonb;
  v_entry jsonb;
  v_reason jsonb;
  v_required text;
  v_selected_effort text;
BEGIN
  IF p_decision IS NULL OR jsonb_typeof(p_decision) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_decision)) <> 7
    OR NOT (p_decision ?& ARRAY[
      'schemaVersion','policyVersion','capability','requiredEffort',
      'selected','factors','rejectedCandidates'
    ])
    OR p_decision -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR p_decision ->> 'policyVersion' <> 'work-routing-v1'
    OR p_decision ->> 'capability' <> p_capability::text
  THEN RETURN false; END IF;

  v_required := private.required_work_effort(p_classification);
  IF p_decision ->> 'requiredEffort' <> v_required THEN RETURN false; END IF;

  v_selected := p_decision -> 'selected';
  IF jsonb_typeof(v_selected) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(v_selected)) <> 5
    OR NOT (v_selected ?& ARRAY['routeId','executorId','providerRef','modelRef','effort'])
    OR NOT private.jsonb_is_nonblank_string(v_selected -> 'routeId')
    OR NOT private.jsonb_is_nonblank_string(v_selected -> 'executorId')
    OR NOT private.jsonb_is_nonblank_string(v_selected -> 'providerRef')
    OR NOT private.jsonb_is_nonblank_string(v_selected -> 'modelRef')
    OR v_selected ->> 'effort' NOT IN ('light','standard','strong')
  THEN RETURN false; END IF;
  v_selected_effort := v_selected ->> 'effort';
  IF (CASE v_selected_effort WHEN 'light' THEN 0 WHEN 'standard' THEN 1 ELSE 2 END)
     < (CASE v_required WHEN 'light' THEN 0 WHEN 'standard' THEN 1 ELSE 2 END)
  THEN RETURN false; END IF;

  v_factors := p_decision -> 'factors';
  IF jsonb_typeof(v_factors) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(v_factors)) <> 6
    OR NOT (v_factors ?& ARRAY[
      'complexity','risk','reversibility','planClarity','urgency','urgencyTieBreakApplied'
    ])
    OR v_factors ->> 'complexity' <> p_classification ->> 'complexity'
    OR v_factors ->> 'risk' <> p_classification ->> 'risk'
    OR v_factors ->> 'reversibility' <> p_classification ->> 'reversibility'
    OR v_factors ->> 'planClarity' <> p_classification ->> 'planClarity'
    OR v_factors ->> 'urgency' <> p_classification ->> 'urgency'
    OR jsonb_typeof(v_factors -> 'urgencyTieBreakApplied') <> 'boolean'
  THEN RETURN false; END IF;

  v_rejected := p_decision -> 'rejectedCandidates';
  IF jsonb_typeof(v_rejected) <> 'array' THEN RETURN false; END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_rejected)
  LOOP
    IF jsonb_typeof(v_entry) <> 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(v_entry)) <> 2
      OR NOT (v_entry ?& ARRAY['routeId','reasons'])
      OR NOT private.jsonb_is_nonblank_string(v_entry -> 'routeId')
      OR v_entry ->> 'routeId' = v_selected ->> 'routeId'
      OR jsonb_typeof(v_entry -> 'reasons') <> 'array'
      OR jsonb_array_length(v_entry -> 'reasons') = 0
    THEN RETURN false; END IF;
    FOR v_reason IN SELECT value FROM jsonb_array_elements(v_entry -> 'reasons')
    LOOP
      IF jsonb_typeof(v_reason) <> 'string'
        OR v_reason #>> '{}' NOT IN (
          'unavailable','capability_unsupported','effort_insufficient',
          'higher_effort_than_needed','tie_break_lost'
        )
      THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  IF (
    SELECT count(*) FROM jsonb_array_elements(v_rejected) entry
  ) <> (
    SELECT count(DISTINCT entry ->> 'routeId') FROM jsonb_array_elements(v_rejected) entry
  ) THEN RETURN false; END IF;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.is_valid_work_routing_decision(
  jsonb, public.work_capability, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_valid_work_routing_decision(
  jsonb, public.work_capability, jsonb
) TO service_role;

CREATE UNIQUE INDEX work_events_routing_attempt_idx
  ON public.work_events (
    work_item_id,
    (payload -> 'data' ->> 'attempt_id')
  )
  WHERE event_type = 'work_routing_decided';

CREATE FUNCTION public.record_work_routing_decision(
  p_work_item_id uuid,
  p_expected_proposal_version integer,
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
  v_classification_event public.work_events;
  v_existing public.work_events;
  v_event_id uuid;
  v_event_seq bigint;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id
  ) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF p_expected_proposal_version IS NULL OR p_expected_proposal_version < 1
    OR p_attempt_id IS NULL
  THEN RAISE EXCEPTION 'invalid work routing decision' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_item
  FROM public.work_items i
  WHERE i.id=p_work_item_id AND i.user_id=v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.state <> 'approved' OR v_item.proposal_version <> p_expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;

  SELECT * INTO v_classification_event
  FROM public.work_events e
  WHERE e.work_item_id=v_item.id
    AND e.event_type='work_intelligence_classified'
    AND e.proposal_version=p_expected_proposal_version
    AND private.is_valid_work_intelligence_classification(e.payload -> 'data' -> 'classification')
    AND private.autonomous_intelligence_eligibility(v_item.id,p_expected_proposal_version)
          ->> 'eligible'='true'
  ORDER BY
    CASE WHEN e.payload -> 'data' ->> 'classification_revision' ~ '^[1-9][0-9]*$'
      THEN (e.payload -> 'data' ->> 'classification_revision')::integer END DESC NULLS LAST,
    e.seq DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work intelligence classification missing or incomplete' USING ERRCODE='55000';
  END IF;
  IF NOT private.is_valid_work_routing_decision(
    p_decision, v_item.capability, v_classification_event.payload -> 'data' -> 'classification'
  ) THEN
    RAISE EXCEPTION 'invalid work routing decision' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.work_events e
  WHERE e.work_item_id=v_item.id
    AND e.event_type='work_routing_decided'
    AND e.payload -> 'data' ->> 'attempt_id'=p_attempt_id::text
  LIMIT 1;
  IF FOUND THEN
    IF v_existing.proposal_version=p_expected_proposal_version
      AND v_existing.payload -> 'data' ->> 'classification_event_id'=v_classification_event.id::text
      AND v_existing.payload -> 'data' -> 'decision'=p_decision
    THEN
      RETURN jsonb_build_object(
        'action','replayed','event_id',v_existing.id,'event_seq',v_existing.seq,
        'classification_event_id',v_classification_event.id,'attempt_id',p_attempt_id
      );
    END IF;
    RAISE EXCEPTION 'work routing decision conflict' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'work_routing_decided','system',p_expected_proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'work_item_id',v_item.id,
      'approved_proposal_version',p_expected_proposal_version,
      'attempt_id',p_attempt_id,
      'classification_event_id',v_classification_event.id,
      'decision',p_decision
    )))
  RETURNING id,seq INTO v_event_id,v_event_seq;

  RETURN jsonb_build_object(
    'action','recorded','event_id',v_event_id,'event_seq',v_event_seq,
    'classification_event_id',v_classification_event.id,'attempt_id',p_attempt_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_work_routing_decision(
  uuid,integer,uuid,jsonb
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_work_routing_decision(
  uuid,integer,uuid,jsonb
) TO authenticated,service_role;

CREATE FUNCTION public.work_routing_decision(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_user_id uuid:=auth.uid(); v_data jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id)
    THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  SELECT e.payload -> 'data' INTO v_data
  FROM public.work_events e
  JOIN public.work_items i ON i.id=e.work_item_id
  WHERE i.user_id=v_user_id AND e.event_type='work_routing_decided'
    AND e.payload -> 'data' ->> 'attempt_id'=p_attempt_id::text
  LIMIT 1;
  RETURN v_data;
END;
$$;

REVOKE ALL ON FUNCTION public.work_routing_decision(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.work_routing_decision(uuid)
  TO authenticated,service_role;
