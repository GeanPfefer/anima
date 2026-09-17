-- Cloud Resource Matching V1 — autoridade paga POR CAPACIDADE na RPC de concessão.
--
-- Prova a evolução de 20260910000000: `grant_paid_compute_authorization` aceita um
-- `capability_scope` OPCIONAL (autoridade que NÃO amarra uma SKU de GPU, mas limita VRAM/features/
-- nodes). Invariantes duras: SKU-fixa XOR capacidade; forma mínima válida; provider_api NUNCA
-- carrega escopo por capacidade. Identidade dirigida SÓ pelo claims JSON (como o PostgREST real
-- deste deploy popula), coerente com paid_compute_jwt_role_source.test.sql.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('cd000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','capability-scope@test.invalid','',now(),'{}','{}',now(),now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',NULL,true);
SELECT set_config('request.jwt.claim.role',NULL,true);
SELECT set_config('request.jwt.claims','{"sub":"cd000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

-- 1) Concessão por capacidade (resource_class NULL + capability_scope) devolve id.
CREATE TEMP TABLE cap_auth AS SELECT ((public.grant_paid_compute_authorization(
  'runpod',NULL,NULL,NULL,1800000,'USD',1.5,now()-interval '1 minute',now()+interval '30 minutes',
  '{"minimumVramGiB":24,"requiredGpuFeatures":["cuda"],"maxNodes":1}'::jsonb))->>'authorization_id')::uuid id;
SELECT isnt((SELECT id FROM cap_auth),NULL,'1) grant por capacidade admite identidade autenticada e devolve id');

-- 2) A linha persistida tem resource_class NULL e capability_scope preservado.
SELECT is(
  (SELECT resource_class IS NULL AND capability_scope->>'minimumVramGiB'='24' AND capability_scope->>'maxNodes'='1'
   FROM public.paid_compute_authorizations WHERE id=(SELECT id FROM cap_auth)),
  true,'2) capability_scope persistido; resource_class permanece NULL');

-- 3) SKU-fixa (resource_class, sem escopo) continua válida — retrocompatível.
SELECT isnt(((public.grant_paid_compute_authorization(
  'runpod',NULL,'gpu-a40-48gb',NULL,1800000,'USD',1.5,now(),now()+interval '30 minutes'))->>'authorization_id'),
  NULL,'3) grant SKU-fixa (9 args, sem escopo) continua funcionando');

-- 4) resource_class + capability_scope juntos → recusado (22023, exclusividade).
SELECT throws_ok(
  $$ SELECT public.grant_paid_compute_authorization('runpod',NULL,'gpu-a40-48gb',NULL,1800000,'USD',1.5,now(),now()+interval '30 minutes','{"minimumVramGiB":24,"requiredGpuFeatures":["cuda"],"maxNodes":1}'::jsonb) $$,
  '22023',NULL,'4) SKU-fixa XOR capacidade: ambas juntas é recusado');

-- 5) capability_scope malformado (sem maxNodes) → recusado (22023).
SELECT throws_ok(
  $$ SELECT public.grant_paid_compute_authorization('runpod',NULL,NULL,NULL,1800000,'USD',1.5,now(),now()+interval '30 minutes','{"minimumVramGiB":24,"requiredGpuFeatures":["cuda"]}'::jsonb) $$,
  '22023',NULL,'5) capability_scope sem maxNodes é recusado (forma mínima)');

-- 6) provider_api (openai) com capability_scope → recusado (22023): capacidade de GPU não se
--    aplica a API terceira.
SELECT throws_ok(
  $$ SELECT public.grant_paid_compute_authorization('openai',NULL,NULL,NULL,1800000,'USD',0.25,now(),now()+interval '30 minutes','{"minimumVramGiB":24,"requiredGpuFeatures":["cuda"],"maxNodes":1}'::jsonb) $$,
  '22023',NULL,'6) provider_api não carrega escopo por capacidade');

-- 7) service_role continua sem fabricar autorização (guard do papel preservado).
SELECT set_config('request.jwt.claims','{"sub":"cd000000-0000-0000-0000-000000000001","role":"service_role"}',true);
SELECT throws_ok(
  $$ SELECT public.grant_paid_compute_authorization('runpod',NULL,NULL,NULL,1800000,'USD',1.5,now(),now()+interval '30 minutes','{"minimumVramGiB":24,"requiredGpuFeatures":["cuda"],"maxNodes":1}'::jsonb) $$,
  '42501',NULL,'7) service_role recusado mesmo com escopo por capacidade');

SELECT * FROM finish();
ROLLBACK;
