-- Estende a base de evidência do PARECER do Verifier para incluir a evidência de
-- GATE observada pelo host. Sem isto, um parecer recomputado DEPOIS que a evidência
-- de gate aparece teria a mesma identidade (attempt, versão, result, observed_git)
-- do parecer anterior, mas conteúdo diferente (coverage.gates, achados de gate) —
-- e cairia em conflito 55000 em vez de acrescentar um novo parecer. A evidência de
-- gate passa a fazer parte da identidade: base diferente ⇒ novo parecer append-only.

-- Régua estrutural: `observedGateEventId` é JSON null OU string não-vazia (espelho
-- de parseVerifierOpinion do core).
CREATE OR REPLACE FUNCTION private.is_valid_verifier_opinion(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN false
    WHEN p -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'workItemId') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'attemptId') THEN false
    WHEN NOT private.jsonb_is_positive_integer(p -> 'approvedProposalVersion') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'verifierVersion') THEN false
    WHEN (p ->> 'verdict') NOT IN ('verified', 'inconclusive', 'rejected') THEN false
    WHEN jsonb_typeof(p -> 'restsOnAttestedEvidence') <> 'boolean' THEN false
    WHEN NOT private.is_valid_opinion_summary(p -> 'summary') THEN false
    WHEN NOT private.is_valid_opinion_findings(p -> 'findings') THEN false
    WHEN jsonb_typeof(p -> 'evidenceBasis') <> 'object' THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p #> '{evidenceBasis,resultEventId}') THEN false
    WHEN NOT ((p #> '{evidenceBasis,observedEventId}') = 'null'::jsonb
              OR private.jsonb_is_nonblank_string(p #> '{evidenceBasis,observedEventId}')) THEN false
    WHEN NOT ((p #> '{evidenceBasis,observedGateEventId}') = 'null'::jsonb
              OR private.jsonb_is_nonblank_string(p #> '{evidenceBasis,observedGateEventId}')) THEN false
    WHEN jsonb_typeof(p #> '{evidenceBasis,coverage,git}') <> 'boolean' THEN false
    WHEN jsonb_typeof(p #> '{evidenceBasis,coverage,gates}') <> 'boolean' THEN false
    ELSE true
  END;
$$;

-- Identidade do parecer passa a incluir o evento de evidência de gate.
DROP INDEX public.work_events_verifier_opinion_identity_idx;
CREATE UNIQUE INDEX work_events_verifier_opinion_identity_idx
  ON public.work_events (
    (payload -> 'data' ->> 'attempt_id'),
    (payload -> 'data' ->> 'verifier_version'),
    (payload -> 'data' ->> 'result_event_id'),
    (coalesce(payload -> 'data' ->> 'observed_event_id', 'none')),
    (coalesce(payload -> 'data' ->> 'observed_gate_event_id', 'none'))
  )
  WHERE event_type = 'verifier_opinion_recorded';

CREATE OR REPLACE FUNCTION public.record_verifier_opinion(
  work_item_id uuid,
  expected_proposal_version integer,
  attempt_id uuid,
  opinion jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_item        public.work_items;
  v_result_id   text := opinion #>> '{evidenceBasis,resultEventId}';
  v_observed_id text;
  v_gate_id     text;
  v_version     text := opinion ->> 'verifierVersion';
  v_existing    public.work_events;
  v_event_seq   bigint;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version < 1 OR attempt_id IS NULL
     OR jsonb_typeof(opinion) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid verifier opinion' USING ERRCODE='22023';
  END IF;

  IF NOT private.is_valid_verifier_opinion(opinion) THEN
    RAISE EXCEPTION 'invalid verifier opinion' USING ERRCODE='22023';
  END IF;

  IF opinion->>'workItemId' IS DISTINCT FROM work_item_id::text
     OR opinion->>'attemptId' IS DISTINCT FROM attempt_id::text
     OR (opinion->>'approvedProposalVersion')::integer IS DISTINCT FROM expected_proposal_version THEN
    RAISE EXCEPTION 'verifier opinion correlation mismatch' USING ERRCODE='22023';
  END IF;

  v_observed_id := opinion #>> '{evidenceBasis,observedEventId}';
  v_gate_id     := opinion #>> '{evidenceBasis,observedGateEventId}';

  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
      AND e.proposal_version=expected_proposal_version
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'attempt not found' USING ERRCODE='P0002';
  END IF;

  -- Base de evidência aponta eventos REAIS DESTA tentativa.
  IF NOT EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.id=v_result_id::uuid AND e.work_item_id=v_item.id AND e.event_type='result_submitted'
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'result evidence not found for attempt' USING ERRCODE='P0002';
  END IF;
  IF v_observed_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.id=v_observed_id::uuid AND e.work_item_id=v_item.id AND e.event_type='host_observed_evidence_recorded'
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'observed evidence not found for attempt' USING ERRCODE='P0002';
  END IF;
  IF v_gate_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.id=v_gate_id::uuid AND e.work_item_id=v_item.id AND e.event_type='host_observed_gate_evidence_recorded'
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'observed gate evidence not found for attempt' USING ERRCODE='P0002';
  END IF;

  SELECT * INTO v_existing FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='verifier_opinion_recorded'
    AND e.payload->'data'->>'attempt_id'=attempt_id::text
    AND e.payload->'data'->>'verifier_version'=v_version
    AND e.payload->'data'->>'result_event_id'=v_result_id
    AND coalesce(e.payload->'data'->>'observed_event_id','none')=coalesce(v_observed_id,'none')
    AND coalesce(e.payload->'data'->>'observed_gate_event_id','none')=coalesce(v_gate_id,'none');
  IF FOUND THEN
    IF v_existing.payload->'data'->'opinion' = opinion THEN
      RETURN jsonb_build_object('action','replayed','event_seq',v_existing.seq);
    END IF;
    RAISE EXCEPTION 'verifier opinion conflict' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.work_events(work_item_id, event_type, author, proposal_version, payload)
  VALUES (v_item.id, 'verifier_opinion_recorded', 'system', expected_proposal_version,
    jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
      'work_item_id', v_item.id,
      'attempt_id', attempt_id,
      'approved_proposal_version', expected_proposal_version,
      'origin', 'verifier',
      'verifier_version', v_version,
      'verdict', opinion->>'verdict',
      'result_event_id', v_result_id,
      'observed_event_id', v_observed_id,
      'observed_gate_event_id', v_gate_id,
      'opinion', opinion)))
  RETURNING seq INTO v_event_seq;

  RETURN jsonb_build_object('action','recorded','verdict',opinion->>'verdict','event_seq',v_event_seq);
END;
$$;
