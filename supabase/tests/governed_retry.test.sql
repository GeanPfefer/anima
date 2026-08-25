BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('91000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','retry@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','user','fixture retry');
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason) VALUES('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','retry pgTAP');
INSERT INTO public.work_items(id,user_id,source_message_id,state,impact_level,capability,original_request,intent,proposal,proposal_version)
VALUES('93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','failed','low','programming','fixture',
'{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"executor":"worktree","coder_backend":"ollama","model":"fixture","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"test","command":"npm test"}],"limits":{"max_attempts":2,"max_duration_minutes":5}}}'::jsonb,
'{"schema_version":1,"data":{"summary":"fixture","objective":"fixture","included_scope":["x"],"excluded_scope":["cloud"],"expected_effects":["x"],"risks":[]}}'::jsonb,2);
INSERT INTO public.work_events(id,work_item_id,event_type,author,proposal_version,payload) VALUES
('94000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','work_approved','user',2,'{"schema_version":1,"data":{"decision":"approve","decided_proposal_version":2}}'),
('94000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001','work_intelligence_classified','system',2,'{"schema_version":1,"data":{"approved_proposal_version":2,"classification_revision":1,"previous_classification_revision":0,"supersedes_event_id":null,"classification":{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"system_assessed","classifiedAt":"2026-08-25T00:00:00Z","classifierId":"fixture","policyVersion":"v1"}}}}'),
('94000000-0000-4000-8000-000000000006','93000000-0000-4000-8000-000000000001','work_routing_adjusted','system',2,'{"schema_version":1,"data":{"attempt_id":"95000000-0000-4000-8000-000000000001","approved_proposal_version":2,"adjustment":{"schemaVersion":1,"policyVersion":"work-routing-adjustment-v1","kind":"none","reason":"baseline_sufficient","baselineEffort":"light","effectiveEffort":"light","consecutiveFailures":0,"evidenceAttemptIds":[]}}}'),
('94000000-0000-4000-8000-000000000005','93000000-0000-4000-8000-000000000001','work_routing_decided','system',2,'{"schema_version":1,"data":{"attempt_id":"95000000-0000-4000-8000-000000000001","approved_proposal_version":2,"decision":{"schemaVersion":1,"policyVersion":"work-routing-v1","capability":"programming","requiredEffort":"light","selected":{"routeId":"fixture","executorId":"worktree-v1","providerRef":"worktree-host","modelRef":"ollama:fixture","effort":"light"},"factors":{"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","urgencyTieBreakApplied":false},"rejectedCandidates":[]}}}'),
('94000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000001','execution_started','anima',2,'{"schema_version":1,"data":{"attempt_id":"95000000-0000-4000-8000-000000000001","claim_id":"96000000-0000-4000-8000-000000000001"}}'),
('94000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000001','execution_failed','executor',2,'{"schema_version":1,"data":{"attempt_id":"95000000-0000-4000-8000-000000000001","retryable":true}}');

SELECT has_function('public','current_work_retry_readiness',ARRAY['uuid'],'readiness RPC existe');
SELECT has_function('public','request_work_retry',ARRAY['uuid','integer','uuid','uuid'],'retry RPC existe');
SELECT has_function('public','request_autonomous_execution',ARRAY['uuid','integer','uuid'],'signal RPC existe');
SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
SELECT is(public.current_work_retry_readiness('93000000-0000-4000-8000-000000000001')->>'status','RETRY_READY','1/2 retryable fica pronto');
SELECT is(public.current_work_retry_readiness('93000000-0000-4000-8000-000000000001')->>'attemptsUsed','1','attempt histórica contada');
SELECT is(public.request_work_retry('93000000-0000-4000-8000-000000000001',2,'94000000-0000-4000-8000-000000000004','97000000-0000-4000-8000-000000000001')->>'replayed','false','primeiro ato cria reentry');
SELECT is((SELECT state::text FROM public.work_items WHERE id='93000000-0000-4000-8000-000000000001'),'approved','reentry reabre elegibilidade');
SELECT is(public.request_work_retry('93000000-0000-4000-8000-000000000001',2,'94000000-0000-4000-8000-000000000004','97000000-0000-4000-8000-000000000001')->>'replayed','true','replay devolve mesmo ato');
SELECT is((SELECT count(*)::text FROM public.work_events WHERE work_item_id='93000000-0000-4000-8000-000000000001' AND payload->'data'->>'authority'='retry_authorization'),'1','replay não duplica');
SELECT is((SELECT count(*)::text FROM public.work_events WHERE work_item_id='93000000-0000-4000-8000-000000000001' AND event_type='execution_started'),'1','reentry não cria attempt');
SELECT * FROM finish();
ROLLBACK;
