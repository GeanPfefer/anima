BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(14);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('87000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','resume@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('87000000-0000-0000-0000-000000000001','87000000-0000-0000-0000-000000000000','user','retomar');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('87000000-0000-0000-0000-000000000000');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','87000000-0000-0000-0000-000000000000',true);

CREATE TEMP TABLE item AS SELECT (public.create_work_proposal(
  '87000000-0000-0000-0000-000000000001','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"resume-target"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":3}}}',
  '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["verde"],"risks":[]}}'
)).id;
SELECT public.resolve_approval((SELECT id FROM item),1,'approve','{}');
SELECT public.acquire_work_claim((SELECT id FROM item),1,'87000000-0000-0000-0000-0000000000c1','sup-a',60);
SELECT public.start_claimed_work_attempt('87000000-0000-0000-0000-0000000000c1','87000000-0000-0000-0000-0000000000a1','fake');
SELECT public.record_work_checkpoint((SELECT id FROM item),1,'87000000-0000-0000-0000-0000000000a1',
 jsonb_build_object('kind','checkpoint','workItemId',(SELECT id FROM item),'attemptId','87000000-0000-0000-0000-0000000000a1',
 'approvedProposalVersion',1,'origin','executor','sequence',2,'checkpoint',jsonb_build_object(
 'schemaVersion',1,'handoffReference','bundle:cp','completedSteps',jsonb_build_array('feito'),
 'remainingSteps',jsonb_build_array('resta'),'nextStep','continuar','decisions','[]'::jsonb,'risks','[]'::jsonb,
 'touchedResources','[]'::jsonb,'validations','[]'::jsonb,'failures','[]'::jsonb,'evidenceReferences','[]'::jsonb)));
SET LOCAL ROLE service_role;
UPDATE public.work_claims SET acquired_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'
 WHERE id='87000000-0000-0000-0000-0000000000c1';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','87000000-0000-0000-0000-000000000000',true);
SELECT public.reconcile_supervised_work();

CREATE TEMP TABLE src AS SELECT public.abandoned_work_resumption_source((SELECT id FROM item)) value;
SELECT is(value->>'kind','abandoned_checkpoint','reconstrói fonte abandonada') FROM src;
SELECT is((value#>>'{checkpoint,checkpoint_signal_sequence}')::int,2,'seleciona maior sequência') FROM src;
SELECT is(value->>'source_attempt_id','87000000-0000-0000-0000-0000000000a1','correlaciona tentativa origem') FROM src;

SELECT lives_ok(format($q$SELECT public.begin_resumed_work_attempt(%L,1,
 '87000000-0000-0000-0000-0000000000a1',%s,%s,
 '87000000-0000-0000-0000-0000000000c2','87000000-0000-0000-0000-0000000000a2','sup-b',300,'fake')$q$,
 (SELECT id FROM item),(SELECT value#>>'{checkpoint,checkpoint_event_seq}' FROM src),
 (SELECT value->>'abandonment_event_seq' FROM src)),'inicia retomada atômica');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM item)),'in_progress','nova tentativa fica em progresso');
SELECT is((SELECT attempt_id::text FROM public.work_claims WHERE id='87000000-0000-0000-0000-0000000000c2'),
 '87000000-0000-0000-0000-0000000000a2','claim novo aponta tentativa nova');
SELECT is((SELECT payload#>>'{data,reason}' FROM public.work_events WHERE work_item_id=(SELECT id FROM item)
 AND event_type='work_started' ORDER BY seq DESC LIMIT 1),'resumed_execution','reason é resumed_execution');
SELECT is((SELECT payload#>>'{data,resumed_from_attempt_id}' FROM public.work_events WHERE work_item_id=(SELECT id FROM item)
 AND event_type='execution_started' ORDER BY seq DESC LIMIT 1),'87000000-0000-0000-0000-0000000000a1','vínculo aponta origem');
SELECT is((SELECT (payload#>>'{data,resumed_from_checkpoint_sequence}')::int FROM public.work_events WHERE work_item_id=(SELECT id FROM item)
 AND event_type='execution_started' ORDER BY seq DESC LIMIT 1),2,'vínculo aponta sequência');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='attempt_abandoned'),1::bigint,'abandono antigo intacto');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='checkpoint_recorded'),1::bigint,'checkpoint antigo intacto');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='execution_started'),2::bigint,'histórico contém duas tentativas');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM item)
 AND event_type='result_accepted'),0::bigint,'não aceita nem integra');
SELECT throws_ok($$SELECT public.record_work_checkpoint((SELECT id FROM item),1,
 '87000000-0000-0000-0000-0000000000a1','{}')$$,'22023',NULL,'executor zumbi é recusado');

SELECT * FROM finish();
ROLLBACK;
