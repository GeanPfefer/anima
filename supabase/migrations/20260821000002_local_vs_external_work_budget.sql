-- INTEL-04 (política V2) — orçamento consciente de CUSTO: local vs externo/pago.
--
-- Decisão ratificada pelo usuário: a razão de existir do modo LOCAL é executar
-- continuamente sem uma quota artificial baseada em custo externo. As quotas de
-- "custo" (contagem global de tentativas 6/24h e tempo global 120min/24h) só
-- fazem sentido para execução EXTERNA/PAGA. Execução LOCAL saudável não deve
-- parar só porque "já houve 6 tentativas hoje".
--
-- Isto NÃO remove segurança. Continuam valendo, para AMBOS os mundos:
--   * anti-loop por item (`item_attempt_budget_exhausted`, min(3,declared)/24h);
--   * reserva interativa do host (`interactive_reserve_protected`, 45min/60min) —
--     protege a sessão interativa na MESMA máquina (saúde do host); seu lar
--     definitivo é o Resource Governor (migração futura, não removida aqui).
--   * a guarda atômica no `execution_started` (revalida a decisão).
-- As quotas de custo (`user_attempt_budget_exhausted`, `user_runtime_budget_exhausted`)
-- passam a contar e a se aplicar SOMENTE a execução EXTERNA.
--
-- A distinção usa o CONTRATO TIPADO `execution_spec.coder_backend` (não heurística
-- de string frágil): a ATTEMPT (executor→coder→gates) é local quando o coder é
-- local. O custo externo do PLANNER (ex.: OpenAI) é um evento de PROPOSTA anterior,
-- não uma attempt — por isso uma proposta planejada externamente NÃO transforma a
-- execução local subsequente numa quota de 6/dia.

-- Classe de custo da ATTEMPT, pelo coder_backend do contrato. Espelha `backendFor`
-- (apps/web): backend ausente ⇒ ollama (local). Backends locais não têm custo
-- externo; `openai` (e qualquer backend não reconhecido) é tratado como externo
-- (conservador quanto a custo).
CREATE FUNCTION private.work_item_cost_class(p_intent jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN p_intent#>>'{execution_spec,coder_backend}' IS NULL THEN 'local'
    WHEN p_intent#>>'{execution_spec,coder_backend}' IN ('ollama','deepseek-harness','scripted') THEN 'local'
    ELSE 'external'
  END;
$$;
REVOKE ALL ON FUNCTION private.work_item_cost_class(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.work_item_cost_class(jsonb) TO service_role;

-- Usage: além dos totais existentes (mantidos p/ observabilidade e reserva
-- interativa machine-wide), classifica cada attempt e reporta tentativas e tempo
-- EXTERNOS (a base das quotas de custo).
CREATE OR REPLACE FUNCTION private.autonomous_work_budget_usage(
  p_user_id uuid, p_work_item_id uuid, p_observed_at timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  WITH starts AS (
    SELECT
      e.work_item_id,
      e.created_at AS started_at,
      private.work_item_cost_class(i.intent) AS cost_class,
      (
        SELECT terminal.created_at FROM public.work_events terminal
        WHERE terminal.work_item_id=e.work_item_id
          AND terminal.created_at>=e.created_at
          AND terminal.event_type IN (
            'result_submitted','execution_failed','work_cancelled',
            'attempt_abandoned','work_blocked')
          AND terminal.payload->'data'->>'attempt_id'=e.payload->'data'->>'attempt_id'
        ORDER BY terminal.seq LIMIT 1
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
      WHERE work_item_id=p_work_item_id AND started_at>p_observed_at-interval '24 hours'),
    'userAttempts24Hours',count(*) FILTER (
      WHERE started_at>p_observed_at-interval '24 hours'),
    'externalAttempts24Hours',count(*) FILTER (
      WHERE cost_class='external' AND started_at>p_observed_at-interval '24 hours'),
    'userRuntimeSeconds24Hours',coalesce(floor(sum(
      greatest(0,extract(epoch FROM
        least(coalesce(finished_at,p_observed_at),p_observed_at)
        - greatest(started_at,p_observed_at-interval '24 hours'))))),0),
    'externalRuntimeSeconds24Hours',coalesce(floor(sum(
      greatest(0,extract(epoch FROM
        least(coalesce(finished_at,p_observed_at),p_observed_at)
        - greatest(started_at,p_observed_at-interval '24 hours')))
      ) FILTER (WHERE cost_class='external')),0),
    'autonomousRuntimeSeconds60Minutes',coalesce(floor(sum(
      greatest(0,extract(epoch FROM
        least(coalesce(finished_at,p_observed_at),p_observed_at)
        - greatest(started_at,p_observed_at-interval '60 minutes')))
      ) FILTER (WHERE coalesce(finished_at,p_observed_at)>p_observed_at-interval '60 minutes')),0)
  ) FROM starts;
$$;

-- Decisão: quotas de CUSTO só para itens EXTERNOS; anti-loop por item e reserva
-- interativa valem para ambos. Ordem: anti-loop → quotas externas (se externo) →
-- reserva. Um item LOCAL só pode ser barrado por anti-loop ou reserva.
CREATE OR REPLACE FUNCTION private.autonomous_work_budget_decision(
  p_user_id uuid, p_work_item_id uuid, p_observed_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE
  v_usage jsonb; v_declared integer; v_item_limit integer; v_reason text;
  v_intent jsonb; v_cost_class text;
BEGIN
  SELECT i.intent INTO v_intent FROM public.work_items i
   WHERE i.id=p_work_item_id AND i.user_id=p_user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_cost_class:=private.work_item_cost_class(v_intent);
  v_declared:=CASE
    WHEN jsonb_typeof(v_intent#>'{execution_spec,limits,max_attempts}')='number'
      AND (v_intent#>>'{execution_spec,limits,max_attempts}')~'^[0-9]+$'
      AND (v_intent#>>'{execution_spec,limits,max_attempts}')::integer>0
    THEN (v_intent#>>'{execution_spec,limits,max_attempts}')::integer
  END;
  v_item_limit:=least(3,coalesce(v_declared,3));
  v_usage:=private.autonomous_work_budget_usage(p_user_id,p_work_item_id,p_observed_at);
  v_reason:=CASE
    WHEN (v_usage->>'itemAttempts24Hours')::integer>=v_item_limit
      THEN 'item_attempt_budget_exhausted'
    WHEN v_cost_class='external' AND (v_usage->>'externalAttempts24Hours')::integer>=6
      THEN 'user_attempt_budget_exhausted'
    WHEN v_cost_class='external' AND (v_usage->>'externalRuntimeSeconds24Hours')::numeric>=7200
      THEN 'user_runtime_budget_exhausted'
    WHEN (v_usage->>'autonomousRuntimeSeconds60Minutes')::numeric>=2700
      THEN 'interactive_reserve_protected'
    ELSE NULL
  END;
  RETURN jsonb_build_object(
    'schemaVersion',1,
    'policyVersion','autonomous-work-budget-v2-local-external',
    'admitted',v_reason IS NULL,
    'reason',v_reason,
    'costClass',v_cost_class,
    'effectiveItemAttemptLimit',v_item_limit,
    -- Quotas de custo são externas; "remaining" reflete o consumo EXTERNO.
    'remainingExternalAttempts',greatest(0,6-(v_usage->>'externalAttempts24Hours')::integer),
    'remainingUserAttempts',greatest(0,6-(v_usage->>'externalAttempts24Hours')::integer),
    'remainingRuntimeSeconds24Hours',greatest(0,7200-(v_usage->>'externalRuntimeSeconds24Hours')::numeric),
    'remainingAutonomousRuntimeSeconds60Minutes',
      greatest(0,2700-(v_usage->>'autonomousRuntimeSeconds60Minutes')::numeric),
    'usage',v_usage
  );
END;
$$;

COMMENT ON FUNCTION private.autonomous_work_budget_decision(uuid,uuid,timestamptz) IS
  'INTEL-04 v2: orçamento consciente de custo. Quotas de custo (user_attempt/user_runtime) só contam e se aplicam a execução EXTERNA (coder_backend externo); execução LOCAL é governada por anti-loop por item + reserva interativa (host) + Resource Governor + guardas anti-loop/concurrency, sem quota diária cega. Distinção pelo contrato tipado execution_spec.coder_backend.';
