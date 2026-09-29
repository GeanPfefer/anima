-- Trusted System Evidence Boundary V0 — a fronteira temporal só vale com EXCLUSIVIDADE de escrita.
-- Escrita direta por papel não-operador (SET ROLE <papel do JWT> + request.jwt.claims). A camada (b)
-- do guard — sessão de API dentro de função definer — só existe com session_user = authenticator
-- (PostgREST real); é provada ao vivo, fora do pgTAP (postgres não troca SESSION AUTHORIZATION).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(24);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('9d000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tseb-human@test.invalid','',now(),'{}','{}',now(),now()),
('9d000000-0000-0000-0000-0000000000ee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tseb-other@test.invalid','',now(),'{}','{}',now(),now()),
('9d000000-0000-0000-0000-00000000aaaa','00000000-0000-0000-0000-000000000000','authenticated','anima_system_writer','tseb-writer@test.invalid','',now(),'{}','{}',now(),now()),
('9d000000-0000-0000-0000-00000000cccc','00000000-0000-0000-0000-000000000000','authenticated','anima_system_writer','tseb-revoked@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES('9d000000-0000-0000-0000-0000000000a1','9d000000-0000-0000-0000-000000000000','user','a');
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('9d000000-0000-0000-0000-000000000000'),('9d000000-0000-0000-0000-0000000000ee');
-- Registro com created_at "antigo" pedido pelo operador: o servidor carimba now().
INSERT INTO private.trusted_system_writers(writer_user_id,owner_user_id,created_at) VALUES('9d000000-0000-0000-0000-00000000aaaa','9d000000-0000-0000-0000-000000000000','2020-01-01T00:00:00Z');
INSERT INTO private.trusted_system_writers(writer_user_id,owner_user_id,revoked_at) VALUES('9d000000-0000-0000-0000-00000000cccc','9d000000-0000-0000-0000-0000000000ee',now());

GRANT anima_system_writer TO postgres;
GRANT USAGE ON SCHEMA extensions TO anima_system_writer;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO anima_system_writer;
CREATE TEMP TABLE ids(k text PRIMARY KEY, v text);
GRANT ALL ON ids TO authenticated, anon, service_role, anima_system_writer;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT v::uuid FROM ids WHERE k=p $$;
CREATE FUNCTION pg_temp.hoe(p_item uuid, p_attempt uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('schemaVersion',1,'workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',1,
    'baseSha',repeat('b',40),'observedCommitSha',repeat('a',40),'observedChangedFiles',jsonb_build_array('src/a.ts'),
    'observedDiffSummary',jsonb_build_object('filesChanged',1,'insertions',3,'deletions',1,
      'files',jsonb_build_array(jsonb_build_object('path','src/a.ts','insertions',3,'deletions',1))),
    'observedAt','2026-08-15T10:00:00Z','coverage',jsonb_build_object('git',true,'gates',false));
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon, service_role, anima_system_writer;

-- Item com attempt governada (fixture em sessão de operador).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9d000000-0000-0000-0000-000000000000',true), set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','9d000000-0000-0000-0000-000000000000')::text,true);
INSERT INTO ids SELECT 'A',(public.create_work_proposal('9d000000-0000-0000-0000-0000000000a1','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"tseb-a"},"permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}',
  '{"schema_version":1,"data":{"summary":"x","objective":"o","included_scope":["src/a.ts"],"excluded_scope":["z"],"expected_effects":["e"],"risks":[]}}')).id::text;
INSERT INTO ids VALUES('att','9d000000-0000-0000-0000-00000000a0a0');
SELECT public.resolve_approval(pg_temp.id('A'),1,'approve','{}');
SELECT public.start_commanded_work_attempt(pg_temp.id('A'),1,pg_temp.id('att'),'worktree-v1');
RESET ROLE;
INSERT INTO ids SELECT 'started', id::text FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type='execution_started';

INSERT INTO ids SELECT 'since', greatest((SELECT activated_at FROM private.trusted_system_evidence_guard),
  (SELECT created_at FROM private.trusted_system_writers WHERE writer_user_id='9d000000-0000-0000-0000-00000000aaaa'))::text;
INSERT INTO ids SELECT 'guard', activated_at::text FROM private.trusted_system_evidence_guard;

-- 1–2. Registro do writer: created_at carimbado pelo servidor e imutável.
SELECT is((SELECT created_at FROM private.trusted_system_writers WHERE writer_user_id='9d000000-0000-0000-0000-00000000aaaa'),now(),'1. created_at do writer é carimbado (pedido 2020 ignorado)');
SELECT throws_ok($$UPDATE private.trusted_system_writers SET created_at=created_at-interval '1 day' WHERE writer_user_id='9d000000-0000-0000-0000-00000000aaaa'$$,'42501',NULL,'2. created_at do writer não retrocede (nem para o operador)');
SELECT throws_ok($$UPDATE private.trusted_system_writers SET revoked_at=NULL WHERE writer_user_id='9d000000-0000-0000-0000-00000000cccc'$$,'42501',NULL,'3. revogação não é desfeita');
SELECT throws_ok($$UPDATE private.trusted_system_writers SET owner_user_id='9d000000-0000-0000-0000-0000000000ee' WHERE writer_user_id='9d000000-0000-0000-0000-00000000aaaa'$$,'42501',NULL,'4. writer não troca de dono');

-- 5–9. service_role (bypass de RLS) NÃO forja fato reservado nem move tempo.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($$INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(pg_temp.id('A'),'host_observed_evidence_recorded','system',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',pg_temp.id('att'),'origin','host','evidence',pg_temp.hoe(pg_temp.id('A'),pg_temp.id('att')))))$$,
  '42501','trusted system writer required','5. service_role não grava evidência git direto');
SELECT throws_ok($$INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at)
  VALUES(pg_temp.id('A'),'verifier_opinion_recorded','system',1,'{"schema_version":1,"data":{}}','2099-01-01')$$,
  '42501','trusted system writer required','6. service_role não grava parecer do Verifier (nem com created_at futuro)');
SELECT throws_ok($$INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(pg_temp.id('A'),'host_observed_gate_evidence_recorded','system',1,'{"schema_version":1,"data":{}}')$$,
  '42501','trusted system writer required','7. service_role não grava gate');
SELECT throws_ok($$INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(pg_temp.id('A'),'host_observed_coder_evidence_recorded','system',1,'{"schema_version":1,"data":{}}')$$,
  '42501','trusted system writer required','8. service_role não grava coder');
SELECT throws_ok($$INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(pg_temp.id('A'),'integration_completed','system',1,'{"schema_version":1,"data":{}}')$$,
  '42501','trusted system writer required','9. service_role não grava receipt');
-- 10. JWT forjado com claim role=anima_system_writer mas papel service_role e sub sem registro.
SELECT set_config('request.jwt.claim.sub','9d000000-0000-0000-0000-0000000000ee',true), set_config('request.jwt.claims','{"role":"anima_system_writer","sub":"9d000000-0000-0000-0000-0000000000ee"}',true);
SELECT throws_ok($$INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(pg_temp.id('A'),'verifier_opinion_recorded','system',1,'{"schema_version":1,"data":{}}')$$,
  '42501','trusted system writer required','10. claim role sem writer registrado ⇒ recusado');
-- 11. Promoção por UPDATE: fato comum não vira fato reservado.
SELECT set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($$UPDATE public.work_events SET event_type='verifier_opinion_recorded' WHERE id=pg_temp.id('started')$$,'42501','trusted system fact is immutable','11. UPDATE não promove evento comum a fato reservado');

-- 12. Humano e anon: nenhum INSERT direto (sem grant) e RPC recusada.
RESET ROLE; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9d000000-0000-0000-0000-000000000000',true), set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','9d000000-0000-0000-0000-000000000000')::text,true);
SELECT throws_ok($$INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(pg_temp.id('A'),'host_observed_evidence_recorded','system',1,'{}')$$,'42501',NULL,'12. humano não insere fato reservado');
SELECT throws_ok($$SELECT public.record_host_observed_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hoe(pg_temp.id('A'),pg_temp.id('att')))$$,'42501',NULL,'13. humano não chama a RPC do writer');
-- 14–15. Fronteira do dono (humano) = greatest(ativação do guard, registro do writer ativo).
SELECT is(public.trusted_system_evidence_since(),(SELECT v::timestamptz FROM ids WHERE k='since'),
  '14. fronteira do dono derivada do registro do writer');
SELECT ok(public.trusted_system_evidence_since() >= (SELECT v::timestamptz FROM ids WHERE k='guard'),'15. fronteira nunca antes da ativação do guard');
-- 16. Dono cujo único writer está revogado ⇒ NULL.
SELECT set_config('request.jwt.claim.sub','9d000000-0000-0000-0000-0000000000ee',true), set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','9d000000-0000-0000-0000-0000000000ee')::text,true);
SELECT is(public.trusted_system_evidence_since(),NULL::timestamptz,'16. só writer revogado ⇒ fronteira NULL');
RESET ROLE; SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT throws_ok($$SELECT public.trusted_system_evidence_since()$$,'42501',NULL,'17. anon não lê fronteira');

-- 18–20. Writer revogado recusado; writer ativo grava pela RPC; created_at carimbado.
RESET ROLE; SET LOCAL ROLE anima_system_writer;
SELECT set_config('request.jwt.claim.sub','9d000000-0000-0000-0000-00000000cccc',true), set_config('request.jwt.claims',jsonb_build_object('role','anima_system_writer','sub','9d000000-0000-0000-0000-00000000cccc')::text,true);
SELECT throws_ok($$SELECT public.record_host_observed_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hoe(pg_temp.id('A'),pg_temp.id('att')))$$,'42501',NULL,'18. writer revogado recusado');
RESET ROLE; SET LOCAL ROLE anima_system_writer;
SELECT set_config('request.jwt.claim.sub','9d000000-0000-0000-0000-00000000aaaa',true), set_config('request.jwt.claims',jsonb_build_object('role','anima_system_writer','sub','9d000000-0000-0000-0000-00000000aaaa')::text,true);
SELECT is((public.record_host_observed_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hoe(pg_temp.id('A'),pg_temp.id('att'))))->>'action','recorded','19. writer registrado grava pela RPC');
SELECT throws_ok($$INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(pg_temp.id('A'),'host_observed_evidence_recorded','system',1,'{}')$$,'42501',NULL,'20. writer não insere direto na tabela (só RPC)');
RESET ROLE;
INSERT INTO ids SELECT 'git', id::text FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type='host_observed_evidence_recorded';

-- 21–22. Fato do writer é imutável para service_role (tempo e conteúdo).
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($$UPDATE public.work_events SET created_at=created_at-interval '30 days' WHERE id=pg_temp.id('git')$$,'42501','trusted system fact is immutable','21. service_role não retrocede created_at de fato reservado');
SELECT throws_ok($$UPDATE public.work_events SET payload='{}' WHERE id=pg_temp.id('git')$$,'42501','trusted system fact is immutable','22. service_role não altera fato reservado');
RESET ROLE;

SELECT is((SELECT author::text FROM public.work_events WHERE id=pg_temp.id('git')),'system','23. fato do writer com author=system');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type IN ('verifier_opinion_recorded','host_observed_gate_evidence_recorded','host_observed_coder_evidence_recorded','integration_completed')),0::bigint,'24. nenhuma tentativa não confiável deixou fato');

SELECT * FROM finish();
ROLLBACK;
