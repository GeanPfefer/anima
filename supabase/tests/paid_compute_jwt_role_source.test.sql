-- Regressão da fonte do papel JWT nas RPCs de compute pago.
--
-- Prova viva do defeito corrigido em 20260903000001: o PostgREST real deste deploy popula APENAS
-- o JSON agregado `request.jwt.claims`, não as GUCs planas `request.jwt.claim.*`. A identidade aqui
-- é dirigida SÓ pelo JSON (GUCs planas explicitamente NULAS) — exatamente como a identidade
-- residente Bearer/GoTrue chega em produção. As quatro RPCs pagas devem admitir essa identidade.
-- Os negativos preservam o guard: papel 'anon' e papel ausente continuam recusados (42501).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('cc000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','jwt-role-source@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('cc000000-0000-0000-0000-000000000011','cc000000-0000-0000-0000-000000000001','user','provar fonte do papel jwt');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('cc000000-0000-0000-0000-000000000001');
RESET ROLE;

-- Identidade SÓ via claims JSON: GUCs planas explicitamente nulas (o PostgREST real não as seta).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',NULL,true);
SELECT set_config('request.jwt.claim.role',NULL,true);
SELECT set_config('request.jwt.claims','{"sub":"cc000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

CREATE TEMP TABLE role_item AS SELECT (public.create_work_proposal(
  'cc000000-0000-0000-0000-000000000011','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"jwt-role-proof"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'::jsonb,
  '{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["src/a.ts"],"excluded_scope":["deploy"],"expected_effects":["ok"],"risks":[]}}'::jsonb
)).id;
SELECT public.resolve_approval((SELECT id FROM role_item),1,'approve','{}');

CREATE TEMP TABLE role_auth AS SELECT ((public.grant_paid_compute_authorization(
  'openai',NULL,'provider_api:gpt-test',(SELECT id FROM role_item),60000,'USD',0.25,
  now()-interval '1 minute',now()+interval '10 minutes'))->>'authorization_id')::uuid id;
SELECT isnt((SELECT id FROM role_auth),NULL,'grant admite identidade autenticada via claims JSON (sem GUC plana)');

SELECT is((public.reserve_paid_compute_budget(
  (SELECT id FROM role_auth),'k1','openai','openai-api','provider_api:gpt-test',(SELECT id FROM role_item),
  'attempt-1','provider-api:attempt-1','USD',0.25))->>'action','reserved','reserve admitida via claims JSON');

SELECT is((public.void_paid_compute_budget_reservation(
  (SELECT reservation_id FROM public.paid_compute_budget_events WHERE event_type='reserved'),'provider_not_called'))->>'action','voided','void admitido via claims JSON');

SELECT is((public.revoke_paid_compute_authorization((SELECT id FROM role_auth)))->>'action','revoked','revoke admitido via claims JSON');

-- Negativa preservada: papel 'anon' no claim ainda recusa mesmo sob role de DB authenticated.
SELECT set_config('request.jwt.claims','{"sub":"cc000000-0000-0000-0000-000000000001","role":"anon"}',true);
SELECT throws_ok(
  $$ SELECT public.grant_paid_compute_authorization('openai',NULL,'provider_api:gpt-test',NULL,60000,'USD',0.25,now(),now()+interval '10 minutes') $$,
  '42501',NULL,'papel anon no claim ainda é recusado');

-- Fail-closed: papel ausente por completo também recusa.
SELECT set_config('request.jwt.claims','{"sub":"cc000000-0000-0000-0000-000000000001"}',true);
SELECT throws_ok(
  $$ SELECT public.grant_paid_compute_authorization('openai',NULL,'provider_api:gpt-test',NULL,60000,'USD',0.25,now(),now()+interval '10 minutes') $$,
  '42501',NULL,'papel ausente é recusado (fail-closed)');

SELECT * FROM finish();
ROLLBACK;
