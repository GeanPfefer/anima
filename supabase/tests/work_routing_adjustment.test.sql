-- INTEL-03: o banco reconstrói o histórico, valida o ajuste e o persiste.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('82000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000',
'authenticated','authenticated','adjust@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
VALUES('82000000-0000-0000-0000-000000000011','82000000-0000-0000-0000-000000000001','user','ajuste');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id)
VALUES('82000000-0000-0000-0000-000000000001');
RESET ROLE;

\set spec '{"schema_version":1,"target":{"kind":"project","reference":"adjust-target"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":4}}'
\set prop '{"schema_version":1,"data":{"summary":"ajuste","objective":"provar ajuste","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["teste"],"risks":[]}}'
\set intel '{"schemaVersion":1,"complexity":"routine","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-28T20:00:00Z","classifierId":"user:adjust"}}'

\ir helpers/routing.inc

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000001',true);
CREATE TEMP TABLE item AS SELECT (public.create_work_proposal(
  '82000000-0000-0000-0000-000000000011','low','programming',
  jsonb_build_object('execution_spec',:'spec'::jsonb),:'prop'::jsonb)).id;
GRANT SELECT ON item TO service_role;
SELECT public.resolve_approval(id,1,'approve','{}') FROM item;
SELECT public.record_work_intelligence_classification(id,1,0,:'intel'::jsonb) FROM item;

SELECT pg_temp.record_test_route((SELECT id FROM item),'82000000-0000-0000-0000-0000000000a1');
SELECT public.acquire_work_claim((SELECT id FROM item),1,'82000000-0000-0000-0000-0000000000c1','sup',300);
SELECT public.start_claimed_work_attempt('82000000-0000-0000-0000-0000000000c1','82000000-0000-0000-0000-0000000000a1','local-runner-v1');
SELECT public.record_commanded_work_terminal((SELECT id FROM item),1,'82000000-0000-0000-0000-0000000000a1',
  jsonb_build_object('kind','error','workItemId',(SELECT id FROM item),'attemptId','82000000-0000-0000-0000-0000000000a1',
    'approvedProposalVersion',1,'origin','executor','sequence',1,'code','runner_failed','message','falhou','retryable',false,
    'handoffReference','local-runner:anima:a1.zip:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
SELECT public.release_work_claim('82000000-0000-0000-0000-0000000000c1','attempt_finished');
SET LOCAL ROLE service_role;
UPDATE public.work_items SET state='approved' WHERE id=(SELECT id FROM item);
RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT pg_temp.record_test_route((SELECT id FROM item),'82000000-0000-0000-0000-0000000000a2');
SELECT public.acquire_work_claim((SELECT id FROM item),1,'82000000-0000-0000-0000-0000000000c2','sup',300);
SELECT public.start_claimed_work_attempt('82000000-0000-0000-0000-0000000000c2','82000000-0000-0000-0000-0000000000a2','local-runner-v1');
SELECT public.record_commanded_work_terminal((SELECT id FROM item),1,'82000000-0000-0000-0000-0000000000a2',
  jsonb_build_object('kind','error','workItemId',(SELECT id FROM item),'attemptId','82000000-0000-0000-0000-0000000000a2',
    'approvedProposalVersion',1,'origin','executor','sequence',1,'code','runner_failed','message','falhou','retryable',false,
    'handoffReference','local-runner:anima:a2.zip:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'));
SELECT public.release_work_claim('82000000-0000-0000-0000-0000000000c2','attempt_finished');
SET LOCAL ROLE service_role;
UPDATE public.work_items SET state='approved' WHERE id=(SELECT id FROM item);
RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT is(jsonb_array_length(public.work_routing_adjustment_context((SELECT id FROM item))->'attempts'),2,
  'histórico contém as duas tentativas roteadas encerradas');
SELECT is(public.work_routing_adjustment_context((SELECT id FROM item))#>>'{attempts,0,outcome}','execution_failed',
  'o desfecho persistido entra no contexto');

SELECT pg_temp.record_test_route((SELECT id FROM item),'82000000-0000-0000-0000-0000000000a3');
SELECT is((SELECT payload#>>'{data,adjustment,kind}' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM item) AND event_type='work_routing_adjusted'
    AND payload#>>'{data,attempt_id}'='82000000-0000-0000-0000-0000000000a3'),'escalated',
  'duas falhas consecutivas escalam a terceira tentativa');
SELECT is((SELECT payload#>>'{data,adjustment,effectiveEffort}' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM item) AND event_type='work_routing_adjusted'
    AND payload#>>'{data,attempt_id}'='82000000-0000-0000-0000-0000000000a3'),'standard',
  'escalonamento sobe exatamente um nível');
SELECT is((SELECT payload#>>'{data,decision,requiredEffort}' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM item) AND event_type='work_routing_decided'
    AND payload#>>'{data,attempt_id}'='82000000-0000-0000-0000-0000000000a3'),'standard',
  'decisão de rota usa o esforço efetivo');
SELECT is((SELECT payload#>>'{data,adjustment,reason}' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM item) AND event_type='work_routing_adjusted'
    AND payload#>>'{data,attempt_id}'='82000000-0000-0000-0000-0000000000a3'),'two_consecutive_failures',
  'razão explícita fica auditável');
SELECT is((SELECT (payload#>'{data,adjustment,evidenceAttemptIds}')::text FROM public.work_events
  WHERE work_item_id=(SELECT id FROM item) AND event_type='work_routing_adjusted'
    AND payload#>>'{data,attempt_id}'='82000000-0000-0000-0000-0000000000a3'),
  '["82000000-0000-0000-0000-0000000000a2", "82000000-0000-0000-0000-0000000000a1"]',
  'evidências nomeiam as tentativas em ordem mais recente primeiro');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM item)
  AND event_type='work_routing_adjusted'),3::bigint,'um ajuste append-only existe por tentativa');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM item)
  AND event_type='work_routing_adjusted' AND author='system'),3::bigint,'ajustes são fatos sistêmicos');
SELECT throws_ok($$SELECT public.record_work_routing_adjustment((SELECT id FROM item),1,
  '82000000-0000-0000-0000-0000000000af',
  '{"schemaVersion":1,"policyVersion":"work-routing-adjustment-v1","kind":"none","baselineEffort":"light","effectiveEffort":"light","consecutiveFailures":0,"evidenceAttemptIds":[],"reason":"baseline_sufficient"}')$$,
  '22023','invalid work routing adjustment','aplicação não pode mentir sobre o histórico');

SELECT * FROM finish();
ROLLBACK;
