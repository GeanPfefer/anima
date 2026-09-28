-- Mandated Verifier Enforcement V0.1 (2026-09-28) — fechar a fronteira de REVIEW.
--
-- V0 (59eb37e) tornou o ACEITE fail-closed na aplicação, mas: (a) o item entrava em
-- `review` na RPC terminal, ANTES do Verifier; (b) `review_work_result_versioned`
-- não conferia o parecer — chamada direta ao PostgREST contornava o gate.
--
-- Para itens com `intent.execution_spec.verifier_requirement` ≠ `advisory`
-- (lane mandatado; marcador gravado pelo materializer canônico):
--
--   1. a RPC terminal grava `result_submitted` (resultado CANDIDATO, durável) e
--      mantém o item em `in_progress`;
--   2. `record_verifier_opinion` persiste o parecer e, NA MESMA TRANSAÇÃO, libera o
--      candidato para `review` somente se o parecer mais recente correlacionado for
--      conclusivo (`verified` ou `rejected`) com correlação completa;
--   3. um trigger recusa QUALQUER transição do lane para `review` sem essa condição
--      (terminal, submissão manual, reconciliação) — defesa persistente;
--   4. `review_work_result_versioned` recusa `accept` sem `verified` corrente;
--   5. a reconciliação não materializa `review` de um candidato pendente: relata
--      `result_pending_verification` para a re-verificação host-side.
--
-- Lanes advisory (sem marcador ou `advisory`): comportamento idêntico ao anterior.
-- Residual NÃO resolvido aqui: autoria do parecer. `record_verifier_opinion` é
-- chamável por qualquer usuário autenticado da allowlist e carimba `system`; o host
-- residente usa a MESMA identidade do usuário — não há como distinguir parecer do
-- host de submissão arbitrária sem nova identidade (fora do escopo).

-- ─── Predicados ─────────────────────────────────────────────────────────────

-- Espelho de `readVerifierRequirement` (core): chave ausente ou `advisory` ⇒ advisory;
-- qualquer outro valor presente (inclusive JSON null) ⇒ obrigatório.
CREATE OR REPLACE FUNCTION private.work_item_requires_verifier(p_intent jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT coalesce(
    jsonb_typeof(p_intent -> 'execution_spec') = 'object'
    AND (p_intent -> 'execution_spec') ? 'verifier_requirement'
    AND (p_intent -> 'execution_spec' -> 'verifier_requirement') IS DISTINCT FROM '"advisory"'::jsonb,
    false);
$$;

CREATE OR REPLACE FUNCTION private.latest_result_event_id(p_work_item_id uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT e.id FROM public.work_events e
  WHERE e.work_item_id = p_work_item_id AND e.event_type = 'result_submitted'
  ORDER BY e.seq DESC LIMIT 1;
$$;

-- Veredito DECISIVO do lane para um resultado: o parecer MAIS RECENTE correlacionado
-- ao resultado (item, versão, attempt, result_event_id), aceito só se a sua base de
-- evidência for completa e coerente:
--   - evidência git do host da MESMA attempt/versão, com `observedCommitSha` = commit
--     do handoff do resultado;
--   - evidência de gate do host da MESMA attempt/versão;
--   - evidência do coder do host da MESMA attempt/versão.
-- Retorna: verified | rejected | inconclusive | missing | result_mismatch |
--          evidence_incomplete | commit_mismatch.
CREATE OR REPLACE FUNCTION private.mandated_result_verdict(
  p_work_item_id uuid, p_proposal_version integer, p_result_event_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE
  v_result  public.work_events;
  v_opinion public.work_events;
  v_attempt text;
  v_commit  text;
BEGIN
  IF p_result_event_id IS NULL THEN RETURN 'missing'; END IF;
  SELECT * INTO v_result FROM public.work_events e
  WHERE e.id = p_result_event_id AND e.work_item_id = p_work_item_id
    AND e.event_type = 'result_submitted' AND e.proposal_version = p_proposal_version;
  IF NOT FOUND THEN RETURN 'result_mismatch'; END IF;
  -- Só o resultado MAIS RECENTE pode ser liberado/aceito: parecer antigo nunca
  -- libera resultado novo, e resultado antigo não é aceitável.
  IF p_result_event_id IS DISTINCT FROM private.latest_result_event_id(p_work_item_id) THEN
    RETURN 'result_mismatch';
  END IF;
  v_attempt := v_result.payload -> 'data' ->> 'attempt_id';
  v_commit  := v_result.payload #>> '{data,executor_signal,worktreeHandoff,commitSha}';

  SELECT * INTO v_opinion FROM public.work_events o
  WHERE o.work_item_id = p_work_item_id AND o.event_type = 'verifier_opinion_recorded'
    AND o.proposal_version = p_proposal_version
    AND o.payload -> 'data' ->> 'attempt_id' = v_attempt
    AND o.payload -> 'data' ->> 'result_event_id' = p_result_event_id::text
    AND (o.payload -> 'data' ->> 'approved_proposal_version') = p_proposal_version::text
  ORDER BY o.seq DESC LIMIT 1;
  IF NOT FOUND THEN RETURN 'missing'; END IF;

  IF (v_opinion.payload -> 'data' ->> 'observed_event_id') IS NULL
     OR (v_opinion.payload -> 'data' ->> 'observed_gate_event_id') IS NULL THEN
    RETURN 'evidence_incomplete';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_events g
    WHERE g.id = (v_opinion.payload -> 'data' ->> 'observed_gate_event_id')::uuid
      AND g.work_item_id = p_work_item_id AND g.event_type = 'host_observed_gate_evidence_recorded'
      AND g.proposal_version = p_proposal_version AND g.payload -> 'data' ->> 'attempt_id' = v_attempt) THEN
    RETURN 'evidence_incomplete';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_events c
    WHERE c.work_item_id = p_work_item_id AND c.event_type = 'host_observed_coder_evidence_recorded'
      AND c.proposal_version = p_proposal_version AND c.payload -> 'data' ->> 'attempt_id' = v_attempt) THEN
    RETURN 'evidence_incomplete';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_events h
    WHERE h.id = (v_opinion.payload -> 'data' ->> 'observed_event_id')::uuid
      AND h.work_item_id = p_work_item_id AND h.event_type = 'host_observed_evidence_recorded'
      AND h.proposal_version = p_proposal_version AND h.payload -> 'data' ->> 'attempt_id' = v_attempt) THEN
    RETURN 'evidence_incomplete';
  END IF;
  IF v_commit IS NULL OR NOT EXISTS (SELECT 1 FROM public.work_events h
    WHERE h.id = (v_opinion.payload -> 'data' ->> 'observed_event_id')::uuid
      AND h.payload #>> '{data,evidence,observedCommitSha}' = v_commit) THEN
    RETURN 'commit_mismatch';
  END IF;

  RETURN CASE v_opinion.payload -> 'data' ->> 'verdict'
    WHEN 'verified' THEN 'verified'
    WHEN 'rejected' THEN 'rejected'
    ELSE 'inconclusive' END;
END;
$$;

-- Libera o resultado candidato do lane para `review` quando o veredito decisivo é
-- conclusivo. Idempotente; nada acontece fora do lane ou fora de `in_progress`.
-- A transição é justificada pelo `verifier_opinion_recorded` persistido (linha
-- nova da matriz normativa) — nenhum evento sintético é criado.
CREATE OR REPLACE FUNCTION private.release_mandated_result(p_item public.work_items)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_verdict text;
  v_target  public.work_state;
BEGIN
  IF p_item.state <> 'in_progress' OR NOT private.work_item_requires_verifier(p_item.intent) THEN
    RETURN false;
  END IF;
  v_verdict := private.mandated_result_verdict(p_item.id, p_item.proposal_version,
    private.latest_result_event_id(p_item.id));
  IF v_verdict NOT IN ('verified','rejected') THEN RETURN false; END IF;
  SELECT t.to_state INTO v_target FROM private.work_state_transitions t
  WHERE t.from_state = 'in_progress' AND t.event_type = 'verifier_opinion_recorded';
  IF NOT FOUND THEN RAISE EXCEPTION 'transition not allowed' USING ERRCODE='22023'; END IF;
  UPDATE public.work_items SET state = v_target, updated_at = now() WHERE id = p_item.id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION private.release_mandated_result(public.work_items) FROM PUBLIC, anon, authenticated;

INSERT INTO private.work_state_transitions (from_state, event_type, to_state)
VALUES ('in_progress', 'verifier_opinion_recorded', 'review')
ON CONFLICT DO NOTHING;

-- ─── Defesa persistente: nenhuma entrada do lane em `review` sem veredito ────

CREATE OR REPLACE FUNCTION private.guard_mandated_review_release()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_verdict text;
BEGIN
  IF NEW.state = 'review' AND OLD.state IS DISTINCT FROM 'review'
     AND private.work_item_requires_verifier(NEW.intent) THEN
    v_verdict := private.mandated_result_verdict(NEW.id, NEW.proposal_version, private.latest_result_event_id(NEW.id));
    IF v_verdict NOT IN ('verified','rejected') THEN
      RAISE EXCEPTION 'mandated result not verified for review (%)', v_verdict USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_mandated_review_release ON public.work_items;
CREATE TRIGGER guard_mandated_review_release
  BEFORE UPDATE OF state ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION private.guard_mandated_review_release();

-- ─── RPCs (corpos vigentes reproduzidos + mudança mínima) ────────────────────

CREATE OR REPLACE FUNCTION public.record_commanded_work_terminal(
  work_item_id uuid,
  expected_proposal_version integer,
  attempt_id uuid,
  signal jsonb
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_previous public.work_events;
  v_event public.work_event_type;
  v_state public.work_state;
  v_data jsonb;
  v_kind text;
  v_terminal_seq integer;
  v_max_checkpoint_seq integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version<1 OR attempt_id IS NULL
     OR jsonb_typeof(signal) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid terminal signal' USING ERRCODE='22023';
  END IF;
  v_kind := signal->>'kind';
  IF v_kind NOT IN ('result','error','cancelled')
     OR signal->>'workItemId' IS DISTINCT FROM work_item_id::text
     OR signal->>'attemptId' IS DISTINCT FROM attempt_id::text
     OR (signal->>'approvedProposalVersion')::integer IS DISTINCT FROM expected_proposal_version
     OR signal->>'origin' IS DISTINCT FROM 'executor'
     OR jsonb_typeof(signal->'sequence') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'terminal signal correlation mismatch' USING ERRCODE='22023';
  END IF;
  v_terminal_seq := (signal->>'sequence')::integer;
  IF v_terminal_seq < 1 THEN
    RAISE EXCEPTION 'terminal sequence must be a positive integer' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
    AND e.proposal_version=expected_proposal_version AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'attempt not found' USING ERRCODE='P0002';
  END IF;

  SELECT * INTO v_previous FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type IN ('result_submitted','execution_failed','work_cancelled')
    AND e.payload->'data'->>'attempt_id'=attempt_id::text ORDER BY e.seq DESC LIMIT 1;
  IF FOUND THEN
    IF v_previous.payload->'data'->'executor_signal'=signal THEN RETURN v_item; END IF;
    RAISE EXCEPTION 'attempt already finished with different signal' USING ERRCODE='55000';
  END IF;

  -- SUP-04: tentativa abandonada pela reconciliação não é ressuscitada por um
  -- sinal tardio. O bundle produzido não é apagado nem perdido — permanece
  -- referenciado pelo evento de abandono —, mas não move estado nenhum.
  IF EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_item.id AND e.event_type='attempt_abandoned'
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'attempt was abandoned by reconciliation' USING ERRCODE='55000';
  END IF;

  -- Etapa 2B.1: o terminal vem DEPOIS de todos os checkpoints persistidos da
  -- tentativa. progress não é persistido, então basta estar à frente do maior.
  SELECT max((e.payload->'data'->>'signal_sequence')::integer) INTO v_max_checkpoint_seq
  FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
    AND e.payload->'data'->>'attempt_id'=attempt_id::text;
  IF v_max_checkpoint_seq IS NOT NULL AND v_terminal_seq <= v_max_checkpoint_seq THEN
    RAISE EXCEPTION 'terminal sequence must follow the latest checkpoint' USING ERRCODE='55000';
  END IF;

  IF v_item.state<>'in_progress' OR v_item.proposal_version<>expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;

  IF v_kind='result' THEN
    IF jsonb_typeof(signal->'resultReferences') IS DISTINCT FROM 'array'
       OR jsonb_typeof(signal->'validations') IS DISTINCT FROM 'array'
       OR jsonb_typeof(signal->'limitations') IS DISTINCT FROM 'array'
       OR length(btrim(signal->>'summary'))=0 OR length(btrim(signal->>'handoffReference'))=0
       OR signal->>'handoffReference' ~ '^[A-Za-z]:[\\/]' OR signal->>'handoffReference' LIKE '/%' THEN
      RAISE EXCEPTION 'invalid result signal' USING ERRCODE='22023';
    END IF;
    v_event:='result_submitted';
    -- Mandated Verifier Enforcement V0.1: no lane com Verifier obrigatório o resultado
    -- é CANDIDATO — o item permanece `in_progress` até um parecer conclusivo e
    -- correlacionado ser persistido (`record_verifier_opinion` libera para `review`).
    -- Lanes advisory seguem direto para `review`, como antes.
    v_state:=CASE WHEN private.work_item_requires_verifier(v_item.intent) THEN 'in_progress'::public.work_state ELSE 'review'::public.work_state END;
    v_data:=jsonb_build_object('summary',signal->>'summary','result_references',signal->'resultReferences',
      'validations',signal->'validations','limitations',signal->'limitations','handoff_reference',signal->>'handoffReference');
  ELSIF v_kind='cancelled' THEN
    v_event:='work_cancelled'; v_state:='cancelled';
    v_data:=jsonb_build_object('reason','execution_cancelled','handoff_reference',signal->>'handoffReference');
  ELSE
    IF length(btrim(signal->>'message'))=0 OR length(btrim(signal->>'handoffReference'))=0 THEN
      RAISE EXCEPTION 'invalid error signal' USING ERRCODE='22023';
    END IF;
    v_event:='execution_failed'; v_state:='failed';
    v_data:=jsonb_build_object('reason',signal->>'code','message',signal->>'message',
      'retryable',signal->'retryable','handoff_reference',signal->>'handoffReference');
  END IF;
  v_data:=v_data||jsonb_build_object('work_item_id',v_item.id,'attempt_id',attempt_id,
    'approved_proposal_version',expected_proposal_version,'origin','executor','signal_sequence',v_terminal_seq,'executor_signal',signal);

  UPDATE public.work_items SET state=v_state,updated_at=now() WHERE id=v_item.id RETURNING * INTO v_item;
  -- Terminal do executor: a autoria é sempre `executor`. O cancelamento humano
  -- explícito nunca chega por aqui — tem seu próprio caminho em checkpoint.
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,v_event,'executor'::public.work_event_author,
    v_item.proposal_version,jsonb_build_object('schema_version',1,'data',v_data));
  RETURN v_item;
END;
$$;

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
  v_released    boolean;
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
      -- Replay idempotente: nenhum evento novo; a liberação (se cabível) é reavaliada.
      v_released := private.release_mandated_result(v_item);
      RETURN jsonb_build_object('action','replayed','event_seq',v_existing.seq,'released_for_review',v_released);
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

  -- Mandated Verifier Enforcement V0.1: persistir o parecer e liberar o resultado
  -- candidato para `review` são ATÔMICOS (mesma transação). Só o parecer
  -- persistido conta; a liberação relê do log e exige a correlação completa.
  v_released := private.release_mandated_result(v_item);

  RETURN jsonb_build_object('action','recorded','verdict',opinion->>'verdict','event_seq',v_event_seq,
    'released_for_review',v_released);
END;
$$;

CREATE OR REPLACE FUNCTION public.review_work_result_versioned(
  work_item_id uuid,
  expected_proposal_version integer,
  reviewed_result_event_id uuid,
  decision public.work_review_decision,
  decision_context jsonb DEFAULT '{}'::jsonb
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE v_user_id uuid:=auth.uid();v_item public.work_items;v_latest_result_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM public.work_items item WHERE item.id=work_item_id AND item.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.state<>'review' OR v_item.proposal_version<>expected_proposal_version THEN RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000'; END IF;
  SELECT event.id INTO v_latest_result_id FROM public.work_events event WHERE event.work_item_id=v_item.id AND event.event_type='result_submitted' ORDER BY event.seq DESC LIMIT 1;
  IF reviewed_result_event_id IS NULL OR reviewed_result_event_id IS DISTINCT FROM v_latest_result_id THEN RAISE EXCEPTION 'reviewed result changed' USING ERRCODE='55000'; END IF;
  -- Mandated Verifier Enforcement V0.1 (defesa persistente): no lane com Verifier
  -- obrigatório, ACEITAR exige parecer corrente `verified`, correlacionado ao
  -- resultado aceito (attempt, versão, evidência git/gate/coder, commit). Pedir
  -- mudanças segue livre. Lanes advisory: inalterados.
  IF decision='accept' AND private.work_item_requires_verifier(v_item.intent)
     AND private.mandated_result_verdict(v_item.id, v_item.proposal_version, reviewed_result_event_id) IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'verifier requirement not satisfied' USING ERRCODE='55000';
  END IF;
  RETURN public.review_work_result(work_item_id,expected_proposal_version,decision,decision_context);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_supervised_work()
RETURNS TABLE (
  work_item_id uuid,
  attempt_id   uuid,
  claim_id     uuid,
  finding      text,
  action       text,
  item_state   public.work_state,
  detail       jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_user_id           uuid := auth.uid();
  v_now               timestamptz := now();
  v_candidate         uuid;
  v_item              public.work_items;
  v_attempt           uuid;
  v_attempt_started   timestamptz;
  v_terminal          public.work_event_type;
  v_claim             public.work_claims;
  v_lease             public.work_claims;
  v_lease_bound       boolean;
  v_lease_exceeded    boolean;
  v_duration_minutes  integer;
  v_duration_bound    boolean;
  v_duration_exceeded boolean;
  v_target_state      public.work_state;
  v_reason            text;
  v_release_reason    text;
  v_verdict           text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;

  -- Duas reconciliações concorrentes são serializadas inteiras. A segunda não
  -- decide sobre estado que a primeira já mudou: ela relê tudo depois do commit.
  PERFORM pg_advisory_xact_lock(hashtextextended('work_reconciliation:'||v_user_id::text, 0));

  FOR v_candidate IN
    SELECT i.id FROM public.work_items i
    WHERE i.user_id = v_user_id
      AND (i.state = 'in_progress'
           OR EXISTS (SELECT 1 FROM public.work_claims c
                      WHERE c.work_item_id = i.id AND c.released_at IS NULL))
    ORDER BY i.id
  LOOP
    SELECT * INTO v_item FROM public.work_items i
    WHERE i.id = v_candidate AND i.user_id = v_user_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;

    -- Tentativa vigente do item: o `execution_started` mais recente que carrega
    -- `attempt_id`. A execução delimitada da P1.6 usa `execution_id` e não
    -- participa deste vocabulário.
    v_attempt := NULL; v_attempt_started := NULL;
    SELECT (e.payload->'data'->>'attempt_id')::uuid, e.created_at
      INTO v_attempt, v_attempt_started
    FROM public.work_events e
    WHERE e.work_item_id = v_item.id AND e.event_type = 'execution_started'
      AND e.payload->'data' ? 'attempt_id'
    ORDER BY e.seq DESC LIMIT 1;

    v_terminal := NULL;
    IF v_attempt IS NOT NULL THEN
      SELECT e.event_type INTO v_terminal FROM public.work_events e
      WHERE e.work_item_id = v_item.id
        AND e.event_type IN ('result_submitted','execution_failed','work_cancelled','attempt_abandoned')
        AND e.payload->'data'->>'attempt_id' = v_attempt::text
      ORDER BY e.seq DESC LIMIT 1;
    END IF;

    -- ---------- (1) evento final já persistido, estado derivado atrasado ----------
    --
    -- Materializar não emite evento novo: o evento JÁ existe e duplicá-lo seria
    -- inventar um segundo fato. Aplica-se a transição que o próprio evento
    -- justifica, pela mesma matriz normativa que todas as RPCs consultam.
    -- Mandated Verifier Enforcement V0.1: resultado CANDIDATO do lane com Verifier
    -- obrigatório não é materializado em `review` sem parecer conclusivo e
    -- correlacionado (o trigger `guard_mandated_review_release` recusaria). É
    -- relatado para a re-verificação host-side; nada muda.
    v_verdict := NULL;
    IF v_item.state = 'in_progress' AND v_terminal = 'result_submitted'
       AND private.work_item_requires_verifier(v_item.intent) THEN
      v_verdict := private.mandated_result_verdict(v_item.id, v_item.proposal_version,
        private.latest_result_event_id(v_item.id));
      IF v_verdict NOT IN ('verified','rejected') THEN
        RETURN QUERY SELECT v_item.id, v_attempt, NULL::uuid,
          'result_pending_verification'::text, 'requires_verification'::text, v_item.state,
          jsonb_build_object('verifier_status', v_verdict);
        v_terminal := NULL;
      END IF;
    END IF;

    IF v_item.state = 'in_progress' AND v_terminal IS NOT NULL THEN
      SELECT t.to_state INTO v_target_state FROM private.work_state_transitions t
      WHERE t.from_state = v_item.state AND t.event_type = v_terminal;
      IF FOUND THEN
        UPDATE public.work_items SET state=v_target_state, updated_at=v_now
        WHERE id=v_item.id RETURNING * INTO v_item;
        RETURN QUERY SELECT v_item.id, v_attempt, NULL::uuid,
          'terminal_not_materialized'::text, 'state_materialized'::text, v_item.state,
          jsonb_build_object('terminal_event_type', v_terminal::text);
      END IF;
    END IF;

    -- ---------- (2) posse aberta ----------
    v_claim := NULL;
    SELECT * INTO v_claim FROM public.work_claims c
    WHERE c.work_item_id = v_item.id AND c.released_at IS NULL FOR UPDATE;
    IF FOUND THEN
      v_release_reason := NULL;
      IF v_claim.attempt_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.work_events e
        WHERE e.work_item_id = v_item.id
          AND e.event_type IN ('result_submitted','execution_failed','work_cancelled','attempt_abandoned')
          AND e.payload->'data'->>'attempt_id' = v_claim.attempt_id::text
      ) THEN
        -- A tentativa desta posse já tem desfecho persistido; o que faltou foi
        -- materializar a liberação. Fato, não relógio.
        v_release_reason := 'attempt_finished';
      ELSIF v_claim.expires_at <= v_now THEN
        -- Lease vencido: recolhido com a MESMA razão declarada que
        -- `acquire_work_claim` já usa. A linha permanece, nada é apagado.
        v_release_reason := 'expired';
      END IF;

      IF v_release_reason IS NOT NULL THEN
        UPDATE public.work_claims SET released_at=v_now, release_reason=v_release_reason
        WHERE id=v_claim.id RETURNING * INTO v_claim;
        INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
          (v_claim.work_item_id,'work_claim_released','system',v_claim.approved_proposal_version,
            jsonb_build_object('schema_version',1,'data',jsonb_build_object(
              'claim_id',v_claim.id,'work_item_id',v_claim.work_item_id,
              'approved_proposal_version',v_claim.approved_proposal_version,
              'owner_instance_id',v_claim.owner_instance_id,'attempt_id',v_claim.attempt_id,
              'reason',v_release_reason,'released_at',v_now)));
        RETURN QUERY SELECT v_item.id, v_claim.attempt_id, v_claim.id,
          (CASE WHEN v_release_reason='expired' THEN 'claim_expired' ELSE 'claim_open_after_terminal' END)::text,
          'claim_released'::text, v_item.state,
          jsonb_build_object('release_reason',v_release_reason,'owner_instance_id',v_claim.owner_instance_id);
      ELSE
        -- Posse ainda válida: intocada. Tomá-la seria o roubo silencioso que o
        -- SUP-05 proíbe, e liberá-la duplicaria execução.
        RETURN QUERY SELECT v_item.id, v_claim.attempt_id, v_claim.id,
          'claim_active'::text, 'none'::text, v_item.state,
          jsonb_build_object('expires_at',v_claim.expires_at,'owner_instance_id',v_claim.owner_instance_id);
      END IF;
    END IF;

    -- ---------- (3) tentativa interrompida ----------
    IF v_item.state = 'in_progress' AND v_terminal IS NULL AND v_verdict IS NULL THEN
      IF v_attempt IS NULL THEN
        -- Item executando sem tentativa registrada: inconsistência que nenhum
        -- fato persistido resolve. Relata e não toca.
        RETURN QUERY SELECT v_item.id, NULL::uuid, NULL::uuid,
          'attempt_missing'::text, 'requires_human'::text, v_item.state,
          jsonb_build_object('explanation','item em execução sem evento de tentativa correlacionado');
      ELSE
        -- Limite de posse: o lease do claim que iniciou ESTA tentativa.
        v_lease := NULL;
        SELECT * INTO v_lease FROM public.work_claims c
        WHERE c.user_id = v_user_id AND c.attempt_id = v_attempt;
        v_lease_bound := FOUND;
        v_lease_exceeded := v_lease_bound
          AND (v_lease.released_at IS NOT NULL OR v_lease.expires_at <= v_now);

        -- Limite de duração declarado na proposta aprovada. Mesma régua de
        -- `private.is_valid_execution_limits`: inteiro positivo ou nada.
        v_duration_minutes := NULL;
        IF jsonb_typeof(v_item.intent #> '{execution_spec,limits,max_duration_minutes}') = 'number'
           AND (v_item.intent #>> '{execution_spec,limits,max_duration_minutes}') ~ '^[0-9]+$'
           AND (v_item.intent #>> '{execution_spec,limits,max_duration_minutes}')::numeric > 0 THEN
          v_duration_minutes := (v_item.intent #>> '{execution_spec,limits,max_duration_minutes}')::integer;
        END IF;
        v_duration_bound := v_duration_minutes IS NOT NULL;
        v_duration_exceeded := v_duration_bound
          AND v_attempt_started + make_interval(mins => v_duration_minutes) <= v_now;

        IF NOT v_lease_bound AND NOT v_duration_bound THEN
          -- Nenhum limite persistido: não há fato que sustente transição alguma.
          -- Preferir estado seguro e revisável a inventar conclusão.
          RETURN QUERY SELECT v_item.id, v_attempt, NULL::uuid,
            'attempt_without_declared_bound'::text, 'requires_human'::text, v_item.state,
            jsonb_build_object(
              'explanation','tentativa sem lease e sem max_duration_minutes: nada delimita quando ela deixou de valer',
              'attempt_started_at',v_attempt_started);
        ELSIF (NOT v_lease_bound OR v_lease_exceeded)
              AND (NOT v_duration_bound OR v_duration_exceeded) THEN
          v_reason := CASE
            WHEN v_lease_bound AND v_duration_bound THEN 'declared_bounds_exceeded'
            WHEN v_lease_bound THEN 'lease_expired'
            ELSE 'duration_limit_exceeded' END;

          SELECT t.to_state INTO v_target_state FROM private.work_state_transitions t
          WHERE t.from_state = v_item.state AND t.event_type = 'attempt_abandoned';
          IF NOT FOUND THEN RAISE EXCEPTION 'transition not allowed' USING ERRCODE='22023'; END IF;

          UPDATE public.work_items SET state=v_target_state, updated_at=v_now
          WHERE id=v_item.id RETURNING * INTO v_item;
          INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
            (v_item.id,'attempt_abandoned','system',v_item.proposal_version,
              jsonb_build_object('schema_version',1,'data',jsonb_build_object(
                'work_item_id',v_item.id,'attempt_id',v_attempt,
                'approved_proposal_version',v_item.proposal_version,
                'claim_id',v_lease.id,
                'origin',CASE WHEN v_lease_bound THEN 'supervised' ELSE 'commanded' END,
                'reason',v_reason,
                'attempt_started_at',v_attempt_started,'observed_at',v_now,
                'lease_expires_at',v_lease.expires_at,
                'max_duration_minutes',v_duration_minutes)));
          RETURN QUERY SELECT v_item.id, v_attempt, v_lease.id,
            'attempt_abandoned'::text, 'attempt_abandoned'::text, v_item.state,
            jsonb_build_object('reason',v_reason,'attempt_started_at',v_attempt_started);
        ELSE
          -- Ao menos um limite declarado ainda não foi excedido: a execução pode
          -- estar legitimamente viva. Não se mexe.
          RETURN QUERY SELECT v_item.id, v_attempt, v_lease.id,
            'attempt_within_declared_bounds'::text, 'none'::text, v_item.state,
            jsonb_build_object(
              'lease_expires_at',v_lease.expires_at,
              'max_duration_minutes',v_duration_minutes,
              'attempt_started_at',v_attempt_started);
        END IF;
      END IF;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.record_verifier_opinion(uuid, integer, uuid, jsonb) IS
  'Persiste o parecer do Verifier (append-only, idempotente). Mandated Verifier Enforcement V0.1: no lane com Verifier obrigatório, libera o resultado candidato para review na MESMA transação quando o parecer decisivo correlacionado é conclusivo (verified/rejected) com evidência git/gate/coder da mesma attempt e commit coerente. Nunca aceita nem integra.';
