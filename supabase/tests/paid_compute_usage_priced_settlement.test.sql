-- B1 — settlement `usage_priced` de reserva provider_api (20260927000000).
--
-- Prova: liquida S ≤ R com proveniência obrigatória e coerente (provider/modelo/attempt/moeda);
-- replay idempotente só com MESMA versão de preço e valor; versão/valor/fonte divergentes conflitam
-- (nunca liquida duas vezes); `usage_priced` sem proveniência é impossível no schema; outro usuário
-- não liquida reserva alheia. Preços aqui são FIXTURE de teste, não tarifa real.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(19);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('ce000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','usage-priced-owner@test.invalid','',now(),'{}','{}',now(),now()),
('ce000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','usage-priced-other@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('ce000000-0000-0000-0000-000000000011','ce000000-0000-0000-0000-000000000001','user','provar settlement usage_priced');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('ce000000-0000-0000-0000-000000000001');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ce000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

CREATE TEMP TABLE up_item AS SELECT (public.create_work_proposal(
  'ce000000-0000-0000-0000-000000000011','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"usage-priced-proof"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'::jsonb,
  '{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["src/a.ts"],"excluded_scope":["deploy"],"expected_effects":["ok"],"risks":[]}}'::jsonb
)).id;
SELECT public.resolve_approval((SELECT id FROM up_item),1,'approve','{}');
SELECT public.start_commanded_work_attempt((SELECT id FROM up_item),1,'ce000000-0000-0000-0000-0000000000a1'::uuid,'resident-host');
CREATE TEMP TABLE up_auth AS SELECT ((public.grant_paid_compute_authorization(
  'openai','openai-api','provider_api:gpt-test',(SELECT id FROM up_item),1800000,'USD',3.00,
  now()-interval '1 minute',now()+interval '10 minutes'))->>'authorization_id')::uuid id;

-- Reserva conservadora do teto inteiro, exatamente como createOpenAICoderAdmission.
SELECT is((public.reserve_paid_compute_budget(
  (SELECT id FROM up_auth),'openai-attempt:ce000000-0000-0000-0000-0000000000a1','openai','openai-api','provider_api:gpt-test',
  (SELECT id FROM up_item),'ce000000-0000-0000-0000-0000000000a1','provider-api:ce000000-0000-0000-0000-0000000000a1','USD',3.00))->>'action',
  'reserved','reserva provider_api do teto inteiro');

CREATE FUNCTION pg_temp.resv() RETURNS uuid LANGUAGE sql AS $$
  SELECT reservation_id FROM public.paid_compute_budget_events
  WHERE event_type='reserved' AND lease_id='provider-api:ce000000-0000-0000-0000-0000000000a1' LIMIT 1; $$;
CREATE FUNCTION pg_temp.prov(p_version text, p_model text DEFAULT 'gpt-test', p_attempt text DEFAULT 'ce000000-0000-0000-0000-0000000000a1', p_currency text DEFAULT 'USD')
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object(
  'schemaVersion',1,'method','usage_priced','attemptId',p_attempt,'provider','openai','model',p_model,
  'catalogRef','fixture@1','pricingVersion',p_version,'pricingSourceRef','fixture:test-only',
  'pricingEffectiveFrom','2026-01-01T00:00:00Z','currency',p_currency,
  'rates',jsonb_build_object('inputPerMillion','2','cachedInputPerMillion','0.5','outputPerMillion','8'),
  'usage',jsonb_build_object('inputTokens',100000,'cachedInputTokens',40000,'outputTokens',5000,'totalTokens',105000,'reportedCallCount',4),
  'exactCost','0.18','rounding','ceil_to_1e-6_capped_at_reservation'); $$;
CREATE FUNCTION pg_temp.committed() RETURNS numeric LANGUAGE sql AS $$ SELECT
  COALESCE(sum(amount) FILTER (WHERE event_type='reserved'),0)
  - COALESCE(sum(amount) FILTER (WHERE event_type='voided'),0)
  - COALESCE(sum(amount) FILTER (WHERE event_type='settled'),0)
  FROM public.paid_compute_budget_events WHERE authorization_id=(SELECT id FROM up_auth); $$;

-- Write gate: invariantes ANTES de qualquer liquidação.
SELECT throws_ok($$ SELECT public.settle_paid_compute_usage_priced_reservation(pg_temp.resv(),'USD',3.01,pg_temp.prov('v1')) $$,'22023',NULL,'custo acima da reserva é recusado (nunca ultrapassa R)');
SELECT throws_ok($$ SELECT public.settle_paid_compute_usage_priced_reservation(pg_temp.resv(),'USD',0.18,pg_temp.prov('')) $$,'22023',NULL,'sem versão de preço identificável não liquida');
SELECT throws_ok($$ SELECT public.settle_paid_compute_usage_priced_reservation(pg_temp.resv(),'USD',0.18,NULL) $$,'22023',NULL,'sem proveniência não liquida');
SELECT throws_ok($$ SELECT public.settle_paid_compute_usage_priced_reservation(pg_temp.resv(),'USD',0.18,pg_temp.prov('v1','gpt-other')) $$,'22023',NULL,'modelo da proveniência diverge da reserva');
SELECT throws_ok($$ SELECT public.settle_paid_compute_usage_priced_reservation(pg_temp.resv(),'USD',0.18,pg_temp.prov('v1','gpt-test','ce000000-0000-0000-0000-0000000000ff')) $$,'22023',NULL,'attempt da proveniência diverge da reserva');
SELECT throws_ok($$ SELECT public.settle_paid_compute_usage_priced_reservation(pg_temp.resv(),'USD',0.18,pg_temp.prov('v1','gpt-test','ce000000-0000-0000-0000-0000000000a1','BRL')) $$,'22023',NULL,'moeda da proveniência diverge do settlement');
SELECT throws_ok($$ SELECT public.settle_paid_compute_budget_reservation(pg_temp.resv(),'USD',0.18,'usage_priced') $$,'22023',NULL,'RPC legada não aceita usage_priced (proveniência obrigatória)');
SELECT is(pg_temp.committed(),3.00::numeric,'sem settlement válido a reserva segue aberta (cost_unknown = teto committed)');

-- Liquidação.
SELECT is((public.settle_paid_compute_usage_priced_reservation(pg_temp.resv(),'USD',0.18,pg_temp.prov('fixture/gpt-test@v1')))->>'action','settled','usage × preço versionado liquida a reserva');
SELECT is(pg_temp.committed(),0.18::numeric,'committed passa a refletir o custo derivado');
SELECT is((SELECT reason FROM public.paid_compute_budget_events WHERE event_type='settled' AND reservation_id=pg_temp.resv()),'usage_priced','fonte usage_priced é persistida');
SELECT is((SELECT settlement_provenance->>'pricingVersion' FROM public.paid_compute_budget_events WHERE event_type='settled' AND reservation_id=pg_temp.resv()),'fixture/gpt-test@v1','versão de preço é persistida na proveniência');

-- Replay / double settlement.
SELECT is((public.settle_paid_compute_usage_priced_reservation(pg_temp.resv(),'USD',0.18,pg_temp.prov('fixture/gpt-test@v1')))->>'action','replayed','replay idêntico é idempotente');
SELECT is((SELECT count(*) FROM public.paid_compute_budget_events WHERE event_type='settled' AND reservation_id=pg_temp.resv()),1::bigint,'replay não duplica o settlement');
SELECT throws_ok($$ SELECT public.settle_paid_compute_usage_priced_reservation(pg_temp.resv(),'USD',0.18,pg_temp.prov('fixture/gpt-test@v2')) $$,'55000',NULL,'versão de preço divergente conflita');
SELECT throws_ok($$ SELECT public.settle_paid_compute_usage_priced_reservation(pg_temp.resv(),'USD',0.20,pg_temp.prov('fixture/gpt-test@v1')) $$,'55000',NULL,'valor divergente conflita');

-- Outro usuário não liquida reserva alheia.
SELECT set_config('request.jwt.claim.sub','ce000000-0000-0000-0000-000000000002',true);
SELECT throws_ok($$ SELECT public.settle_paid_compute_usage_priced_reservation((SELECT reservation_id FROM public.paid_compute_budget_events WHERE lease_id='provider-api:ce000000-0000-0000-0000-0000000000a1' AND event_type='reserved' LIMIT 1),'USD',0.18,pg_temp.prov('fixture/gpt-test@v1')) $$,'P0002',NULL,'outro usuário não liquida reserva alheia');

-- Schema: usage_priced sem proveniência é impossível mesmo para o owner do banco.
RESET ROLE;
SELECT throws_ok($$ INSERT INTO public.paid_compute_budget_events(user_id,authorization_id,reservation_id,idempotency_key,event_type,provider_id,node_id,resource_class,work_item_id,attempt_id,lease_id,currency,amount,reason)
  SELECT user_id,authorization_id,gen_random_uuid(),'k-x','settled',provider_id,node_id,resource_class,work_item_id,attempt_id,'lease-x',currency,0,'usage_priced'
  FROM public.paid_compute_budget_events WHERE event_type='reserved' AND lease_id='provider-api:ce000000-0000-0000-0000-0000000000a1' $$,'23514',NULL,'constraint: usage_priced exige proveniência');

SELECT * FROM finish();
ROLLBACK;
