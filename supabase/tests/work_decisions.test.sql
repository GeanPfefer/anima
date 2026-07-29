BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(20);
CREATE FUNCTION pg_temp.record_test_route(p_item uuid,p_attempt uuid,p_executor text DEFAULT 'local-runner-v1')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_current jsonb;v_classification jsonb;v_effort text;v_capability text;v_decision jsonb;v_adjustment jsonb;v_version integer;
BEGIN
  v_current:=public.current_work_intelligence_classification(p_item);v_classification:=v_current->'classification';
  SELECT capability::text,proposal_version INTO v_capability,v_version FROM public.work_items WHERE id=p_item;
  v_adjustment:=private.expected_work_routing_adjustment(p_item,v_version,private.required_work_effort(v_classification));
  PERFORM public.record_work_routing_adjustment(p_item,v_version,p_attempt,v_adjustment);v_effort:=v_adjustment->>'effectiveEffort';
  v_decision:=jsonb_build_object('schemaVersion',1,'policyVersion','work-routing-v1','capability',v_capability,
    'requiredEffort',v_effort,'selected',jsonb_build_object('routeId','test:declared','executorId',p_executor,
      'providerRef','test-node','modelRef','test-model','effort',v_effort),
    'factors',jsonb_build_object('complexity',v_classification->>'complexity','risk',v_classification->>'risk',
      'reversibility',v_classification->>'reversibility','planClarity',v_classification->>'planClarity',
      'urgency',v_classification->>'urgency','urgencyTieBreakApplied',false),'rejectedCandidates','[]'::jsonb);
  RETURN public.record_work_routing_decision(p_item,v_version,p_attempt,v_decision);
END $$;

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
('73000000-0000-0000-0000-000000000001','checkpoint_recorded','executor',1,'{"schema_version":1,"data":{"attempt_id":"74000000-0000-0000-0000-000000000001","signal_sequence":1,"checkpoint":{"schemaVersion":1,"handoffReference":"ux02-proof:checkpoint-1","completedSteps":["iniciado"],"remainingSteps":["concluir"],"nextStep":"decidir","decisions":[],"risks":[],"touchedResources":["x"],"validations":[],"failures":[],"evidenceReferences":[]}}}');
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
SELECT is((SELECT payload#>>'{data,input_request,reason}' FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='input_requested'),'architectural_decision','pedido reutiliza InputRequestedPayloadV1');
SELECT is((SELECT payload#>>'{data,input_request,source_state,checkpoint_reference}' FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='input_requested'),(SELECT id::text FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='checkpoint_recorded'),'source_state referencia o checkpoint exato');
SELECT is((SELECT payload#>>'{data,handoff,stopReason}' FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='input_requested'),'human_input_required','WorkHandoffV1 pausado é persistido');
SELECT lives_ok($$SELECT public.respond_to_work_decision('73000000-0000-0000-0000-000000000001',1,(SELECT id FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='input_requested'),'seguir')$$,'replay idempotente da mesma resposta');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='input_provided'),1::bigint,'replay não duplica consumo');
SELECT is(public.human_decision_resumption_source('73000000-0000-0000-0000-000000000001')->>'kind','human_decision_checkpoint','backend reconstrói fonte de retomada após refresh');
SELECT pg_temp.record_test_route('73000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000002');
SELECT lives_ok($$SELECT public.begin_human_decision_resumed_attempt(
  '73000000-0000-0000-0000-000000000001',1,
  (SELECT id FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='input_requested'),
  (SELECT id FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='input_provided'),
  '75000000-0000-0000-0000-000000000002','74000000-0000-0000-0000-000000000002','supervisor-resumed',300,'local-runner-v1')$$,
  'continuar inicia nova tentativa pelo checkpoint persistido');
SELECT is((SELECT payload#>>'{data,resumed_from_input_provided_event_id}' FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='execution_started' AND payload#>>'{data,attempt_id}'='74000000-0000-0000-0000-000000000002'),(SELECT id::text FROM public.work_events WHERE work_item_id='73000000-0000-0000-0000-000000000001' AND event_type='input_provided'),'nova tentativa referencia a decisão consumida');
SELECT lives_ok($$SELECT public.record_commanded_work_terminal(
  '73000000-0000-0000-0000-000000000001',1,'74000000-0000-0000-0000-000000000002',
  '{"kind":"result","workItemId":"73000000-0000-0000-0000-000000000001","attemptId":"74000000-0000-0000-0000-000000000002","approvedProposalVersion":1,"origin":"executor","sequence":2,"summary":"Retomado e concluído.","resultReferences":["ux02-proof:resumed"],"validations":[{"label":"retomada","outcome":"passed"}],"limitations":[],"handoffReference":"ux02-proof:completed"}')$$,
  'tentativa retomada persiste resultado real');
SELECT is((SELECT state::text FROM public.work_items WHERE id='73000000-0000-0000-0000-000000000001'),'review','retomada conclui em revisão sem integrar automaticamente');

SELECT * FROM finish();
ROLLBACK;
