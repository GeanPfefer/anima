-- ============================================================
-- Persistência append-only da evidência de GATE OBSERVADA PELO HOST
-- ============================================================
--
-- Decisão humana (2026-08-16): NÃO reexecutar gates só para o Verifier. Em vez
-- disso, preservar como evidência observada de primeira parte do host os desfechos
-- que o host JÁ observa no momento em que executa cada gate (`runGate` →
-- `runProcess` → `spawn`, código de host — jamais o `CoderBackend`/LLM).
--
-- Diferente do `worktreeHandoff.gates` (ATESTADO pelo executor no sinal `result`),
-- este evento (`host_observed_gate_evidence_recorded`, `author=system`/`origin=host`)
-- é o registro do host sobre o processo que ele mesmo rodou. Um executor que minta
-- sobre um gate que falhou é contraditado por estes fatos. A proveniência
-- system/host não é forjável pelo sinal do executor (outro evento, outra RPC, outro
-- autor). NÃO muda estado do item, não conclui, não aceita, não autoriza, não integra.
--
-- Honestidade: só é produzível quando o HOST executa o gate (caminho worktree
-- in-process). Executor futuro que rode gates num processo separado não gera esta
-- evidência — e aí a independência de gate é honestamente ausente.
--
-- Idempotência: uma tentativa tem uma realidade de gate. Reobservação idêntica
-- (mesmo conteúdo, ignorando observedAt) replaya; conteúdo divergente é conflito.

-- ============================================================
-- Régua estrutural (espelho SQL de buildHostObservedGateEvidence do core)
-- ============================================================

CREATE FUNCTION private.is_valid_host_gate_outcomes(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN v IS NULL OR jsonb_typeof(v) <> 'array' OR jsonb_array_length(v) = 0 OR jsonb_array_length(v) > 200 THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v) AS entry
      WHERE jsonb_typeof(entry.value) <> 'object'
         OR NOT private.jsonb_is_nonblank_string(entry.value -> 'label')
         OR NOT private.jsonb_is_nonblank_string(entry.value -> 'command')
         OR (entry.value ->> 'command') ~ '^[A-Za-z]:[\\/]' OR (entry.value ->> 'command') LIKE '/%'
         OR jsonb_typeof(entry.value -> 'exitCode') <> 'number'
         OR (entry.value ->> 'exitCode')::numeric <> trunc((entry.value ->> 'exitCode')::numeric)
         OR jsonb_typeof(entry.value -> 'durationMs') <> 'number'
         OR (entry.value ->> 'durationMs')::numeric < 0
         OR (entry.value ->> 'durationMs')::numeric <> trunc((entry.value ->> 'durationMs')::numeric)
         OR jsonb_typeof(entry.value -> 'timedOut') <> 'boolean'
         OR jsonb_typeof(entry.value -> 'cancelled') <> 'boolean'
         -- outcome tem de ser o DERIVADO dos fatos: passou ⟺ código 0 sem timeout/cancelamento.
         OR (entry.value ->> 'outcome') <> (CASE
              WHEN (entry.value ->> 'exitCode')::numeric = 0 AND (entry.value -> 'timedOut') = 'false'::jsonb AND (entry.value -> 'cancelled') = 'false'::jsonb
              THEN 'passed' ELSE 'failed' END)
    )
  END;
$$;

CREATE FUNCTION private.is_valid_host_gate_evidence(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN false
    WHEN p -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'workItemId') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'attemptId') THEN false
    WHEN NOT private.jsonb_is_positive_integer(p -> 'approvedProposalVersion') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'observedAt') THEN false
    WHEN (p #> '{coverage,gates}') IS DISTINCT FROM 'true'::jsonb THEN false
    WHEN NOT private.is_valid_host_gate_outcomes(p -> 'gates') THEN false
    ELSE true
  END;
$$;

REVOKE ALL ON FUNCTION private.is_valid_host_gate_outcomes(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_valid_host_gate_evidence(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_valid_host_gate_outcomes(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.is_valid_host_gate_evidence(jsonb) TO service_role;

-- Garantia final: no máximo UMA evidência de gate por tentativa.
CREATE UNIQUE INDEX work_events_host_gate_evidence_attempt_idx
  ON public.work_events ((payload -> 'data' ->> 'attempt_id'))
  WHERE event_type = 'host_observed_gate_evidence_recorded';

-- ============================================================
-- RPC de registro
-- ============================================================

CREATE FUNCTION public.record_host_observed_gate_evidence(
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
  v_event_seq bigint;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version < 1 OR attempt_id IS NULL
     OR jsonb_typeof(evidence) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid host gate evidence' USING ERRCODE='22023';
  END IF;

  IF NOT private.is_valid_host_gate_evidence(evidence) THEN
    RAISE EXCEPTION 'invalid host gate evidence' USING ERRCODE='22023';
  END IF;

  IF evidence->>'workItemId' IS DISTINCT FROM work_item_id::text
     OR evidence->>'attemptId' IS DISTINCT FROM attempt_id::text
     OR (evidence->>'approvedProposalVersion')::integer IS DISTINCT FROM expected_proposal_version THEN
    RAISE EXCEPTION 'host gate evidence correlation mismatch' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  -- Tentativa real correlacionada (INT-02): sem tentativa não há gate a observar.
  IF NOT EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
      AND e.proposal_version=expected_proposal_version
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'attempt not found' USING ERRCODE='P0002';
  END IF;

  -- Idempotência por tentativa, ignorando observedAt: reobservação idêntica replaya;
  -- conteúdo divergente é conflito fail-closed (nunca duas verdades).
  SELECT * INTO v_existing FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='host_observed_gate_evidence_recorded'
    AND e.payload->'data'->>'attempt_id'=attempt_id::text;
  IF FOUND THEN
    IF (v_existing.payload->'data'->'evidence') - 'observedAt' = evidence - 'observedAt' THEN
      RETURN jsonb_build_object('action','replayed','event_seq',v_existing.seq);
    END IF;
    RAISE EXCEPTION 'host gate evidence conflict' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.work_events(work_item_id, event_type, author, proposal_version, payload)
  VALUES (v_item.id, 'host_observed_gate_evidence_recorded', 'system', expected_proposal_version,
    jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
      'work_item_id', v_item.id,
      'attempt_id', attempt_id,
      'approved_proposal_version', expected_proposal_version,
      'origin', 'host',
      'coverage', jsonb_build_object('gates', true),
      'evidence', evidence)))
  RETURNING seq INTO v_event_seq;

  RETURN jsonb_build_object('action','recorded','event_seq',v_event_seq);
END;
$$;

REVOKE ALL ON FUNCTION public.record_host_observed_gate_evidence(uuid, integer, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_host_observed_gate_evidence(uuid, integer, uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.record_host_observed_gate_evidence(uuid, integer, uuid, jsonb) IS
  'Registra a evidência de GATE observada pelo host (desfechos reais dos gates que o host executou) como evento append-only host_observed_gate_evidence_recorded, author=system/origin=host, fail-closed. Exige item do usuário, allowlist, tentativa real correlacionada, evidência HostObservedGateEvidenceV1 estruturalmente válida (com outcome DERIVADO do exitCode/timeout/cancelamento) e correlação casando com os parâmetros. Idempotente por tentativa ignorando observedAt; conteúdo divergente é conflito 55000. Proveniência não forjável pelo sinal do executor. NÃO muda estado, não conclui, não aceita, não autoriza e não integra.';
