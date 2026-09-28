-- Trusted System Writer V0 (2026-09-28) — `author=system` é FRONTEIRA DE CONFIANÇA, não rótulo.
--
-- Achado (auditorias independentes): as RPCs que gravam fatos de SISTEMA — evidência git,
-- de gate e do coder observada pelo host, parecer do Verifier e receipt de integração —
-- eram executáveis por `authenticated`: uma sessão HUMANA conseguia produzir eventos que a
-- persistência carimbava `author=system`.
--
-- Primitive reusada (sem service_role, sem PKI, sem auth nova): identidade GoTrue dedicada
-- (o "writer de sistema") cujo `auth.users.role` é o papel Postgres `anima_system_writer`.
-- O GoTrue emite esse papel no claim `role` do JWT e o PostgREST faz `SET ROLE` para ele
-- (provado localmente em 2026-09-28). O papel NÃO herda `authenticated`: não lê tabela
-- nenhuma e só executa estas cinco RPCs.
--
--   HUMAN WRITER  (authenticated, auth.uid() = dono): aprova, revisa, aceita, pede mudanças,
--                                                     autoriza o efeito de integração.
--   SYSTEM WRITER (anima_system_writer, registrado em private.trusted_system_writers para
--                  UM dono): só persiste fatos observados/produzidos pelo sistema.
--
-- Defesa em profundidade: além do GRANT, cada RPC resolve o dono por
-- `private.trusted_system_writer_owner()`, que exige o claim `role` = anima_system_writer
-- (vindo do JWT verificado) E o registro ativo do writer — sessão humana resolve NULL e é
-- recusada mesmo se um GRANT acidental voltar. `author`/`origin` do payload nunca são prova.
--
-- Provisionamento (ato do OPERADOR, fora do código): criar o usuário GoTrue do writer,
-- `UPDATE auth.users SET role='anima_system_writer' WHERE id=<writer>` e
-- `INSERT INTO private.trusted_system_writers(writer_user_id, owner_user_id) VALUES (...)`.
-- Sem provisionamento, nenhum fato de sistema é gravado (fail-closed).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anima_system_writer') THEN
    CREATE ROLE anima_system_writer NOLOGIN NOINHERIT;
  END IF;
END $$;
GRANT anima_system_writer TO authenticator;
GRANT USAGE ON SCHEMA public TO anima_system_writer;

CREATE TABLE private.trusted_system_writers (
  writer_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_user_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  reason         text CHECK (reason IS NULL OR length(btrim(reason)) > 0),
  CONSTRAINT trusted_system_writer_not_owner CHECK (writer_user_id <> owner_user_id)
);
REVOKE ALL ON TABLE private.trusted_system_writers FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE private.trusted_system_writers IS
  'Writers de sistema registrados: cada identidade GoTrue dedicada (auth.users.role = anima_system_writer) grava fatos de sistema para UM dono. Sem acesso de clientes; provisionamento é ato do operador.';

-- Dono servido pelo writer da sessão atual, ou NULL. Exige o claim `role` do JWT verificado
-- (request.jwt.claims — o PostgREST o define a partir do token; o cliente não o forja) E o
-- registro ativo. Um writer nunca é o próprio dono (CHECK) nem um usuário humano da allowlist.
CREATE OR REPLACE FUNCTION private.trusted_system_writer_owner()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT w.owner_user_id
  FROM private.trusted_system_writers w
  WHERE w.writer_user_id = auth.uid()
    AND w.revoked_at IS NULL
    AND coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'anima_system_writer'
    AND NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id = w.writer_user_id);
$$;
REVOKE ALL ON FUNCTION private.trusted_system_writer_owner() FROM PUBLIC, anon, authenticated;

-- ─── Os cinco sinks de sistema: corpos vigentes, dono resolvido pelo writer ─────
-- Mudança ÚNICA em cada corpo: `auth.uid()` → `private.trusted_system_writer_owner()`.
-- Todas as correlações (dono do item, versão, attempt, resultado, evidências, commit,
-- autorização) permanecem idênticas. NULL (sessão humana/anon/writer não registrado) ⇒
-- a checagem existente `IF v_user... IS NULL` recusa com 42501.

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
  v_user_id   uuid := private.trusted_system_writer_owner();
  v_item      public.work_items;
  v_existing  public.work_events;
  v_has_delta boolean := evidence ? 'observedChangedFilesSinceStart';
  v_event_seq bigint;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'trusted system writer required' USING ERRCODE='42501'; END IF;
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

CREATE OR REPLACE FUNCTION public.record_host_observed_gate_evidence(
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
  v_user_id   uuid := private.trusted_system_writer_owner();
  v_item      public.work_items;
  v_existing  public.work_events;
  v_event_seq bigint;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'trusted system writer required' USING ERRCODE='42501'; END IF;
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

CREATE OR REPLACE FUNCTION public.record_host_observed_coder_evidence(
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
  v_user_id   uuid := private.trusted_system_writer_owner();
  v_item      public.work_items;
  v_existing  public.work_events;
  v_event_seq bigint;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'trusted system writer required' USING ERRCODE='42501'; END IF;
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
  v_user_id     uuid := private.trusted_system_writer_owner();
  v_item        public.work_items;
  v_result_id   text := opinion #>> '{evidenceBasis,resultEventId}';
  v_observed_id text;
  v_gate_id     text;
  v_version     text := opinion ->> 'verifierVersion';
  v_existing    public.work_events;
  v_event_seq   bigint;
  v_released    boolean;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'trusted system writer required' USING ERRCODE='42501'; END IF;
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

CREATE OR REPLACE FUNCTION public.record_integration_completed(
  work_item_id uuid,
  expected_proposal_version integer,
  authorization_id text,
  receipt jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  v_user uuid:=private.trusted_system_writer_owner(); v_item public.work_items; v_auth public.work_events; v_accept public.work_events;
  v_a jsonb; v_existing public.work_events; v_seq bigint;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'trusted system writer required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version<1 OR length(btrim(coalesce(authorization_id,'')))=0
     OR jsonb_typeof(receipt) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid integration receipt' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.state<>'completed' OR v_item.proposal_version<>expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_auth FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='integration_effect_authorized'
    AND e.payload->'data'->>'authorization_id'=authorization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'integration effect authorization not found' USING ERRCODE='P0002'; END IF;
  v_a:=v_auth.payload->'data';
  SELECT * INTO v_accept FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='result_accepted' ORDER BY e.seq DESC LIMIT 1;
  IF NOT FOUND OR (v_accept.payload->'data'->>'accepted_result_event_id') IS DISTINCT FROM v_a->>'accepted_result_event_id' THEN
    RAISE EXCEPTION 'accepted result changed' USING ERRCODE='55000';
  END IF;

  -- O receipt reproduz EXATAMENTE a autorização e descreve o efeito observado:
  -- merge commit com pais [SHA-alvo esperado, commit do resultado] e alvo = merge.
  IF receipt->>'kind' IS DISTINCT FROM 'integration_effect'
     OR receipt->>'operationKey' IS DISTINCT FROM v_a->>'operation_key'
     OR receipt->>'authorizationId' IS DISTINCT FROM authorization_id
     OR receipt->>'workItemId' IS DISTINCT FROM v_item.id::text
     OR (receipt->>'proposalVersion')::integer IS DISTINCT FROM expected_proposal_version
     OR receipt->>'attemptId' IS DISTINCT FROM v_a->>'attempt_id'
     OR receipt->>'acceptedResultEventId' IS DISTINCT FROM v_a->>'accepted_result_event_id'
     OR receipt->>'resultCommitSha' IS DISTINCT FROM v_a->>'result_commit_sha'
     OR receipt->>'repositoryId' IS DISTINCT FROM v_a->>'repository_id'
     OR receipt->>'targetRef' IS DISTINCT FROM v_a->>'target_ref'
     OR receipt->>'mode' IS DISTINCT FROM v_a->>'mode'
     OR receipt->>'previousTargetSha' IS DISTINCT FROM v_a->>'expected_target_sha'
     OR NOT private.is_sha1_hex(receipt->>'mergeCommitSha')
     OR receipt->>'resultingTargetSha' IS DISTINCT FROM receipt->>'mergeCommitSha'
     OR receipt->'mergeParents' IS DISTINCT FROM jsonb_build_array(v_a->>'expected_target_sha',v_a->>'result_commit_sha')
     OR receipt->'observed' IS DISTINCT FROM 'true'::jsonb
     OR receipt->>'disposition' NOT IN ('effected','reconciled') THEN
    RAISE EXCEPTION 'integration receipt mismatch' USING ERRCODE='55000';
  END IF;

  SELECT * INTO v_existing FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='integration_completed';
  IF FOUND THEN
    -- Idempotência por identidade do EFEITO (a disposição pode diferir entre execução e reconciliação).
    IF v_existing.payload->'data'->>'authorization_id'=authorization_id
       AND (v_existing.payload->'data'->'receipt') - 'disposition' = receipt - 'disposition' THEN
      RETURN jsonb_build_object('action','replayed','event_seq',v_existing.seq);
    END IF;
    RAISE EXCEPTION 'integration receipt conflict' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'integration_completed','system',expected_proposal_version,jsonb_build_object('schema_version',1,'data',
    jsonb_build_object('authorization_id',authorization_id,'operation_key',v_a->>'operation_key',
      'accepted_result_event_id',v_a->>'accepted_result_event_id','attempt_id',v_a->>'attempt_id','receipt',receipt)))
  RETURNING seq INTO v_seq;
  RETURN jsonb_build_object('action','recorded','event_seq',v_seq);
END $$;

-- ─── Permissões: só o writer de sistema executa ─────────────────────────────
REVOKE ALL ON FUNCTION public.record_host_observed_evidence(uuid,integer,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_host_observed_evidence(uuid,integer,uuid,jsonb) TO anima_system_writer;
REVOKE ALL ON FUNCTION public.record_host_observed_gate_evidence(uuid,integer,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_host_observed_gate_evidence(uuid,integer,uuid,jsonb) TO anima_system_writer;
REVOKE ALL ON FUNCTION public.record_host_observed_coder_evidence(uuid,integer,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_host_observed_coder_evidence(uuid,integer,uuid,jsonb) TO anima_system_writer;
REVOKE ALL ON FUNCTION public.record_verifier_opinion(uuid,integer,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_verifier_opinion(uuid,integer,uuid,jsonb) TO anima_system_writer;
REVOKE ALL ON FUNCTION public.record_integration_completed(uuid,integer,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_integration_completed(uuid,integer,text,jsonb) TO anima_system_writer;
