BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('71000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ux02@test.invalid','',now(),'{}','{}',now(),now());
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason)
VALUES('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','UX-02 pgTAP');
INSERT INTO public.ai_conversations(id,user_id,role,content)
VALUES('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','user','Teste UX-02');
INSERT INTO public.work_items(id,user_id,source_message_id,state,impact_level,capability,original_request,intent,proposal,proposal_version)
VALUES('73000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','approved','low','programming','Teste',
  '{"execution_spec":{"mode":"autonomous","target":{"kind":"local_repository","reference":"test"},"permissions":{"read":["x"],"write":["x"]},"validation_criteria":["teste"],"limits":{"max_attempts":1,"max_duration_minutes":5}}}',
  '{"schema_version":1,"data":{"summary":"Teste","objective":"Testar","included_scope":["x"],"excluded_scope":[],"expected_effects":["x"],"risks":[]}}',1);
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
VALUES('73000000-0000-0000-0000-000000000001','work_intelligence_classified','anima',1,'{"schema_version":1,"data":{"approved_proposal_version":1,"classification_revision":1,"classification":{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-29T12:00:00Z","classifierId":"user:test"}}}}');
INSERT INTO public.work_claims(id,user_id,work_item_id,approved_proposal_version,target_reference,owner_instance_id,attempt_id,expires_at)
VALUES('75000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001',1,'test','supervisor','74000000-0000-0000-0000-000000000001',now()+interval '5 minutes');
UPDATE public.work_items SET state='in_progress' WHERE id='73000000-0000-0000-0000-000000000001';
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
('73000000-0000-0000-0000-000000000001','execution_started','anima',1,'{"schema_version":1,"data":{"attempt_id":"74000000-0000-0000-0000-000000000001"}}'),
('73000000-0000-0000-0000-000000000001','checkpoint_recorded','executor',1,'{"schema_version":1,"data":{"attempt_id":"74000000-0000-0000-0000-000000000001","signal_sequence":1,"checkpoint":{"nextStep":"decidir"}}}');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);

SELECT lives_ok($$SELECT public.record_work_decision_required(
  '73000000-0000-0000-0000-000000000001',1,'74000000-0000-0000-0000-000000000001',
  '{"kind":"decision_required","workItemId":"73000000-0000-0000-0000-000000000001","attemptId":"74000000-0000-0000-0000-000000000001","approvedProposalVersion":1,"origin":"executor","sequence":2,"reason":"architectural_decision","explanation":"Escolha a fronteira.","options":[{"id":"seguir","label":"Seguir","effect":"resume"},{"id":"parar","label":"Parar","effect":"cancel"}]}'
)$$,'interrupção tipada é persistida');
SELECT is((SELECT state::text FROM public.work_items WHERE id='73000000-0000-0000-0000-000000000001'),'blocked','trabalho permanece bloqueado');
SELECT is((SELECT payload->'data'->>'reason' FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='input_requested'),'architectural_decision','razão exata é preservada');
SELECT is((SELECT payload->'data'->'options'->0->>'id' FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='input_requested'),'seguir','alternativa exata é preservada');
SELECT ok((SELECT released_at IS NOT NULL FROM public.work_claims WHERE id='75000000-0000-0000-0000-000000000001'),'claim é liberado');
SELECT throws_ok($$SELECT public.respond_to_work_decision('73000000-0000-0000-0000-000000000001',1,(SELECT id FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='input_requested'),'inventada')$$,'22023','decision option not presented','alternativa não apresentada é recusada');
SELECT lives_ok($$SELECT public.respond_to_work_decision('73000000-0000-0000-0000-000000000001',1,(SELECT id FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='input_requested'),'seguir')$$,'resposta exata retoma');
SELECT is((SELECT state::text FROM public.work_items WHERE id='73000000-0000-0000-0000-000000000001'),'approved','retomada volta à fila aprovada');
SELECT is((SELECT payload->'data'->>'option_id' FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='input_provided'),'seguir','decisão exata fica auditável');
SELECT throws_ok($$SELECT public.respond_to_work_decision('73000000-0000-0000-0000-000000000001',2,(SELECT id FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='input_requested'),'seguir')$$,'P0002','decision request not found','versão obsoleta é recusada');

SELECT * FROM finish();
ROLLBACK;
