-- Observabilidade read-only do orçamento autônomo na CLI.
-- Enriquece o reader já usado pelo Supervisor sem alterar a decisão canônica,
-- limites, guarda atômica, eventos ou estados. Expirações vêm exclusivamente dos
-- timestamps persistidos de execution_started sob claim.

CREATE OR REPLACE FUNCTION public.autonomous_work_budget_status(p_work_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
STABLE
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_decision jsonb;
  v_usage jsonb;
  v_item_next timestamptz;
  v_user_next timestamptz;
  v_external_next timestamptz;
  v_next_budget timestamptz;
  v_cost_class text;
  v_release_offset integer;
  v_external_attempt_policy boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  v_decision := private.autonomous_work_budget_decision(v_uid, p_work_item_id, v_now);
  IF v_decision IS NULL THEN RETURN NULL; END IF;
  v_usage := v_decision->'usage';

  SELECT private.work_item_cost_class(i.intent) INTO v_cost_class
  FROM public.work_items i WHERE i.id=p_work_item_id AND i.user_id=v_uid;

  SELECT
    min(e.created_at + interval '24 hours') FILTER (WHERE e.work_item_id=p_work_item_id),
    min(e.created_at + interval '24 hours'),
    min(e.created_at + interval '24 hours') FILTER (WHERE private.work_item_cost_class(i.intent)='external')
  INTO v_item_next, v_user_next, v_external_next
  FROM public.work_events e
  JOIN public.work_items i ON i.id=e.work_item_id
  WHERE i.user_id=v_uid AND e.event_type='execution_started'
    AND e.payload->'data' ? 'claim_id' AND e.payload->'data'->>'claim_id' IS NOT NULL
    AND e.created_at>v_now-interval '24 hours';

  -- "Liberação" não é necessariamente a primeira expiração: se o consumo passou
  -- do teto, seleciona o N-ésimo start cuja saída torna a decisão admissível.
  IF v_decision->>'reason'='item_attempt_budget_exhausted' THEN
    v_release_offset:=greatest(0,(v_usage->>'itemAttempts24Hours')::integer-(v_decision->>'effectiveItemAttemptLimit')::integer);
    SELECT e.created_at+interval '24 hours' INTO v_next_budget
    FROM public.work_events e
    WHERE e.work_item_id=p_work_item_id AND e.event_type='execution_started'
      AND e.payload->'data' ? 'claim_id' AND e.payload->'data'->>'claim_id' IS NOT NULL
      AND e.created_at>v_now-interval '24 hours'
    ORDER BY e.created_at OFFSET v_release_offset LIMIT 1;
  ELSIF v_decision->>'reason'='user_attempt_budget_exhausted' THEN
    -- A policy V2 expõe remainingExternalAttempts; a V1 vigente conta todas.
    -- A escolha vem do próprio contrato da decisão, não da CLI.
    v_external_attempt_policy:=v_decision ? 'remainingExternalAttempts';
    v_release_offset:=greatest(0,
      CASE WHEN v_external_attempt_policy THEN coalesce((v_usage->>'externalAttempts24Hours')::integer,0)
           ELSE (v_usage->>'userAttempts24Hours')::integer END-6);
    SELECT e.created_at+interval '24 hours' INTO v_next_budget
    FROM public.work_events e JOIN public.work_items i ON i.id=e.work_item_id
    WHERE i.user_id=v_uid AND e.event_type='execution_started'
      AND e.payload->'data' ? 'claim_id' AND e.payload->'data'->>'claim_id' IS NOT NULL
      AND e.created_at>v_now-interval '24 hours'
      AND (NOT v_external_attempt_policy OR private.work_item_cost_class(i.intent)='external')
    ORDER BY e.created_at OFFSET v_release_offset LIMIT 1;
  END IF;

  RETURN v_decision || jsonb_build_object(
    'observedAt',v_now,
    'costClass',v_cost_class,
    'windows',jsonb_build_object('attemptsHours',24,'userRuntimeHours',24,'autonomousRuntimeMinutes',60),
    'attempts',jsonb_build_object(
      'item',jsonb_build_object('used',(v_usage->>'itemAttempts24Hours')::integer,
        'limit',(v_decision->>'effectiveItemAttemptLimit')::integer,
        'remaining',greatest(0,(v_decision->>'effectiveItemAttemptLimit')::integer-(v_usage->>'itemAttempts24Hours')::integer),
        'nextReleaseAt',v_item_next),
      'user',jsonb_build_object('used',(v_usage->>'userAttempts24Hours')::integer,
        'remaining',(v_decision->>'remainingUserAttempts')::integer,'nextReleaseAt',v_user_next),
      'external',jsonb_build_object('used',coalesce((v_usage->>'externalAttempts24Hours')::integer,0),
        'remaining',greatest(0,6-coalesce((v_usage->>'externalAttempts24Hours')::integer,0)),'nextReleaseAt',v_external_next)),
    'runtime',jsonb_build_object(
      'user24h',jsonb_build_object('usedSeconds',(v_usage->>'userRuntimeSeconds24Hours')::numeric,
        'remainingSeconds',(v_decision->>'remainingRuntimeSeconds24Hours')::numeric),
      'external24h',jsonb_build_object('usedSeconds',coalesce((v_usage->>'externalRuntimeSeconds24Hours')::numeric,0),
        'remainingSeconds',greatest(0,7200-coalesce((v_usage->>'externalRuntimeSeconds24Hours')::numeric,0))),
      'autonomous60m',jsonb_build_object('usedSeconds',(v_usage->>'autonomousRuntimeSeconds60Minutes')::numeric,
        'remainingSeconds',(v_decision->>'remainingAutonomousRuntimeSeconds60Minutes')::numeric)),
    'nextBudgetReleaseAt',v_next_budget);
END;
$$;

REVOKE ALL ON FUNCTION public.autonomous_work_budget_status(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.autonomous_work_budget_status(uuid) TO authenticated,service_role;

COMMENT ON FUNCTION public.autonomous_work_budget_status(uuid) IS
  'INTEL-04: reader canônico read-only da decisão e consumo do orçamento, enriquecido com janelas e próximas expirações derivadas de execution_started persistidos. Não muta nem readmite trabalho.';
