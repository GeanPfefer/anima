BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('94000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','compute-router@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
VALUES('94000000-0000-0000-0000-000000000011','94000000-0000-0000-0000-000000000001','user','route compute');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('94000000-0000-0000-0000-000000000001');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',true);
CREATE TEMP TABLE target AS SELECT (public.create_work_proposal(
  '94000000-0000-0000-0000-000000000011','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}',
  '{"schema_version":1,"data":{"summary":"router","objective":"route","included_scope":["a"],"excluded_scope":["deploy"],"expected_effects":["ok"],"risks":[]}}')).id;
SELECT public.resolve_approval(id,1,'approve','{}') FROM target;

CREATE FUNCTION pg_temp.decision(p_status text, p_provider text, p_auth text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object(
  'schemaVersion',1,'policyVersion','compute-router-v1','workItemId',(SELECT id::text FROM target),
  'approvedProposalVersion',1,'capability','programming','taskClass','coding/simple','status',p_status,
  'selectedProvider',p_provider,'selectedModel',CASE WHEN p_provider IS NULL THEN NULL WHEN p_provider='openai' THEN 'gpt-x' ELSE 'qwen' END,
  'placement',CASE WHEN p_provider IS NULL THEN NULL WHEN p_provider='openai' THEN 'provider_api' ELSE 'local' END,
  'reasonCode',CASE WHEN p_status='selected' THEN 'local_sufficient' ELSE 'paid_authorization_required' END,
  'reason','decisão explicável','alternativesConsidered',jsonb_build_array(jsonb_build_object('provider','ollama'),jsonb_build_object('provider','openai')),
  'fallbackChain','[]'::jsonb,'paidAuthorityRequired',true,'authorizationId',p_auth,
  'economicsBasis',jsonb_build_object('used',false,'reason','not_provided','localCostPerVerified',NULL,'openaiCostPerVerified',NULL)); $$;

CREATE TEMP TABLE recorded AS SELECT public.record_compute_routing_decision((SELECT id FROM target),1,
  '94000000-0000-0000-0000-000000000021','94000000-0000-0000-0000-000000000031',pg_temp.decision('selected','ollama',NULL)) result;
SELECT is(result->>'action','recorded','registra decisão selecionada antes da tentativa') FROM recorded;
SELECT is((SELECT event_type::text FROM public.work_events WHERE work_item_id=(SELECT id FROM target) AND event_type='compute_routing_decided'),'compute_routing_decided','usa evento dedicado') ;
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=(SELECT id FROM target) AND event_type='compute_routing_decided'),'system','autoria é sistêmica');
SELECT is((public.record_compute_routing_decision((SELECT id FROM target),1,'94000000-0000-0000-0000-000000000021','94000000-0000-0000-0000-000000000031',pg_temp.decision('selected','ollama',NULL)))->>'action','replayed','replay idêntico');
SELECT throws_ok($$SELECT public.record_compute_routing_decision((SELECT id FROM target),1,'94000000-0000-0000-0000-000000000021','94000000-0000-0000-0000-000000000031',pg_temp.decision('selected','openai','auth'))$$,'55000','compute routing decision conflict','divergência conflita');
SELECT throws_ok($$SELECT public.record_compute_routing_decision((SELECT id FROM target),1,'94000000-0000-0000-0000-000000000022','94000000-0000-0000-0000-000000000032',pg_temp.decision('selected','openai',NULL))$$,'22023','invalid compute routing authority correlation','OpenAI sem authority é recusada');
SELECT is((public.record_compute_routing_decision((SELECT id FROM target),1,'94000000-0000-0000-0000-000000000023',NULL,pg_temp.decision('waiting_for_human_authorization',NULL,NULL)))->>'action','recorded','waiting sem tentativa é persistido');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM target) AND event_type='execution_started'),0::bigint,'decisão não inicia execução');

SELECT * FROM finish();
ROLLBACK;
