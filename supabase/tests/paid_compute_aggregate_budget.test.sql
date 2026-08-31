BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(18);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('cb000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','budget-owner@test.invalid','',now(),'{}','{}',now(),now()),
('cb000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','budget-other@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('cb000000-0000-0000-0000-000000000011','cb000000-0000-0000-0000-000000000001','user','provar orçamento');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('cb000000-0000-0000-0000-000000000001');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cb000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
CREATE TEMP TABLE budget_item AS SELECT (public.create_work_proposal(
  'cb000000-0000-0000-0000-000000000011','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"budget-proof"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'::jsonb,
  '{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["src/a.ts"],"excluded_scope":["deploy"],"expected_effects":["ok"],"risks":[]}}'::jsonb
)).id;
SELECT public.resolve_approval((SELECT id FROM budget_item),1,'approve','{}');
CREATE TEMP TABLE budget_auth AS SELECT ((public.grant_paid_compute_authorization(
  'fake-provider',NULL,'gpu-test',(SELECT id FROM budget_item),60000,'USD',1.00,
  now()-interval '1 minute',now()+interval '10 minutes'))->>'authorization_id')::uuid id;

CREATE FUNCTION pg_temp.reserve(p_key text,p_lease text,p_amount numeric,p_currency text DEFAULT 'USD')
RETURNS jsonb LANGUAGE sql AS $$ SELECT public.reserve_paid_compute_budget(
  (SELECT id FROM budget_auth),p_key,'fake-provider','fake-node','gpu-test',(SELECT id FROM budget_item),
  NULL,p_lease,p_currency,p_amount); $$;

SELECT is((pg_temp.reserve('key-a','lease-a',0.70))->>'action','reserved','primeira reserva de 0.70 é admitida');
SELECT is((pg_temp.reserve('key-b','lease-b',0.70))->>'reason','aggregate_budget_exceeded','segunda reserva excedente é negada');
SELECT is((SELECT sum(amount) FROM public.paid_compute_budget_events WHERE event_type='reserved'),0.70::numeric,'exposição nunca ultrapassa 1.00');
SELECT is((pg_temp.reserve('key-a','lease-a',0.70))->>'action','replayed','retry da mesma chave recupera reserva');
SELECT is((SELECT count(*) FROM public.paid_compute_budget_events WHERE event_type='reserved'),1::bigint,'replay não duplica consumo');
SELECT throws_ok($$ SELECT pg_temp.reserve('key-a','lease-divergente',0.70) $$,'55000',NULL,'reuso divergente da chave conflita');
SELECT is((public.void_paid_compute_budget_reservation(
  (SELECT reservation_id FROM public.paid_compute_budget_events WHERE event_type='reserved'),'provider_not_called'))->>'action','voided','void seguro é append-only');
SELECT is((public.void_paid_compute_budget_reservation(
  (SELECT reservation_id FROM public.paid_compute_budget_events WHERE event_type='reserved'),'provider_not_called'))->>'action','replayed','retry do void é idempotente');
SELECT is((pg_temp.reserve('key-a','lease-a',0.70))->>'reason','reservation_voided','reserva anulada não volta a conceder efeito');
SELECT is((pg_temp.reserve('key-c','lease-c',1.00))->>'action','reserved','void comprovado libera exatamente o envelope');
SELECT is((pg_temp.reserve('key-d','lease-d',0.000001))->>'reason','aggregate_budget_exceeded','mínimo acima do restante é negado');
SELECT throws_ok($$ SELECT pg_temp.reserve('key-zero','lease-zero',0) $$,'22023',NULL,'estimate zero é inválido');
SELECT is((pg_temp.reserve('key-brl','lease-brl',0.1,'BRL'))->>'reason','currency_mismatch','moeda incompatível é negada');
SELECT throws_ok($$ SELECT public.void_paid_compute_budget_reservation(
  (SELECT reservation_id FROM public.paid_compute_budget_events WHERE event_type='reserved' LIMIT 1),'lease_finished') $$,
  '22023',NULL,'término comum não autoriza liberar reserva');

-- Replay idempotente preserva a reserva historica, mas nao concede
-- autoridade nova depois que o envelope humano expirou.
RESET ROLE;
UPDATE public.paid_compute_authorizations
SET valid_until = now() - interval '1 second'
WHERE id = (SELECT id FROM budget_auth);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cb000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

SELECT is(
  (pg_temp.reserve('key-c','lease-c',1.00))->>'reason',
  'authorization_expired',
  'replay nao inicia efeito apos expiracao'
);

SELECT public.revoke_paid_compute_authorization((SELECT id FROM budget_auth));
SELECT is((pg_temp.reserve('key-c','lease-c',1.00))->>'reason','authorization_revoked','replay não inicia efeito após revogação');

SELECT set_config('request.jwt.claim.sub','cb000000-0000-0000-0000-000000000002',true);
SELECT is((SELECT count(*) FROM public.paid_compute_budget_events),0::bigint,'outro usuário não lê o ledger');
SELECT throws_ok($$ SELECT public.reserve_paid_compute_budget((SELECT id FROM budget_auth),'alien','fake-provider','fake-node','gpu-test',
  (SELECT id FROM budget_item),NULL,'alien','USD',0.1) $$,'P0002',NULL,'outro usuário não consome autorização alheia');

SELECT * FROM finish();
ROLLBACK;
