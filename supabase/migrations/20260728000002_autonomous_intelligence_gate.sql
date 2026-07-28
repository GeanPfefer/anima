-- INTEL-01, terceiro incremento: classificação vigente e completa passa a ser
-- pré-condição exclusivamente da execução autônoma.
--
-- O gate existe em três fronteiras do banco:
--   1. fila/seleção: itens bloqueados nem são oferecidos;
--   2. INSERT de claim: fecha a corrida entre seleção e aquisição;
--   3. INSERT de execution_started sob claim: fecha a corrida entre claim e
--      início/reclassificação.
-- Execução comandada não possui claim e permanece deliberadamente fora.

CREATE FUNCTION private.autonomous_intelligence_eligibility(
  p_work_item_id uuid,
  p_proposal_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_classification jsonb;
  v_unknown_axes jsonb;
BEGIN
  SELECT e.payload -> 'data' -> 'classification'
  INTO v_classification
  FROM public.work_events e
  WHERE e.work_item_id=p_work_item_id
    AND e.event_type='work_intelligence_classified'
    AND e.proposal_version=p_proposal_version
    AND e.payload -> 'data' ->> 'approved_proposal_version'=p_proposal_version::text
    AND private.is_valid_work_intelligence_classification(
      e.payload -> 'data' -> 'classification'
    )
  ORDER BY
    CASE
      WHEN e.payload -> 'data' ->> 'classification_revision' ~ '^[1-9][0-9]*$'
      THEN (e.payload -> 'data' ->> 'classification_revision')::integer
    END DESC NULLS LAST,
    e.seq DESC
  LIMIT 1;

  IF v_classification IS NULL THEN
    RETURN jsonb_build_object(
      'eligible',false,
      'reason','work_intelligence_classification_missing',
      'unknown_axes','[]'::jsonb
    );
  END IF;

  SELECT COALESCE(jsonb_agg(axis ORDER BY ordinal), '[]'::jsonb)
  INTO v_unknown_axes
  FROM (VALUES
    (1,'complexity',v_classification->>'complexity'),
    (2,'risk',v_classification->>'risk'),
    (3,'reversibility',v_classification->>'reversibility'),
    (4,'planClarity',v_classification->>'planClarity'),
    (5,'urgency',v_classification->>'urgency')
  ) AS axes(ordinal,axis,value)
  WHERE value='unknown';

  IF jsonb_array_length(v_unknown_axes)>0 THEN
    RETURN jsonb_build_object(
      'eligible',false,
      'reason','work_intelligence_classification_incomplete',
      'unknown_axes',v_unknown_axes
    );
  END IF;
  RETURN jsonb_build_object(
    'eligible',true,
    'reason',NULL,
    'unknown_axes','[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION private.autonomous_intelligence_eligibility(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.autonomous_intelligence_eligibility(uuid, integer)
  TO service_role;

CREATE FUNCTION private.enforce_autonomous_intelligence_on_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_gate jsonb;
BEGIN
  v_gate := private.autonomous_intelligence_eligibility(
    NEW.work_item_id, NEW.approved_proposal_version
  );
  IF v_gate ->> 'eligible' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '%', v_gate ->> 'reason' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_autonomous_intelligence_on_claim
BEFORE INSERT ON public.work_claims
FOR EACH ROW EXECUTE FUNCTION private.enforce_autonomous_intelligence_on_claim();

CREATE FUNCTION private.enforce_autonomous_intelligence_on_attempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_gate jsonb;
BEGIN
  -- `claim_id` distingue os caminhos autônomos. INT-04 comandado não possui
  -- claim e não é afetado por este gate.
  IF NEW.event_type='execution_started'
     AND NEW.payload -> 'data' ->> 'claim_id' IS NOT NULL
  THEN
    v_gate := private.autonomous_intelligence_eligibility(
      NEW.work_item_id, NEW.proposal_version
    );
    IF v_gate ->> 'eligible' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION '%', v_gate ->> 'reason' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_autonomous_intelligence_on_attempt
BEFORE INSERT ON public.work_events
FOR EACH ROW EXECUTE FUNCTION private.enforce_autonomous_intelligence_on_attempt();

CREATE OR REPLACE FUNCTION public.autonomous_work_queue()
RETURNS TABLE (
  work_item_id              uuid,
  approved_proposal_version integer,
  approval_seq              bigint,
  approved_at               timestamptz,
  capability                public.work_capability,
  target_reference          text,
  queue_position            bigint,
  target_occupied           boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.proposal_version,
    approval.seq,
    approval.created_at,
    i.capability,
    btrim(i.intent #>> '{execution_spec,target,reference}'),
    row_number() OVER (ORDER BY approval.seq, i.id),
    (EXISTS (
       SELECT 1 FROM public.work_claims oc
       WHERE oc.user_id=v_user_id
         AND oc.target_reference=btrim(i.intent #>> '{execution_spec,target,reference}')
         AND oc.released_at IS NULL AND oc.expires_at > now()
     ) OR EXISTS (
       SELECT 1 FROM public.work_items oi
       WHERE oi.user_id=v_user_id AND oi.state='in_progress'
         AND btrim(oi.intent #>> '{execution_spec,target,reference}')=btrim(i.intent #>> '{execution_spec,target,reference}')
     ))
  FROM public.work_items i
  JOIN LATERAL (
    SELECT e.seq, e.created_at
    FROM public.work_events e
    WHERE e.work_item_id=i.id
      AND e.event_type='work_approved'
      AND e.proposal_version=i.proposal_version
    ORDER BY e.seq DESC
    LIMIT 1
  ) AS approval ON TRUE
  WHERE i.user_id=v_user_id
    AND private.is_autonomously_eligible(i.state, i.proposal, i.intent)
    AND private.autonomous_intelligence_eligibility(i.id, i.proposal_version)
          ->> 'eligible'='true'
    AND NOT EXISTS (
      SELECT 1 FROM public.work_claims c
      WHERE c.work_item_id=i.id AND c.released_at IS NULL AND c.expires_at>now()
    )
  ORDER BY approval.seq, i.id;
END;
$$;

COMMENT ON FUNCTION public.autonomous_work_queue() IS
  'Projeção da fila autônoma. Além do AUTO-01, exige classificação INTEL-01 vigente e completa para a versão aprovada atual. Ausência e unknown falham fechado; execução comandada não usa esta fila.';
