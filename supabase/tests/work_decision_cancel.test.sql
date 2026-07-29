BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('76000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ux02-cancel@test.invalid','',now(),'{}','{}',now(),now());
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason)
VALUES('76000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000001','UX-02 cancel');
INSERT INTO public.ai_conversations(id,user_id,role,content)
VALUES('76100000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000001','user','Cancelar UX-02');
INSERT INTO public.work_items(id,user_id,source_message_id,state,impact_level,capability,original_request,intent,proposal,proposal_version)
VALUES('76200000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000001','76100000-0000-0000-0000-000000000001','approved','low','programming','Teste',
 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"ux02-deterministic-decision"},"permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"teste"}],"limits":{"max_attempts":3,"max_duration_minutes":5}}}',
 '{"schema_version":1,"data":{"summary":"Teste","objective":"Testar","included_scope":["proof.txt"],"excluded_scope":["deploy"],"expected_effects":["prova"],"risks":[]}}',1);
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
VALUES('76200000-0000-0000-0000-000000000001','work_intelligence_classified','anima',1,
 '{"schema_version":1,"data":{"approved_proposal_version":1,"classification_revision":1,"classification":{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-29T12:00:00Z","classifierId":"user:test"}}}}');
INSERT INTO public.work_claims(id,user_id,work_item_id,approved_proposal_version,target_reference,owner_instance_id,attempt_id,expires_at)
VALUES('76300000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000001','76200000-0000-0000-0000-000000000001',1,'ux02-deterministic-decision','supervisor','76400000-0000-0000-0000-000000000001',now()+interval '5 minutes');
UPDATE public.work_items SET state='in_progress' WHERE id='76200000-0000-0000-0000-000000000001';
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
('76200000-0000-0000-0000-000000000001','execution_started','anima',1,'{"schema_version":1,"data":{"attempt_id":"76400000-0000-0000-0000-000000000001"}}'),
('76200000-0000-0000-0000-000000000001','checkpoint_recorded','executor',1,'{"schema_version":1,"data":{"attempt_id":"76400000-0000-0000-0000-000000000001","signal_sequence":2,"checkpoint":{"schemaVersion":1,"handoffReference":"ux02-proof:checkpoint-1","completedSteps":["iniciado"],"remainingSteps":["concluir"],"nextStep":"continuar","decisions":[],"risks":[],"touchedResources":["proof.txt"],"validations":[],"failures":[],"evidenceReferences":[]}}}');
RESET ROLE; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','76000000-0000-0000-0000-000000000001',true);
SELECT lives_ok($$SELECT public.record_work_decision_required('76200000-0000-0000-0000-000000000001',1,'76400000-0000-0000-0000-000000000001',
 '{"kind":"decision_required","workItemId":"76200000-0000-0000-0000-000000000001","attemptId":"76400000-0000-0000-0000-000000000001","approvedProposalVersion":1,"origin":"executor","sequence":3,"reason":"architectural_decision","explanation":"Continuar ou encerrar?","options":[{"id":"continuar","label":"Continuar","effect":"resume"},{"id":"encerrar","label":"Encerrar","effect":"cancel"}]}')$$,'pedido é persistido');
SELECT lives_ok($$SELECT public.respond_to_work_decision('76200000-0000-0000-0000-000000000001',1,(SELECT id FROM public.work_events WHERE work_item_id='76200000-0000-0000-0000-000000000001' AND event_type='input_requested'),'encerrar')$$,'encerrar consome a decisão');
SELECT is((SELECT state::text FROM public.work_items WHERE id='76200000-0000-0000-0000-000000000001'),'cancelled','encerrar cancela persistentemente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id='76200000-0000-0000-0000-000000000001' AND event_type='work_cancelled'),1::bigint,'cancelamento tem um único evento');
SELECT lives_ok($$SELECT public.respond_to_work_decision('76200000-0000-0000-0000-000000000001',1,(SELECT id FROM public.work_events WHERE work_item_id='76200000-0000-0000-0000-000000000001' AND event_type='input_requested'),'encerrar')$$,'clique repetido é idempotente');
SELECT throws_ok($$SELECT public.respond_to_work_decision('76200000-0000-0000-0000-000000000001',1,(SELECT id FROM public.work_events WHERE work_item_id='76200000-0000-0000-0000-000000000001' AND event_type='input_requested'),'continuar')$$,'55000','decision was already answered differently','resposta divergente tardia falha fechado');
SELECT * FROM finish(); ROLLBACK;
