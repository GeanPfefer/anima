-- INTEL-04/UX-01 — restaura `work_paused` como terminal de runtime após a
-- política V2 local vs external.
--
-- 20260728000019_count_paused_runtime.sql estabeleceu que uma pausa aplicada
-- encerra a janela de runtime da attempt. Ao redefinir
-- `private.autonomous_work_budget_usage` em
-- 20260821000002_local_vs_external_work_budget.sql para separar custo local de
-- externo, `work_paused` foi omitido acidentalmente da lista de terminais.
--
-- Este recorte preserva integralmente a semântica V2 de custo local/externo e
-- restaura somente o terminal perdido. Não altera quotas, classificação de
-- custo, anti-loop, reserva interativa, estados ou autoridade.

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
            'attempt_abandoned','work_blocked','work_paused')
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

COMMENT ON FUNCTION private.autonomous_work_budget_usage(uuid,uuid,timestamptz) IS
  'INTEL-04 v2 / UX-01: mede attempts locais e externas preservando a política de custo V2. A janela de runtime encerra no primeiro terminal correlacionado, incluindo work_paused; pausa aplicada não continua consumindo orçamento.';