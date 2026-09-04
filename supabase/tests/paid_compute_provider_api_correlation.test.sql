-- Correlação autoritativa + proibição de wildcard para compute pago provider_api (20260904000000).
--
-- Prova que o RESERVE provider_api exige correlação real attempt ↔ work item ↔ proposal version
-- e estado de execução, e que o GRANT provider_api recusa autoridade ampla (wildcard). Nodes
-- pagos comuns (resource_class != provider_api:*) seguem inalterados (regressão).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('cd000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','provider-api-correlation@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('cd000000-0000-0000-0000-000000000011','cd000000-0000-0000-0000-000000000001','user','provar correlação provider_api'),
('cd000000-0000-0000-0000-000000000012','cd000000-0000-0000-0000-000000000001','user','item aprovado sem attempt');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('cd000000-0000-0000-0000-000000000001');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cd000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

-- Item A: aprovado E em execução (attempt real com execution_started).
CREATE TEMP TABLE item_a AS SELECT (public.create_work_proposal(
  'cd000000-0000-0000-0000-000000000011','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"corr-proof"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'::jsonb,
  '{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["src/a.ts"],"excluded_scope":["deploy"],"expected_effects":["ok"],"risks":[]}}'::jsonb
)).id;
SELECT public.resolve_approval((SELECT id FROM item_a),1,'approve','{}');
SELECT public.start_commanded_work_attempt((SELECT id FROM item_a),1,'cd000000-0000-0000-0000-0000000000a1'::uuid,'resident-host');

-- Item B: aprovado mas NÃO iniciado (fica em 'approved').
CREATE TEMP TABLE item_b AS SELECT (public.create_work_proposal(
  'cd000000-0000-0000-0000-000000000012','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"corr-proof-b"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'::jsonb,
  '{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["src/b.ts"],"excluded_scope":["deploy"],"expected_effects":["ok"],"risks":[]}}'::jsonb
)).id;
SELECT public.resolve_approval((SELECT id FROM item_b),1,'approve','{}');

CREATE TEMP TABLE auth_a AS SELECT ((public.grant_paid_compute_authorization(
  'openai',NULL,'provider_api:gpt-test',(SELECT id FROM item_a),60000,'USD',1.00,
  now()-interval '1 minute',now()+interval '10 minutes'))->>'authorization_id')::uuid id;

-- (1) attempt correlacionado → reserva admitida.
SELECT is((public.reserve_paid_compute_budget(
  (SELECT id FROM auth_a),'k-ok','openai','openai-api','provider_api:gpt-test',(SELECT id FROM item_a),
  'cd000000-0000-0000-0000-0000000000a1','lease-ok','USD',0.10))->>'action','reserved','attempt correlacionado é admitido');

-- (2) attempt UUID mas SEM execution_started correlacionado → recusa.
SELECT is((public.reserve_paid_compute_budget(
  (SELECT id FROM auth_a),'k-uncorr','openai','openai-api','provider_api:gpt-test',(SELECT id FROM item_a),
  'cd000000-0000-0000-0000-0000000000ff','lease-uncorr','USD',0.10))->>'reason','attempt_correlation_required','attempt não correlacionado é recusado');

-- (3) attempt não-UUID → inválido.
SELECT throws_ok($$ SELECT public.reserve_paid_compute_budget(
  (SELECT id FROM auth_a),'k-bad','openai','openai-api','provider_api:gpt-test',(SELECT id FROM item_a),
  'nao-uuid','lease-bad','USD',0.10) $$,'22023',NULL,'attempt provider_api precisa ser uuid');

-- (4) GRANT provider_api sem work item → wildcard proibido.
SELECT throws_ok($$ SELECT public.grant_paid_compute_authorization(
  'openai',NULL,'provider_api:gpt-test',NULL,60000,'USD',0.25,now(),now()+interval '10 minutes') $$,
  '22023',NULL,'grant provider_api sem work item é recusado');

-- (5) GRANT provider_api (provider openai) sem resource_class específico → recusado.
SELECT throws_ok($$ SELECT public.grant_paid_compute_authorization(
  'openai',NULL,NULL,(SELECT id FROM item_a),60000,'USD',0.25,now(),now()+interval '10 minutes') $$,
  '22023',NULL,'grant provider_api sem resource_class específico é recusado');

-- (6) GRANT provider_api com modelo vazio ('provider_api:') → recusado.
SELECT throws_ok($$ SELECT public.grant_paid_compute_authorization(
  'openai',NULL,'provider_api:',(SELECT id FROM item_a),60000,'USD',0.25,now(),now()+interval '10 minutes') $$,
  '22023',NULL,'grant provider_api com modelo vazio é recusado');

-- (7) Item aprovado mas NÃO em execução → reserva provider_api recusada.
CREATE TEMP TABLE auth_b AS SELECT ((public.grant_paid_compute_authorization(
  'openai',NULL,'provider_api:gpt-test',(SELECT id FROM item_b),60000,'USD',1.00,
  now()-interval '1 minute',now()+interval '10 minutes'))->>'authorization_id')::uuid id;
SELECT is((public.reserve_paid_compute_budget(
  (SELECT id FROM auth_b),'k-b','openai','openai-api','provider_api:gpt-test',(SELECT id FROM item_b),
  'cd000000-0000-0000-0000-0000000000b1','lease-b','USD',0.10))->>'reason','work_item_not_executing','item fora de execução recusa reserva paga');

-- (8) Regressão: node pago comum (não provider_api) segue inalterado, sem exigir correlação.
CREATE TEMP TABLE auth_node AS SELECT ((public.grant_paid_compute_authorization(
  'fake-provider','fake-node','gpu-test',(SELECT id FROM item_a),60000,'USD',1.00,
  now()-interval '1 minute',now()+interval '10 minutes'))->>'authorization_id')::uuid id;
SELECT is((public.reserve_paid_compute_budget(
  (SELECT id FROM auth_node),'k-node','fake-provider','fake-node','gpu-test',(SELECT id FROM item_a),
  NULL,'lease-node','USD',0.10))->>'action','reserved','node pago comum não exige correlação de attempt');

SELECT * FROM finish();
ROLLBACK;
