-- INTEL-03: histórico consultável e ajuste de esforço validado no servidor.

CREATE FUNCTION private.work_routing_adjustment_context(
  p_work_item_id uuid,
  p_proposal_version integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path=pg_catalog
AS $$
  WITH starts AS (
    SELECT s.seq, s.payload #>> '{data,attempt_id}' AS attempt_id
    FROM public.work_events s
    WHERE s.work_item_id=p_work_item_id
      AND s.proposal_version=p_proposal_version
      AND s.event_type='execution_started'
  ), attempts AS (
    SELECT s.seq, s.attempt_id,
      terminal.event_type::text AS outcome,
      route.payload #>> '{data,decision,selected,effort}' AS selected_effort,
      COALESCE(adjustment.payload #>> '{data,adjustment,kind}','none') AS adjustment
    FROM starts s
    LEFT JOIN LATERAL (
      SELECT e.event_type
      FROM public.work_events e
      WHERE e.work_item_id=p_work_item_id
        AND e.proposal_version=p_proposal_version
        AND e.payload #>> '{data,attempt_id}'=s.attempt_id
        AND e.event_type IN ('result_submitted','execution_failed','work_cancelled','attempt_abandoned')
      ORDER BY e.seq DESC LIMIT 1
    ) terminal ON true
    JOIN public.work_events route
      ON route.work_item_id=p_work_item_id
     AND route.proposal_version=p_proposal_version
     AND route.event_type='work_routing_decided'
     AND route.payload #>> '{data,attempt_id}'=s.attempt_id
    LEFT JOIN public.work_events adjustment
      ON adjustment.work_item_id=p_work_item_id
     AND adjustment.proposal_version=p_proposal_version
     AND adjustment.event_type='work_routing_adjusted'
     AND adjustment.payload #>> '{data,attempt_id}'=s.attempt_id
    WHERE terminal.event_type IS NOT NULL
  ), latest_checkpoint AS (
    SELECT e.payload #>> '{data,attempt_id}' AS attempt_id,
      e.payload #>> '{data,checkpoint,nextStep}' AS next_step,
      COALESCE(e.payload #> '{data,checkpoint,remainingSteps}','[]'::jsonb) AS remaining_steps,
      COALESCE(e.payload #> '{data,checkpoint,failures}','[]'::jsonb) AS failures
    FROM public.work_events e
    WHERE e.work_item_id=p_work_item_id
      AND e.proposal_version=p_proposal_version
      AND e.event_type='checkpoint_recorded'
    ORDER BY e.seq DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'schemaVersion',1,
    'attempts',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'attemptId',a.attempt_id,'outcome',a.outcome,
        'selectedEffort',a.selected_effort,'adjustment',a.adjustment
      ) ORDER BY a.seq) FROM attempts a
    ),'[]'::jsonb),
    'latestCheckpoint',(SELECT jsonb_build_object(
      'attemptId',c.attempt_id,'nextStep',COALESCE(c.next_step,''),
      'remainingSteps',c.remaining_steps,'failures',c.failures
    ) FROM latest_checkpoint c)
  )
$$;

REVOKE ALL ON FUNCTION private.work_routing_adjustment_context(uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.work_routing_adjustment_context(uuid,integer) TO service_role;

CREATE FUNCTION private.expected_work_routing_adjustment(
  p_work_item_id uuid,
  p_proposal_version integer,
  p_baseline text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path=pg_catalog
AS $$
DECLARE
  v_context jsonb:=private.work_routing_adjustment_context(p_work_item_id,p_proposal_version);
  v_attempt jsonb; v_previous jsonb; v_checkpoint jsonb;
  v_failures integer:=0; v_ids jsonb:='[]'::jsonb;
  v_kind text:='none'; v_effective text:=p_baseline; v_reason text:='baseline_sufficient';
BEGIN
  FOR v_attempt IN
    SELECT value FROM jsonb_array_elements(v_context->'attempts') WITH ORDINALITY t(value,n)
    ORDER BY n DESC
  LOOP
    IF v_previous IS NULL THEN v_previous:=v_attempt; END IF;
    EXIT WHEN v_attempt->>'outcome' NOT IN ('execution_failed','attempt_abandoned');
    v_failures:=v_failures+1;
    v_ids:=v_ids||jsonb_build_array(v_attempt->>'attemptId');
  END LOOP;
  v_checkpoint:=v_context->'latestCheckpoint';
  IF v_previous->>'adjustment'='escalated'
    AND v_checkpoint->>'attemptId'=v_previous->>'attemptId'
    AND length(btrim(COALESCE(v_checkpoint->>'nextStep','')))>0
    AND jsonb_array_length(COALESCE(v_checkpoint->'remainingSteps','[]'::jsonb))>0
    AND jsonb_array_length(COALESCE(v_checkpoint->'failures','[]'::jsonb))=0
  THEN
    v_kind:='reduced'; v_effective:=p_baseline;
    v_reason:='consolidated_checkpoint_after_escalation';
    v_ids:=jsonb_build_array(v_previous->>'attemptId');
  ELSIF v_failures>=2 THEN
    IF p_baseline='light' THEN v_kind:='escalated'; v_effective:='standard'; v_reason:='two_consecutive_failures';
    ELSIF p_baseline='standard' THEN v_kind:='escalated'; v_effective:='strong'; v_reason:='two_consecutive_failures';
    ELSE v_reason:='already_at_strong'; END IF;
  END IF;
  RETURN jsonb_build_object(
    'schemaVersion',1,'policyVersion','work-routing-adjustment-v1',
    'kind',v_kind,'baselineEffort',p_baseline,'effectiveEffort',v_effective,
    'consecutiveFailures',v_failures,'evidenceAttemptIds',v_ids,'reason',v_reason
  );
END $$;

REVOKE ALL ON FUNCTION private.expected_work_routing_adjustment(uuid,integer,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.expected_work_routing_adjustment(uuid,integer,text) TO service_role;

CREATE FUNCTION public.work_routing_adjustment_context(p_work_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_uid uuid:=auth.uid(); v_item public.work_items;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid)
    THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM public.work_items i WHERE i.id=p_work_item_id AND i.user_id=v_uid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN private.work_routing_adjustment_context(v_item.id,v_item.proposal_version);
END $$;

REVOKE ALL ON FUNCTION public.work_routing_adjustment_context(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.work_routing_adjustment_context(uuid) TO authenticated,service_role;

CREATE UNIQUE INDEX work_events_routing_adjustment_attempt_idx
  ON public.work_events(work_item_id,(payload #>> '{data,attempt_id}'))
  WHERE event_type='work_routing_adjusted';

CREATE FUNCTION public.record_work_routing_adjustment(
  p_work_item_id uuid, p_expected_proposal_version integer,
  p_attempt_id uuid, p_adjustment jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_uid uuid:=auth.uid(); v_item public.work_items; v_classification public.work_events;
  v_expected jsonb; v_existing public.work_events; v_id uuid; v_seq bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid)
    THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  IF p_attempt_id IS NULL THEN RAISE EXCEPTION 'invalid work routing adjustment' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_item FROM public.work_items i
   WHERE i.id=p_work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.state<>'approved' OR v_item.proposal_version<>p_expected_proposal_version
    THEN RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_classification FROM public.work_events e
   WHERE e.work_item_id=v_item.id AND e.proposal_version=p_expected_proposal_version
     AND e.event_type='work_intelligence_classified'
     AND private.is_valid_work_intelligence_classification(e.payload#>'{data,classification}')
   ORDER BY (e.payload#>>'{data,classification_revision}')::integer DESC,e.seq DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'work intelligence classification missing or incomplete' USING ERRCODE='55000'; END IF;
  v_expected:=private.expected_work_routing_adjustment(
    v_item.id,p_expected_proposal_version,
    private.required_work_effort(v_classification.payload#>'{data,classification}')
  );
  IF p_adjustment IS DISTINCT FROM v_expected
    THEN RAISE EXCEPTION 'invalid work routing adjustment' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_existing FROM public.work_events e
   WHERE e.work_item_id=v_item.id AND e.event_type='work_routing_adjusted'
     AND e.payload#>>'{data,attempt_id}'=p_attempt_id::text;
  IF FOUND THEN
    IF v_existing.payload#>'{data,adjustment}'=p_adjustment THEN
      RETURN jsonb_build_object('action','replayed','event_id',v_existing.id,'event_seq',v_existing.seq);
    END IF;
    RAISE EXCEPTION 'work routing adjustment conflict' USING ERRCODE='55000';
  END IF;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'work_routing_adjusted','system',p_expected_proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'work_item_id',v_item.id,'approved_proposal_version',p_expected_proposal_version,
      'attempt_id',p_attempt_id,'adjustment',p_adjustment)))
  RETURNING id,seq INTO v_id,v_seq;
  RETURN jsonb_build_object('action','recorded','event_id',v_id,'event_seq',v_seq);
END $$;

REVOKE ALL ON FUNCTION public.record_work_routing_adjustment(uuid,integer,uuid,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_work_routing_adjustment(uuid,integer,uuid,jsonb)
  TO authenticated,service_role;
