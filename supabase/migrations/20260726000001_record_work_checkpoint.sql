-- Etapa 2A: persistência append-only de checkpoints mid-flight.
--
-- ============================================================
-- O que esta migration entrega
-- ============================================================
--
-- Um executor emite, durante uma tentativa AINDA EM ANDAMENTO, um sinal
-- `checkpoint` (INT-01) com um `WorkCheckpointV1` enxuto. `record_work_checkpoint`
-- persiste esse snapshot como um evento `checkpoint_recorded`, e
-- `latest_work_checkpoint` reconstrói deterministicamente o último válido — tudo
-- por fato persistido, sem tabela nova.
--
-- Fronteiras que esta etapa NÃO cruza (2B e adiante):
--   * o laço operacional, o LocalRunnerAdapter e o runner Python não são tocados;
--   * nenhuma tentativa nova é criada; `resumed_from_attempt_id` e
--     `reason = 'resumed_execution'` não existem aqui;
--   * `planWorkResumption` continua puro e não é chamado;
--   * checkpoint NÃO muda estado do item, não conclui, não aceita, não autoriza,
--     não integra e não aplica; a matriz de estados permanece intocada.
--
-- ============================================================
-- Sequência e idempotência
-- ============================================================
--
-- A `sequence` é a da transcrição INTEIRA do INT-01 (1-indexada), não só dos
-- checkpoints; a RPC não vê os `progress` não persistidos, então checkpoints são
-- monotônicos mas NÃO consecutivos. Para a maior sequência de checkpoint já
-- persistida na tentativa:
--   * sequence menor            → recusa por regressão (55000);
--   * mesma sequence, idêntico  → replay idempotente, sem novo evento;
--   * mesma sequence, diferente → conflito fail-closed (55000);
--   * sequence maior            → novo evento.
-- A comparação de replay é determinística: jsonb `=` sobre o sinal bruto
-- guardado, sem timestamps e sem correção de conteúdo divergente — o mesmo
-- dispositivo que `record_commanded_work_terminal` já usa para o terminal.
--
-- ============================================================
-- Concorrência
-- ============================================================
--
-- `SELECT ... FOR UPDATE` do item serializa dois registros concorrentes do mesmo
-- item: o segundo espera, relê o último checkpoint já commitado e cai em replay
-- (mesmo conteúdo) ou conflito (conteúdo diferente). O índice único parcial
-- `(attempt_id, signal_sequence) WHERE checkpoint_recorded` é a garantia final,
-- ainda que alguém esqueça o lock. Não há mutex em memória.

-- ============================================================
-- Régua estrutural (espelho SQL de validateWorkCheckpoint do core)
-- ============================================================
--
-- Reutiliza os primitivos existentes (`jsonb_is_nonblank_string`,
-- `jsonb_is_nonblank_string_array`) — não cria uma segunda política. As chaves
-- são camelCase porque validam o payload como o executor o emite (INT-01). A
-- sanitização de dados sensíveis (credenciais/caminhos) permanece a régua única
-- do core aplicada antes da emissão; aqui só se reforça a guarda de caminho
-- absoluto do `handoffReference`, idêntica à do terminal comandado.

CREATE FUNCTION private.is_valid_checkpoint_validations(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN v IS NULL OR jsonb_typeof(v) <> 'array' THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v) AS entry
      WHERE jsonb_typeof(entry.value) <> 'object'
         OR NOT private.jsonb_is_nonblank_string(entry.value -> 'label')
         OR (entry.value ->> 'outcome') NOT IN ('passed', 'failed', 'declared')
    )
  END;
$$;

CREATE FUNCTION private.is_valid_work_checkpoint(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN false
    WHEN p -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'handoffReference') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'nextStep') THEN false
    WHEN NOT private.jsonb_is_nonblank_string_array(p -> 'completedSteps', 0) THEN false
    WHEN NOT private.jsonb_is_nonblank_string_array(p -> 'remainingSteps', 0) THEN false
    WHEN NOT private.jsonb_is_nonblank_string_array(p -> 'decisions', 0) THEN false
    WHEN NOT private.jsonb_is_nonblank_string_array(p -> 'risks', 0) THEN false
    WHEN NOT private.jsonb_is_nonblank_string_array(p -> 'touchedResources', 0) THEN false
    WHEN NOT private.jsonb_is_nonblank_string_array(p -> 'failures', 0) THEN false
    WHEN NOT private.jsonb_is_nonblank_string_array(p -> 'evidenceReferences', 0) THEN false
    WHEN NOT private.is_valid_checkpoint_validations(p -> 'validations') THEN false
    -- Neste ponto ambos são arrays comprovados; jsonb_array_length é seguro.
    WHEN jsonb_array_length(p -> 'completedSteps') + jsonb_array_length(p -> 'remainingSteps') = 0 THEN false
    ELSE true
  END;
$$;

REVOKE ALL ON FUNCTION private.is_valid_checkpoint_validations(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_valid_work_checkpoint(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_valid_checkpoint_validations(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.is_valid_work_checkpoint(jsonb) TO service_role;

-- Garantia final da unicidade por (tentativa, sequência de checkpoint).
CREATE UNIQUE INDEX work_events_checkpoint_attempt_seq_idx
  ON public.work_events ((payload -> 'data' ->> 'attempt_id'), (payload -> 'data' ->> 'signal_sequence'))
  WHERE event_type = 'checkpoint_recorded';

-- ============================================================
-- RPC de registro
-- ============================================================

CREATE FUNCTION public.record_work_checkpoint(
  work_item_id uuid,
  expected_proposal_version integer,
  attempt_id uuid,
  signal jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id       uuid := auth.uid();
  v_item          public.work_items;
  v_checkpoint    jsonb;
  v_sequence      integer;
  v_claim_id      uuid;
  v_claim_attempt uuid;
  v_claim_found   boolean;
  v_last          public.work_events;
  v_last_seq      integer;
  v_event_seq     bigint;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version < 1 OR attempt_id IS NULL
     OR jsonb_typeof(signal) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid checkpoint signal' USING ERRCODE='22023';
  END IF;

  -- Correlação do sinal contra os parâmetros explícitos: não se confia só nele.
  v_checkpoint := signal -> 'checkpoint';
  IF signal->>'kind' IS DISTINCT FROM 'checkpoint'
     OR signal->>'workItemId' IS DISTINCT FROM work_item_id::text
     OR signal->>'attemptId' IS DISTINCT FROM attempt_id::text
     OR (signal->>'approvedProposalVersion')::integer IS DISTINCT FROM expected_proposal_version
     OR signal->>'origin' IS DISTINCT FROM 'executor'
     OR jsonb_typeof(signal -> 'sequence') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'checkpoint signal correlation mismatch' USING ERRCODE='22023';
  END IF;
  v_sequence := (signal->>'sequence')::integer;
  IF v_sequence IS NULL OR v_sequence < 1 THEN
    RAISE EXCEPTION 'checkpoint sequence must be a positive integer' USING ERRCODE='22023';
  END IF;

  -- Payload estruturalmente válido; guarda de caminho absoluto do handoff,
  -- idêntica à do terminal comandado (não é uma segunda política).
  IF NOT private.is_valid_work_checkpoint(v_checkpoint) THEN
    RAISE EXCEPTION 'invalid checkpoint payload' USING ERRCODE='22023';
  END IF;
  IF v_checkpoint->>'handoffReference' ~ '^[A-Za-z]:[\\/]' OR v_checkpoint->>'handoffReference' LIKE '/%' THEN
    RAISE EXCEPTION 'invalid checkpoint payload' USING ERRCODE='22023';
  END IF;

  -- Fronteira de concorrência: bloqueia o item e serializa registros do item.
  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  -- A tentativa existe e está correlacionada por fato persistido (INT-02).
  IF NOT EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
      AND e.proposal_version=expected_proposal_version
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'attempt not found' USING ERRCODE='P0002';
  END IF;

  -- Tentativa não pode ter terminal nem ter sido abandonada pelo SUP-04.
  IF EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_item.id
      AND e.event_type IN ('result_submitted','execution_failed','work_cancelled')
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'attempt already finished' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_item.id AND e.event_type='attempt_abandoned'
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'attempt was abandoned by reconciliation' USING ERRCODE='55000';
  END IF;

  -- Item ainda em execução, na versão aprovada correta.
  IF v_item.state <> 'in_progress' OR v_item.proposal_version <> expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;

  -- Claim derivado no servidor: se há posse ativa no item, ela tem de ser desta
  -- tentativa. Posse liberada (INT-04 comandado, ou lease recolhido pelo SUP-04
  -- com a duração ainda dentro do limite) não bloqueia: claim_id fica nulo.
  SELECT c.id, c.attempt_id INTO v_claim_id, v_claim_attempt
  FROM public.work_claims c WHERE c.work_item_id=v_item.id AND c.released_at IS NULL;
  v_claim_found := FOUND;
  IF v_claim_found AND v_claim_attempt IS DISTINCT FROM attempt_id THEN
    RAISE EXCEPTION 'work item is held by a different attempt' USING ERRCODE='55000';
  END IF;
  IF NOT v_claim_found THEN v_claim_id := NULL; END IF;

  -- Monotonicidade e idempotência pela maior sequência de checkpoint da tentativa.
  SELECT * INTO v_last FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
    AND e.payload->'data'->>'attempt_id'=attempt_id::text
  ORDER BY (e.payload->'data'->>'signal_sequence')::integer DESC LIMIT 1;
  IF FOUND THEN
    v_last_seq := (v_last.payload->'data'->>'signal_sequence')::integer;
    IF v_sequence < v_last_seq THEN
      RAISE EXCEPTION 'checkpoint sequence regressed' USING ERRCODE='55000';
    ELSIF v_sequence = v_last_seq THEN
      -- Replay determinístico do sinal bruto; divergência falha fechada.
      IF v_last.payload->'data'->'executor_signal' = signal THEN
        RETURN jsonb_build_object('action','replayed','checkpoint_sequence',v_sequence,'event_seq',v_last.seq);
      END IF;
      RAISE EXCEPTION 'checkpoint conflict at the same sequence' USING ERRCODE='55000';
    END IF;
  END IF;

  -- Novo checkpoint: evento append-only, sem tocar o estado do item.
  INSERT INTO public.work_events(work_item_id, event_type, author, proposal_version, payload)
  VALUES (v_item.id, 'checkpoint_recorded', 'executor', v_item.proposal_version,
    jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
      'work_item_id', v_item.id,
      'attempt_id', attempt_id,
      'approved_proposal_version', expected_proposal_version,
      'claim_id', v_claim_id,
      'origin', 'executor',
      'signal_sequence', v_sequence,
      'checkpoint', v_checkpoint,
      'executor_signal', signal)))
  RETURNING seq INTO v_event_seq;

  RETURN jsonb_build_object('action','recorded','checkpoint_sequence',v_sequence,'event_seq',v_event_seq);
END;
$$;

REVOKE ALL ON FUNCTION public.record_work_checkpoint(uuid, integer, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_work_checkpoint(uuid, integer, uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.record_work_checkpoint(uuid, integer, uuid, jsonb) IS
  'Etapa 2A: registra um checkpoint mid-flight (WorkCheckpointV1) como evento append-only checkpoint_recorded, decidindo apenas por fato persistido e fail-closed. Exige item do usuário em in_progress, tentativa iniciada, sem terminal e não abandonada pelo SUP-04, versão correta, payload estruturalmente válido e origem executor; se há claim ativo no item, ele tem de ser o desta tentativa. Monotônico por sequência: regressão e conflito na mesma sequência falham fechados; reentrega idêntica é replay sem novo evento. NÃO muda estado, não conclui, não aceita, não autoriza e não integra.';

-- ============================================================
-- Reconstrução: último checkpoint válido, só por fato persistido
-- ============================================================
--
-- Leitura pura: escolhe o checkpoint de maior `signal_sequence` da tentativa,
-- preserva todo o histórico, não consome, não inicia tentativa, não altera
-- estado, não decide elegibilidade e não chama planWorkResumption. Ausência é
-- representada como NULL (ausência tipada no espelho do core).

CREATE FUNCTION public.latest_work_checkpoint(p_work_item_id uuid, p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
STABLE
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_data    jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  -- Item inexistente ou de outro usuário: ausência tipada, sem vazar existência.
  IF NOT EXISTS (SELECT 1 FROM public.work_items i WHERE i.id=p_work_item_id AND i.user_id=v_user_id) THEN
    RETURN NULL;
  END IF;
  SELECT e.payload -> 'data' INTO v_data FROM public.work_events e
  WHERE e.work_item_id=p_work_item_id AND e.event_type='checkpoint_recorded'
    AND e.payload->'data'->>'attempt_id'=p_attempt_id::text
  ORDER BY (e.payload->'data'->>'signal_sequence')::integer DESC LIMIT 1;
  RETURN v_data; -- NULL quando não há checkpoint
END;
$$;

REVOKE ALL ON FUNCTION public.latest_work_checkpoint(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.latest_work_checkpoint(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.latest_work_checkpoint(uuid, uuid) IS
  'Etapa 2A: reconstrói o último checkpoint válido de uma tentativa (maior signal_sequence) apenas por fato persistido. Preserva o histórico, não consome, não inicia tentativa, não altera estado, não decide elegibilidade e não chama planWorkResumption. Retorna NULL quando não há checkpoint (ausência tipada).';
