BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(31);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('bd000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','backlog-owner@test.invalid','',now(),'{}','{}',now(),now()),
('bd000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','backlog-intruder@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO private.work_orchestration_allowlist(user_id,reason) VALUES('bd000000-0000-4000-8000-000000000001','pgTAP backlog proposal');
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('bd100000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000001','user','Eu prefiro execução local e cloud somente quando necessária.'),
('bd100000-0000-4000-8000-000000000002','bd000000-0000-4000-8000-000000000001','user','Pode registrar esses trabalhos no backlog.'),
('bd100000-0000-4000-8000-000000000003','bd000000-0000-4000-8000-000000000001','user','Não quero provisioning automático ainda.');
SELECT set_config('anima.work_count',(SELECT count(*)::text FROM public.work_items WHERE user_id='bd000000-0000-4000-8000-000000000001'),true);
SELECT set_config('anima.event_count',(SELECT count(*)::text FROM public.work_events),true);
SELECT set_config('anima.focus_count',(SELECT count(*)::text FROM public.work_focus WHERE user_id='bd000000-0000-4000-8000-000000000001'),true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000001',true);
SELECT public.create_project_decision_proposal('Preferir execução local e usar cloud somente quando necessário.','','[]','[]','[]','[]','{"source":"human_expression","source_message_id":"bd100000-0000-4000-8000-000000000001"}','decision-backlog-01');
SELECT set_config('anima.decision',(SELECT id::text FROM public.project_decision_proposals WHERE idempotency_key='decision-backlog-01'),true);
SELECT throws_ok(format('SELECT public.create_project_backlog_proposal(%L,1,''Implementar local-first'',''[]'','''',''[]'',''[]'',''{"source":"system_derivation"}'',''backlog-before-ratified'')',current_setting('anima.decision')),'P0002','ratified decision not found','decisão não ratificada não gera proposal materializável');
SELECT public.resolve_project_decision_proposal(current_setting('anima.decision')::uuid,1,'ratified','ratify-backlog-01','{"source":"human_confirmation"}');

SELECT set_config('anima.slices',$$[
 {"slice_key":"node-inventory","summary":"Representar nós disponíveis","impact_level":"structural","capability":"programming","dependencies":[],"intent":{"kind":"project_work"},"proposal":{"schema_version":1,"data":{"summary":"Representar nós disponíveis","objective":"Modelar capacidade local e remota sem provisionar","included_scope":["packages/core/src"],"excluded_scope":["infra"],"expected_effects":["Inventário tipado"],"risks":["Modelo prematuro"]}}},
 {"slice_key":"local-first-routing","summary":"Decidir local-first por capacidade","impact_level":"structural","capability":"programming","dependencies":["node-inventory"],"intent":{"kind":"project_work"},"proposal":{"schema_version":1,"data":{"summary":"Decidir local-first por capacidade","objective":"Escolher local ou remoto sem provisioning","included_scope":["packages/core/src"],"excluded_scope":["infra"],"expected_effects":["Roteamento provável"],"risks":["Telemetria incompleta"]}}}
]$$,true);
SELECT lives_ok(format('SELECT public.create_project_backlog_proposal(%L,1,''Aplicar preferência local-first com cloud sob necessidade'',%L,''Decomposição causal'',''["auto-provisioning"]'',''["limiar de capacidade"]'',''{"source":"system_derivation","authority":"advisory"}'',''backlog-proposal-v1'')',current_setting('anima.decision'),current_setting('anima.slices')),'decisão ratificada pode gerar proposal');
SELECT set_config('anima.proposal',(SELECT id::text FROM public.project_backlog_proposals WHERE idempotency_key='backlog-proposal-v1'),true);
SELECT is((SELECT status FROM public.project_backlog_proposal_state WHERE id=current_setting('anima.proposal')::uuid),'awaiting_confirmation','proposal aguarda confirmação');
SELECT is((SELECT version FROM public.project_backlog_proposals WHERE id=current_setting('anima.proposal')::uuid),1,'proposal começa na versão 1');
SELECT is((SELECT count(*)::text FROM public.work_items),current_setting('anima.work_count'),'proposal não cria work_item');
SELECT is((SELECT provenance->>'source' FROM public.project_backlog_proposals WHERE id=current_setting('anima.proposal')::uuid),'system_derivation','autoria do sistema é honesta');
SELECT throws_ok(format('SELECT public.create_project_backlog_proposal(%L,1,''Proposta com spec inválida'',replace(%L,''{"kind":"project_work"}'',''{"kind":"project_work","execution_spec":{}}'')::jsonb,'''',''[]'',''[]'',''{"source":"system_derivation"}'',''invalid-execution-spec'')',current_setting('anima.decision'),current_setting('anima.slices')),'23514',NULL,'execution_spec inválido falha fechado');
SELECT lives_ok(format('SELECT public.request_project_backlog_proposal_changes(%L,1,''bd100000-0000-4000-8000-000000000003'',''backlog-change-v1'',''Não quero provisioning automático ainda.'')',current_setting('anima.proposal')),'usuário pede revisão');
SELECT is((SELECT status FROM public.project_backlog_proposal_state WHERE id=current_setting('anima.proposal')::uuid),'changes_requested','versão antiga fica changes_requested');
SELECT throws_ok(format('SELECT public.materialize_project_backlog_proposal(%L,1,''bd100000-0000-4000-8000-000000000002'',''materialize-old-v1'',''{"source":"human_confirmation"}'')',current_setting('anima.proposal')),'55000','backlog proposal is not current','versão antiga não materializa');
SELECT lives_ok(format('SELECT public.create_project_backlog_proposal(%L,1,''Aplicar preferência local-first sem provisioning'',%L,''Revisada'',''["auto-provisioning"]'',''[]'',''{"source":"system_derivation"}'',''backlog-proposal-v2'',%L)',current_setting('anima.decision'),current_setting('anima.slices'),current_setting('anima.proposal')),'revisão cria nova proposta');
SELECT set_config('anima.v2',(SELECT id::text FROM public.project_backlog_proposals WHERE idempotency_key='backlog-proposal-v2'),true);
SELECT is((SELECT version FROM public.project_backlog_proposals WHERE id=current_setting('anima.v2')::uuid),2,'revisão incrementa versão');

SELECT set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000002',true);
SELECT is((SELECT count(*)::int FROM public.project_backlog_proposals),0,'RLS oculta proposals de outro usuário');
SELECT is((SELECT count(*)::int FROM public.project_backlog_events),0,'RLS oculta eventos de outro usuário');
SELECT throws_ok(format('SELECT public.materialize_project_backlog_proposal(%L,2,''bd100000-0000-4000-8000-000000000002'',''intruder-materialize'',''{"source":"human_confirmation"}'')',current_setting('anima.v2')),'P0002','backlog proposal not found','outro usuário não materializa');

SELECT set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000001',true);
SELECT throws_ok(format('SELECT public.materialize_project_backlog_proposal(%L,1,''bd100000-0000-4000-8000-000000000002'',''wrong-version-materialize'',''{"source":"human_confirmation"}'')',current_setting('anima.v2')),'55000','backlog proposal is not current','versão divergente falha fechado');
SELECT lives_ok(format('SELECT public.materialize_project_backlog_proposal(%L,2,''bd100000-0000-4000-8000-000000000002'',''materialize-v2-key'',''{"source":"human_confirmation","actor":"user"}'')',current_setting('anima.v2')),'confirmação inequívoca materializa atomicamente');
SELECT is((SELECT status FROM public.project_backlog_proposal_state WHERE id=current_setting('anima.v2')::uuid),'materialized','estado final é materialized');
SELECT is((SELECT count(*)::int FROM public.project_backlog_materialized_items WHERE proposal_id=current_setting('anima.v2')::uuid),2,'dois slices produzem dois itens');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE intent->'backlog_provenance'->>'backlog_proposal_id'=current_setting('anima.v2')),2,'proveniência liga proposal aos itens');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE intent->'backlog_provenance'->>'source_decision_id'=current_setting('anima.decision')),2,'proveniência liga decisão aos itens');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE intent->'backlog_provenance'->>'materialization_confirmation_message_id'='bd100000-0000-4000-8000-000000000002'),2,'proveniência liga confirmação humana aos itens');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE intent ? 'backlog_provenance' AND state='proposed'),2,'todos os itens nascem proposed');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE intent ? 'backlog_provenance' AND state IN ('approved','in_progress')),0,'nenhum item nasce aprovado ou em progresso');
SELECT is((SELECT dependencies FROM public.project_backlog_materialized_items WHERE proposal_id=current_setting('anima.v2')::uuid AND slice_key='local-first-routing'),'["node-inventory"]'::jsonb,'dependência é preservada');
SELECT lives_ok(format('SELECT public.materialize_project_backlog_proposal(%L,2,''bd100000-0000-4000-8000-000000000002'',''materialize-v2-key'',''{"source":"human_confirmation","actor":"user"}'')',current_setting('anima.v2')),'retry HTTP é idempotente');
SELECT is((SELECT count(*)::int FROM public.project_backlog_materialized_items WHERE proposal_id=current_setting('anima.v2')::uuid),2,'retry não duplica itens');
SELECT is((SELECT count(*)::int FROM public.project_backlog_events WHERE proposal_id=current_setting('anima.v2')::uuid AND event_type='materialization_confirmed'),1,'replay não duplica confirmação');
SELECT throws_ok(format('SELECT public.materialize_project_backlog_proposal(%L,2,''bd100000-0000-4000-8000-000000000003'',''materialize-v2-key'',''{"source":"human_confirmation"}'')',current_setting('anima.v2')),'55000','materialization idempotency conflict','payload divergente com mesma chave falha fechado');
SELECT is((SELECT count(*)::text FROM public.work_focus WHERE user_id='bd000000-0000-4000-8000-000000000001'),current_setting('anima.focus_count'),'materialização não altera work_focus');
SELECT is((SELECT count(*)::int FROM public.work_events e JOIN public.work_items w ON w.id=e.work_item_id WHERE w.intent ? 'backlog_provenance' AND e.event_type IN ('work_approved','work_started','execution_started')),0,'nenhuma aprovação ou execução é iniciada');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
