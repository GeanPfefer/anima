-- ============================================================
-- Persistência append-only da evidência OBSERVADA PELO HOST (independência real)
-- ============================================================
--
-- O eixo: "o agente que executa não deve conseguir fabricar sozinho a evidência
-- usada para verificar o próprio trabalho". Diferente do `WorktreeHandoffV1`
-- (INT-05), ATESTADO pelo executor (ele põe os valores no sinal `result`), esta
-- evidência é produzida por INSPEÇÃO DE GIT feita pelo HOST sobre a branch
-- descartável `anima-work/<attemptId>` já persistida no repositório, DEPOIS da
-- execução. O git não mente sobre o que foi commitado: um executor que minta no
-- seu sinal sobre quais arquivos alterou é contraditado por estes fatos.
--
-- COBERTURA V0 — honesta. O host observa independentemente apenas os fatos do GIT
-- (commit, arquivos alterados, diff): `coverage.git=true, coverage.gates=false`.
-- Os desfechos de GATE NÃO são observados independentemente — observá-los exigiria
-- RE-EXECUTAR os gates num sandbox controlado (evolução futura). O Verifier
-- continua tratando gates como atestados. Independência real PARCIAL é preferível
-- a uma falsa promessa total.
--
-- Por que a persistência é confiável mesmo sem o banco rodar git:
--   * a evidência é produzida pelo HOST (código servidor que o executor não
--     controla), nunca pelo sinal do executor. O único canal do executor é o
--     `result`/checkpoint, e esses caminhos gravam `author='executor'`;
--   * esta RPC carimba `author='system'` + `origin='host'` — o sinal do executor
--     JAMAIS produz um evento com esta assinatura (é outro tipo de evento, outra
--     RPC, outro autor). Assim o executor não pode "se passar" por host;
--   * exige `auth.uid()` = dono do item + allowlist: um cliente arbitrário não
--     fabrica a evidência de outro dono;
--   * exige uma tentativa REAL correlacionada (`execution_started` com o mesmo
--     `attempt_id` e a mesma versão aprovada), que o cliente não inventa;
--   * é idempotente por tentativa: reobservação determinística do MESMO git
--     replaya; conteúdo divergente para a mesma tentativa é CONFLITO fail-closed —
--     impossível criar duas verdades incompatíveis num retry.
--
-- NÃO muda estado do item, não conclui, não aceita, não autoriza, não integra e
-- não aplica coisa alguma. É registro de fato observado, advisory por natureza.

-- ============================================================
-- Régua estrutural (espelho SQL de buildHostObservedGitEvidence do core)
-- ============================================================
--
-- As chaves são camelCase porque validam o payload `HostObservedGitEvidenceV1`
-- como o core o constrói. Reutiliza os primitivos existentes; a guarda de caminho
-- absoluto é a mesma do terminal comandado / checkpoint (não é segunda política).

CREATE FUNCTION private.is_valid_host_git_diff_files(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN v IS NULL OR jsonb_typeof(v) <> 'array' OR jsonb_array_length(v) = 0 THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v) AS entry
      WHERE jsonb_typeof(entry.value) <> 'object'
         OR NOT private.jsonb_is_nonblank_string(entry.value -> 'path')
         OR (entry.value ->> 'path') ~ '^[A-Za-z]:[\\/]' OR (entry.value ->> 'path') LIKE '/%' OR (entry.value ->> 'path') LIKE '\\%'
         OR jsonb_typeof(entry.value -> 'insertions') <> 'number'
         OR jsonb_typeof(entry.value -> 'deletions') <> 'number'
         OR (entry.value ->> 'insertions')::numeric < -1
         OR (entry.value ->> 'deletions')::numeric < -1
         OR (entry.value ->> 'insertions')::numeric <> trunc((entry.value ->> 'insertions')::numeric)
         OR (entry.value ->> 'deletions')::numeric <> trunc((entry.value ->> 'deletions')::numeric)
    )
  END;
$$;

CREATE FUNCTION private.is_valid_host_observed_evidence(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN false
    WHEN p -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'workItemId') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'attemptId') THEN false
    WHEN NOT private.jsonb_is_positive_integer(p -> 'approvedProposalVersion') THEN false
    WHEN (p ->> 'baseSha') !~ '^[a-f0-9]{40}$' THEN false
    WHEN (p ->> 'observedCommitSha') !~ '^[a-f0-9]{40}$' THEN false
    -- base == commit: nada teria sido registrado; base != commit é obrigatório.
    WHEN (p ->> 'baseSha') = (p ->> 'observedCommitSha') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'observedAt') THEN false
    -- Cada arquivo alterado precisa ser não-vazio e caminho relativo (nunca absoluto).
    WHEN NOT private.jsonb_is_nonblank_string_array(p -> 'observedChangedFiles', 1) THEN false
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p -> 'observedChangedFiles') AS f(path)
      WHERE f.path ~ '^[A-Za-z]:[\\/]' OR f.path LIKE '/%' OR f.path LIKE '\\%'
    ) THEN false
    WHEN jsonb_typeof(p -> 'observedDiffSummary') <> 'object' THEN false
    WHEN jsonb_typeof(p #> '{observedDiffSummary,filesChanged}') <> 'number' THEN false
    WHEN jsonb_typeof(p #> '{observedDiffSummary,insertions}') <> 'number' THEN false
    WHEN jsonb_typeof(p #> '{observedDiffSummary,deletions}') <> 'number' THEN false
    WHEN NOT private.is_valid_host_git_diff_files(p #> '{observedDiffSummary,files}') THEN false
    -- Cobertura fixa: git observado, gates NÃO. Qualquer outra combinação é inválida.
    WHEN (p #> '{coverage,git}') IS DISTINCT FROM 'true'::jsonb THEN false
    WHEN (p #> '{coverage,gates}') IS DISTINCT FROM 'false'::jsonb THEN false
    ELSE true
  END;
$$;

REVOKE ALL ON FUNCTION private.is_valid_host_git_diff_files(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_valid_host_observed_evidence(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_valid_host_git_diff_files(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.is_valid_host_observed_evidence(jsonb) TO service_role;

-- Garantia final: no máximo UMA evidência observada por tentativa. Uma tentativa
-- tem uma única realidade de git; retry com conteúdo divergente é conflito, não
-- uma segunda verdade.
CREATE UNIQUE INDEX work_events_host_observed_evidence_attempt_idx
  ON public.work_events ((payload -> 'data' ->> 'attempt_id'))
  WHERE event_type = 'host_observed_evidence_recorded';

-- ============================================================
-- RPC de registro
-- ============================================================

CREATE FUNCTION public.record_host_observed_evidence(
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
    RAISE EXCEPTION 'invalid host observed evidence' USING ERRCODE='22023';
  END IF;

  -- Régua estrutural do core, aplicada ANTES de qualquer efeito.
  IF NOT private.is_valid_host_observed_evidence(evidence) THEN
    RAISE EXCEPTION 'invalid host observed evidence' USING ERRCODE='22023';
  END IF;

  -- Correlação declarada na evidência tem de casar com os parâmetros explícitos:
  -- não se confia só no blob. (A independência vem de o HOST tê-lo produzido, mas
  -- a correlação é reconferida contra a autoridade dos parâmetros.)
  IF evidence->>'workItemId' IS DISTINCT FROM work_item_id::text
     OR evidence->>'attemptId' IS DISTINCT FROM attempt_id::text
     OR (evidence->>'approvedProposalVersion')::integer IS DISTINCT FROM expected_proposal_version THEN
    RAISE EXCEPTION 'host observed evidence correlation mismatch' USING ERRCODE='22023';
  END IF;

  -- Fronteira de concorrência: bloqueia o item e serializa registros do item.
  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  -- A tentativa existe e está correlacionada por fato persistido (INT-02): o
  -- `execution_started` que `private.begin_work_attempt` emite nos dois caminhos.
  -- Sem tentativa real correlacionada, não há o que observar — cliente não fabrica.
  IF NOT EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
      AND e.proposal_version=expected_proposal_version
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'attempt not found' USING ERRCODE='P0002';
  END IF;

  -- Idempotência por tentativa: a comparação IGNORA `observedAt` (a reobservação
  -- do MESMO git após um crash é determinística no conteúdo, mas o instante muda).
  -- Conteúdo idêntico ⇒ replay sem novo evento; divergente ⇒ conflito fail-closed.
  SELECT * INTO v_existing FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='host_observed_evidence_recorded'
    AND e.payload->'data'->>'attempt_id'=attempt_id::text;
  IF FOUND THEN
    IF (v_existing.payload->'data'->'evidence') - 'observedAt' = evidence - 'observedAt' THEN
      RETURN jsonb_build_object('action','replayed','event_seq',v_existing.seq);
    END IF;
    RAISE EXCEPTION 'host observed evidence conflict' USING ERRCODE='55000';
  END IF;

  -- Evento append-only. `author='system'` + `origin='host'`: proveniência que o
  -- sinal do executor não consegue forjar por este ou por nenhum outro caminho.
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

REVOKE ALL ON FUNCTION public.record_host_observed_evidence(uuid, integer, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_host_observed_evidence(uuid, integer, uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.record_host_observed_evidence(uuid, integer, uuid, jsonb) IS
  'Registra a evidência de execução OBSERVADA PELO HOST (git) como evento append-only host_observed_evidence_recorded, decidindo só por fato persistido e fail-closed. Exige item do usuário, allowlist, tentativa real correlacionada (execution_started na versão aprovada), payload HostObservedGitEvidenceV1 estruturalmente válido e correlação casando com os parâmetros. author=system, origin=host: o sinal do executor não forja esta proveniência. Idempotente por tentativa ignorando observedAt (reobservação determinística replaya; conteúdo divergente é conflito 55000). NÃO muda estado, não conclui, não aceita, não autoriza e não integra.';
