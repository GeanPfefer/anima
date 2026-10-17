-- A2-0 / Recorte 2 — ACEITE SOB MANDATO HUMANO ANTECIPADO (acceptance-mandate-v1).
-- CANDIDATA: NÃO aplicar no residente sem checkpoint humano. Depende de 20261017000000 (vocabulário).
-- 100% aditiva: nenhuma função, tabela, evento ou política existente é alterado. O caminho de aceite humano
-- (`review_work_result_versioned`) permanece intacto e continua gravando `result_accepted` com author `user`.
--
-- MODELO DE AUTORIDADE (quatro identidades distintas):
--   GRANTOR  — usuário GoTrue dedicado, papel `anima_mandate_grantor`, credenciais FORA do runner. Só concede/revoga.
--   RUNNER   — sessão residente. NÃO executa nenhuma função deste arquivo (ACL) e não escreve em work_events.
--   WRITER   — Trusted System Writer. Único que executa `accept_work_result_under_mandate`; o BANCO recalcula tudo.
--   HUMANO   — o mandato é a decisão humana (evento `work_mandate_granted`, autor user, conta como ato humano).
-- O aceite mandatado é um `result_accepted` com author `system` + bloco `authority.kind = human_mandate`, que só esta
-- função consegue gravar (trigger aditivo + `authenticated` só tem SELECT em work_events).

-- ─── Papel e registro do grantor (mesmo molde do Trusted System Writer) ───────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anima_mandate_grantor') THEN
    CREATE ROLE anima_mandate_grantor NOLOGIN NOINHERIT;
  END IF;
END $$;
GRANT anima_mandate_grantor TO authenticator;
GRANT USAGE ON SCHEMA public TO anima_mandate_grantor;

CREATE TABLE private.acceptance_mandate_grantors (
  grantor_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_user_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  reason          text,
  CONSTRAINT acceptance_mandate_grantor_not_owner CHECK (grantor_user_id <> owner_user_id),
  CONSTRAINT acceptance_mandate_grantor_reason_check CHECK (reason IS NULL OR length(btrim(reason)) > 0)
);
ALTER TABLE private.acceptance_mandate_grantors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.acceptance_mandate_grantors FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE private.acceptance_mandate_grantors IS
  'Grantors registrados: cada identidade GoTrue dedicada (auth.users.role = anima_mandate_grantor) concede mandatos para UM dono. Nunca é o dono, nunca está na allowlist de trabalho, nunca é um writer de sistema. Provisionamento é ato do operador.';

-- Um grantor nunca pode ser humano da allowlist nem writer de sistema (separação de papéis).
CREATE FUNCTION private.guard_acceptance_mandate_grantor_registration() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id = NEW.grantor_user_id)
     OR EXISTS (SELECT 1 FROM private.trusted_system_writers w WHERE w.writer_user_id = NEW.grantor_user_id) THEN
    RAISE EXCEPTION 'grantor must be a dedicated identity' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_acceptance_mandate_grantor_registration BEFORE INSERT OR UPDATE ON private.acceptance_mandate_grantors
  FOR EACH ROW EXECUTE FUNCTION private.guard_acceptance_mandate_grantor_registration();

-- Dono resolvido pela identidade do grantor: o `auth.uid()` registrado + o claim `role` do JWT (não forjável pelo cliente).
CREATE FUNCTION private.acceptance_mandate_grantor_owner() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT g.owner_user_id
  FROM private.acceptance_mandate_grantors g
  WHERE g.grantor_user_id = auth.uid()
    AND g.revoked_at IS NULL
    AND coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'anima_mandate_grantor'
    AND NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id = g.grantor_user_id)
    AND NOT EXISTS (SELECT 1 FROM private.trusted_system_writers w WHERE w.writer_user_id = g.grantor_user_id);
$$;
REVOKE ALL ON FUNCTION private.acceptance_mandate_grantor_owner() FROM PUBLIC, anon, authenticated;

-- ─── Política v1 e validadores puros ──────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION private.acceptance_mandate_policy_version() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$ SELECT 'acceptance-mandate-v1'::text $$;
CREATE FUNCTION private.acceptance_mandate_min_verifier() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$ SELECT 'work-verifier-v6'::text $$;
REVOKE ALL ON FUNCTION private.acceptance_mandate_policy_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.acceptance_mandate_min_verifier() FROM PUBLIC, anon, authenticated;

-- Escopo seguro: 1..20 caminhos relativos, normalizados, únicos, fora dos prefixos sensíveis (espelha o TS).
CREATE FUNCTION private.acceptance_mandate_scope_is_safe(p text[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  v_e text; v_pfx text; v_parts text[];
  v_sensitive constant text[] := ARRAY['supabase','.claude','.git','.github','.env','apps/web/.env','scripts','apps/web/scripts','tools',
    'packages/core/src/work-orchestration/autonomous-authorization','packages/core/src/work-orchestration/acceptance-mandate',
    'apps/web/lib/work-orchestration/auto-approval','apps/web/lib/work-orchestration/acceptance-mandate',
    'apps/web/lib/work-orchestration/trusted-system-writer'];
BEGIN
  IF p IS NULL OR cardinality(p) < 1 OR cardinality(p) > 20 THEN RETURN false; END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p) x) <> cardinality(p) THEN RETURN false; END IF;
  FOREACH v_e IN ARRAY p LOOP
    IF v_e IS NULL OR length(v_e) < 1 OR length(v_e) > 300 OR v_e <> btrim(v_e) THEN RETURN false; END IF;
    IF position(E'\\' IN v_e) > 0 OR left(v_e, 1) = '/' OR v_e ~ '^[A-Za-z]:' THEN RETURN false; END IF;
    v_parts := string_to_array(v_e, '/');
    IF '' = ANY (v_parts) OR '.' = ANY (v_parts) OR '..' = ANY (v_parts) THEN RETURN false; END IF;
    -- O host é Windows (NTFS): caminhos diferem só por caixa, ponto/espaço final, nome curto (~) ou caractere reservado aliasam
    -- diretórios protegidos. Fora do conjunto portátil e minúsculo-estável ⇒ recusa; prefixo sensível comparado sem caixa.
    IF v_e ~ '[<>:"|?*~[:cntrl:]]' OR EXISTS (SELECT 1 FROM unnest(v_parts) s WHERE s ~ '[. ]$') THEN RETURN false; END IF;
    FOREACH v_pfx IN ARRAY v_sensitive LOOP
      IF left(lower(v_e), length(v_pfx)) = v_pfx THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.acceptance_mandate_scope_is_safe(text[]) FROM PUBLIC, anon, authenticated;

-- Hash canônico do contrato (jsonb::text é determinístico no PostgreSQL). Autoridade única do hash: o banco.
CREATE FUNCTION private.acceptance_contract_sha256(p_item public.work_items) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT encode(extensions.digest(convert_to(jsonb_build_object(
    'policy', 'acceptance-contract-v1', 'impact_level', p_item.impact_level::text, 'capability', p_item.capability::text,
    'proposal_version', p_item.proposal_version, 'execution_spec', p_item.intent -> 'execution_spec', 'proposal', p_item.proposal
  )::text, 'UTF8'), 'sha256'), 'hex');
$$;
REVOKE ALL ON FUNCTION private.acceptance_contract_sha256(public.work_items) FROM PUBLIC, anon, authenticated;

-- ─── Tabela de mandatos (RLS: dono lê; nenhuma escrita direta) ────────────────────────────────────────────────────
CREATE TABLE public.work_acceptance_mandates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  work_item_id      uuid NOT NULL REFERENCES public.work_items(id) ON DELETE RESTRICT,
  proposal_version  integer NOT NULL CHECK (proposal_version >= 1),
  contract_sha256   text NOT NULL CHECK (contract_sha256 ~ '^[0-9a-f]{64}$'),
  base_sha          text NOT NULL CHECK (base_sha ~ '^[0-9a-f]{40}$'),
  scope_files       text[] NOT NULL CHECK (private.acceptance_mandate_scope_is_safe(scope_files)),
  allowed_actions   text[] NOT NULL DEFAULT ARRAY['accept'] CHECK (allowed_actions = ARRAY['accept']),
  not_before        timestamptz NOT NULL,
  expires_at        timestamptz NOT NULL,
  policy_version    text NOT NULL,
  request_id        uuid NOT NULL,
  granted_event_id  uuid NOT NULL,
  granted_event_seq bigint NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz,
  revoke_reason     text,
  consumed_at       timestamptz,
  consumed_event_id uuid,
  CONSTRAINT work_acceptance_mandates_window CHECK (expires_at > not_before AND expires_at - not_before <= interval '24 hours'),
  CONSTRAINT work_acceptance_mandates_not_both CHECK (NOT (revoked_at IS NOT NULL AND consumed_at IS NOT NULL)),
  CONSTRAINT work_acceptance_mandates_consumed_pair CHECK ((consumed_at IS NULL) = (consumed_event_id IS NULL)),
  CONSTRAINT work_acceptance_mandates_request_unique UNIQUE (user_id, request_id)
);
-- No máximo UM mandato consumido por item+versão.
CREATE UNIQUE INDEX work_acceptance_mandates_one_consumed_idx
  ON public.work_acceptance_mandates (work_item_id, proposal_version) WHERE consumed_at IS NOT NULL;
CREATE INDEX work_acceptance_mandates_item_idx ON public.work_acceptance_mandates (work_item_id, proposal_version);
ALTER TABLE public.work_acceptance_mandates ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_acceptance_mandates_owner_select ON public.work_acceptance_mandates FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.work_acceptance_mandates FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.work_acceptance_mandates TO authenticated;

-- Imutabilidade: só revogação (uma vez) e consumo (uma vez) são transições permitidas; nunca delete.
CREATE FUNCTION private.guard_work_acceptance_mandates() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'mandate is append-only' USING ERRCODE = '42501'; END IF;
  IF (to_jsonb(NEW) - 'revoked_at' - 'revoke_reason' - 'consumed_at' - 'consumed_event_id')
     IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at' - 'revoke_reason' - 'consumed_at' - 'consumed_event_id') THEN
    RAISE EXCEPTION 'mandate terms are immutable' USING ERRCODE = '42501';
  END IF;
  IF (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
     OR (OLD.consumed_at IS NOT NULL AND (NEW.consumed_at IS DISTINCT FROM OLD.consumed_at OR NEW.consumed_event_id IS DISTINCT FROM OLD.consumed_event_id)) THEN
    RAISE EXCEPTION 'mandate state is final' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_work_acceptance_mandates BEFORE UPDATE OR DELETE ON public.work_acceptance_mandates
  FOR EACH ROW EXECUTE FUNCTION private.guard_work_acceptance_mandates();

-- ─── Elegibilidade de concessão (compartilhada por preview e grant) ───────────────────────────────────────────────
CREATE FUNCTION private.acceptance_mandate_grant_blockers(p_item public.work_items, p_scope text[], p_base_sha text)
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE
  v_spec jsonb := p_item.intent -> 'execution_spec';
  v_class jsonb; v_pref text; v_out text[] := ARRAY[]::text[];
BEGIN
  IF p_item.state <> 'approved' THEN v_out := array_append(v_out, 'item_not_approved'::text); END IF;
  IF p_item.impact_level::text <> 'low' THEN v_out := array_append(v_out, 'impact_not_low'::text); END IF;
  IF p_item.capability::text <> 'programming' THEN v_out := array_append(v_out, 'capability_not_programming'::text); END IF;
  IF jsonb_typeof(v_spec) IS DISTINCT FROM 'object' THEN
    RETURN array_append(v_out, 'execution_spec_missing'::text);
  END IF;
  IF v_spec ->> 'executor' IS DISTINCT FROM 'worktree' THEN v_out := array_append(v_out, 'executor_not_worktree'::text); END IF;
  IF v_spec ->> 'verifier_requirement' IS DISTINCT FROM 'required_fail_closed' THEN v_out := array_append(v_out, 'verifier_not_fail_closed'::text); END IF;
  IF (v_spec #>> '{limits,max_attempts}') IS DISTINCT FROM '1' THEN v_out := array_append(v_out, 'attempts_not_one'::text); END IF;
  IF v_spec ->> 'coder_backend' IS NULL OR v_spec ->> 'coder_backend' NOT IN ('codex-cli', 'ollama') THEN v_out := array_append(v_out, 'coder_backend_not_local_or_subscription'::text); END IF;
  IF v_spec #>> '{target,kind}' IS DISTINCT FROM 'project' THEN v_out := array_append(v_out, 'target_not_project'::text); END IF;
  IF coalesce(v_spec ->> 'base_sha', '') !~ '^[0-9a-f]{40}$' OR (p_base_sha IS NOT NULL AND v_spec ->> 'base_sha' IS DISTINCT FROM p_base_sha) THEN v_out := array_append(v_out, 'base_sha_mismatch'::text); END IF;
  IF v_spec ? 'resume_from_checkpoint' THEN v_out := array_append(v_out, 'resume_not_allowed'::text); END IF;
  -- Antecipado: nenhuma attempt pode ter começado.
  IF EXISTS (SELECT 1 FROM public.work_events e WHERE e.work_item_id = p_item.id AND e.event_type IN ('work_claimed', 'execution_started', 'work_started', 'result_submitted')) THEN
    v_out := array_append(v_out, 'attempt_already_started'::text);
  END IF;
  -- Classificação humana vigente: bounded / low / reversible / clear.
  SELECT e.payload -> 'data' -> 'classification' INTO v_class FROM public.work_events e
  WHERE e.work_item_id = p_item.id AND e.event_type = 'work_intelligence_classified' AND e.proposal_version = p_item.proposal_version
  ORDER BY e.seq DESC LIMIT 1;
  IF v_class IS NULL OR v_class #>> '{provenance,kind}' IS DISTINCT FROM 'human_confirmed'
     OR v_class ->> 'complexity' IS DISTINCT FROM 'bounded' OR v_class ->> 'risk' IS DISTINCT FROM 'low'
     OR v_class ->> 'reversibility' IS DISTINCT FROM 'reversible' OR v_class ->> 'planClarity' IS DISTINCT FROM 'clear' THEN
    v_out := array_append(v_out, 'classification_not_human_bounded_low'::text);
  END IF;
  -- Sem compute pago: preferência, autorizações e eventos de orçamento pago.
  SELECT e.payload -> 'data' -> 'preference' ->> 'strategy' INTO v_pref FROM public.work_events e
  WHERE e.work_item_id = p_item.id AND e.event_type = 'compute_preference_recorded' ORDER BY e.seq DESC LIMIT 1;
  IF v_pref = 'provider_api'
     OR EXISTS (SELECT 1 FROM public.paid_compute_authorizations a WHERE a.work_item_id = p_item.id)
     OR EXISTS (SELECT 1 FROM public.paid_compute_budget_events b WHERE b.work_item_id = p_item.id) THEN
    v_out := array_append(v_out, 'paid_compute_present'::text);
  END IF;
  -- Escopo do mandato == included_scope do contrato e seguro.
  IF p_scope IS NOT NULL THEN
    IF NOT private.acceptance_mandate_scope_is_safe(p_scope) THEN v_out := array_append(v_out, 'scope_unsafe'::text); END IF;
    IF (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(coalesce(p_item.proposal -> 'data' -> 'included_scope', '[]'::jsonb)) x)
       IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(p_scope) x) THEN
      v_out := array_append(v_out, 'scope_differs_from_contract'::text);
    END IF;
  END IF;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION private.acceptance_mandate_grant_blockers(public.work_items, text[], text) FROM PUBLIC, anon, authenticated;

-- ─── GRANTOR: preview / grant / revoke ───────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.preview_acceptance_contract(p_work_item_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_owner uuid := private.acceptance_mandate_grantor_owner(); v_item public.work_items;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'mandate grantor required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id = v_owner) THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE = '42501'; END IF;
  IF p_work_item_id IS NULL THEN RAISE EXCEPTION 'invalid mandate request' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_item FROM public.work_items i WHERE i.id = p_work_item_id AND i.user_id = v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object(
    'workItemId', v_item.id, 'state', v_item.state, 'proposalVersion', v_item.proposal_version,
    'contractSha256', private.acceptance_contract_sha256(v_item), 'baseSha', v_item.intent #>> '{execution_spec,base_sha}',
    'includedScope', coalesce(v_item.proposal -> 'data' -> 'included_scope', '[]'::jsonb),
    'blockers', to_jsonb(private.acceptance_mandate_grant_blockers(v_item, NULL, NULL)),
    'policyVersion', private.acceptance_mandate_policy_version());
END $$;

CREATE FUNCTION public.grant_acceptance_mandate(
  p_work_item_id uuid, p_expected_proposal_version integer, p_contract_sha256 text, p_base_sha text,
  p_scope_files text[], p_not_before timestamptz, p_expires_at timestamptz, p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_owner uuid := private.acceptance_mandate_grantor_owner(); v_item public.work_items; v_existing public.work_acceptance_mandates;
  v_blockers text[]; v_ev public.work_events; v_mandate public.work_acceptance_mandates; v_scope text[];
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'mandate grantor required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id = v_owner) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE = '42501';
  END IF;
  IF p_work_item_id IS NULL OR p_expected_proposal_version IS NULL OR p_expected_proposal_version < 1
     OR p_contract_sha256 IS NULL OR p_contract_sha256 !~ '^[0-9a-f]{64}$' OR p_base_sha IS NULL OR p_base_sha !~ '^[0-9a-f]{40}$'
     OR p_request_id IS NULL OR p_not_before IS NULL OR p_expires_at IS NULL
     OR NOT private.acceptance_mandate_scope_is_safe(p_scope_files)
     OR p_expires_at <= p_not_before OR p_expires_at - p_not_before > interval '24 hours' THEN
    RAISE EXCEPTION 'invalid mandate request' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at <= clock_timestamp() OR p_not_before < clock_timestamp() - interval '2 minutes' THEN
    RAISE EXCEPTION 'mandate window is not in the future' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(x ORDER BY x) INTO v_scope FROM unnest(p_scope_files) x;

  SELECT * INTO v_item FROM public.work_items i WHERE i.id = p_work_item_id AND i.user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE = 'P0002'; END IF;

  -- Idempotência por request_id (mesmos termos ⇒ replay; termos diferentes ⇒ conflito).
  SELECT * INTO v_existing FROM public.work_acceptance_mandates m WHERE m.user_id = v_owner AND m.request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.work_item_id = p_work_item_id AND v_existing.proposal_version = p_expected_proposal_version
       AND v_existing.contract_sha256 = p_contract_sha256 AND v_existing.base_sha = p_base_sha AND v_existing.scope_files = v_scope
       AND v_existing.not_before = p_not_before AND v_existing.expires_at = p_expires_at THEN
      RETURN jsonb_build_object('action', 'replayed', 'mandate_id', v_existing.id, 'event_seq', v_existing.granted_event_seq);
    END IF;
    RAISE EXCEPTION 'mandate request conflict' USING ERRCODE = '55000';
  END IF;

  IF v_item.proposal_version <> p_expected_proposal_version THEN RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE = '55000'; END IF;
  v_blockers := private.acceptance_mandate_grant_blockers(v_item, v_scope, p_base_sha);
  IF cardinality(v_blockers) > 0 THEN
    RAISE EXCEPTION 'mandate not grantable: %', array_to_string(v_blockers, ',') USING ERRCODE = '55000';
  END IF;
  IF private.acceptance_contract_sha256(v_item) <> p_contract_sha256 THEN
    RAISE EXCEPTION 'contract hash does not match the persisted contract' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_acceptance_mandates m WHERE m.work_item_id = v_item.id AND m.proposal_version = v_item.proposal_version
             AND m.revoked_at IS NULL AND m.consumed_at IS NULL AND m.expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'an active mandate already exists for this item version' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.work_events(work_item_id, event_type, author, proposal_version, payload)
  VALUES (v_item.id, 'work_mandate_granted', 'user', v_item.proposal_version, jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
    'work_item_id', v_item.id, 'approved_proposal_version', v_item.proposal_version, 'contract_sha256', p_contract_sha256,
    'base_sha', p_base_sha, 'scope_files', to_jsonb(v_scope), 'allowed_actions', jsonb_build_array('accept'),
    'not_before', p_not_before, 'expires_at', p_expires_at, 'policy_version', private.acceptance_mandate_policy_version(),
    'granted_by', 'mandate_grantor', 'request_id', p_request_id)))
  RETURNING * INTO v_ev;

  INSERT INTO public.work_acceptance_mandates(user_id, work_item_id, proposal_version, contract_sha256, base_sha, scope_files, not_before,
    expires_at, policy_version, request_id, granted_event_id, granted_event_seq)
  VALUES (v_owner, v_item.id, v_item.proposal_version, p_contract_sha256, p_base_sha, v_scope, p_not_before, p_expires_at,
    private.acceptance_mandate_policy_version(), p_request_id, v_ev.id, v_ev.seq)
  RETURNING * INTO v_mandate;

  RETURN jsonb_build_object('action', 'granted', 'mandate_id', v_mandate.id, 'event_seq', v_ev.seq);
END $$;

CREATE FUNCTION public.revoke_acceptance_mandate(p_mandate_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_owner uuid := private.acceptance_mandate_grantor_owner(); v_m public.work_acceptance_mandates; v_ev public.work_events; v_item_id uuid;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'mandate grantor required' USING ERRCODE = '42501'; END IF;
  IF p_mandate_id IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) = 0 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'invalid mandate request' USING ERRCODE = '22023';
  END IF;
  -- Mesma ordem de locks do aceite e da concessão (ITEM primeiro, depois o mandato): inserir o evento de revogação toma
  -- FOR KEY SHARE no item, que conflita com o FOR UPDATE do aceite; travar o mandato antes causava deadlock (40P01) e podia
  -- abortar a revogação enquanto o aceite consumia o mandato.
  SELECT m.work_item_id INTO v_item_id FROM public.work_acceptance_mandates m WHERE m.id = p_mandate_id AND m.user_id = v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'mandate not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.work_items i WHERE i.id = v_item_id FOR UPDATE;
  SELECT * INTO v_m FROM public.work_acceptance_mandates m WHERE m.id = p_mandate_id AND m.user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mandate not found' USING ERRCODE = 'P0002'; END IF;
  IF v_m.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'mandate already consumed' USING ERRCODE = '55000'; END IF;
  IF v_m.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('action', 'replayed', 'mandate_id', v_m.id); END IF;
  UPDATE public.work_acceptance_mandates SET revoked_at = now(), revoke_reason = btrim(p_reason) WHERE id = v_m.id;
  INSERT INTO public.work_events(work_item_id, event_type, author, proposal_version, payload)
  VALUES (v_m.work_item_id, 'work_mandate_revoked', 'user', v_m.proposal_version, jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
    'work_item_id', v_m.work_item_id, 'approved_proposal_version', v_m.proposal_version, 'mandate_id', v_m.id,
    'reason', btrim(p_reason), 'revoked_by', 'mandate_grantor')))
  RETURNING * INTO v_ev;
  RETURN jsonb_build_object('action', 'revoked', 'mandate_id', v_m.id, 'event_seq', v_ev.seq);
END $$;

-- ─── WRITER: aceite sob mandato (o banco recalcula TUDO; nada do runner é confiável) ──────────────────────────────
CREATE FUNCTION public.accept_work_result_under_mandate(
  p_work_item_id uuid, p_expected_proposal_version integer, p_reviewed_result_event_id uuid, p_mandate_id uuid, p_integrity jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_owner uuid := private.trusted_system_writer_owner();
  v_item public.work_items; v_m public.work_acceptance_mandates; v_result public.work_events; v_op public.work_events;
  v_ctx public.work_events; v_git public.work_events; v_ev public.work_events; v_prev public.work_events;
  v_attempt text; v_commit text; v_exec_seq bigint; v_exec_count integer; v_class jsonb; v_target public.work_state;
  v_scope text[]; v_host_files text[]; v_int_files text[]; v_statuses text[]; v_status_paths text[]; v_needs_tb boolean;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'trusted system writer required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id = v_owner) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE = '42501';
  END IF;
  IF p_work_item_id IS NULL OR p_expected_proposal_version IS NULL OR p_expected_proposal_version < 1 OR p_reviewed_result_event_id IS NULL
     OR p_mandate_id IS NULL OR jsonb_typeof(p_integrity) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid mandated acceptance request' USING ERRCODE = '22023';
  END IF;
  -- Forma EXATA do relatório de integridade (chaves fechadas).
  IF (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(p_integrity) k)
     IS DISTINCT FROM ARRAY['baseIsAncestor','baseSha','changeStatuses','changedFiles','checkedAt','commitCount','commitSha','mergeCount','parentShas','schemaVersion']::text[]
     OR p_integrity -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb
     OR jsonb_typeof(p_integrity -> 'parentShas') IS DISTINCT FROM 'array' OR jsonb_typeof(p_integrity -> 'changedFiles') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_integrity -> 'changeStatuses') IS DISTINCT FROM 'array' OR jsonb_typeof(p_integrity -> 'baseIsAncestor') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_integrity -> 'commitCount') IS DISTINCT FROM 'number' OR jsonb_typeof(p_integrity -> 'mergeCount') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'invalid mandated acceptance request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items i WHERE i.id = p_work_item_id AND i.user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_m FROM public.work_acceptance_mandates m WHERE m.id = p_mandate_id AND m.user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mandate not found' USING ERRCODE = 'P0002'; END IF;
  IF v_m.work_item_id <> v_item.id THEN RAISE EXCEPTION 'acceptance mandate: wrong_item_or_version' USING ERRCODE = '55000'; END IF;

  -- Replay: mandato já consumido ⇒ mesmo resultado devolve 'replayed'; qualquer outro é conflito.
  IF v_m.consumed_at IS NOT NULL THEN
    SELECT * INTO v_prev FROM public.work_events e WHERE e.id = v_m.consumed_event_id;
    IF v_prev.payload -> 'data' ->> 'accepted_result_event_id' = p_reviewed_result_event_id::text THEN
      RETURN jsonb_build_object('action', 'replayed', 'event_seq', v_prev.seq);
    END IF;
    RAISE EXCEPTION 'acceptance mandate: mandate_consumed' USING ERRCODE = '55000';
  END IF;
  IF v_m.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'acceptance mandate: mandate_revoked' USING ERRCODE = '55000'; END IF;
  IF v_m.allowed_actions IS DISTINCT FROM ARRAY['accept'] THEN RAISE EXCEPTION 'acceptance mandate: action_not_allowed' USING ERRCODE = '55000'; END IF;
  IF v_m.policy_version <> private.acceptance_mandate_policy_version() THEN RAISE EXCEPTION 'acceptance mandate: policy_changed' USING ERRCODE = '55000'; END IF;
  IF clock_timestamp() < v_m.not_before THEN RAISE EXCEPTION 'acceptance mandate: mandate_not_yet_valid' USING ERRCODE = '55000'; END IF;
  IF clock_timestamp() >= v_m.expires_at THEN RAISE EXCEPTION 'acceptance mandate: mandate_expired' USING ERRCODE = '55000'; END IF;
  IF v_item.proposal_version <> p_expected_proposal_version OR v_m.proposal_version <> v_item.proposal_version THEN
    RAISE EXCEPTION 'acceptance mandate: wrong_item_or_version' USING ERRCODE = '55000';
  END IF;
  IF v_item.state <> 'review' THEN RAISE EXCEPTION 'acceptance mandate: item_not_in_review' USING ERRCODE = '55000'; END IF;
  IF p_reviewed_result_event_id IS DISTINCT FROM private.latest_result_event_id(v_item.id) THEN
    RAISE EXCEPTION 'acceptance mandate: result_not_latest' USING ERRCODE = '55000';
  END IF;
  IF private.acceptance_contract_sha256(v_item) <> v_m.contract_sha256 THEN RAISE EXCEPTION 'acceptance mandate: contract_changed' USING ERRCODE = '55000'; END IF;
  IF v_item.impact_level::text <> 'low' THEN RAISE EXCEPTION 'acceptance mandate: impact_not_low' USING ERRCODE = '55000'; END IF;
  IF v_item.intent #>> '{execution_spec,base_sha}' IS DISTINCT FROM v_m.base_sha THEN RAISE EXCEPTION 'acceptance mandate: base_changed' USING ERRCODE = '55000'; END IF;

  SELECT * INTO v_result FROM public.work_events e WHERE e.id = p_reviewed_result_event_id AND e.work_item_id = v_item.id AND e.event_type = 'result_submitted';
  IF NOT FOUND THEN RAISE EXCEPTION 'acceptance mandate: result_not_latest' USING ERRCODE = '55000'; END IF;
  v_attempt := v_result.payload -> 'data' ->> 'attempt_id';
  v_commit := v_result.payload #>> '{data,executor_signal,worktreeHandoff,commitSha}';

  -- Mandato ANTECIPADO e uma única attempt.
  SELECT count(*) INTO v_exec_count FROM public.work_events e WHERE e.work_item_id = v_item.id AND e.event_type = 'execution_started';
  IF v_exec_count <> 1 THEN RAISE EXCEPTION 'acceptance mandate: multiple_attempts' USING ERRCODE = '55000'; END IF;
  SELECT e.seq INTO v_exec_seq FROM public.work_events e WHERE e.work_item_id = v_item.id AND e.event_type = 'execution_started' AND e.payload -> 'data' ->> 'attempt_id' = v_attempt;
  IF v_exec_seq IS NULL OR v_exec_seq <= v_m.granted_event_seq THEN RAISE EXCEPTION 'acceptance mandate: not_anticipated' USING ERRCODE = '55000'; END IF;

  -- Classificação humana vigente.
  SELECT e.payload -> 'data' -> 'classification' INTO v_class FROM public.work_events e
  WHERE e.work_item_id = v_item.id AND e.event_type = 'work_intelligence_classified' AND e.proposal_version = v_item.proposal_version ORDER BY e.seq DESC LIMIT 1;
  IF v_class IS NULL OR v_class #>> '{provenance,kind}' IS DISTINCT FROM 'human_confirmed' OR v_class ->> 'complexity' IS DISTINCT FROM 'bounded'
     OR v_class ->> 'risk' IS DISTINCT FROM 'low' OR v_class ->> 'reversibility' IS DISTINCT FROM 'reversible' OR v_class ->> 'planClarity' IS DISTINCT FROM 'clear' THEN
    RAISE EXCEPTION 'acceptance mandate: classification_not_human_confirmed' USING ERRCODE = '55000';
  END IF;

  -- Sem compute pago e sem integração/aceite anteriores.
  IF EXISTS (SELECT 1 FROM public.paid_compute_authorizations a WHERE a.work_item_id = v_item.id)
     OR EXISTS (SELECT 1 FROM public.paid_compute_budget_events b WHERE b.work_item_id = v_item.id)
     OR (SELECT e.payload -> 'data' -> 'preference' ->> 'strategy' FROM public.work_events e WHERE e.work_item_id = v_item.id AND e.event_type = 'compute_preference_recorded' ORDER BY e.seq DESC LIMIT 1) = 'provider_api' THEN
    RAISE EXCEPTION 'acceptance mandate: paid_compute_present' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_events e WHERE e.work_item_id = v_item.id AND (e.event_type::text LIKE 'integration%' OR e.event_type IN ('result_accepted', 'branch_published'))) THEN
    RAISE EXCEPTION 'acceptance mandate: integration_present' USING ERRCODE = '55000';
  END IF;

  -- Verifier v6 verified, correlacionado, zero gaps e zero violations.
  IF private.mandated_result_verdict(v_item.id, v_item.proposal_version, p_reviewed_result_event_id) IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'acceptance mandate: verifier_not_verified' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_op FROM public.work_events o WHERE o.work_item_id = v_item.id AND o.event_type = 'verifier_opinion_recorded' AND o.proposal_version = v_item.proposal_version
    AND o.payload -> 'data' ->> 'attempt_id' = v_attempt AND o.payload -> 'data' ->> 'result_event_id' = p_reviewed_result_event_id::text ORDER BY o.seq DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'acceptance mandate: verifier_missing' USING ERRCODE = '55000'; END IF;
  IF v_op.payload -> 'data' ->> 'verifier_version' IS DISTINCT FROM private.acceptance_mandate_min_verifier()
     OR v_op.payload -> 'data' -> 'opinion' ->> 'verifierVersion' IS DISTINCT FROM private.acceptance_mandate_min_verifier() THEN
    RAISE EXCEPTION 'acceptance mandate: verifier_version_too_old' USING ERRCODE = '55000';
  END IF;
  IF (v_op.payload #>> '{data,opinion,summary,gaps}') IS DISTINCT FROM '0' OR (v_op.payload #>> '{data,opinion,summary,violations}') IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'acceptance mandate: verifier_gaps_or_violations' USING ERRCODE = '55000';
  END IF;
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_item.intent #> '{execution_spec,validation_criteria}', '[]'::jsonb)) c WHERE c ->> 'claim_kind' = 'test_binding') INTO v_needs_tb;
  IF v_needs_tb AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_op.payload #> '{data,opinion,findings}', '[]'::jsonb)) f
                                WHERE f ->> 'code' = 'test_binding_satisfied' AND f ->> 'provenance' = 'independent') THEN
    RAISE EXCEPTION 'acceptance mandate: test_binding_not_independent' USING ERRCODE = '55000';
  END IF;

  -- Fato de contexto de execução (R1) da MESMA attempt, escrito pelo writer, em modo unattended/supervised.
  SELECT * INTO v_ctx FROM public.work_events c WHERE c.work_item_id = v_item.id AND c.event_type = 'host_observed_execution_context_recorded'
    AND c.proposal_version = v_item.proposal_version AND c.payload -> 'data' ->> 'attempt_id' = v_attempt;
  IF NOT FOUND OR v_ctx.author <> 'system' OR v_ctx.payload -> 'data' ->> 'recorded_by' IS DISTINCT FROM 'trusted_system_writer'
     OR v_ctx.payload -> 'data' ->> 'execution_mode' NOT IN ('unattended', 'supervised') THEN
    RAISE EXCEPTION 'acceptance mandate: context_fact_missing_or_invalid' USING ERRCODE = '55000';
  END IF;

  -- Integridade do candidato: evidência git OBSERVADA PELO HOST + conferência Git do writer (p_integrity).
  SELECT * INTO v_git FROM public.work_events h WHERE h.id = (v_op.payload -> 'data' ->> 'observed_event_id')::uuid AND h.work_item_id = v_item.id
    AND h.event_type = 'host_observed_evidence_recorded';
  IF NOT FOUND THEN RAISE EXCEPTION 'acceptance mandate: candidate_integrity_failed' USING ERRCODE = '55000'; END IF;
  SELECT array_agg(x ORDER BY x) INTO v_scope FROM unnest(v_m.scope_files) x;
  SELECT array_agg(x ORDER BY x) INTO v_host_files FROM jsonb_array_elements_text(coalesce(v_git.payload #> '{data,evidence,observedChangedFiles}', '[]'::jsonb)) x;
  SELECT array_agg(x ORDER BY x) INTO v_int_files FROM jsonb_array_elements_text(p_integrity -> 'changedFiles') x;
  SELECT array_agg(s ->> 'status' ORDER BY s ->> 'path'), array_agg(s ->> 'path' ORDER BY s ->> 'path') INTO v_statuses, v_status_paths FROM jsonb_array_elements(p_integrity -> 'changeStatuses') s;
  IF v_commit IS NULL OR v_commit !~ '^[0-9a-f]{40}$'
     OR p_integrity ->> 'commitSha' IS DISTINCT FROM v_commit
     OR v_git.payload #>> '{data,evidence,observedCommitSha}' IS DISTINCT FROM v_commit
     OR p_integrity ->> 'baseSha' IS DISTINCT FROM v_m.base_sha
     OR v_git.payload #>> '{data,evidence,baseSha}' IS DISTINCT FROM v_m.base_sha
     OR (p_integrity -> 'baseIsAncestor') IS DISTINCT FROM 'true'::jsonb
     OR (p_integrity ->> 'mergeCount') IS DISTINCT FROM '0'
     OR (p_integrity ->> 'commitCount') IS DISTINCT FROM '1'
     OR p_integrity -> 'parentShas' IS DISTINCT FROM jsonb_build_array(v_m.base_sha)
     OR v_int_files IS DISTINCT FROM v_scope OR v_host_files IS DISTINCT FROM v_scope
     OR v_status_paths IS DISTINCT FROM v_scope
     OR EXISTS (SELECT 1 FROM unnest(v_statuses) st WHERE st IS DISTINCT FROM 'A') THEN
    RAISE EXCEPTION 'acceptance mandate: candidate_integrity_failed' USING ERRCODE = '55000';
  END IF;

  -- Efeito: item completed (mesma tabela de transições do aceite humano), decisão de SISTEMA citando o mandato.
  SELECT t.to_state INTO v_target FROM private.work_state_transitions t WHERE t.from_state = v_item.state AND t.event_type = 'result_accepted';
  IF NOT FOUND THEN RAISE EXCEPTION 'transition not allowed' USING ERRCODE = '22023'; END IF;
  UPDATE public.work_items SET state = v_target, updated_at = now() WHERE id = v_item.id;
  INSERT INTO public.work_events(work_item_id, event_type, author, proposal_version, payload)
  VALUES (v_item.id, 'result_accepted', 'system', v_item.proposal_version, jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
    'accepted_result_event_id', p_reviewed_result_event_id, 'decided_by', 'trusted_system_writer',
    'authority', jsonb_build_object('kind', 'human_mandate', 'mandate_id', v_m.id, 'grant_event_id', v_m.granted_event_id,
      'grant_event_seq', v_m.granted_event_seq, 'contract_sha256', v_m.contract_sha256, 'policy_version', v_m.policy_version, 'expires_at', v_m.expires_at),
    'verifier_event_id', v_op.id, 'execution_context_event_id', v_ctx.id,
    'candidate', jsonb_build_object('commit_sha', v_commit, 'base_sha', v_m.base_sha, 'scope_files', to_jsonb(v_scope)),
    'integrity', p_integrity)))
  RETURNING * INTO v_ev;
  UPDATE public.work_acceptance_mandates SET consumed_at = now(), consumed_event_id = v_ev.id WHERE id = v_m.id;
  RETURN jsonb_build_object('action', 'accepted', 'event_seq', v_ev.seq, 'mandate_id', v_m.id);
END $$;

-- ─── Trigger ADITIVO: aceite de sistema só nasce do writer, com mandato existente e vigente ───────────────────────
-- (não altera o guard_trusted_system_fact existente; defesa em profundidade para qualquer outra via de INSERT)
CREATE FUNCTION private.guard_mandated_acceptance() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE v_owner uuid; v_m public.work_acceptance_mandates;
BEGIN
  IF NEW.event_type <> 'result_accepted' THEN RETURN NEW; END IF;
  IF NEW.author = 'system' OR NEW.payload -> 'data' -> 'authority' ->> 'kind' = 'human_mandate' THEN
    v_owner := private.trusted_system_writer_owner();
    IF v_owner IS NULL OR NEW.author IS DISTINCT FROM 'system' OR NOT EXISTS (SELECT 1 FROM public.work_items i WHERE i.id = NEW.work_item_id AND i.user_id = v_owner) THEN
      RAISE EXCEPTION 'mandated acceptance requires the trusted system writer' USING ERRCODE = '42501';
    END IF;
    IF NEW.payload -> 'data' -> 'authority' ->> 'kind' IS DISTINCT FROM 'human_mandate'
       OR NEW.payload -> 'data' ->> 'decided_by' IS DISTINCT FROM 'trusted_system_writer'
       OR coalesce(NEW.payload -> 'data' -> 'authority' ->> 'mandate_id', '') !~ '^[0-9a-f-]{36}$' THEN
      RAISE EXCEPTION 'system acceptance requires a mandate authority' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_m FROM public.work_acceptance_mandates m WHERE m.id = (NEW.payload -> 'data' -> 'authority' ->> 'mandate_id')::uuid;
    IF NOT FOUND OR v_m.work_item_id <> NEW.work_item_id OR v_m.revoked_at IS NOT NULL OR v_m.consumed_at IS NOT NULL
       OR clock_timestamp() < v_m.not_before OR clock_timestamp() >= v_m.expires_at THEN
      RAISE EXCEPTION 'mandate is not valid for this acceptance' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_mandated_acceptance BEFORE INSERT ON public.work_events FOR EACH ROW EXECUTE FUNCTION private.guard_mandated_acceptance();

-- ─── ACL: cada função só para o seu papel; runner (authenticated), anon e service_role ficam de fora ─────────────
REVOKE ALL ON FUNCTION public.preview_acceptance_contract(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.grant_acceptance_mandate(uuid, integer, text, text, text[], timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_acceptance_mandate(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.accept_work_result_under_mandate(uuid, integer, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_acceptance_contract(uuid) TO anima_mandate_grantor;
GRANT EXECUTE ON FUNCTION public.grant_acceptance_mandate(uuid, integer, text, text, text[], timestamptz, timestamptz, uuid) TO anima_mandate_grantor;
GRANT EXECUTE ON FUNCTION public.revoke_acceptance_mandate(uuid, text) TO anima_mandate_grantor;
GRANT EXECUTE ON FUNCTION public.accept_work_result_under_mandate(uuid, integer, uuid, uuid, jsonb) TO anima_system_writer;

COMMENT ON FUNCTION public.accept_work_result_under_mandate(uuid, integer, uuid, uuid, jsonb) IS
  'A2-0 R2. Aceite sob mandato humano antecipado. Só o Trusted System Writer. O banco recalcula mandato, contrato, Verifier v6, escopo e integridade; grava result_accepted author system com authority human_mandate e consome o mandato atomicamente. Não integra, não publica.';
