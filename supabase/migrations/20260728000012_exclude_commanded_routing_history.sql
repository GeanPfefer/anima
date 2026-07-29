-- INTEL-03 considera somente tentativas que tiveram rota autônoma declarada.
CREATE OR REPLACE FUNCTION private.work_routing_adjustment_context(
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
    JOIN public.work_events route
      ON route.work_item_id=p_work_item_id
     AND route.proposal_version=p_proposal_version
     AND route.event_type='work_routing_decided'
     AND route.payload #>> '{data,attempt_id}'=s.attempt_id
    LEFT JOIN LATERAL (
      SELECT e.event_type
      FROM public.work_events e
      WHERE e.work_item_id=p_work_item_id
        AND e.proposal_version=p_proposal_version
        AND e.payload #>> '{data,attempt_id}'=s.attempt_id
        AND e.event_type IN ('result_submitted','execution_failed','work_cancelled','attempt_abandoned')
      ORDER BY e.seq DESC LIMIT 1
    ) terminal ON true
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
      AND EXISTS (
        SELECT 1 FROM public.work_events r
        WHERE r.work_item_id=e.work_item_id
          AND r.proposal_version=e.proposal_version
          AND r.event_type='work_routing_decided'
          AND r.payload #>> '{data,attempt_id}'=e.payload #>> '{data,attempt_id}'
      )
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
