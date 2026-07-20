BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('90000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','runner@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000000','user','execute');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('90000000-0000-0000-0000-000000000000');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000000',true);
CREATE TEMP TABLE item AS SELECT (public.create_work_proposal('90000000-0000-0000-0000-000000000001','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}',
  '{"schema_version":1,"data":{"summary":"x","objective":"corrigir","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}')).id;
SELECT public.resolve_approval((SELECT id FROM item),1,'approve','{}');
SELECT is((public.start_commanded_work_attempt((SELECT id FROM item),1,'90000000-0000-0000-0000-000000000002','local-runner-v1')).state,'in_progress','inicia atomicamente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='execution_started'),1::bigint,'um início');
SELECT lives_ok($$SELECT public.start_commanded_work_attempt((SELECT id FROM item),1,'90000000-0000-0000-0000-000000000002','local-runner-v1')$$,'início idempotente');
SELECT throws_ok($$SELECT public.start_commanded_work_attempt((SELECT id FROM item),1,'90000000-0000-0000-0000-000000000002','outro')$$,'55000','attempt correlation conflict','conflito falha fechado');
CREATE TEMP TABLE terminal AS SELECT jsonb_build_object('kind','result','workItemId',(SELECT id FROM item),'attemptId','90000000-0000-0000-0000-000000000002','approvedProposalVersion',1,'origin','executor','sequence',1,'summary','feito','resultReferences',jsonb_build_array('runner-evidence:x.json'),'validations',jsonb_build_array(jsonb_build_object('label','tests','outcome','passed')),'limitations',jsonb_build_array('não aplicado'),'handoffReference','local-runner:anima:x.zip:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') signal;
SELECT is((public.record_commanded_work_terminal((SELECT id FROM item),1,'90000000-0000-0000-0000-000000000002',(SELECT signal FROM terminal))).state,'review','resultado vai para revisão');
SELECT is((SELECT payload->'data'->>'attempt_id' FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='result_submitted'),'90000000-0000-0000-0000-000000000002','correlação persistida');
SELECT is((SELECT payload->'data'->>'origin' FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='result_submitted'),'executor','origem persistida');
SELECT lives_ok($$SELECT public.record_commanded_work_terminal((SELECT id FROM item),1,'90000000-0000-0000-0000-000000000002',(SELECT signal FROM terminal))$$,'terminal idempotente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='result_submitted'),1::bigint,'sem duplicação');
SELECT throws_ok($$SELECT public.record_commanded_work_terminal((SELECT id FROM item),1,'90000000-0000-0000-0000-000000000002',(SELECT signal||'{"summary":"divergente"}' FROM terminal))$$,'55000','attempt already finished with different signal','terminal divergente recusado');
SELECT * FROM finish();
RESET ROLE;
ROLLBACK;
