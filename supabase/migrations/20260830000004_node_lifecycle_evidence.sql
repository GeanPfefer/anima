CREATE FUNCTION private.is_valid_node_lifecycle_evidence(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'object' OR p->'schemaVersion' <> '1'::jsonb THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p->'nodeId') OR NOT private.jsonb_is_nonblank_string(p->'providerId') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p->'leaseId') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p->'workItemId') THEN false
    WHEN p->'attemptId' IS DISTINCT FROM 'null'::jsonb AND NOT private.jsonb_is_nonblank_string(p->'attemptId') THEN false
    WHEN p->>'billingMode' NOT IN ('owned','already_provisioned','paid') THEN false
    WHEN jsonb_typeof(p->'transition') <> 'object' THEN false
    WHEN p->'transition'->>'from' NOT IN ('offline','provisioning','ready','busy','idle','shutting_down','provision_failed','health_failed','shutdown_failed') THEN false
    WHEN p->'transition'->>'to' NOT IN ('offline','provisioning','ready','busy','idle','shutting_down','provision_failed','health_failed','shutdown_failed') THEN false
    WHEN p->'transition'->>'event' NOT IN ('provision_requested','health_confirmed','provision_failed','health_lost','reserved','released','shutdown_requested','shutdown_confirmed','shutdown_failed') THEN false
    WHEN jsonb_typeof(p->'healthy') <> 'boolean' THEN false
    WHEN jsonb_typeof(p->'activeDurationMs') <> 'number' OR (p->>'activeDurationMs')::numeric < 0
      OR (p->>'activeDurationMs')::numeric <> trunc((p->>'activeDurationMs')::numeric) THEN false
    WHEN p->>'billingMode'='paid' AND NOT private.jsonb_is_nonblank_string(p->'authorizationRef') THEN false
    WHEN p->>'billingMode'<>'paid' AND p->'authorizationRef' IS DISTINCT FROM 'null'::jsonb THEN false
    WHEN p->'estimatedCost' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(p->'estimatedCost') <> 'object'
      OR NOT private.jsonb_is_nonblank_string(p->'estimatedCost'->'currency')
      OR jsonb_typeof(p->'estimatedCost'->'amount') <> 'number'
      OR (p->'estimatedCost'->>'amount')::numeric < 0) THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p->'observedAt') THEN false
    ELSE true
  END;
$$;

REVOKE ALL ON FUNCTION private.is_valid_node_lifecycle_evidence(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_valid_node_lifecycle_evidence(jsonb) TO service_role;

CREATE UNIQUE INDEX work_events_node_lifecycle_semantic_idx ON public.work_events (
  (payload->'data'->>'work_item_id'),
  (payload->'data'->>'node_id'),
  (payload->'data'->>'lease_id'),
  COALESCE(payload->'data'->>'attempt_id',''),
  (payload->'data'->'evidence'->'transition'->>'from'),
  (payload->'data'->'evidence'->'transition'->>'to'),
  (payload->'data'->'evidence'->'transition'->>'event')
) WHERE event_type='host_observed_node_lifecycle_recorded';

CREATE FUNCTION public.record_host_observed_node_lifecycle(
  work_item_id uuid,
  expected_proposal_version integer,
  evidence jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  v_user_id uuid:=auth.uid(); v_item public.work_items; v_attempt uuid;
  v_existing public.work_events; v_seq bigint;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version<1
    OR NOT private.is_valid_node_lifecycle_evidence(evidence) THEN
    RAISE EXCEPTION 'invalid node lifecycle evidence' USING ERRCODE='22023';
  END IF;
  IF evidence->>'workItemId' IS DISTINCT FROM work_item_id::text THEN
    RAISE EXCEPTION 'node lifecycle evidence correlation mismatch' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.proposal_version IS DISTINCT FROM expected_proposal_version THEN
    RAISE EXCEPTION 'proposal version mismatch' USING ERRCODE='40001';
  END IF;
  IF evidence->>'attemptId' IS NOT NULL THEN
    v_attempt := (evidence->>'attemptId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.work_events e WHERE e.work_item_id=v_item.id
      AND e.event_type='execution_started' AND e.proposal_version=expected_proposal_version
      AND e.payload->'data'->>'attempt_id'=v_attempt::text) THEN
      RAISE EXCEPTION 'attempt not found' USING ERRCODE='P0002';
    END IF;
  END IF;
  SELECT * INTO v_existing FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='host_observed_node_lifecycle_recorded'
    AND e.payload->'data'->>'node_id'=evidence->>'nodeId'
    AND e.payload->'data'->>'lease_id'=evidence->>'leaseId'
    AND COALESCE(e.payload->'data'->>'attempt_id','')=COALESCE(evidence->>'attemptId','')
    AND e.payload->'data'->'evidence'->'transition'=evidence->'transition';
  IF FOUND THEN
    IF (v_existing.payload->'data'->'evidence')-'observedAt'=evidence-'observedAt' THEN
      RETURN jsonb_build_object('action','replayed','event_seq',v_existing.seq);
    END IF;
    RAISE EXCEPTION 'node lifecycle evidence conflict' USING ERRCODE='55000';
  END IF;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'host_observed_node_lifecycle_recorded','system',expected_proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'work_item_id',v_item.id,'attempt_id',v_attempt,'node_id',evidence->>'nodeId','lease_id',evidence->>'leaseId',
      'origin','host','evidence',evidence))) RETURNING seq INTO v_seq;
  RETURN jsonb_build_object('action','recorded','event_seq',v_seq);
END;
$$;

REVOKE ALL ON FUNCTION public.record_host_observed_node_lifecycle(uuid,integer,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_host_observed_node_lifecycle(uuid,integer,jsonb) TO authenticated, service_role;
