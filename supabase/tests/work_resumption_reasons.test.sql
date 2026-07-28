-- AUTO-05 / Etapa 2B.2 — as três razões de abandono atravessam a retomada
-- intactas, cada uma pela via de reconciliação que realmente a produz.
--
-- O que estas asserções provam, em uma frase: `abandoned_work_resumption_source`
-- e `begin_resumed_work_attempt` leem a razão técnica persistida por
-- `attempt_abandoned` no vocabulário PRÓPRIO do abandono e a preservam literal —
-- nunca a convertem em `InterruptionScenario` (que é do ramo terminal
-- `WorkHandoffV1`) nem inventam `status`/`stopReason` como `paused`, `timed_out`
-- ou `time_limit_reached`. As três razões nascem aqui da reconciliação real
-- (SUP-04), não de um evento fabricado: `lease_expired` (só lease vencido),
-- `duration_limit_exceeded` (comandada sem posse, só duração vencida) e
-- `declared_bounds_exceeded` (posse e duração vencidas juntas).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(18);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('86000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','resume-reasons@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
SELECT ('86000000-0000-0000-0000-0000000000'||lpad(n::text,2,'0'))::uuid,'86000000-0000-0000-0000-000000000000','user','pedido '||n
FROM generate_series(1,3) AS n;
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('86000000-0000-0000-0000-000000000000');
RESET ROLE;

\set prop '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["verde"],"risks":[]}}'
-- Alvos distintos por razão: o SUP-05 recusaria dois inícios no mesmo alvo.
-- lease: só max_attempts (sem duração) → lease_expired.
\set lease_spec '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"rr-lease"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":3}}}'
-- dur: só max_duration_minutes, via comandada sem posse → duration_limit_exceeded.
\set dur_spec '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"rr-dur"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_duration_minutes":1}}}'
-- both: posse com lease E duração declarada, ambas vencidas → declared_bounds_exceeded.
\set both_spec '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"rr-both"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":3,"max_duration_minutes":1}}}'

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','86000000-0000-0000-0000-000000000000',true);

-- ============================================================
-- (A) lease_expired — supervisionada, só o lease venceu
-- ============================================================

CREATE TEMP TABLE lease_item AS SELECT (public.create_work_proposal('86000000-0000-0000-0000-000000000001','low','programming',:'lease_spec'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM lease_item),1,'approve','{}');
SELECT public.acquire_work_claim((SELECT id FROM lease_item),1,'86000000-0000-4000-8000-0000000000c1','sup-lease',3600);
SELECT public.start_claimed_work_attempt('86000000-0000-4000-8000-0000000000c1','86000000-0000-4000-8000-0000000000a1','fake');
SELECT public.record_work_checkpoint((SELECT id FROM lease_item),1,'86000000-0000-4000-8000-0000000000a1',
  jsonb_build_object('kind','checkpoint','workItemId',(SELECT id FROM lease_item),'attemptId','86000000-0000-4000-8000-0000000000a1',
  'approvedProposalVersion',1,'origin','executor','sequence',2,'checkpoint',jsonb_build_object(
  'schemaVersion',1,'handoffReference','bundle:cp','completedSteps',jsonb_build_array('feito'),
  'remainingSteps',jsonb_build_array('resta'),'nextStep','continuar','decisions','[]'::jsonb,'risks','[]'::jsonb,
  'touchedResources','[]'::jsonb,'validations','[]'::jsonb,'failures','[]'::jsonb,'evidenceReferences','[]'::jsonb)));
SET LOCAL ROLE service_role;
UPDATE public.work_claims SET acquired_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'
  WHERE id='86000000-0000-4000-8000-0000000000c1';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','86000000-0000-0000-0000-000000000000',true);
SELECT public.reconcile_supervised_work();

SELECT is((SELECT payload->'data'->>'reason' FROM public.work_events WHERE work_item_id=(SELECT id FROM lease_item)
  AND event_type='attempt_abandoned' ORDER BY seq DESC LIMIT 1),'lease_expired',
  'lease vencido sem duração declarada é abandonado como lease_expired');
CREATE TEMP TABLE lease_src AS SELECT public.abandoned_work_resumption_source((SELECT id FROM lease_item)) value;
SELECT is((SELECT value->>'kind' FROM lease_src),'abandoned_checkpoint','lease: fonte de retomada é a de checkpoint abandonado');
SELECT ok((SELECT (value->>'abandonment_reason')='lease_expired'
  AND (value->>'abandonment_reason') NOT IN ('provider_limit_reached','application_shutdown','machine_restart','container_runtime_unavailable','network_failure','model_failure','executor_change')
  AND NOT (value ? 'scenario')
  AND value::text NOT LIKE '%time_limit_reached%' AND value::text NOT LIKE '%timed_out%' AND value::text NOT LIKE '%"paused"%'
  FROM lease_src),'lease_expired preservado literal: sem InterruptionScenario, status ou stopReason inventados');
SELECT lives_ok(format($q$SELECT public.begin_resumed_work_attempt(%L,1,
  '86000000-0000-4000-8000-0000000000a1',%s,%s,
  '86000000-0000-4000-8000-0000000000d1','86000000-0000-4000-8000-0000000000b1','sup-lease-b',300,'fake')$q$,
  (SELECT id FROM lease_item),(SELECT value#>>'{checkpoint,checkpoint_event_seq}' FROM lease_src),
  (SELECT value->>'abandonment_event_seq' FROM lease_src)),'lease_expired é aceito pelo início atômico da retomada');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM lease_item)),'in_progress','lease: nova tentativa em progresso');
SELECT is((SELECT payload->'data'->>'reason' FROM public.work_events WHERE work_item_id=(SELECT id FROM lease_item)
  AND event_type='execution_started' ORDER BY seq DESC LIMIT 1),'resumed_execution','lease: início marcado como retomada, não como cenário');

-- ============================================================
-- (B) duration_limit_exceeded — comandada sem posse, só a duração venceu
-- ============================================================

CREATE TEMP TABLE dur_item AS SELECT (public.create_work_proposal('86000000-0000-0000-0000-000000000002','low','programming',:'dur_spec'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM dur_item),1,'approve','{}');
SELECT public.start_commanded_work_attempt((SELECT id FROM dur_item),1,'86000000-0000-4000-8000-0000000000a2','fake');
SELECT public.record_work_checkpoint((SELECT id FROM dur_item),1,'86000000-0000-4000-8000-0000000000a2',
  jsonb_build_object('kind','checkpoint','workItemId',(SELECT id FROM dur_item),'attemptId','86000000-0000-4000-8000-0000000000a2',
  'approvedProposalVersion',1,'origin','executor','sequence',2,'checkpoint',jsonb_build_object(
  'schemaVersion',1,'handoffReference','bundle:cp','completedSteps',jsonb_build_array('feito'),
  'remainingSteps',jsonb_build_array('resta'),'nextStep','continuar','decisions','[]'::jsonb,'risks','[]'::jsonb,
  'touchedResources','[]'::jsonb,'validations','[]'::jsonb,'failures','[]'::jsonb,'evidenceReferences','[]'::jsonb)));
SET LOCAL ROLE service_role;
-- Sob service_role as tabelas temporárias do papel anterior não são visíveis; o
-- alvo, único por razão, identifica o item sem depender delas.
UPDATE public.work_events SET created_at=now()-interval '2 hours'
  WHERE event_type='execution_started' AND work_item_id IN (
    SELECT id FROM public.work_items WHERE user_id='86000000-0000-0000-0000-000000000000'
      AND intent#>>'{execution_spec,target,reference}'='rr-dur');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','86000000-0000-0000-0000-000000000000',true);
SELECT public.reconcile_supervised_work();

SELECT is((SELECT payload->'data'->>'reason' FROM public.work_events WHERE work_item_id=(SELECT id FROM dur_item)
  AND event_type='attempt_abandoned' ORDER BY seq DESC LIMIT 1),'duration_limit_exceeded',
  'comandada sem posse que excedeu a duração é abandonada como duration_limit_exceeded');
CREATE TEMP TABLE dur_src AS SELECT public.abandoned_work_resumption_source((SELECT id FROM dur_item)) value;
SELECT is((SELECT value->>'kind' FROM dur_src),'abandoned_checkpoint','dur: fonte de retomada é a de checkpoint abandonado');
SELECT ok((SELECT (value->>'abandonment_reason')='duration_limit_exceeded'
  AND (value->>'abandonment_reason') NOT IN ('provider_limit_reached','application_shutdown','machine_restart','container_runtime_unavailable','network_failure','model_failure','executor_change')
  AND NOT (value ? 'scenario')
  AND value::text NOT LIKE '%time_limit_reached%' AND value::text NOT LIKE '%timed_out%' AND value::text NOT LIKE '%"paused"%'
  FROM dur_src),'duration_limit_exceeded preservado literal: sem InterruptionScenario, status ou stopReason inventados');
SELECT lives_ok(format($q$SELECT public.begin_resumed_work_attempt(%L,1,
  '86000000-0000-4000-8000-0000000000a2',%s,%s,
  '86000000-0000-4000-8000-0000000000d2','86000000-0000-4000-8000-0000000000b2','sup-dur-b',300,'fake')$q$,
  (SELECT id FROM dur_item),(SELECT value#>>'{checkpoint,checkpoint_event_seq}' FROM dur_src),
  (SELECT value->>'abandonment_event_seq' FROM dur_src)),'duration_limit_exceeded é aceito pelo início atômico da retomada');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM dur_item)),'in_progress','dur: nova tentativa em progresso');
SELECT is((SELECT payload->'data'->>'reason' FROM public.work_events WHERE work_item_id=(SELECT id FROM dur_item)
  AND event_type='execution_started' ORDER BY seq DESC LIMIT 1),'resumed_execution','dur: início marcado como retomada, não como cenário');

-- ============================================================
-- (C) declared_bounds_exceeded — posse e duração vencidas juntas
-- ============================================================

CREATE TEMP TABLE both_item AS SELECT (public.create_work_proposal('86000000-0000-0000-0000-000000000003','low','programming',:'both_spec'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM both_item),1,'approve','{}');
SELECT public.acquire_work_claim((SELECT id FROM both_item),1,'86000000-0000-4000-8000-0000000000c3','sup-both',3600);
SELECT public.start_claimed_work_attempt('86000000-0000-4000-8000-0000000000c3','86000000-0000-4000-8000-0000000000a3','fake');
SELECT public.record_work_checkpoint((SELECT id FROM both_item),1,'86000000-0000-4000-8000-0000000000a3',
  jsonb_build_object('kind','checkpoint','workItemId',(SELECT id FROM both_item),'attemptId','86000000-0000-4000-8000-0000000000a3',
  'approvedProposalVersion',1,'origin','executor','sequence',2,'checkpoint',jsonb_build_object(
  'schemaVersion',1,'handoffReference','bundle:cp','completedSteps',jsonb_build_array('feito'),
  'remainingSteps',jsonb_build_array('resta'),'nextStep','continuar','decisions','[]'::jsonb,'risks','[]'::jsonb,
  'touchedResources','[]'::jsonb,'validations','[]'::jsonb,'failures','[]'::jsonb,'evidenceReferences','[]'::jsonb)));
SET LOCAL ROLE service_role;
UPDATE public.work_claims SET acquired_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'
  WHERE id='86000000-0000-4000-8000-0000000000c3';
UPDATE public.work_events SET created_at=now()-interval '2 hours'
  WHERE event_type='execution_started' AND work_item_id IN (
    SELECT id FROM public.work_items WHERE user_id='86000000-0000-0000-0000-000000000000'
      AND intent#>>'{execution_spec,target,reference}'='rr-both');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','86000000-0000-0000-0000-000000000000',true);
SELECT public.reconcile_supervised_work();

SELECT is((SELECT payload->'data'->>'reason' FROM public.work_events WHERE work_item_id=(SELECT id FROM both_item)
  AND event_type='attempt_abandoned' ORDER BY seq DESC LIMIT 1),'declared_bounds_exceeded',
  'lease e duração vencidos juntos são abandonados como declared_bounds_exceeded');
CREATE TEMP TABLE both_src AS SELECT public.abandoned_work_resumption_source((SELECT id FROM both_item)) value;
SELECT is((SELECT value->>'kind' FROM both_src),'abandoned_checkpoint','both: fonte de retomada é a de checkpoint abandonado');
SELECT ok((SELECT (value->>'abandonment_reason')='declared_bounds_exceeded'
  AND (value->>'abandonment_reason') NOT IN ('provider_limit_reached','application_shutdown','machine_restart','container_runtime_unavailable','network_failure','model_failure','executor_change')
  AND NOT (value ? 'scenario')
  AND value::text NOT LIKE '%time_limit_reached%' AND value::text NOT LIKE '%timed_out%' AND value::text NOT LIKE '%"paused"%'
  FROM both_src),'declared_bounds_exceeded preservado literal: sem InterruptionScenario, status ou stopReason inventados');
SELECT lives_ok(format($q$SELECT public.begin_resumed_work_attempt(%L,1,
  '86000000-0000-4000-8000-0000000000a3',%s,%s,
  '86000000-0000-4000-8000-0000000000d3','86000000-0000-4000-8000-0000000000b3','sup-both-b',300,'fake')$q$,
  (SELECT id FROM both_item),(SELECT value#>>'{checkpoint,checkpoint_event_seq}' FROM both_src),
  (SELECT value->>'abandonment_event_seq' FROM both_src)),'declared_bounds_exceeded é aceito pelo início atômico da retomada');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM both_item)),'in_progress','both: nova tentativa em progresso');
SELECT is((SELECT payload->'data'->>'reason' FROM public.work_events WHERE work_item_id=(SELECT id FROM both_item)
  AND event_type='execution_started' ORDER BY seq DESC LIMIT 1),'resumed_execution','both: início marcado como retomada, não como cenário');

SELECT * FROM finish();
ROLLBACK;
