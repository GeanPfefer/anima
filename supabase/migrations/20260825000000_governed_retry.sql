-- Retry governado V0. A falha continua terminal e append-only; RETRY_READY e
-- derivado dos fatos persistidos. O ato humano usa `work_approved` com autoridade
-- `retry_authorization` (nao e uma nova aprovacao de escopo nem autorizacao financeira).

INSERT INTO private.work_state_transitions(from_state,event_type,to_state)
VALUES ('failed','work_approved','approved')
ON CONFLICT DO NOTHING;

CREATE FUNCTION private.work_retry_readiness(p_user_id uuid,p_work_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE
  v_item public.work_items; v_failure public.work_events; v_attempts integer;
  v_max integer; v_reason text; v_attempt_id text;
BEGIN
  SELECT * INTO v_item FROM public.work_items i
   WHERE i.id=p_work_item_id AND i.user_id=p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','BLOCKED','reason','item_not_found'); END IF;

  SELECT * INTO v_failure FROM public.work_events e
   WHERE e.work_item_id=v_item.id
     AND e.event_type IN ('result_submitted','execution_failed','work_cancelled','attempt_abandoned')
   ORDER BY e.seq DESC LIMIT 1;
  v_attempt_id:=v_failure.payload->'data'->>'attempt_id';
  SELECT count(DISTINCT e.payload->'data'->>'attempt_id') INTO v_attempts
    FROM public.work_events e WHERE e.work_item_id=v_item.id
      AND e.event_type='execution_started' AND e.proposal_version=v_item.proposal_version;
  v_max:=CASE WHEN (v_item.intent#>>'{execution_spec,limits,max_attempts}')~'^[1-9][0-9]*$'
    THEN (v_item.intent#>>'{execution_spec,limits,max_attempts}')::integer ELSE 0 END;

  v_reason:=CASE
    WHEN v_item.state<>'failed' THEN 'item_not_failed'
    WHEN v_failure.id IS NULL OR v_failure.event_type<>'execution_failed' THEN 'latest_terminal_not_retryable_failure'
    WHEN v_failure.proposal_version IS DISTINCT FROM v_item.proposal_version THEN 'proposal_changed'
    WHEN v_failure.payload->'data'->>'retryable' IS DISTINCT FROM 'true' THEN 'failure_not_retryable'
    WHEN v_attempt_id IS NULL THEN 'failure_attempt_missing'
    WHEN v_max<1 OR v_attempts>=v_max THEN 'attempt_budget_exhausted'
    WHEN NOT EXISTS(SELECT 1 FROM public.work_events e WHERE e.work_item_id=v_item.id
      AND e.event_type='work_approved' AND e.proposal_version=v_item.proposal_version
      AND e.seq<v_failure.seq) THEN 'approval_missing'
    WHEN private.autonomous_intelligence_eligibility(v_item.id,v_item.proposal_version)->>'eligible' IS DISTINCT FROM 'true' THEN 'classification_invalid'
    WHEN NOT private.autonomous_work_dependencies_satisfied(p_user_id,v_item.id,v_item.intent) THEN 'dependencies_unsatisfied'
    WHEN EXISTS(SELECT 1 FROM public.work_claims c WHERE c.work_item_id=v_item.id AND c.released_at IS NULL) THEN 'open_claim'
    WHEN EXISTS(SELECT 1 FROM public.work_events s WHERE s.work_item_id=v_item.id AND s.event_type='execution_started'
      AND NOT EXISTS(SELECT 1 FROM public.work_events t WHERE t.work_item_id=s.work_item_id
        AND t.payload->'data'->>'attempt_id'=s.payload->'data'->>'attempt_id'
        AND t.event_type IN ('result_submitted','execution_failed','work_cancelled','attempt_abandoned'))) THEN 'active_attempt'
    WHEN NOT private.is_autonomously_eligible('approved',v_item.proposal,v_item.intent) THEN 'target_or_envelope_invalid'
    ELSE NULL END;
  RETURN jsonb_build_object(
    'status',CASE WHEN v_reason IS NULL THEN 'RETRY_READY' ELSE 'BLOCKED' END,
    'reason',v_reason,'attemptsUsed',v_attempts,'maxAttempts',v_max,
    'remainingAttempts',greatest(0,v_max-v_attempts),'sourceAttemptId',v_attempt_id,
    'failureEventId',v_failure.id,'proposalVersion',v_item.proposal_version);
END; $$;
REVOKE ALL ON FUNCTION private.work_retry_readiness(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.work_retry_readiness(uuid,uuid) TO service_role;

CREATE FUNCTION public.current_work_retry_readiness(p_work_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_uid uuid:=auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid)
    THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  RETURN private.work_retry_readiness(v_uid,p_work_item_id);
END; $$;
REVOKE ALL ON FUNCTION public.current_work_retry_readiness(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_work_retry_readiness(uuid) TO authenticated,service_role;

CREATE FUNCTION public.request_work_retry(
  p_work_item_id uuid,p_expected_proposal_version integer,
  p_failure_event_id uuid,p_retry_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_uid uuid:=auth.uid(); v_item public.work_items; v_ready jsonb; v_existing public.work_events; v_event public.work_events;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF p_retry_request_id IS NULL OR p_failure_event_id IS NULL THEN RAISE EXCEPTION 'invalid retry request' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_item FROM public.work_items i WHERE i.id=p_work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_existing FROM public.work_events e WHERE e.work_item_id=v_item.id
    AND e.event_type='work_approved' AND e.payload->'data'->>'authority'='retry_authorization'
    AND e.payload->'data'->>'retry_request_id'=p_retry_request_id::text ORDER BY e.seq DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('eventId',v_existing.id,'replayed',true,'state',v_item.state); END IF;
  IF v_item.proposal_version<>p_expected_proposal_version THEN RAISE EXCEPTION 'proposal version changed' USING ERRCODE='40001'; END IF;
  v_ready:=private.work_retry_readiness(v_uid,v_item.id);
  IF v_ready->>'status'<>'RETRY_READY' OR v_ready->>'failureEventId'<>p_failure_event_id::text
    THEN RAISE EXCEPTION 'retry is not ready: %',coalesce(v_ready->>'reason','failure_changed') USING ERRCODE='55000'; END IF;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'work_approved','user',v_item.proposal_version,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'decision','retry','authority','retry_authorization','decided_proposal_version',v_item.proposal_version,
    'retry_request_id',p_retry_request_id,'failure_event_id',p_failure_event_id,
    'source_attempt_id',v_ready->>'sourceAttemptId','attempts_used',(v_ready->>'attemptsUsed')::integer,
    'max_attempts',(v_ready->>'maxAttempts')::integer))) RETURNING * INTO v_event;
  UPDATE public.work_items SET state='approved',updated_at=now() WHERE id=v_item.id;
  RETURN jsonb_build_object('eventId',v_event.id,'replayed',false,'state','approved');
END; $$;
REVOKE ALL ON FUNCTION public.request_work_retry(uuid,integer,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_work_retry(uuid,integer,uuid,uuid) TO authenticated,service_role;

COMMENT ON FUNCTION public.request_work_retry(uuid,integer,uuid,uuid) IS
  'Reentrada humana idempotente de uma falha tecnica retryable dentro do budget. Preserva attempt/falha, nao cria claim/attempt e nao concede autoridade financeira.';

CREATE FUNCTION public.request_autonomous_execution(
  p_work_item_id uuid,p_expected_proposal_version integer,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_uid uuid:=auth.uid(); v_item public.work_items; v_existing public.work_events; v_event public.work_events;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM public.work_items i WHERE i.id=p_work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_existing FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='work_approved'
    AND e.payload->'data'->>'authority'='autonomous_execution_request'
    AND e.payload->'data'->>'request_id'=p_request_id::text LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('eventId',v_existing.id,'replayed',true); END IF;
  IF v_item.state<>'approved' OR v_item.proposal_version<>p_expected_proposal_version
    OR NOT EXISTS(SELECT 1 FROM public.autonomous_work_queue() q WHERE q.work_item_id=v_item.id)
    THEN RAISE EXCEPTION 'work item is not eligible for autonomous execution' USING ERRCODE='55000'; END IF;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'work_approved','user',v_item.proposal_version,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'decision','execute','authority','autonomous_execution_request','decided_proposal_version',v_item.proposal_version,'request_id',p_request_id)))
  RETURNING * INTO v_event;
  RETURN jsonb_build_object('eventId',v_event.id,'replayed',false);
END; $$;
REVOKE ALL ON FUNCTION public.request_autonomous_execution(uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_autonomous_execution(uuid,integer,uuid) TO authenticated,service_role;

COMMENT ON FUNCTION public.request_autonomous_execution(uuid,integer,uuid) IS
  'Sinal humano autenticado e idempotente para o Resident Host. Nao cria claim, attempt nem executa comandos no processo web.';
