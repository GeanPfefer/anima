-- ============================================================
-- Persistência append-only do PARECER do Verifier (advisory, VERSIONADO)
-- ============================================================
--
-- Distinção canônica do recorte:
--   EVIDÊNCIA (histórico observado/atestado) ≠ PARECER (interpretação versionada da
--   evidência) ≠ DECISÃO (autorização humana/política).
--
-- Este evento registra o PARECER: `verifier_opinion_recorded`, `author=system` +
-- `origin=verifier`. O Verifier é uma função PURA e DETERMINÍSTICA do host/system
-- (`computeVerifierOpinion` em packages/core), não do executor — por isso a
-- proveniência é `system`/`verifier`, e o sinal do executor NÃO a forja (outro
-- evento, outra RPC, outro autor). O parecer é ADVISORY: não muda estado do item,
-- não aceita resultado, não autoriza/decide integração (`integration_decided` é
-- `author=user`, outro fato, outro momento do ciclo), não publica, não mergeia, não
-- deploya, não aumenta maturidade e não remove o gate humano.
--
-- ============================================================
-- Histórico versionado, não verdade única
-- ============================================================
--
-- O mesmo attempt pode LEGITIMAMENTE receber mais de um parecer ao longo do tempo:
--   * o Verifier evolui de versão (V1 → V2), ou
--   * a base de EVIDÊNCIA muda (a evidência observada pelo host aparece depois da
--     atestação: V1 sobre atestado apenas → V1 sobre atestado + observado).
-- A identidade de um parecer é (attempt, verifier_version, result_event_id,
-- observed_event_id). Para essa chave:
--   * idêntico já registrado           → replay idempotente, sem novo evento;
--   * mesma chave, conteúdo diferente  → conflito fail-closed (55000) — o Verifier é
--     determinístico, então conteúdo divergente na mesma base é bug/adulteração;
--   * base ou versão diferente         → NOVO parecer append-only (história preservada).
-- Como o parecer é RECOMPUTÁVEL de (item, eventos), um crash entre computar e
-- persistir não perde nada: recomputa-se no próximo seam. A persistência é auditoria.
--
-- O parecer NÃO duplica a evidência: referencia os eventos de evidência por id
-- (`result_event_id`, `observed_event_id`) e guarda a espinha estruturada dos achados,
-- não a prosa (que também é recomputável).

-- ============================================================
-- Régua estrutural (espelho SQL de parseVerifierOpinion do core)
-- ============================================================

CREATE FUNCTION private.is_valid_opinion_summary(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN v IS NULL OR jsonb_typeof(v) <> 'object' THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM (VALUES ('violations'),('gaps'),('checks'),('attested'),('independent')) AS k(key)
      WHERE jsonb_typeof(v -> k.key) IS DISTINCT FROM 'number'
         OR (v ->> k.key)::numeric < 0
         OR (v ->> k.key)::numeric <> trunc((v ->> k.key)::numeric)
    )
  END;
$$;

CREATE FUNCTION private.is_valid_opinion_findings(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN v IS NULL OR jsonb_typeof(v) <> 'array' THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v) AS entry
      WHERE jsonb_typeof(entry.value) <> 'object'
         OR NOT private.jsonb_is_nonblank_string(entry.value -> 'code')
         OR (entry.value ->> 'severity') NOT IN ('ok', 'gap', 'violation')
         OR (entry.value ->> 'provenance') NOT IN ('independent', 'attested')
         OR (entry.value ? 'subject' AND NOT private.jsonb_is_nonblank_string(entry.value -> 'subject'))
    )
  END;
$$;

CREATE FUNCTION private.is_valid_verifier_opinion(p jsonb)
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
    -- observedEventId: JSON null OU string não-vazia.
    WHEN NOT ((p #> '{evidenceBasis,observedEventId}') = 'null'::jsonb
              OR private.jsonb_is_nonblank_string(p #> '{evidenceBasis,observedEventId}')) THEN false
    WHEN jsonb_typeof(p #> '{evidenceBasis,coverage,git}') <> 'boolean' THEN false
    WHEN jsonb_typeof(p #> '{evidenceBasis,coverage,gates}') <> 'boolean' THEN false
    ELSE true
  END;
$$;

REVOKE ALL ON FUNCTION private.is_valid_opinion_summary(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_valid_opinion_findings(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_valid_verifier_opinion(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_valid_opinion_summary(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.is_valid_opinion_findings(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.is_valid_verifier_opinion(jsonb) TO service_role;

-- Garantia final da identidade do parecer: um por (tentativa, versão do Verifier,
-- evidência considerada). `coalesce` colapsa o observedEventId ausente num único valor,
-- para que dois pareceres "sem observação" na mesma base sejam o MESMO, não duplicáveis.
CREATE UNIQUE INDEX work_events_verifier_opinion_identity_idx
  ON public.work_events (
    (payload -> 'data' ->> 'attempt_id'),
    (payload -> 'data' ->> 'verifier_version'),
    (payload -> 'data' ->> 'result_event_id'),
    (coalesce(payload -> 'data' ->> 'observed_event_id', 'none'))
  )
  WHERE event_type = 'verifier_opinion_recorded';

-- ============================================================
-- RPC de registro
-- ============================================================

CREATE FUNCTION public.record_verifier_opinion(
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

  -- Régua estrutural do core, antes de qualquer efeito.
  IF NOT private.is_valid_verifier_opinion(opinion) THEN
    RAISE EXCEPTION 'invalid verifier opinion' USING ERRCODE='22023';
  END IF;

  -- Correlação declarada tem de casar com os parâmetros — não se confia só no blob.
  IF opinion->>'workItemId' IS DISTINCT FROM work_item_id::text
     OR opinion->>'attemptId' IS DISTINCT FROM attempt_id::text
     OR (opinion->>'approvedProposalVersion')::integer IS DISTINCT FROM expected_proposal_version THEN
    RAISE EXCEPTION 'verifier opinion correlation mismatch' USING ERRCODE='22023';
  END IF;

  -- observedEventId como JSON null vira SQL NULL aqui.
  v_observed_id := opinion #>> '{evidenceBasis,observedEventId}';

  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  -- A tentativa existe e está correlacionada por fato persistido (INT-02).
  IF NOT EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
      AND e.proposal_version=expected_proposal_version
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'attempt not found' USING ERRCODE='P0002';
  END IF;

  -- A base de evidência tem de apontar eventos REAIS DESTA tentativa: o parecer não
  -- pode referenciar evidência de outro attempt.
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

  -- Idempotência/histórico pela identidade (tentativa, versão, base de evidência).
  SELECT * INTO v_existing FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='verifier_opinion_recorded'
    AND e.payload->'data'->>'attempt_id'=attempt_id::text
    AND e.payload->'data'->>'verifier_version'=v_version
    AND e.payload->'data'->>'result_event_id'=v_result_id
    AND coalesce(e.payload->'data'->>'observed_event_id','none')=coalesce(v_observed_id,'none');
  IF FOUND THEN
    IF v_existing.payload->'data'->'opinion' = opinion THEN
      RETURN jsonb_build_object('action','replayed','event_seq',v_existing.seq);
    END IF;
    RAISE EXCEPTION 'verifier opinion conflict' USING ERRCODE='55000';
  END IF;

  -- Evento append-only. author=system + origin=verifier: proveniência que o executor
  -- não forja. NÃO muda estado do item nem cria decisão.
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
      'opinion', opinion)))
  RETURNING seq INTO v_event_seq;

  RETURN jsonb_build_object('action','recorded','verdict',opinion->>'verdict','event_seq',v_event_seq);
END;
$$;

REVOKE ALL ON FUNCTION public.record_verifier_opinion(uuid, integer, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verifier_opinion(uuid, integer, uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.record_verifier_opinion(uuid, integer, uuid, jsonb) IS
  'Registra o PARECER do Verifier (advisory, versionado) como evento append-only verifier_opinion_recorded, author=system/origin=verifier, decidindo só por fato persistido e fail-closed. Exige item do usuário, allowlist, tentativa real correlacionada, opinion VerifierOpinionV1 estruturalmente válido, correlação casando com os parâmetros e base de evidência (result_event_id/observed_event_id) apontando eventos reais DESTA tentativa. Histórico versionado: identidade por (attempt, verifier_version, result_event_id, observed_event_id) — idêntico replaya, conteúdo divergente na mesma base é conflito 55000, base/versão diferente é novo parecer append-only. NÃO muda estado, não aceita, não autoriza/decide integração, não publica, não mergeia, não aumenta maturidade e não remove o gate humano. Recomputável de (item, eventos): a persistência é auditoria.';
