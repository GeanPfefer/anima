-- ============================================================
-- Persistência append-only da evidência do CODER OBSERVADA PELO HOST
-- ============================================================
--
-- Direção da visão de identidade/compute distribuído (§12): "o Resource Governor deverá
-- progressivamente observar diferentes classes de workload... preferir evidência observada
-- INDEPENDENTEMENTE pelo host sempre que possível". Assim como o host mede o `durationMs`
-- real de cada gate que executa (`host_observed_gate_evidence_recorded`), ele pode medir o
-- tempo de parede do backend de código: inicia o relógio ANTES de `backend.edit()` e o
-- encerra DEPOIS. Nada disso confia no provider — o LLM/Ollama/OpenAI não reporta nada aqui.
--
-- Este evento (`host_observed_coder_evidence_recorded`, `author=system`/`origin=host`) é o
-- registro do host sobre a própria chamada que cronometrou. A proveniência system/host não é
-- forjável pelo sinal do executor (outro evento, outra RPC, outro autor). NÃO muda estado do
-- item, não conclui, não aceita, não autoriza, não integra.
--
-- Semântica honesta do coder (diferente do gate): não há `exitCode`; a identidade é o
-- `backendId` (o adaptador que o host invocou), não um comando de shell; o desfecho é
-- succeeded | failed | cancelled — `cancelled` é uma MEDIÇÃO PARCIAL distinta, não um
-- workload que terminou falhando. Tokens/modelo do provider são uma mudança contratual
-- separada e NÃO entram nesta evidência (proveniência host-observed ≠ provider-reported).
--
-- Honestidade: só é produzível quando o HOST cronometra a chamada (caminho worktree
-- in-process). Executor futuro que rode o coder num processo separado não gera esta
-- evidência — e aí o custo host-observed do coder é honestamente ausente.
--
-- Idempotência: uma tentativa tem uma edição de coder. Reobservação idêntica (mesmo
-- conteúdo, ignorando observedAt) replaya; conteúdo divergente é conflito fail-closed.

-- ============================================================
-- Régua estrutural (espelho SQL de buildHostObservedCoderEvidence do core)
-- ============================================================

CREATE FUNCTION private.is_valid_host_coder_evidence(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN false
    WHEN p -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'workItemId') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'attemptId') THEN false
    WHEN NOT private.jsonb_is_positive_integer(p -> 'approvedProposalVersion') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'backendId') THEN false
    -- backendId é identidade opaca: nada de caminho absoluto local.
    WHEN (p ->> 'backendId') ~ '^[A-Za-z]:[\\/]' OR (p ->> 'backendId') LIKE '/%' THEN false
    WHEN jsonb_typeof(p -> 'durationMs') <> 'number' THEN false
    WHEN (p ->> 'durationMs')::numeric < 0
      OR (p ->> 'durationMs')::numeric <> trunc((p ->> 'durationMs')::numeric) THEN false
    WHEN (p ->> 'outcome') NOT IN ('succeeded', 'failed', 'cancelled') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'observedAt') THEN false
    ELSE true
  END;
$$;

REVOKE ALL ON FUNCTION private.is_valid_host_coder_evidence(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_valid_host_coder_evidence(jsonb) TO service_role;

-- Garantia final: no máximo UMA evidência de coder por tentativa.
CREATE UNIQUE INDEX work_events_host_coder_evidence_attempt_idx
  ON public.work_events ((payload -> 'data' ->> 'attempt_id'))
  WHERE event_type = 'host_observed_coder_evidence_recorded';

-- ============================================================
-- RPC de registro
-- ============================================================

CREATE FUNCTION public.record_host_observed_coder_evidence(
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
    RAISE EXCEPTION 'invalid host coder evidence' USING ERRCODE='22023';
  END IF;

  IF NOT private.is_valid_host_coder_evidence(evidence) THEN
    RAISE EXCEPTION 'invalid host coder evidence' USING ERRCODE='22023';
  END IF;

  IF evidence->>'workItemId' IS DISTINCT FROM work_item_id::text
     OR evidence->>'attemptId' IS DISTINCT FROM attempt_id::text
     OR (evidence->>'approvedProposalVersion')::integer IS DISTINCT FROM expected_proposal_version THEN
    RAISE EXCEPTION 'host coder evidence correlation mismatch' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  -- Tentativa real correlacionada (INT-02): sem tentativa não há edição de coder a observar.
  IF NOT EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
      AND e.proposal_version=expected_proposal_version
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'attempt not found' USING ERRCODE='P0002';
  END IF;

  -- Idempotência por tentativa, ignorando observedAt: reobservação idêntica replaya;
  -- conteúdo divergente é conflito fail-closed (nunca duas verdades).
  SELECT * INTO v_existing FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='host_observed_coder_evidence_recorded'
    AND e.payload->'data'->>'attempt_id'=attempt_id::text;
  IF FOUND THEN
    IF (v_existing.payload->'data'->'evidence') - 'observedAt' = evidence - 'observedAt' THEN
      RETURN jsonb_build_object('action','replayed','event_seq',v_existing.seq);
    END IF;
    RAISE EXCEPTION 'host coder evidence conflict' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.work_events(work_item_id, event_type, author, proposal_version, payload)
  VALUES (v_item.id, 'host_observed_coder_evidence_recorded', 'system', expected_proposal_version,
    jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
      'work_item_id', v_item.id,
      'attempt_id', attempt_id,
      'approved_proposal_version', expected_proposal_version,
      'origin', 'host',
      'evidence', evidence)))
  RETURNING seq INTO v_event_seq;

  RETURN jsonb_build_object('action','recorded','event_seq',v_event_seq);
END;
$$;

REVOKE ALL ON FUNCTION public.record_host_observed_coder_evidence(uuid, integer, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_host_observed_coder_evidence(uuid, integer, uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.record_host_observed_coder_evidence(uuid, integer, uuid, jsonb) IS
  'Registra a evidência do CODER observada pelo host (duração wall-clock que o host mediu ao redor de backend.edit()) como evento append-only host_observed_coder_evidence_recorded, author=system/origin=host, fail-closed. Exige item do usuário, allowlist, tentativa real correlacionada, evidência HostObservedCoderEvidenceV1 estruturalmente válida (backendId opaco, durationMs inteiro >= 0, outcome em succeeded|failed|cancelled) e correlação casando com os parâmetros. Idempotente por tentativa ignorando observedAt; conteúdo divergente é conflito 55000. Proveniência não forjável pelo sinal do executor. NÃO carrega tokens/modelo do provider, NÃO muda estado, não conclui, não aceita, não autoriza e não integra.';
