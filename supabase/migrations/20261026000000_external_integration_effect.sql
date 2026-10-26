-- Project Builder V0 — T5 (2026-10-26): integração Git governada de candidato EXTERNO + exclusividade FÍSICA transacional.
--
-- ADITIVA. Não altera migrations históricas, assinaturas, grants nem o caminho INTERNO do Anima:
--   * `authorize_integration_effect` (alvo fixo refs/heads/dev) e `record_integration_completed` seguem como estão. O receipt
--     de um efeito externo `ff_only` é gravado pelo MESMO `record_integration_completed` (a autorização externa congela os mesmos
--     campos: operation_key, repository_id, target_ref, expected_target_sha, result_commit_sha, mode).
--   * Nova autorização HUMANA `authorize_external_integration_effect`: só `ff_only`; destino `refs/heads/<nome>` seguro; congela
--     item, versão, attempt, resultado aceito, commit candidato (DERIVADO do handoff persistido), referência e IDENTIDADE
--     canônica do repositório (raiz, git-common-dir, commit raiz, base), mais o operador (author=user). Exige Verifier `verified`
--     correlacionado ao resultado aceito. A revisão humana de critérios (T4) vive em mensagens do operador e é verificada pelo
--     executor; o banco não a lê.
--   * Um trigger fecha a porta ao contrário: item externo NÃO pode usar a autorização interna (e vice-versa).
--   * Exclusividade FÍSICA: `external_repo_leases` + chave derivada no SERVIDOR da identidade (git-common-dir normalizado),
--     independente da referência textual. Lease e CLAIM são mutuamente excludentes por repositório físico e por advisory lock
--     transacional; leases expirados são liberados na próxima aquisição (recuperação após queda do processo).

-- ─── Identidade externa e chave física (derivadas do intent persistido) ────────────────────────

CREATE FUNCTION private.external_target_identity(p_intent jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_intent #> '{execution_spec,target,identity}')='object'
     AND (p_intent #>> '{execution_spec,target,reference}') ~ '^ext:[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'
     AND private.is_sha1_hex(p_intent #>> '{execution_spec,target,identity,root_commit_sha}')
     AND private.is_sha1_hex(p_intent #>> '{execution_spec,target,identity,base_sha}')
     AND length(btrim(coalesce(p_intent #>> '{execution_spec,target,identity,repo_root_canonical}','')))>0
     AND length(btrim(coalesce(p_intent #>> '{execution_spec,target,identity,git_common_dir_canonical}','')))>0
    THEN p_intent #> '{execution_spec,target,identity}'
    ELSE NULL END;
$$;

-- Chave do repositório físico: sha256 do git-common-dir canônico (barras normalizadas; caixa só em caminho Windows/UNC),
-- espelho de `normalizeCanonicalPath` (core). Duas referências para o mesmo diretório colidem aqui.
CREATE FUNCTION private.external_repo_key(p_intent jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE v_identity jsonb:=private.external_target_identity(p_intent); v_path text;
BEGIN
  IF v_identity IS NULL THEN RETURN NULL; END IF;
  v_path:=regexp_replace(replace(v_identity->>'git_common_dir_canonical','\','/'),'/+$','');
  IF v_path ~ '^[A-Za-z]:/' OR v_path LIKE '//%' THEN v_path:=lower(v_path); END IF;
  RETURN encode(sha256(convert_to(v_path,'UTF8')),'hex');
END $$;

REVOKE ALL ON FUNCTION private.external_target_identity(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.external_repo_key(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.external_target_identity(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.external_repo_key(jsonb) TO service_role;

-- ─── Lease de repositório físico ──────────────────────────────────────────────────────────────

CREATE TABLE public.external_repo_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  repo_key text NOT NULL CHECK (repo_key ~ '^[a-f0-9]{64}$'),
  operation text NOT NULL CHECK (operation IN ('integration')),
  owner_instance_id text NOT NULL CHECK (length(btrim(owner_instance_id))>0),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text,
  CHECK (expires_at>acquired_at),
  CHECK ((released_at IS NULL)=(release_reason IS NULL))
);
-- No máximo UM lease aberto por repositório físico (por usuário), garantido pelo banco.
CREATE UNIQUE INDEX external_repo_leases_single_open_idx ON public.external_repo_leases(user_id,repo_key) WHERE released_at IS NULL;
CREATE INDEX external_repo_leases_item_idx ON public.external_repo_leases(work_item_id);

ALTER TABLE public.external_repo_leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuário lê seus leases de repositório externo" ON public.external_repo_leases FOR SELECT TO authenticated USING (user_id=auth.uid());
REVOKE ALL ON public.external_repo_leases FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.external_repo_leases TO authenticated;
GRANT ALL ON public.external_repo_leases TO service_role;

COMMENT ON TABLE public.external_repo_leases IS
  'Exclusividade FÍSICA de repositório externo para operações mutantes (integração Git). Chave = sha256 do git-common-dir canônico derivado do intent no servidor; a referência textual não importa. Escrita só pelas RPCs.';

-- Conflito físico: outro item (qualquer referência) com claim aberto e vigente, ou em execução (in_progress).
CREATE FUNCTION private.external_repo_busy(p_user uuid,p_key text,p_item uuid)
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT CASE
    WHEN EXISTS(SELECT 1 FROM public.external_repo_leases l WHERE l.user_id=p_user AND l.repo_key=p_key AND l.released_at IS NULL
                AND l.expires_at>now() AND l.work_item_id<>p_item) THEN 'external repository is held by an active lease'
    WHEN EXISTS(SELECT 1 FROM public.work_claims c JOIN public.work_items i ON i.id=c.work_item_id
                WHERE c.user_id=p_user AND c.released_at IS NULL AND c.expires_at>now() AND i.id<>p_item
                  AND private.external_repo_key(i.intent)=p_key) THEN 'external repository is busy with an active claim'
    WHEN EXISTS(SELECT 1 FROM public.work_items i WHERE i.user_id=p_user AND i.id<>p_item AND i.state='in_progress'
                AND private.external_repo_key(i.intent)=p_key) THEN 'external repository is busy with a running work item'
    ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION private.external_repo_busy(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.external_repo_busy(uuid,text,uuid) TO service_role;

CREATE FUNCTION public.acquire_external_repo_lease(work_item_id uuid,owner_instance_id text,lease_seconds integer)
RETURNS public.external_repo_leases LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_user uuid:=auth.uid(); v_item public.work_items; v_key text; v_open public.external_repo_leases; v_busy text; v_row public.external_repo_leases;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF lease_seconds IS NULL OR lease_seconds NOT BETWEEN 30 AND 3600 OR length(btrim(coalesce(owner_instance_id,'')))=0 THEN
    RAISE EXCEPTION 'invalid external repository lease request' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  v_key:=private.external_repo_key(v_item.intent);
  IF v_key IS NULL THEN RAISE EXCEPTION 'work item is not an external target' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text||':'||v_key,0));
  -- Recuperação: lease vencido deixa de ocupar o repositório (o processo dono caiu ou demorou demais).
  UPDATE public.external_repo_leases l SET released_at=now(),release_reason='expired'
   WHERE l.user_id=v_user AND l.repo_key=v_key AND l.released_at IS NULL AND l.expires_at<=now();
  SELECT * INTO v_open FROM public.external_repo_leases l WHERE l.user_id=v_user AND l.repo_key=v_key AND l.released_at IS NULL;
  IF FOUND THEN
    IF v_open.work_item_id=v_item.id AND v_open.owner_instance_id=owner_instance_id THEN
      UPDATE public.external_repo_leases l SET expires_at=greatest(l.expires_at,now()+make_interval(secs=>lease_seconds)) WHERE l.id=v_open.id RETURNING * INTO v_row;
      RETURN v_row; -- mesmo dono: renovação idempotente
    END IF;
    RAISE EXCEPTION 'external repository is held by an active lease' USING ERRCODE='55000';
  END IF;
  v_busy:=private.external_repo_busy(v_user,v_key,v_item.id);
  IF v_busy IS NOT NULL THEN RAISE EXCEPTION '%',v_busy USING ERRCODE='55000'; END IF;
  INSERT INTO public.external_repo_leases(user_id,work_item_id,repo_key,operation,owner_instance_id,expires_at)
  VALUES(v_user,v_item.id,v_key,'integration',btrim(owner_instance_id),now()+make_interval(secs=>lease_seconds))
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

CREATE FUNCTION public.release_external_repo_lease(lease_id uuid,reason text DEFAULT 'released')
RETURNS public.external_repo_leases LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_user uuid:=auth.uid(); v_row public.external_repo_leases;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF reason IS NULL OR reason NOT IN ('released','failed','completed') THEN RAISE EXCEPTION 'invalid lease release reason' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_row FROM public.external_repo_leases l WHERE l.id=lease_id AND l.user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lease not found' USING ERRCODE='P0002'; END IF;
  IF v_row.released_at IS NOT NULL THEN RETURN v_row; END IF; -- idempotente
  UPDATE public.external_repo_leases l SET released_at=now(),release_reason=reason WHERE l.id=v_row.id RETURNING * INTO v_row;
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.acquire_external_repo_lease(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_external_repo_lease(uuid,text,integer) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.release_external_repo_lease(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_external_repo_lease(uuid,text) TO authenticated,service_role;

-- Claim de item externo: não nasce enquanto OUTRO item ocupa o mesmo repositório físico (lease, claim vigente, in_progress).
-- Itens sem identidade externa (todo o fluxo interno) passam intactos. As regras por REFERÊNCIA existentes continuam valendo.
CREATE FUNCTION private.enforce_external_repo_exclusivity_on_claim() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_key text; v_busy text;
BEGIN
  SELECT private.external_repo_key(i.intent) INTO v_key FROM public.work_items i WHERE i.id=NEW.work_item_id;
  IF v_key IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text||':'||v_key,0));
  v_busy:=private.external_repo_busy(NEW.user_id,v_key,NEW.work_item_id);
  IF v_busy IS NOT NULL THEN RAISE EXCEPTION '%',v_busy USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enforce_external_repo_exclusivity_on_claim BEFORE INSERT ON public.work_claims
  FOR EACH ROW EXECUTE FUNCTION private.enforce_external_repo_exclusivity_on_claim();

-- ─── Autorização humana do efeito externo ─────────────────────────────────────────────────────

CREATE FUNCTION public.authorize_external_integration_effect(
  work_item_id uuid,
  expected_proposal_version integer,
  accepted_result_event_id uuid,
  authorization_id text,
  target_ref text,
  expected_target_sha text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  v_user uuid:=auth.uid(); v_item public.work_items; v_accept public.work_events; v_result public.work_events; v_identity jsonb;
  v_reference text; v_handoff jsonb; v_commit text; v_attempt text; v_repo text; v_key text; v_data jsonb; v_existing public.work_events; v_seq bigint;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version<1 OR accepted_result_event_id IS NULL
     OR length(btrim(coalesce(authorization_id,'')))=0 OR NOT private.is_sha1_hex(expected_target_sha) THEN
    RAISE EXCEPTION 'invalid integration effect authorization' USING ERRCODE='22023';
  END IF;
  -- Destino: branch local explícito e seguro; nunca o namespace de attempts do Anima. Modo único: ff_only.
  IF target_ref IS NULL OR target_ref !~ '^refs/heads/[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$' OR target_ref LIKE '%..%' OR target_ref LIKE '%//%'
     OR target_ref LIKE '%/' OR target_ref LIKE '%.lock' OR target_ref LIKE 'refs/heads/anima-work/%' THEN
    RAISE EXCEPTION 'integration target not allowed' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.state<>'completed' OR v_item.proposal_version<>expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;
  v_identity:=private.external_target_identity(v_item.intent);
  v_reference:=v_item.intent #>> '{execution_spec,target,reference}';
  IF v_identity IS NULL OR v_item.intent #>> '{external_work_provenance,kind}' IS DISTINCT FROM 'external_work_proposal'
     OR v_item.intent #>> '{external_work_provenance,reference}' IS DISTINCT FROM v_reference
     OR v_item.intent #>> '{execution_spec,base_sha}' IS DISTINCT FROM v_identity->>'base_sha' THEN
    RAISE EXCEPTION 'work item is not an external target' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_accept FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='result_accepted' ORDER BY e.seq DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'accepted result not found' USING ERRCODE='P0002'; END IF;
  IF (v_accept.payload->'data'->>'accepted_result_event_id') IS DISTINCT FROM accepted_result_event_id::text THEN
    RAISE EXCEPTION 'accepted result changed' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_result FROM public.work_events e
  WHERE e.id=accepted_result_event_id AND e.work_item_id=v_item.id AND e.event_type='result_submitted' AND e.proposal_version=expected_proposal_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'accepted result not found' USING ERRCODE='P0002'; END IF;

  -- Commit e attempt DERIVADOS do handoff persistido; a base do handoff é a base autorizada na identidade.
  v_handoff:=v_result.payload->'data'->'executor_signal'->'worktreeHandoff';
  v_commit:=v_handoff->>'commitSha';
  v_attempt:=v_result.payload->'data'->>'attempt_id';
  IF v_handoff IS NULL OR NOT private.is_sha1_hex(v_commit) OR v_attempt IS NULL
     OR v_handoff->>'attemptId' IS DISTINCT FROM v_attempt OR v_handoff->>'workItemId' IS DISTINCT FROM v_item.id::text
     OR (v_handoff->>'approvedProposalVersion')::integer IS DISTINCT FROM expected_proposal_version
     OR v_handoff->>'baseSha' IS DISTINCT FROM v_identity->>'base_sha' THEN
    RAISE EXCEPTION 'result commit not derivable' USING ERRCODE='P0002';
  END IF;

  -- Verifier: o parecer decisivo (mais recente) desta attempt, ligado a ESTE resultado, precisa ser `verified`.
  IF NOT EXISTS(
    SELECT 1 FROM public.work_events o
    WHERE o.work_item_id=v_item.id AND o.event_type='verifier_opinion_recorded'
      AND o.payload->'data'->>'attempt_id'=v_attempt
      AND o.payload->'data'->'opinion'->'evidenceBasis'->>'resultEventId'=accepted_result_event_id::text
      AND o.payload->'data'->'opinion'->>'verdict'='verified'
      AND o.seq=(SELECT max(o2.seq) FROM public.work_events o2
                 WHERE o2.work_item_id=v_item.id AND o2.event_type='verifier_opinion_recorded'
                   AND o2.payload->'data'->>'attempt_id'=v_attempt
                   AND o2.payload->'data'->'opinion'->'evidenceBasis'->>'resultEventId'=accepted_result_event_id::text)) THEN
    RAISE EXCEPTION 'verifier opinion is not verified for the accepted result' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='integration_completed') THEN
    RAISE EXCEPTION 'work item already integrated' USING ERRCODE='55000';
  END IF;

  v_repo:='external:'||v_reference;
  v_key:='integration-effect:'||authorization_id||':'||accepted_result_event_id::text||':'||v_repo||':'||target_ref||':'||expected_target_sha||':'||v_commit||':ff_only';
  v_data:=jsonb_build_object(
    'authorization_id',authorization_id,'operation_key',v_key,
    'work_item_id',v_item.id,'approved_proposal_version',expected_proposal_version,'attempt_id',v_attempt,
    'accepted_result_event_id',accepted_result_event_id,'result_commit_sha',v_commit,
    'repository_id',v_repo,'target_ref',target_ref,'expected_target_sha',expected_target_sha,'mode','ff_only',
    'external',jsonb_build_object('reference',v_reference,'repo_root_canonical',v_identity->>'repo_root_canonical',
      'git_common_dir_canonical',v_identity->>'git_common_dir_canonical','root_commit_sha',v_identity->>'root_commit_sha','base_sha',v_identity->>'base_sha'));

  SELECT * INTO v_existing FROM public.work_events e
  WHERE e.event_type='integration_effect_authorized' AND e.payload->'data'->>'authorization_id'=authorization_id;
  IF FOUND THEN
    IF v_existing.work_item_id=v_item.id AND v_existing.payload->'data'=v_data THEN
      RETURN jsonb_build_object('action','replayed','event_seq',v_existing.seq,'operation_key',v_key,'result_commit_sha',v_commit);
    END IF;
    RAISE EXCEPTION 'integration effect authorization conflict' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'integration_effect_authorized','user',expected_proposal_version,jsonb_build_object('schema_version',1,'data',v_data))
  RETURNING seq INTO v_seq;
  RETURN jsonb_build_object('action','recorded','event_seq',v_seq,'operation_key',v_key,'result_commit_sha',v_commit);
END $$;
REVOKE ALL ON FUNCTION public.authorize_external_integration_effect(uuid,integer,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_external_integration_effect(uuid,integer,uuid,text,text,text) TO authenticated,service_role;

-- A autorização INTERNA não serve a item externo, e a EXTERNA não serve a item interno.
CREATE FUNCTION private.enforce_integration_authorization_kind() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_intent jsonb; v_external boolean; v_marked boolean:=(NEW.payload->'data') ? 'external';
BEGIN
  IF NEW.event_type<>'integration_effect_authorized' THEN RETURN NEW; END IF;
  SELECT i.intent INTO v_intent FROM public.work_items i WHERE i.id=NEW.work_item_id;
  v_external:=private.external_target_identity(v_intent) IS NOT NULL;
  IF v_external AND NOT v_marked THEN
    RAISE EXCEPTION 'external work items require the external integration authorization' USING ERRCODE='55000';
  END IF;
  IF v_marked AND NOT v_external THEN
    RAISE EXCEPTION 'external integration authorization requires an external work item' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enforce_integration_authorization_kind BEFORE INSERT ON public.work_events
  FOR EACH ROW WHEN (NEW.event_type='integration_effect_authorized') EXECUTE FUNCTION private.enforce_integration_authorization_kind();

COMMENT ON FUNCTION public.authorize_external_integration_effect(uuid,integer,uuid,text,text,text) IS
  'Project Builder V0 T5: autorização HUMANA de um efeito Git ff_only de candidato EXTERNO em um branch local explícito, ligado ao item, versão, attempt, resultado aceito, commit derivado do handoff, referência e identidade canônica do repositório; exige Verifier verified. O receipt usa record_integration_completed.';
COMMENT ON FUNCTION public.acquire_external_repo_lease(uuid,text,integer) IS
  'Exclusividade física transacional (advisory lock + índice único parcial) por git-common-dir canônico, independente da referência; lease vencido é liberado na próxima aquisição.';
