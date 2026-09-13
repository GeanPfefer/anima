BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(23);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('cd000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','settle-owner@test.invalid','',now(),'{}','{}',now(),now()),
('cd000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','settle-other@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('cd000000-0000-0000-0000-000000000011','cd000000-0000-0000-0000-000000000001','user','provar settlement');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('cd000000-0000-0000-0000-000000000001');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cd000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
CREATE TEMP TABLE settle_item AS SELECT (public.create_work_proposal(
  'cd000000-0000-0000-0000-000000000011','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"settle-proof"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'::jsonb,
  '{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["src/a.ts"],"excluded_scope":["deploy"],"expected_effects":["ok"],"risks":[]}}'::jsonb
)).id;
SELECT public.resolve_approval((SELECT id FROM settle_item),1,'approve','{}');
-- Envelope de SESSÃO com teto 1.50 (não por máquina).
CREATE TEMP TABLE settle_auth AS SELECT ((public.grant_paid_compute_authorization(
  'runpod',NULL,'gpu-test',(SELECT id FROM settle_item),1800000,'USD',1.50,
  now()-interval '1 minute',now()+interval '10 minutes'))->>'authorization_id')::uuid id;

CREATE FUNCTION pg_temp.reserve(p_key text,p_lease text,p_amount numeric)
RETURNS jsonb LANGUAGE sql AS $$ SELECT public.reserve_paid_compute_budget(
  (SELECT id FROM settle_auth),p_key,'runpod','fake-node','gpu-test',(SELECT id FROM settle_item),
  NULL,p_lease,'USD',p_amount); $$;
CREATE FUNCTION pg_temp.committed()
RETURNS numeric LANGUAGE sql AS $$ SELECT
  COALESCE(sum(amount) FILTER (WHERE event_type='reserved'),0)
  - COALESCE(sum(amount) FILTER (WHERE event_type='voided'),0)
  - COALESCE(sum(amount) FILTER (WHERE event_type='settled'),0)
  FROM public.paid_compute_budget_events WHERE authorization_id=(SELECT id FROM settle_auth); $$;
CREATE FUNCTION pg_temp.resv(p_lease text)
RETURNS uuid LANGUAGE sql AS $$ SELECT reservation_id FROM public.paid_compute_budget_events
  WHERE event_type='reserved' AND lease_id=p_lease LIMIT 1; $$;

-- Pod A: reserva conservadora 0.245 (30 min @ 0.49/h).
SELECT is((pg_temp.reserve('key-a','lease-a',0.245))->>'action','reserved','Pod A reserva 0.245');
SELECT is(pg_temp.committed(),0.245::numeric,'committed = exposição integral antes do settlement');

-- Pod A viveu ~606s (~0.082): settlement libera o excesso.
SELECT is((public.settle_paid_compute_budget_reservation(pg_temp.resv('lease-a'),'USD',0.0825,'estimated'))->>'action','settled','settlement de Pod A é registrado');
SELECT is(pg_temp.committed(),0.0825::numeric,'committed passa a refletir o custo efetivo (~0.082), não a reserva');
SELECT is((SELECT amount FROM public.paid_compute_budget_events WHERE event_type='settled' AND lease_id='lease-a'),0.1625::numeric,'evento settled grava o excesso liberado (0.245−0.0825)');
SELECT is((SELECT reason FROM public.paid_compute_budget_events WHERE event_type='settled' AND lease_id='lease-a'),'estimated','fonte do custo é preservada (estimated vs provider_confirmed)');

-- Settlement idempotente.
SELECT is((public.settle_paid_compute_budget_reservation(pg_temp.resv('lease-a'),'USD',0.0825,'estimated'))->>'action','replayed','retry do settlement é idempotente');
SELECT is((SELECT count(*) FROM public.paid_compute_budget_events WHERE event_type='settled' AND lease_id='lease-a'),1::bigint,'replay não duplica settlement');
SELECT throws_ok($$ SELECT public.settle_paid_compute_budget_reservation(pg_temp.resv('lease-a'),'USD',0.10,'estimated') $$,'55000',NULL,'settlement divergente conflita');

-- Budget liberado permite a próxima máquina da MESMA sessão (excesso reabriu o envelope).
SELECT is((pg_temp.reserve('key-b','lease-b',0.245))->>'action','reserved','Pod B cabe após o excesso de A ser liberado');

-- Invariantes do write gate.
SELECT throws_ok($$ SELECT public.settle_paid_compute_budget_reservation(pg_temp.resv('lease-b'),'USD',0.50,'estimated') $$,'22023',NULL,'settlement nunca excede a reserva');
SELECT throws_ok($$ SELECT public.settle_paid_compute_budget_reservation(pg_temp.resv('lease-b'),'USD',-0.01,'estimated') $$,'22023',NULL,'settlement negativo é inválido (committed jamais negativo)');
SELECT throws_ok($$ SELECT public.settle_paid_compute_budget_reservation(pg_temp.resv('lease-b'),'USD',0.05,'lease_ended') $$,'22023',NULL,'cost_source fora do domínio é inválido');

-- void×settle mutuamente exclusivos; e outro usuário não liquida reserva alheia.
SELECT public.settle_paid_compute_budget_reservation(pg_temp.resv('lease-b'),'USD',0.05,'provider_confirmed');
SELECT throws_ok($$ SELECT public.void_paid_compute_budget_reservation(pg_temp.resv('lease-b'),'provider_not_called') $$,'22023',NULL,'não se anula uma reserva já liquidada');

-- LATE SETTLEMENT: liquidar é seguro MESMO após a autoridade EXPIRAR (libera excesso / registra
-- custo real pós-hoc; só NÃO inicia gasto novo). É exatamente o caminho para settlement tardio das
-- reservas históricas de forma canônica append-only.
SELECT is((pg_temp.reserve('key-c','lease-c',0.1))->>'action','reserved','reserva lease-c antes de expirar a autoridade');
RESET ROLE;
UPDATE public.paid_compute_authorizations SET valid_until = now() - interval '1 second' WHERE id=(SELECT id FROM settle_auth);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cd000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT is((public.settle_paid_compute_budget_reservation(pg_temp.resv('lease-c'),'USD',0.03,'estimated'))->>'action','settled','settlement TARDIO funciona após a autoridade expirar');
SELECT is((pg_temp.reserve('key-d','lease-d',0.1))->>'reason','authorization_expired','mas NOVA reserva após expirar continua negada (não inicia gasto)');

-- A exclusividade também vale na direção voided → settled.
RESET ROLE;
UPDATE public.paid_compute_authorizations
SET valid_until = now() + interval '10 minutes'
WHERE id=(SELECT id FROM settle_auth);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cd000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT is((pg_temp.reserve('key-e','lease-e',0.1))->>'action','reserved','reserva lease-e para provar voided → settled bloqueado');
SELECT is((public.void_paid_compute_budget_reservation(pg_temp.resv('lease-e'),'provider_not_called'))->>'action','voided','reserva lease-e é anulada canonicamente');
SELECT throws_ok($$ SELECT public.settle_paid_compute_budget_reservation(pg_temp.resv('lease-e'),'USD',0.01,'estimated') $$,'22023',NULL,'reserva anulada não pode ser liquidada');

-- Revogação bloqueia gasto NOVO, mas não impede reconciliar custo de uma reserva preexistente.
SELECT is((pg_temp.reserve('key-f','lease-f',0.1))->>'action','reserved','reserva lease-f antes de revogar a autoridade');
RESET ROLE;
UPDATE public.paid_compute_authorizations SET revoked_at=now() WHERE id=(SELECT id FROM settle_auth);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cd000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT is((public.settle_paid_compute_budget_reservation(pg_temp.resv('lease-f'),'USD',0.04,'provider_confirmed'))->>'action','settled','settlement TARDIO funciona após a autoridade ser revogada');

SELECT set_config('request.jwt.claim.sub','cd000000-0000-0000-0000-000000000002',true);
SELECT throws_ok($$ SELECT public.settle_paid_compute_budget_reservation((SELECT reservation_id FROM public.paid_compute_budget_events WHERE event_type='reserved' AND lease_id='lease-a' LIMIT 1),'USD',0.01,'estimated') $$,'P0002',NULL,'outro usuário não liquida reserva alheia');

SELECT * FROM finish();
ROLLBACK;
