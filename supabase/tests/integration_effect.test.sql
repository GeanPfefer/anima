-- Completed → Integrated V0/V1 — autorização humana do efeito e receipt persistido (merge_no_ff e ff_only).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(40);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('9b000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ie@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-000000000000','user','a');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('9b000000-0000-0000-0000-000000000000');
RESET ROLE;

-- Trusted System Writer V0: fatos de sistema são gravados pelo WRITER DE SISTEMA (não pela
-- sessão humana). Estes wrappers de TESTE assumem a identidade de um writer registrado para o
-- dono da sessão corrente (claims role=anima_system_writer + sub do writer) e chamam a RPC
-- real — exercitam a defesa em profundidade da função. A fronteira de GRANT (humano/anon
-- negados; writer permitido) é provada com SET ROLE real em trusted_system_writer.test.sql.
CREATE FUNCTION pg_temp.writer_for(p_owner uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $w$
DECLARE v_writer uuid := md5('trusted-writer:'||coalesce(p_owner::text,'none'))::uuid;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES(v_writer,'00000000-0000-0000-0000-000000000000','anima_system_writer','anima_system_writer','writer-'||v_writer||'@test.invalid','',now(),'{}','{}',now(),now())
  ON CONFLICT (id) DO NOTHING;
  IF p_owner IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_owner) THEN
    INSERT INTO private.trusted_system_writers(writer_user_id,owner_user_id) VALUES(v_writer,p_owner) ON CONFLICT (writer_user_id) DO NOTHING;
  END IF;
  RETURN v_writer;
END $w$;
CREATE FUNCTION pg_temp.record_host_observed_evidence(a uuid, b integer, c uuid, d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $w$
DECLARE v_sub text := current_setting('request.jwt.claim.sub', true); v_claims text := current_setting('request.jwt.claims', true); v_w uuid; r jsonb;
BEGIN
  v_w := pg_temp.writer_for(nullif(v_sub,'')::uuid);
  PERFORM set_config('request.jwt.claim.sub', v_w::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','anima_system_writer','sub',v_w)::text, true);
  BEGIN
    r := public.record_host_observed_evidence(a,b,c,d);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
    PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
  RETURN r;
END $w$;
GRANT EXECUTE ON FUNCTION pg_temp.record_host_observed_evidence(a uuid, b integer, c uuid, d jsonb) TO authenticated, anon;
CREATE FUNCTION pg_temp.record_host_observed_gate_evidence(a uuid, b integer, c uuid, d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $w$
DECLARE v_sub text := current_setting('request.jwt.claim.sub', true); v_claims text := current_setting('request.jwt.claims', true); v_w uuid; r jsonb;
BEGIN
  v_w := pg_temp.writer_for(nullif(v_sub,'')::uuid);
  PERFORM set_config('request.jwt.claim.sub', v_w::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','anima_system_writer','sub',v_w)::text, true);
  BEGIN
    r := public.record_host_observed_gate_evidence(a,b,c,d);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
    PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
  RETURN r;
END $w$;
GRANT EXECUTE ON FUNCTION pg_temp.record_host_observed_gate_evidence(a uuid, b integer, c uuid, d jsonb) TO authenticated, anon;
CREATE FUNCTION pg_temp.record_host_observed_coder_evidence(a uuid, b integer, c uuid, d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $w$
DECLARE v_sub text := current_setting('request.jwt.claim.sub', true); v_claims text := current_setting('request.jwt.claims', true); v_w uuid; r jsonb;
BEGIN
  v_w := pg_temp.writer_for(nullif(v_sub,'')::uuid);
  PERFORM set_config('request.jwt.claim.sub', v_w::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','anima_system_writer','sub',v_w)::text, true);
  BEGIN
    r := public.record_host_observed_coder_evidence(a,b,c,d);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
    PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
  RETURN r;
END $w$;
GRANT EXECUTE ON FUNCTION pg_temp.record_host_observed_coder_evidence(a uuid, b integer, c uuid, d jsonb) TO authenticated, anon;
CREATE FUNCTION pg_temp.record_verifier_opinion(a uuid, b integer, c uuid, d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $w$
DECLARE v_sub text := current_setting('request.jwt.claim.sub', true); v_claims text := current_setting('request.jwt.claims', true); v_w uuid; r jsonb;
BEGIN
  v_w := pg_temp.writer_for(nullif(v_sub,'')::uuid);
  PERFORM set_config('request.jwt.claim.sub', v_w::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','anima_system_writer','sub',v_w)::text, true);
  BEGIN
    r := public.record_verifier_opinion(a,b,c,d);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
    PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
  RETURN r;
END $w$;
GRANT EXECUTE ON FUNCTION pg_temp.record_verifier_opinion(a uuid, b integer, c uuid, d jsonb) TO authenticated, anon;
CREATE FUNCTION pg_temp.record_integration_completed(a uuid, b integer, c text, d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $w$
DECLARE v_sub text := current_setting('request.jwt.claim.sub', true); v_claims text := current_setting('request.jwt.claims', true); v_w uuid; r jsonb;
BEGIN
  v_w := pg_temp.writer_for(nullif(v_sub,'')::uuid);
  PERFORM set_config('request.jwt.claim.sub', v_w::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','anima_system_writer','sub',v_w)::text, true);
  BEGIN
    r := public.record_integration_completed(a,b,c,d);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
    PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
  RETURN r;
END $w$;
GRANT EXECUTE ON FUNCTION pg_temp.record_integration_completed(a uuid, b integer, c text, d jsonb) TO authenticated, anon;
CREATE TEMP TABLE ids(k text PRIMARY KEY, v text);
GRANT ALL ON ids TO authenticated;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT v::uuid FROM ids WHERE k=p $$;
CREATE FUNCTION pg_temp.receipt(p_over jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('kind','integration_effect',
    'operationKey',(SELECT payload->'data'->>'operation_key' FROM public.work_events WHERE event_type='integration_effect_authorized' AND payload->'data'->>'authorization_id'='auth-1'),
    'authorizationId','auth-1','workItemId',pg_temp.id('A'),'proposalVersion',1,'attemptId',pg_temp.id('att'),
    'acceptedResultEventId',pg_temp.id('res'),'resultCommitSha',repeat('b',40),'repositoryId','https://github.com/example/anima',
    'targetRef','refs/heads/dev','mode','merge_no_ff','previousTargetSha',repeat('c',40),
    'resultingTargetSha',repeat('d',40),'mergeCommitSha',repeat('d',40),'mergeParents',jsonb_build_array(repeat('c',40),repeat('b',40)),
    'observed',true,'disposition','effected') || p_over;
$$;
-- Receipt ff_only do item B: nenhum commit criado (mergeCommitSha nulo, mergeParents vazio, alvo = commit do resultado).
CREATE FUNCTION pg_temp.receipt_ff(p_over jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('kind','integration_effect',
    'operationKey',(SELECT payload->'data'->>'operation_key' FROM public.work_events WHERE event_type='integration_effect_authorized' AND payload->'data'->>'authorization_id'='auth-ff'),
    'authorizationId','auth-ff','workItemId',pg_temp.id('B'),'proposalVersion',1,'attemptId',pg_temp.id('attB'),
    'acceptedResultEventId',pg_temp.id('resB'),'resultCommitSha',repeat('b',40),'repositoryId','https://github.com/example/anima',
    'targetRef','refs/heads/dev','mode','ff_only','previousTargetSha',repeat('c',40),
    'resultingTargetSha',repeat('b',40),'mergeCommitSha',NULL::text,'mergeParents','[]'::jsonb,
    'observed',true,'disposition','effected') || p_over;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.receipt_ff(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.receipt(jsonb) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000000',true);
INSERT INTO ids SELECT 'A',(public.create_work_proposal('9b000000-0000-0000-0000-0000000000a1','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"ie-a"},"permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}',
  '{"schema_version":1,"data":{"summary":"x","objective":"o","included_scope":["a.ts"],"excluded_scope":["z"],"expected_effects":["e"],"risks":[]}}')).id::text;
INSERT INTO ids VALUES('att','9b000000-0000-0000-0000-00000000a0a0');
SELECT public.resolve_approval(pg_temp.id('A'),1,'approve','{}');
SELECT public.start_commanded_work_attempt(pg_temp.id('A'),1,pg_temp.id('att'),'worktree-v1');
SELECT public.record_commanded_work_terminal(pg_temp.id('A'),1,pg_temp.id('att'),jsonb_build_object('kind','result','workItemId',pg_temp.id('A'),
  'attemptId',pg_temp.id('att'),'approvedProposalVersion',1,'origin','executor','sequence',1,'summary','feito','resultReferences','[]'::jsonb,
  'validations','[]'::jsonb,'limitations','[]'::jsonb,'handoffReference','worktree:ie-a:anima-work/x',
  'worktreeHandoff',jsonb_build_object('commitSha',repeat('b',40),'attemptId',pg_temp.id('att'),'workItemId',pg_temp.id('A'),'approvedProposalVersion',1)));
INSERT INTO ids SELECT 'res', id::text FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type='result_submitted';

-- 14. autorização sem aceite (item em review) ⇒ recusada.
SELECT throws_ok($$SELECT public.authorize_integration_effect(pg_temp.id('A'),1,pg_temp.id('res'),'auth-1','https://github.com/example/anima','refs/heads/dev',repeat('c',40),'merge_no_ff')$$,
  '55000',NULL,'14. sem aceite (item não completed) ⇒ recusada');
SELECT public.review_work_result_versioned(pg_temp.id('A'),1,pg_temp.id('res'),'accept','{}');
SELECT is((SELECT state::text FROM public.work_items WHERE id=pg_temp.id('A')),'completed','aceito ⇒ completed');
-- 13. aceite sozinho não cria autorização nem integração.
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type IN ('integration_effect_authorized','integration_completed')),
  0::bigint,'13. aceite sozinho não autoriza nem integra');

-- 12/26. main e alvos arbitrários negados; modo fixo.
SELECT throws_ok($$SELECT public.authorize_integration_effect(pg_temp.id('A'),1,pg_temp.id('res'),'auth-x','https://github.com/example/anima','refs/heads/main',repeat('c',40),'merge_no_ff')$$,
  '22023','integration target not allowed','12. refs/heads/main negado');
SELECT throws_ok($$SELECT public.authorize_integration_effect(pg_temp.id('A'),1,pg_temp.id('res'),'auth-x','https://github.com/example/anima','origin/main',repeat('c',40),'merge_no_ff')$$,
  '22023','integration target not allowed','12. origin/main negado');
SELECT throws_ok($$SELECT public.authorize_integration_effect(pg_temp.id('A'),1,pg_temp.id('res'),'auth-x','https://github.com/example/anima','refs/heads/release',repeat('c',40),'merge_no_ff')$$,
  '22023','integration target not allowed','11. alvo fora da allowlist negado');
SELECT throws_ok($$SELECT public.authorize_integration_effect(pg_temp.id('A'),1,pg_temp.id('res'),'auth-x','https://github.com/example/anima','refs/heads/dev',repeat('c',40),'fast_forward')$$,
  '22023','integration mode not allowed','modo fora do V0 negado');
SELECT throws_ok($$SELECT public.authorize_integration_effect(pg_temp.id('A'),1,pg_temp.id('res'),'auth-x','https://github.com/example/anima','refs/heads/dev','HEAD','merge_no_ff')$$,
  '22023',NULL,'SHA-alvo esperado precisa ser SHA');
-- 3/4. resultado ou versão divergentes.
SELECT throws_ok($$SELECT public.authorize_integration_effect(pg_temp.id('A'),1,pg_temp.id('att'),'auth-x','https://github.com/example/anima','refs/heads/dev',repeat('c',40),'merge_no_ff')$$,
  '55000','accepted result changed','3. outro resultado ⇒ recusado');
SELECT throws_ok($$SELECT public.authorize_integration_effect(pg_temp.id('A'),2,pg_temp.id('res'),'auth-x','https://github.com/example/anima','refs/heads/dev',repeat('c',40),'merge_no_ff')$$,
  '55000',NULL,'4. versão divergente ⇒ recusada');

-- Autorização válida: commit/attempt DERIVADOS do handoff; author=user.
SELECT is((public.authorize_integration_effect(pg_temp.id('A'),1,pg_temp.id('res'),'auth-1','https://github.com/example/anima','refs/heads/dev',repeat('c',40),'merge_no_ff'))->>'result_commit_sha',
  repeat('b',40),'commit do resultado derivado do handoff persistido');
SELECT is((SELECT author::text FROM public.work_events WHERE event_type='integration_effect_authorized' AND payload->'data'->>'authorization_id'='auth-1'),
  'user','autorização é ato humano (author=user)');
SELECT is((public.authorize_integration_effect(pg_temp.id('A'),1,pg_temp.id('res'),'auth-1','https://github.com/example/anima','refs/heads/dev',repeat('c',40),'merge_no_ff'))->>'action',
  'replayed','autorização idempotente');
SELECT throws_ok($$SELECT public.authorize_integration_effect(pg_temp.id('A'),1,pg_temp.id('res'),'auth-1','https://github.com/example/anima','refs/heads/dev',repeat('e',40),'merge_no_ff')$$,
  '55000','integration effect authorization conflict','mesma autorização com SHA-alvo diferente ⇒ conflito');
SELECT is((SELECT state::text FROM public.work_items WHERE id=pg_temp.id('A')),'completed','autorização não muda o estado');

-- 16. integration_decided (V1) NÃO é autorização de merge.
RESET ROLE;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
VALUES(pg_temp.id('A'),'integration_decided','user',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
  'decision','authorize','decision_id','decided-1','accepted_result_event_id',pg_temp.id('res'),'attempt_id',pg_temp.id('att'))));
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('A'),1,'decided-1',pg_temp.receipt(jsonb_build_object('authorizationId','decided-1')))$$,
  'P0002','integration effect authorization not found','16. integration_decided não serve como autorização de merge');

-- 15/22. receipt que não reproduz a autorização ou o efeito esperado ⇒ recusado.
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt(jsonb_build_object('mergeParents',jsonb_build_array(repeat('b',40),repeat('c',40)))))$$,
  '55000','integration receipt mismatch','22. pais inesperados ⇒ recusado');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt(jsonb_build_object('targetRef','refs/heads/main')))$$,
  '55000','integration receipt mismatch','receipt com main ⇒ recusado');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt(jsonb_build_object('previousTargetSha',repeat('e',40))))$$,
  '55000','integration receipt mismatch','receipt com SHA anterior ≠ esperado ⇒ recusado');

-- Hardening pós-auditoria: disposition presente, não nula e ∈ {effected, reconciled} nos dois modos.
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt() - 'disposition')$$,
  '55000','integration receipt mismatch','H1. merge_no_ff: disposition ausente ⇒ recusado');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt(jsonb_build_object('disposition',NULL::text)))$$,
  '55000','integration receipt mismatch','H2. merge_no_ff: disposition JSON null ⇒ recusado');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt(jsonb_build_object('disposition','bogus')))$$,
  '55000','integration receipt mismatch','H3. merge_no_ff: disposition desconhecido ⇒ recusado');

-- Receipt exato ⇒ integration_completed (author=system); item continua completed.
SELECT is((pg_temp.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt()))->>'action','recorded','15. receipt exato persistido');
SELECT is((SELECT author::text FROM public.work_events WHERE event_type='integration_completed' AND work_item_id=pg_temp.id('A')),'system','receipt é do sistema');
-- 10/20. replay idempotente mesmo com disposição diferente (reconciliação); efeito divergente ⇒ conflito.
SELECT is((pg_temp.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt(jsonb_build_object('disposition','reconciled'))))->>'action',
  'replayed','10. replay idempotente por identidade do efeito');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt(jsonb_build_object('mergeCommitSha',repeat('f',40),'resultingTargetSha',repeat('f',40))))$$,
  '55000','integration receipt conflict','23. mesmo item com efeito divergente ⇒ conflito');

-- ─── V1: modo ff_only (item B, com o mesmo desenho do item A) ───────────────
-- Modo desconhecido segue negado (não há default nem aliases).
SELECT throws_ok($$SELECT public.authorize_integration_effect(pg_temp.id('A'),1,pg_temp.id('res'),'auth-x','https://github.com/example/anima','refs/heads/dev',repeat('c',40),'ff')$$,
  '22023','integration mode not allowed','V1. modo desconhecido (ff) negado');

INSERT INTO ids SELECT 'B',(public.create_work_proposal('9b000000-0000-0000-0000-0000000000a1','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"ie-b"},"permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}',
  '{"schema_version":1,"data":{"summary":"x","objective":"o","included_scope":["a.ts"],"excluded_scope":["z"],"expected_effects":["e"],"risks":[]}}')).id::text;
INSERT INTO ids VALUES('attB','9b000000-0000-0000-0000-00000000b0b0');
SELECT public.resolve_approval(pg_temp.id('B'),1,'approve','{}');
SELECT public.start_commanded_work_attempt(pg_temp.id('B'),1,pg_temp.id('attB'),'worktree-v1');
SELECT public.record_commanded_work_terminal(pg_temp.id('B'),1,pg_temp.id('attB'),jsonb_build_object('kind','result','workItemId',pg_temp.id('B'),
  'attemptId',pg_temp.id('attB'),'approvedProposalVersion',1,'origin','executor','sequence',1,'summary','feito','resultReferences','[]'::jsonb,
  'validations','[]'::jsonb,'limitations','[]'::jsonb,'handoffReference','worktree:ie-b:anima-work/y',
  'worktreeHandoff',jsonb_build_object('commitSha',repeat('b',40),'attemptId',pg_temp.id('attB'),'workItemId',pg_temp.id('B'),'approvedProposalVersion',1)));
INSERT INTO ids SELECT 'resB', id::text FROM public.work_events WHERE work_item_id=pg_temp.id('B') AND event_type='result_submitted';
SELECT public.review_work_result_versioned(pg_temp.id('B'),1,pg_temp.id('resB'),'accept','{}');

SELECT is((public.authorize_integration_effect(pg_temp.id('B'),1,pg_temp.id('resB'),'auth-ff','https://github.com/example/anima','refs/heads/dev',repeat('c',40),'ff_only'))->>'action',
  'recorded','V1. autorização ff_only gravada (modo congelado na autorização)');
SELECT is((public.authorize_integration_effect(pg_temp.id('B'),1,pg_temp.id('resB'),'auth-ff','https://github.com/example/anima','refs/heads/dev',repeat('c',40),'ff_only'))->>'action',
  'replayed','V1. autorização ff_only idempotente');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('B'),1,'auth-ff',pg_temp.receipt_ff(jsonb_build_object('mergeCommitSha',repeat('d',40))))$$,
  '55000','integration receipt mismatch','V1. receipt ff_only com merge commit inventado ⇒ recusado');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('B'),1,'auth-ff',pg_temp.receipt_ff(jsonb_build_object('mergeParents',jsonb_build_array(repeat('c',40),repeat('b',40)))))$$,
  '55000','integration receipt mismatch','V1. receipt ff_only com pais de merge ⇒ recusado');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('B'),1,'auth-ff',pg_temp.receipt_ff(jsonb_build_object('resultingTargetSha',repeat('d',40))))$$,
  '55000','integration receipt mismatch','V1. receipt ff_only com alvo resultante ≠ commit do resultado ⇒ recusado');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('B'),1,'auth-ff',pg_temp.receipt_ff(jsonb_build_object('mode','merge_no_ff')))$$,
  '55000','integration receipt mismatch','V1. receipt com modo ≠ modo autorizado ⇒ recusado');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('B'),1,'auth-ff',pg_temp.receipt_ff() - 'mergeCommitSha')$$,
  '55000','integration receipt mismatch','H4. ff_only: chave mergeCommitSha omitida ⇒ recusado');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('B'),1,'auth-ff',pg_temp.receipt_ff(jsonb_build_object('mergeCommitSha',repeat('b',40))))$$,
  '55000','integration receipt mismatch','H5. ff_only: mergeCommitSha string ⇒ recusado');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('B'),1,'auth-ff',pg_temp.receipt_ff() - 'disposition')$$,
  '55000','integration receipt mismatch','H6. ff_only: disposition ausente ⇒ recusado');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('B'),1,'auth-ff',pg_temp.receipt_ff(jsonb_build_object('disposition',NULL::text)))$$,
  '55000','integration receipt mismatch','H7. ff_only: disposition JSON null ⇒ recusado');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('B'),1,'auth-ff',pg_temp.receipt_ff(jsonb_build_object('disposition','bogus')))$$,
  '55000','integration receipt mismatch','H8. ff_only: disposition desconhecido ⇒ recusado');

SELECT is((pg_temp.record_integration_completed(pg_temp.id('B'),1,'auth-ff',pg_temp.receipt_ff()))->>'action',
  'recorded','V1. receipt ff_only exato persistido');
SELECT is((pg_temp.record_integration_completed(pg_temp.id('B'),1,'auth-ff',pg_temp.receipt_ff(jsonb_build_object('disposition','reconciled'))))->>'action',
  'replayed','V1. replay ff_only idempotente por identidade do efeito');

SELECT * FROM finish();
RESET ROLE;
ROLLBACK;
