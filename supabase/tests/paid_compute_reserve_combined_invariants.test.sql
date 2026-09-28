-- Guarda de regressão do `reserve_paid_compute_budget` (20260927000001).
--
-- A 20260910000001 recompilou o reserve a partir de um corpo antigo e perdeu, de uma vez, o role
-- robusto (20260903000001) e a correlação provider_api (20260904000000). Este teste prende as TRÊS
-- evoluções no MESMO corpo, para que uma recompilação futura não perca nenhuma em silêncio:
--   (a) role lido do JSON `request.jwt.claims` mesmo com a GUC plana vazia;
--   (b) correlação provider_api fail-closed;
--   (c) committed = reserved − voided − settled (excesso liquidado reabre o envelope).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('cf000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','reserve-guard@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('cf000000-0000-0000-0000-000000000011','cf000000-0000-0000-0000-000000000001','user','guarda do reserve');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('cf000000-0000-0000-0000-000000000001');
RESET ROLE;

-- (a) Só o JSON agregado carrega o role (como no PostgREST deste deploy); a GUC plana fica vazia.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cf000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claim.role','',true);
SELECT set_config('request.jwt.claims','{"sub":"cf000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

CREATE TEMP TABLE g_item AS SELECT (public.create_work_proposal(
  'cf000000-0000-0000-0000-000000000011','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"reserve-guard"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'::jsonb,
  '{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["src/a.ts"],"excluded_scope":["deploy"],"expected_effects":["ok"],"risks":[]}}'::jsonb
)).id;
SELECT public.resolve_approval((SELECT id FROM g_item),1,'approve','{}');
SELECT public.start_commanded_work_attempt((SELECT id FROM g_item),1,'cf000000-0000-0000-0000-0000000000a1'::uuid,'resident-host');
CREATE TEMP TABLE g_auth AS SELECT ((public.grant_paid_compute_authorization(
  'openai','openai-api','provider_api:gpt-test',(SELECT id FROM g_item),1800000,'USD',1.00,
  now()-interval '1 minute',now()+interval '10 minutes'))->>'authorization_id')::uuid id;

CREATE FUNCTION pg_temp.reserve(p_attempt text,p_key text,p_amount numeric) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.reserve_paid_compute_budget((SELECT id FROM g_auth),p_key,'openai','openai-api','provider_api:gpt-test',
    (SELECT id FROM g_item),p_attempt,'provider-api:'||p_key,'USD',p_amount); $$;

-- (a)+(b) attempt correlacionado é admitido com role vindo só do JSON.
SELECT is((pg_temp.reserve('cf000000-0000-0000-0000-0000000000a1','k1',1.00))->>'action','reserved','role robusto + attempt correlacionado ⇒ reserva');
-- (b) attempt sem execution_started ⇒ recusa; não-UUID e ausente ⇒ 22023.
SELECT is((pg_temp.reserve('cf000000-0000-0000-0000-0000000000ff','k2',0.10))->>'reason','attempt_correlation_required','attempt não correlacionado é recusado');
SELECT throws_ok($$ SELECT pg_temp.reserve('nao-uuid','k3',0.10) $$,'22023',NULL,'attempt não-UUID é inválido');
SELECT throws_ok($$ SELECT pg_temp.reserve(NULL,'k4',0.10) $$,'22023',NULL,'attempt ausente é inválido');

-- (c) teto 1.00 todo reservado ⇒ nova reserva excede; após liquidar 0.30 (usage_priced) o excesso reabre.
SELECT is((pg_temp.reserve('cf000000-0000-0000-0000-0000000000a1','k5',0.50))->>'reason','aggregate_budget_exceeded','teto integralmente reservado bloqueia nova exposição');
SELECT is((public.settle_paid_compute_usage_priced_reservation(
  (SELECT reservation_id FROM public.paid_compute_budget_events WHERE lease_id='provider-api:k1' AND event_type='reserved'),'USD',0.30,
  jsonb_build_object('schemaVersion',1,'method','usage_priced','attemptId','cf000000-0000-0000-0000-0000000000a1','provider','openai',
    'model','gpt-test','catalogRef','fixture@1','pricingVersion','fixture/gpt-test@v1','pricingSourceRef','fixture:test-only',
    'currency','USD','usage',jsonb_build_object('inputTokens',1,'outputTokens',1))))->>'action','settled','settlement usage_priced libera excesso');
SELECT is((pg_temp.reserve('cf000000-0000-0000-0000-0000000000a1','k6',0.50))->>'action','reserved','excesso liquidado reabre o envelope (committed desconta settled)');

SELECT * FROM finish();
ROLLBACK;
