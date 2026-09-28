-- Completed → Integrated V0 — autorização humana do efeito e receipt persistido.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(23);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('9b000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ie@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-000000000000','user','a');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('9b000000-0000-0000-0000-000000000000');
RESET ROLE;
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
SELECT throws_ok($$SELECT public.record_integration_completed(pg_temp.id('A'),1,'decided-1',pg_temp.receipt(jsonb_build_object('authorizationId','decided-1')))$$,
  'P0002','integration effect authorization not found','16. integration_decided não serve como autorização de merge');

-- 15/22. receipt que não reproduz a autorização ou o efeito esperado ⇒ recusado.
SELECT throws_ok($$SELECT public.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt(jsonb_build_object('mergeParents',jsonb_build_array(repeat('b',40),repeat('c',40)))))$$,
  '55000','integration receipt mismatch','22. pais inesperados ⇒ recusado');
SELECT throws_ok($$SELECT public.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt(jsonb_build_object('targetRef','refs/heads/main')))$$,
  '55000','integration receipt mismatch','receipt com main ⇒ recusado');
SELECT throws_ok($$SELECT public.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt(jsonb_build_object('previousTargetSha',repeat('e',40))))$$,
  '55000','integration receipt mismatch','receipt com SHA anterior ≠ esperado ⇒ recusado');

-- Receipt exato ⇒ integration_completed (author=system); item continua completed.
SELECT is((public.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt()))->>'action','recorded','15. receipt exato persistido');
SELECT is((SELECT author::text FROM public.work_events WHERE event_type='integration_completed' AND work_item_id=pg_temp.id('A')),'system','receipt é do sistema');
-- 10/20. replay idempotente mesmo com disposição diferente (reconciliação); efeito divergente ⇒ conflito.
SELECT is((public.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt(jsonb_build_object('disposition','reconciled'))))->>'action',
  'replayed','10. replay idempotente por identidade do efeito');
SELECT throws_ok($$SELECT public.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt(jsonb_build_object('mergeCommitSha',repeat('f',40),'resultingTargetSha',repeat('f',40))))$$,
  '55000','integration receipt conflict','23. mesmo item com efeito divergente ⇒ conflito');

SELECT * FROM finish();
RESET ROLE;
ROLLBACK;
