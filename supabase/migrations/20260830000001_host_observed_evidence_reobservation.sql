-- Permite corrigir append-only a base semântica de uma observação Git já
-- persistida. Por tentativa existem no máximo duas classes: legado (sem delta)
-- e atual (com observedChangedFilesSinceStart). Dentro da mesma classe, replay
-- idêntico continua idempotente e conteúdo divergente continua fail-closed.

DROP INDEX public.work_events_host_observed_evidence_attempt_idx;
CREATE UNIQUE INDEX work_events_host_observed_evidence_attempt_basis_idx
  ON public.work_events (
    (payload -> 'data' ->> 'attempt_id'),
    (((payload -> 'data' -> 'evidence') ? 'observedChangedFilesSinceStart'))
  )
  WHERE event_type = 'host_observed_evidence_recorded';

CREATE OR REPLACE FUNCTION public.record_host_observed_evidence(
  work_item_id uuid,
  expected_proposal_version integer,
  attempt_id uuid,
  evidence jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_item      public.work_items;
  v_existing  public.work_events;
  v_has_delta boolean := evidence ? 'observedChangedFilesSinceStart';
  v_event_seq bigint;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version < 1 OR attempt_id IS NULL
     OR jsonb_typeof(evidence) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid host observed evidence' USING ERRCODE='22023';
  END IF;
  IF NOT private.is_valid_host_observed_evidence(evidence) THEN
    RAISE EXCEPTION 'invalid host observed evidence' USING ERRCODE='22023';
  END IF;
  IF evidence->>'workItemId' IS DISTINCT FROM work_item_id::text
     OR evidence->>'attemptId' IS DISTINCT FROM attempt_id::text
     OR (evidence->>'approvedProposalVersion')::integer IS DISTINCT FROM expected_proposal_version THEN
    RAISE EXCEPTION 'host observed evidence correlation mismatch' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
      AND e.proposal_version=expected_proposal_version
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'attempt not found' USING ERRCODE='P0002';
  END IF;

  SELECT * INTO v_existing FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='host_observed_evidence_recorded'
    AND e.payload->'data'->>'attempt_id'=attempt_id::text
    AND ((e.payload->'data'->'evidence') ? 'observedChangedFilesSinceStart')=v_has_delta;
  IF FOUND THEN
    IF (v_existing.payload->'data'->'evidence') - 'observedAt' = evidence - 'observedAt' THEN
      RETURN jsonb_build_object('action','replayed','event_seq',v_existing.seq);
    END IF;
    RAISE EXCEPTION 'host observed evidence conflict' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.work_events(work_item_id, event_type, author, proposal_version, payload)
  VALUES (v_item.id, 'host_observed_evidence_recorded', 'system', expected_proposal_version,
    jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
      'work_item_id', v_item.id,
      'attempt_id', attempt_id,
      'approved_proposal_version', expected_proposal_version,
      'origin', 'host',
      'coverage', jsonb_build_object('git', true, 'gates', false),
      'evidence', evidence)))
  RETURNING seq INTO v_event_seq;

  RETURN jsonb_build_object('action','recorded','event_seq',v_event_seq);
END;
$$;

COMMENT ON FUNCTION public.record_host_observed_evidence(uuid, integer, uuid, jsonb) IS
  'Registra observações Git host-side append-only. Uma tentativa admite uma evidência histórica sem delta e uma evidência atual com observedChangedFilesSinceStart; a projeção usa a mais recente. Dentro de cada base semântica, conteúdo idêntico replaya e conteúdo divergente conflita. Não muda estado, não aceita, não autoriza e não integra.';
