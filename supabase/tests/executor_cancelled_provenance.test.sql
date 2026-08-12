-- Proveniência do cancelamento originado pelo executor: `work_cancelled` gravado
-- por `record_commanded_work_terminal` a partir de um terminal `cancelled` do
-- executor tem `author=executor` e `reason=execution_cancelled` — nunca `user`,
-- que é reservado ao cancelamento humano explícito em checkpoint.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('90000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cancel-runner@test.invalid','',now(),'{}','{}',now(),now());
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
SELECT public.start_commanded_work_attempt((SELECT id FROM item),1,'90000000-0000-0000-0000-000000000002','local-runner-v1');

CREATE TEMP TABLE terminal AS SELECT jsonb_build_object(
  'kind','cancelled','workItemId',(SELECT id FROM item),'attemptId','90000000-0000-0000-0000-000000000002',
  'approvedProposalVersion',1,'origin','executor','sequence',1,'acknowledged',true,
  'handoffReference','checkpoint:runner-cancelled') signal;

SELECT is((public.record_commanded_work_terminal((SELECT id FROM item),1,'90000000-0000-0000-0000-000000000002',(SELECT signal FROM terminal))).state,'cancelled','cancelamento do executor leva o item a cancelled');
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='work_cancelled'),'executor','autoria do cancelamento do executor é executor, não user');
SELECT is((SELECT payload->'data'->>'reason' FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='work_cancelled'),'execution_cancelled','razão persistida é execution_cancelled');
SELECT is((SELECT payload->'data'->>'origin' FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='work_cancelled'),'executor','origem persistida é executor');
SELECT lives_ok($$SELECT public.record_commanded_work_terminal((SELECT id FROM item),1,'90000000-0000-0000-0000-000000000002',(SELECT signal FROM terminal))$$,'terminal de cancelamento é idempotente');

SELECT * FROM finish();
RESET ROLE;
ROLLBACK;
