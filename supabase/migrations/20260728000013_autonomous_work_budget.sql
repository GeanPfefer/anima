-- INTEL-04 — orçamento V0: tentativas + tempo, com reserva interativa.
-- Valores ratificados: item 3/24h (ou menor declarado), usuário 6/24h,
-- 120 min/24h e no máximo 45 min autônomos por janela móvel de 60 min.

CREATE FUNCTION private.autonomous_work_budget_usage(
  p_user_id uuid,
  p_work_item_id uuid,
  p_observed_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  WITH starts AS (
    SELECT
      e.work_item_id,
      e.created_at AS started_at,
      e.payload->'data'->>'attempt_id' AS attempt_id,
      (
        SELECT terminal.created_at
        FROM public.work_events terminal
        WHERE terminal.work_item_id=e.work_item_id
          AND terminal.created_at>=e.created_at
          AND terminal.event_type IN (
            'result_submitted','execution_failed','work_cancelled',
            'attempt_abandoned','work_blocked'
          )
          AND terminal.payload->'data'->>'attempt_id'=e.payload->'data'->>'attempt_id'
        ORDER BY terminal.seq
        LIMIT 1
      ) AS finished_at
    FROM public.work_events e
    JOIN public.work_items i ON i.id=e.work_item_id
    WHERE i.user_id=p_user_id
      AND e.event_type='execution_started'
      AND e.payload->'data' ? 'claim_id'
      AND e.payload->'data'->>'claim_id' IS NOT NULL
  )
  SELECT jsonb_build_object(
    'schemaVersion',1,
    'itemAttempts24Hours',count(*) FILTER (
      WHERE work_item_id=p_work_item_id
        AND started_at>p_observed_at-interval '24 hours'
    ),
    'userAttempts24Hours',count(*) FILTER (
      WHERE started_at>p_observed_at-interval '24 hours'
    ),
    'userRuntimeSeconds24Hours',coalesce(floor(sum(
      greatest(0,extract(epoch FROM
        least(coalesce(finished_at,p_observed_at),p_observed_at)
        - greatest(started_at,p_observed_at-interval '24 hours')
      ))
    )),0),
    'autonomousRuntimeSeconds60Minutes',coalesce(floor(sum(
      greatest(0,extract(epoch FROM
        least(coalesce(finished_at,p_observed_at),p_observed_at)
        - greatest(started_at,p_observed_at-interval '60 minutes')
      ))
    ) FILTER (WHERE coalesce(finished_at,p_observed_at)>p_observed_at-interval '60 minutes')),0)
  )
  FROM starts;
$$;

REVOKE ALL ON FUNCTION private.autonomous_work_budget_usage(uuid,uuid,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.autonomous_work_budget_usage(uuid,uuid,timestamptz)
  TO service_role;

CREATE FUNCTION private.autonomous_work_budget_decision(
  p_user_id uuid,
  p_work_item_id uuid,
  p_observed_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_usage jsonb;
  v_declared integer;
  v_item_limit integer;
  v_reason text;
BEGIN
  SELECT CASE
    WHEN jsonb_typeof(i.intent#>'{execution_spec,limits,max_attempts}')='number'
      AND (i.intent#>>'{execution_spec,limits,max_attempts}')~'^[0-9]+$'
      AND (i.intent#>>'{execution_spec,limits,max_attempts}')::integer>0
    THEN (i.intent#>>'{execution_spec,limits,max_attempts}')::integer
  END INTO v_declared
  FROM public.work_items i
  WHERE i.id=p_work_item_id AND i.user_id=p_user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_item_limit:=least(3,coalesce(v_declared,3));
  v_usage:=private.autonomous_work_budget_usage(p_user_id,p_work_item_id,p_observed_at);
  v_reason:=CASE
    WHEN (v_usage->>'itemAttempts24Hours')::integer>=v_item_limit
      THEN 'item_attempt_budget_exhausted'
    WHEN (v_usage->>'userAttempts24Hours')::integer>=6
      THEN 'user_attempt_budget_exhausted'
    WHEN (v_usage->>'userRuntimeSeconds24Hours')::numeric>=7200
      THEN 'user_runtime_budget_exhausted'
    WHEN (v_usage->>'autonomousRuntimeSeconds60Minutes')::numeric>=2700
      THEN 'interactive_reserve_protected'
    ELSE NULL
  END;
  RETURN jsonb_build_object(
    'schemaVersion',1,
    'policyVersion','autonomous-work-budget-v1',
    'admitted',v_reason IS NULL,
    'reason',v_reason,
    'effectiveItemAttemptLimit',v_item_limit,
    'remainingUserAttempts',greatest(0,6-(v_usage->>'userAttempts24Hours')::integer),
    'remainingRuntimeSeconds24Hours',greatest(0,7200-(v_usage->>'userRuntimeSeconds24Hours')::numeric),
    'remainingAutonomousRuntimeSeconds60Minutes',
      greatest(0,2700-(v_usage->>'autonomousRuntimeSeconds60Minutes')::numeric),
    'usage',v_usage
  );
END;
$$;

REVOKE ALL ON FUNCTION private.autonomous_work_budget_decision(uuid,uuid,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.autonomous_work_budget_decision(uuid,uuid,timestamptz)
  TO service_role;

CREATE FUNCTION public.autonomous_work_budget_status(p_work_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
STABLE
AS $$
DECLARE v_uid uuid:=auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  RETURN private.autonomous_work_budget_decision(v_uid,p_work_item_id,now());
END;
$$;

REVOKE ALL ON FUNCTION public.autonomous_work_budget_status(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.autonomous_work_budget_status(uuid)
  TO authenticated,service_role;

CREATE FUNCTION private.enforce_autonomous_work_budget()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_uid uuid;
  v_decision jsonb;
BEGIN
  IF NEW.event_type<>'execution_started'
     OR NOT (NEW.payload->'data' ? 'claim_id')
     OR NEW.payload->'data'->>'claim_id' IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT i.user_id INTO v_uid FROM public.work_items i WHERE i.id=NEW.work_item_id;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('autonomous_work_budget:'||v_uid::text,0));
  v_decision:=private.autonomous_work_budget_decision(v_uid,NEW.work_item_id,now());
  IF NOT coalesce((v_decision->>'admitted')::boolean,false) THEN
    RAISE EXCEPTION '%',v_decision->>'reason'
      USING ERRCODE='P0001',DETAIL=v_decision::text;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_autonomous_work_budget_before_start
BEFORE INSERT ON public.work_events
FOR EACH ROW EXECUTE FUNCTION private.enforce_autonomous_work_budget();

COMMENT ON FUNCTION public.autonomous_work_budget_status(uuid) IS
  'INTEL-04: expõe consumo e decisão do orçamento V0 em janelas móveis. A guarda atômica no log de execution_started aplica a mesma decisão exclusivamente a tentativas sob claim; execução comandada permanece fora do orçamento autônomo.';
