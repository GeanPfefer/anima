BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('ce000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','authority-amend@test.invalid','',now(),'{}','{}',now(),now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
CREATE TEMP TABLE amended_auth AS SELECT ((public.grant_paid_compute_authorization(
  'runpod',NULL,NULL,NULL,1800000,'USD',1.5,now()-interval '1 minute',now()+interval '30 minutes',
  '{"minimumVramGiB":24,"requiredGpuFeatures":["cuda"],"maxHourlyPrice":{"currency":"USD","amount":0.55},"maxNodes":1}'::jsonb))->>'authorization_id')::uuid id;
SELECT is((public.raise_paid_compute_hourly_limit_to_usd_1((SELECT id FROM amended_auth)))->>'action','amended','1) narrow amendment applies');
SELECT is((SELECT capability_scope#>>'{maxHourlyPrice,amount}' FROM public.paid_compute_authorizations WHERE id=(SELECT id FROM amended_auth)),'1','2) hourly ceiling becomes USD 1');
SELECT is((SELECT max_cost_amount::text FROM public.paid_compute_authorizations WHERE id=(SELECT id FROM amended_auth)),'1.5','3) aggregate ceiling stays USD 1.50');
SELECT is((SELECT max_duration_ms::text FROM public.paid_compute_authorizations WHERE id=(SELECT id FROM amended_auth)),'1800000','4) duration stays 30 minutes');
SELECT is((SELECT (previous_capability_scope#>>'{maxHourlyPrice,amount}')||'->'||(next_capability_scope#>>'{maxHourlyPrice,amount}') FROM public.paid_compute_authorization_events WHERE authorization_id=(SELECT id FROM amended_auth)),'0.55->1','5) append-only event preserves before and after');
SELECT is((public.raise_paid_compute_hourly_limit_to_usd_1((SELECT id FROM amended_auth)))->>'action','unchanged','6) replay is idempotent');
SELECT * FROM finish();
ROLLBACK;
