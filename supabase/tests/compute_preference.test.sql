BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(13);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('95000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','compute-preference@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
VALUES('95000000-0000-0000-0000-000000000011','95000000-0000-0000-0000-000000000001','user','prefer compute');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('95000000-0000-0000-0000-000000000001');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000001',true);
CREATE TEMP TABLE target AS SELECT (public.create_work_proposal(
  '95000000-0000-0000-0000-000000000011','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}',
  '{"schema_version":1,"data":{"summary":"pref","objective":"prefer","included_scope":["a"],"excluded_scope":["deploy"],"expected_effects":["ok"],"risks":[]}}')).id;
SELECT public.resolve_approval(id,1,'approve','{}') FROM target;

CREATE TEMP TABLE sol AS SELECT '{"schemaVersion":1,"strategy":"provider_api","provider":"openai","model":"gpt-5.6-sol"}'::jsonb AS p;

SELECT is((public.record_compute_preference((SELECT id FROM target),1,'{"schemaVersion":1,"strategy":"router_default"}'))->>'action',
  'replayed','router_default sem escolha vigente não anexa evento');
SELECT is((public.record_compute_preference((SELECT id FROM target),1,(SELECT p FROM sol)))->>'action','recorded','registra provider_api em approved');
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=(SELECT id FROM target) AND event_type='compute_preference_recorded'),
  'user','autoria é humana');
SELECT is((SELECT payload->'data'->'preference' FROM public.work_events WHERE work_item_id=(SELECT id FROM target) AND event_type='compute_preference_recorded'),
  (SELECT p FROM sol),'payload guarda a preferência normalizada');
SELECT is((public.record_compute_preference((SELECT id FROM target),1,(SELECT p FROM sol)))->>'action','replayed','mesma preferência vigente é replay');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM target) AND event_type='compute_preference_recorded'),
  1::bigint,'replay não duplica evento');
SELECT throws_ok($$SELECT public.record_compute_preference((SELECT id FROM target),1,'{"schemaVersion":1,"strategy":"provider_api","provider":"ollama","model":"qwen"}')$$,
  '22023','invalid compute preference','provider fora da estratégia é recusado');
SELECT throws_ok($$SELECT public.record_compute_preference((SELECT id FROM target),1,'{"schemaVersion":1,"strategy":"provider_api","provider":"openai","model":"gpt; drop"}')$$,
  '22023','invalid compute preference','modelo malformado é recusado');
SELECT throws_ok($$SELECT public.record_compute_preference((SELECT id FROM target),1,'{"schemaVersion":1,"strategy":"provider_api","provider":"openai","model":"gpt-5.6-sol","maxUsd":3}')$$,
  '22023','invalid compute preference','preferência não carrega dinheiro');
SELECT throws_ok($$SELECT public.record_compute_preference((SELECT id FROM target),2,(SELECT p FROM sol))$$,
  '55000','work item state or version changed','versão divergente é recusada');
SELECT is((public.record_compute_preference((SELECT id FROM target),1,'{"schemaVersion":1,"strategy":"router_default"}'))->>'action','recorded','router_default limpa a escolha vigente');
SELECT is((SELECT count(*) FROM public.paid_compute_authorizations WHERE work_item_id=(SELECT id FROM target)),0::bigint,'nenhuma authority paga criada');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM target) AND event_type IN ('execution_started','work_started')),0::bigint,'preferência não inicia execução');

SELECT * FROM finish();
ROLLBACK;
