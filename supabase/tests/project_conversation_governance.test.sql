BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(31);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('dc000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','project-decision-owner@test.invalid','',now(),'{}','{}',now(),now()),
('dc000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','project-decision-intruder@test.invalid','',now(),'{}','{}',now(),now());
SELECT set_config('anima.work_count',(SELECT count(*)::text FROM public.work_items),true);
SELECT set_config('anima.focus_count',(SELECT count(*)::text FROM public.work_focus),true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($$SELECT public.create_project_decision_proposal('Manter local como preferência','', '[]','[]','[]','[]','{"source":"human_expression"}','unauth-key-01')$$,'42501','authentication required','sem identidade não cria proposta');

SELECT set_config('request.jwt.claim.sub','dc000000-0000-4000-8000-000000000001',true);
SELECT lives_ok($$SELECT public.create_project_decision_proposal('Manter execução local como preferência e usar cloud somente quando necessário.','Preferência expressa pelo usuário','["governança de custo"]','["cloud é exceção"]','["cloud sempre"]','["limiar exato em aberto"]','{"source":"human_expression","authority":"user_preference"}','proposal-key-a1')$$,'proposta é criada sob a conta real');
SELECT set_config('anima.a',(SELECT id::text FROM public.project_decision_proposals WHERE idempotency_key='proposal-key-a1'),true);
SELECT is((SELECT count(*)::int FROM public.project_decision_proposals WHERE id=current_setting('anima.a')::uuid),1,'uma proposta imutável existe');
SELECT is((SELECT count(*)::int FROM public.project_decision_events WHERE proposal_id=current_setting('anima.a')::uuid),1,'proposal_created é append-only');
SELECT is((SELECT status FROM public.project_decision_proposal_state WHERE id=current_setting('anima.a')::uuid),'awaiting_confirmation','proposta aguarda confirmação');
SELECT is((SELECT provenance->>'source' FROM public.project_decision_proposals WHERE id=current_setting('anima.a')::uuid),'human_expression','proveniência humana é preservada');
SELECT lives_ok($$SELECT public.create_project_decision_proposal('Manter execução local como preferência e usar cloud somente quando necessário.','Preferência expressa pelo usuário','[]','[]','[]','[]','{"source":"human_expression"}','proposal-key-a1')$$,'retry da criação é idempotente');
SELECT is((SELECT count(*)::int FROM public.project_decision_proposals WHERE idempotency_key='proposal-key-a1'),1,'retry não duplica proposta');
SELECT throws_ok($$INSERT INTO public.project_decision_events(proposal_id,user_id,proposal_version,event_type,actor,idempotency_key,provenance) VALUES(current_setting('anima.a')::uuid,'dc000000-0000-4000-8000-000000000001',1,'ratified','user','direct-write','{}')$$,'42501',NULL,'cliente não insere evento diretamente');

SELECT set_config('request.jwt.claim.sub','dc000000-0000-4000-8000-000000000002',true);
SELECT is((SELECT count(*)::int FROM public.project_decision_proposals),0,'RLS oculta propostas de outra conta');
SELECT is((SELECT count(*)::int FROM public.project_decision_events),0,'RLS oculta eventos de outra conta');
SELECT throws_ok(format('SELECT public.resolve_project_decision_proposal(%L,1,''ratified'',''intruder-key-01'',''{"source":"human_confirmation"}'')',current_setting('anima.a')),'P0002','proposal not found','outra conta não ratifica');

SELECT set_config('request.jwt.claim.sub','dc000000-0000-4000-8000-000000000001',true);
SELECT throws_ok(format('SELECT public.resolve_project_decision_proposal(%L,2,''ratified'',''ratify-a-wrong'',''{"source":"human_confirmation"}'')',current_setting('anima.a')),'55000','proposal version changed','versão divergente falha fechado');
SELECT lives_ok(format('SELECT public.resolve_project_decision_proposal(%L,1,''ratified'',''ratify-a-key1'',''{"source":"human_confirmation","actor":"user"}'')',current_setting('anima.a')),'confirmação humana ratifica');
SELECT is((SELECT status FROM public.project_decision_proposal_state WHERE id=current_setting('anima.a')::uuid),'ratified','estado derivado é ratified');
SELECT is((SELECT actor FROM public.project_decision_events WHERE proposal_id=current_setting('anima.a')::uuid AND event_type='ratified'),'user','actor é humano derivado pelo host');
SELECT lives_ok(format('SELECT public.resolve_project_decision_proposal(%L,1,''ratified'',''ratify-a-key1'',''{"source":"human_confirmation","actor":"user"}'')',current_setting('anima.a')),'retry da confirmação é idempotente');
SELECT is((SELECT count(*)::int FROM public.project_decision_events WHERE proposal_id=current_setting('anima.a')::uuid AND event_type='ratified'),1,'duplo clique não duplica ratificação');
SELECT throws_ok(format('SELECT public.resolve_project_decision_proposal(%L,1,''rejected'',''other-resolution'',''{"source":"human_confirmation"}'')',current_setting('anima.a')),'55000','proposal already resolved','concorrente tardio falha fechado');

SELECT lives_ok($$SELECT public.create_project_decision_proposal('Adotar cloud como padrão para toda execução futura.','','[]','[]','[]','[]','{"source":"human_expression"}','proposal-key-b1')$$,'segunda proposta é criada');
SELECT set_config('anima.b',(SELECT id::text FROM public.project_decision_proposals WHERE idempotency_key='proposal-key-b1'),true);
SELECT lives_ok(format('SELECT public.resolve_project_decision_proposal(%L,1,''rejected'',''reject-b-key1'',''{"source":"human_confirmation"}'')',current_setting('anima.b')),'rejeição é registrada');
SELECT is((SELECT status FROM public.project_decision_proposal_state WHERE id=current_setting('anima.b')::uuid),'rejected','rejeição não ratifica');

SELECT lives_ok($$SELECT public.create_project_decision_proposal('Permitir cloud sem limite de custo quando local estiver ocupado.','','[]','[]','[]','[]','{"source":"human_expression"}','proposal-key-c1')$$,'proposta revisável é criada');
SELECT set_config('anima.c',(SELECT id::text FROM public.project_decision_proposals WHERE idempotency_key='proposal-key-c1'),true);
SELECT lives_ok(format('SELECT public.resolve_project_decision_proposal(%L,1,''changes_requested'',''change-c-key1'',''{"source":"human_confirmation"}'')',current_setting('anima.c')),'pedido de revisão não ratifica');
SELECT is((SELECT status FROM public.project_decision_proposal_state WHERE id=current_setting('anima.c')::uuid),'changes_requested','versão antiga pede mudanças');
SELECT lives_ok(format('SELECT public.create_project_decision_proposal(''Permitir cloud somente com limite explícito de custo.'','''',''[]'',''[]'',''[]'',''[]'',''{"source":"human_expression"}'',''proposal-key-c2'',%L)',current_setting('anima.c')),'nova versão supersede semanticamente a antiga');
SELECT is((SELECT version FROM public.project_decision_proposals WHERE idempotency_key='proposal-key-c2'),2,'revisão incrementa versão');
SELECT throws_ok(format('SELECT public.resolve_project_decision_proposal(%L,1,''ratified'',''late-c-key1'',''{"source":"human_confirmation"}'')',current_setting('anima.c')),'55000','proposal already resolved','versão antiga não pode ser confirmada');
SELECT throws_ok($$SELECT public.create_project_decision_proposal('Provider tenta decidir pelo usuário','','[]','[]','[]','[]','{"source":"model_inference"}','provider-key-01')$$,'22023','invalid decision proposal','recomendação do provider não vira preferência humana');

RESET ROLE;
SELECT is((SELECT count(*)::text FROM public.work_items),current_setting('anima.work_count'),'ratificação não cria work_item');
SELECT is((SELECT count(*)::text FROM public.work_focus),current_setting('anima.focus_count'),'ratificação não altera foco');
SELECT * FROM finish();
ROLLBACK;
