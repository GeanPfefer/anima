-- INTEL-04 — uma tentativa aberta antes da janela ainda consumiu toda a janela.
-- Remove o corte prematuro por started_at e aplica-o somente às contagens.

CREATE OR REPLACE FUNCTION private.autonomous_work_budget_usage(
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
    ) FILTER (WHERE coalesce(finished_at,p_observed_at)>p_observed_at-interval '24 hours')),0),
    'autonomousRuntimeSeconds60Minutes',coalesce(floor(sum(
      greatest(0,extract(epoch FROM
        least(coalesce(finished_at,p_observed_at),p_observed_at)
        - greatest(started_at,p_observed_at-interval '60 minutes')
      ))
    ) FILTER (WHERE coalesce(finished_at,p_observed_at)>p_observed_at-interval '60 minutes')),0)
  )
  FROM starts;
$$;

COMMENT ON FUNCTION private.autonomous_work_budget_usage(uuid,uuid,timestamptz) IS
  'INTEL-04: reconstrói tentativas iniciadas dentro das janelas e o tempo de toda tentativa que sobrepõe cada janela, inclusive quando começou antes dela e segue aberta.';
