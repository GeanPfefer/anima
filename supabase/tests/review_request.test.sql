BEGIN;CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;SELECT plan(17);
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)VALUES('e2000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','review-request@test.invalid','',now(),'{}','{}',now(),now());
SET LOCAL ROLE service_role;INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason)VALUES('e2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','review request proof');INSERT INTO public.ai_conversations(id,user_id,role,content)VALUES('e2000000-0000-0000-0000-0000000000c1','e2000000-0000-0000-0000-000000000001','user','create authorized review request');RESET ROLE;
SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claim.sub','e2000000-0000-0000-0000-000000000001',true);
SELECT lives_ok($$SELECT public.create_work_proposal('e2000000-0000-0000-0000-0000000000c1','low','programming','{"schema_version":1}','{"schema_version":1,"data":{"summary":"review","objective":"review","included_scope":["review"],"excluded_scope":[],"expected_effects":[],"risks":[]}}')$$,'item criado');
SELECT set_config('anima.item',(SELECT id::text FROM public.work_items WHERE source_message_id='e2000000-0000-0000-0000-0000000000c1'),true);
SET LOCAL ROLE service_role;UPDATE public.work_items SET state='completed' WHERE id=current_setting('anima.item')::uuid;
INSERT INTO public.work_events(id,work_item_id,event_type,author,proposal_version,payload)VALUES
('e2000000-0000-0000-0000-0000000000e1',current_setting('anima.item')::uuid,'result_submitted','executor',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id','attempt-1','executor_signal',jsonb_build_object('worktreeHandoff',jsonb_build_object('workItemId',current_setting('anima.item'),'attemptId','attempt-1','approvedProposalVersion',1,'branch','anima-work/attempt-1','baseSha',repeat('a',40),'commitSha',repeat('b',40)))))),
('e2000000-0000-0000-0000-0000000000e2',current_setting('anima.item')::uuid,'result_accepted','user',1,'{"schema_version":1,"data":{"accepted_result_event_id":"e2000000-0000-0000-0000-0000000000e1"}}'),
('e2000000-0000-0000-0000-0000000000e3',current_setting('anima.item')::uuid,'integration_decided','user',1,'{"schema_version":1,"data":{"attempt_id":"attempt-1","accepted_result_event_id":"e2000000-0000-0000-0000-0000000000e1","decision":"authorize","decision_id":"auth-1"}}');RESET ROLE;
SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claim.sub','e2000000-0000-0000-0000-000000000001',true);
SELECT set_config('anima.breceipt',jsonb_build_object('kind','branch_publication','receiptId','r1','idempotencyKey','integration-publication:auth-1:'||repeat('b',40)||':branch','providerId','git-branch-publication-v1','repositoryId','repo','remoteName','origin','remoteBranch','anima-work/attempt-1','commitSha',repeat('b',40),'baseBranch','main','verifiedBaseSha',repeat('a',40),'disposition','created')::text,true);
SELECT set_config('anima.rreceipt',jsonb_build_object('kind','review_request','receiptId','rr1','idempotencyKey','integration-publication:auth-1:'||repeat('b',40)||':review','providerId','git-branch-publication-v1','repositoryId','repo','remoteName','origin','reviewId','pr-1','reviewReference','https://example.invalid/pull/1','state','open','sourceBranch','anima-work/attempt-1','sourceCommitSha',repeat('b',40),'baseBranch','main','verifiedBaseSha',repeat('a',40),'disposition','created')::text,true);
-- Ordenação: review request ANTES de branch publicada é recusado fechado.
SELECT throws_ok($$SELECT public.record_review_request_created(current_setting('anima.item')::uuid,1,'auth-1',current_setting('anima.rreceipt')::jsonb)$$,'P0002','branch publication required before review request','review exige branch publicada antes');
-- Publica a branch (pré-condição real).
SELECT lives_ok($$SELECT public.record_branch_published(current_setting('anima.item')::uuid,1,'auth-1',current_setting('anima.breceipt')::jsonb)$$,'branch publicada como pré-condição');
-- Autorização exata exigida.
SELECT throws_ok($$SELECT public.record_review_request_created(current_setting('anima.item')::uuid,1,'wrong',current_setting('anima.rreceipt')::jsonb)$$,'P0002','integration authorization not found','autorização exata exigida');
-- Receipt correto persiste.
SELECT lives_ok($$SELECT public.record_review_request_created(current_setting('anima.item')::uuid,1,'auth-1',current_setting('anima.rreceipt')::jsonb)$$,'receipt de review correto persiste');
SELECT is((SELECT count(*)::int FROM public.work_events WHERE work_item_id=current_setting('anima.item')::uuid AND event_type='review_request_created'),1,'um evento de review persistido');
SELECT is((SELECT payload->'data'->'receipt'->>'sourceCommitSha' FROM public.work_events WHERE work_item_id=current_setting('anima.item')::uuid AND event_type='review_request_created'),repeat('b',40),'source commit exato persistido');
-- Replay idempotente.
SELECT lives_ok($$SELECT public.record_review_request_created(current_setting('anima.item')::uuid,1,'auth-1',current_setting('anima.rreceipt')::jsonb)$$,'replay idempotente');
SELECT is((SELECT count(*)::int FROM public.work_events WHERE work_item_id=current_setting('anima.item')::uuid AND event_type='review_request_created'),1,'replay não duplica');
-- Commit divergente do handoff/branch é recusado.
SELECT throws_ok($$SELECT public.record_review_request_created(current_setting('anima.item')::uuid,1,'auth-1',jsonb_set(current_setting('anima.rreceipt')::jsonb,'{sourceCommitSha}',to_jsonb(repeat('c',40))))$$,'55000','review request receipt mismatch','source commit divergente recusado');
-- Source branch divergente é recusada.
SELECT throws_ok($$SELECT public.record_review_request_created(current_setting('anima.item')::uuid,1,'auth-1',jsonb_set(current_setting('anima.rreceipt')::jsonb,'{sourceBranch}',to_jsonb('main'::text)))$$,'55000','review request receipt mismatch','source branch divergente recusada');
-- Receipt que casa o handoff/branch porém difere do persistido num campo não fixado
-- (reviewId) não é replay: conflita.
SELECT throws_ok($$SELECT public.record_review_request_created(current_setting('anima.item')::uuid,1,'auth-1',jsonb_set(current_setting('anima.rreceipt')::jsonb,'{reviewId}',to_jsonb('pr-outro'::text)))$$,'55000','review request receipt conflict','receipt validado porém divergente do persistido conflita');
-- Versão de proposta divergente recusada fechado.
SELECT throws_ok($$SELECT public.record_review_request_created(current_setting('anima.item')::uuid,2,'auth-1',current_setting('anima.rreceipt')::jsonb)$$,'55000','work item state or proposal version changed','versão de proposta divergente recusada');
-- Input inválido barra antes de qualquer leitura de fato ou efeito.
SELECT throws_ok($$SELECT public.record_review_request_created(current_setting('anima.item')::uuid,0,'auth-1',current_setting('anima.rreceipt')::jsonb)$$,'22023','invalid review request input','versão inválida recusada antes de qualquer efeito');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item')::uuid),'completed','estado permanece completed');
SELECT is((SELECT count(*)::int FROM public.work_events WHERE work_item_id=current_setting('anima.item')::uuid AND event_type::text IN('merged','integrated')),0,'não faz merge nem integrated');
-- Isolamento por dono: segundo usuário allowlistado não cria review do item alheio.
RESET ROLE;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)VALUES('e2000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','review-request-intruder@test.invalid','',now(),'{}','{}',now(),now());
SET LOCAL ROLE service_role;INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason)VALUES('e2000000-0000-0000-0000-000000000002','e2000000-0000-0000-0000-000000000002','intruso allowlistado');RESET ROLE;
SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claim.sub','e2000000-0000-0000-0000-000000000002',true);
SELECT throws_ok($$SELECT public.record_review_request_created(current_setting('anima.item')::uuid,1,'auth-1',current_setting('anima.rreceipt')::jsonb)$$,'P0002','work item not found','segundo usuário allowlistado não cria review do item alheio');
SELECT * FROM finish();ROLLBACK;
