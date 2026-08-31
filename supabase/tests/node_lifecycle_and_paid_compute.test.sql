BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(19);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('ca000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','node-owner@test.invalid','',now(),'{}','{}',now(),now()),
('ca000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','node-other@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('ca000000-0000-0000-0000-000000000011','ca000000-0000-0000-0000-000000000001','user','provar node');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('ca000000-0000-0000-0000-000000000001');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ca000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
CREATE TEMP TABLE node_item AS
  SELECT (public.create_work_proposal(
    'ca000000-0000-0000-0000-000000000011','low','programming',
    '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"node-proof"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'::jsonb,
    '{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["src/a.ts"],"excluded_scope":["deploy"],"expected_effects":["ok"],"risks":[]}}'::jsonb
  )).id;
SELECT public.resolve_approval((SELECT id FROM node_item),1,'approve','{}');

CREATE FUNCTION pg_temp.lifecycle(p_from text,p_to text,p_event text,p_attempt text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object(
  'schemaVersion',1,'nodeId','owned-node-1','providerId','local-process','leaseId','lease-proof-1',
  'workItemId',(SELECT id FROM node_item),'attemptId',p_attempt,'billingMode','owned',
  'transition',jsonb_build_object('from',p_from,'to',p_to,'event',p_event),
  'healthy',p_to IN ('ready','busy','idle'),'activeDurationMs',0,
  'authorizationRef',NULL,'estimatedCost',NULL,'observedAt','2026-08-30T20:00:00Z'); $$;

SELECT is((public.record_host_observed_node_lifecycle((SELECT id FROM node_item),1,
  pg_temp.lifecycle('offline','provisioning','provision_requested')))->>'action','recorded','registra lifecycle host-observed sem attempt');
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=(SELECT id FROM node_item)
  AND event_type='host_observed_node_lifecycle_recorded'),'system','evidência recebe autoria system');
SELECT is((SELECT payload->'data'->>'origin' FROM public.work_events WHERE work_item_id=(SELECT id FROM node_item)
  AND event_type='host_observed_node_lifecycle_recorded'),'host','evidência recebe origem host');
SELECT is((public.record_host_observed_node_lifecycle((SELECT id FROM node_item),1,
  pg_temp.lifecycle('offline','provisioning','provision_requested')))->>'action','replayed','replay semântico é idempotente');
SELECT throws_ok($$ SELECT public.record_host_observed_node_lifecycle((SELECT id FROM node_item),1,
  pg_temp.lifecycle('offline','provisioning','provision_requested') || '{"activeDurationMs":10}'::jsonb) $$,
  '55000',NULL,'mesma transição com fato divergente conflita');
SELECT throws_ok($$ SELECT public.record_host_observed_node_lifecycle((SELECT id FROM node_item),1,
  pg_temp.lifecycle('provisioning','ready','health_confirmed','ca000000-0000-0000-0000-00000000aaaa')) $$,
  'P0002',NULL,'attempt inexistente é recusada');

-- providerRef OPCIONAL: aceito quando string; persistido na evidência; vazio é recusado.
SELECT is((public.record_host_observed_node_lifecycle((SELECT id FROM node_item),1,
  pg_temp.lifecycle('ready','busy','reserved') || '{"providerRef":"pod-proof-1"}'::jsonb))->>'action','recorded','evidência com providerRef é aceita');
SELECT is((SELECT payload->'data'->'evidence'->>'providerRef' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM node_item) AND payload->'data'->'evidence'->'transition'->>'event'='reserved' LIMIT 1),
  'pod-proof-1','providerRef é persistido na evidência');
SELECT throws_ok($$ SELECT public.record_host_observed_node_lifecycle((SELECT id FROM node_item),1,
  pg_temp.lifecycle('busy','idle','released') || '{"providerRef":"  "}'::jsonb) $$,
  '22023',NULL,'providerRef vazio é recusado');

SELECT is((public.grant_paid_compute_authorization('fake-provider','fake-node','gpu-test',(SELECT id FROM node_item),
  60000,'USD',1.25,now()-interval '1 minute',now()+interval '10 minutes'))->>'action','granted','usuário concede autorização paga');
SELECT is((SELECT count(*) FROM public.paid_compute_authorizations WHERE user_id='ca000000-0000-0000-0000-000000000001'),1::bigint,'autorização owner-scoped persistida');
SELECT is((SELECT provider_id FROM public.paid_compute_authorizations LIMIT 1),'fake-provider','envelope preserva provider');
SELECT is((SELECT max_duration_ms FROM public.paid_compute_authorizations LIMIT 1),60000::bigint,'envelope preserva duração máxima');
SELECT is((public.revoke_paid_compute_authorization((SELECT id FROM public.paid_compute_authorizations LIMIT 1)))->>'action','revoked','usuário revoga autorização');
SELECT ok((SELECT revoked_at IS NOT NULL FROM public.paid_compute_authorizations LIMIT 1),'revogação é auditável');
SELECT is((public.revoke_paid_compute_authorization((SELECT id FROM public.paid_compute_authorizations LIMIT 1)))->>'action','revoked','revogação repetida é idempotente');

SELECT set_config('request.jwt.claim.sub','ca000000-0000-0000-0000-000000000002',true);
SELECT is((SELECT count(*) FROM public.paid_compute_authorizations),0::bigint,'RLS esconde autorização de outro owner');
SELECT throws_ok($$ SELECT public.revoke_paid_compute_authorization((SELECT id FROM public.paid_compute_authorizations WHERE user_id='ca000000-0000-0000-0000-000000000001' LIMIT 1)) $$,
  'P0002',NULL,'outro usuário não revoga autorização alheia');

SET LOCAL ROLE service_role;
SELECT throws_ok($$ SELECT public.grant_paid_compute_authorization('fake','n','c',NULL,1000,NULL,NULL,now(),now()+interval '1 minute') $$,
  '42501',NULL,'service role não fabrica decisão humana');

SELECT * FROM finish();
ROLLBACK;
