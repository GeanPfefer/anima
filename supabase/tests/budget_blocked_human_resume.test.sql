BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(16);

-- Este teste isola a autoridade/orçamento; classificação e routing têm suítes próprias.
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_routing_on_attempt;

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
VALUES('76000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','budget-resume@test.invalid','',now(),now());
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason)
VALUES('76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001','test');
INSERT INTO public.ai_conversations(id,user_id,role,content)
VALUES('76000000-0000-4000-8000-000000000011','76000000-0000-4000-8000-000000000001','user','test');

CREATE FUNCTION pg_temp.proposal(label text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('schema_version',1,'data',jsonb_build_object('summary',label,'objective','objetivo',
  'included_scope',jsonb_build_array('apps/web/scripts/x.ts'),'excluded_scope',jsonb_build_array('main'),
  'expected_effects',jsonb_build_array('feito'),'risks',jsonb_build_array('risco')))
$$;
CREATE FUNCTION pg_temp.intent() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('execution_spec',jsonb_build_object('schema_version',1,
  'target',jsonb_build_object('kind','project','reference','anima'),'executor','worktree','coder_backend','openai','model','gpt-test',
  'permissions',jsonb_build_array('workspace_read','workspace_write_isolated'),
  'validation_criteria',jsonb_build_array(jsonb_build_object('label','gate','command','npm test','covers',jsonb_build_array('feito'))),
  'limits',jsonb_build_object('max_attempts',3,'max_duration_minutes',30)))
$$;
CREATE FUNCTION pg_temp.auth(req text DEFAULT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reason text DEFAULT 'user_attempt_budget_exhausted')
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('schemaVersion',1,'kind','budget_blocked_attempt_v1',
 'requestId',req,'reason','Autorizo exatamente uma tentativa adicional para este item bloqueado.',
 'additionalAttempts',1,'expectedBudgetReason',reason) $$;

CREATE TEMP TABLE ids(label text PRIMARY KEY,id uuid NOT NULL);
INSERT INTO ids VALUES ('target','76000000-0000-4000-8000-000000000021'),('other','76000000-0000-4000-8000-000000000022'),('wrong','76000000-0000-4000-8000-000000000023');
INSERT INTO public.work_items(id,user_id,source_message_id,state,impact_level,capability,original_request,intent,proposal,proposal_version)
SELECT id,'76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000011',
 CASE WHEN label='other' THEN 'failed'::public.work_state ELSE 'blocked'::public.work_state END,
 'low','programming','req',pg_temp.intent(),pg_temp.proposal(label),2 FROM ids;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
SELECT id,'work_approved','user',2,'{"schema_version":1,"data":{"authority":"autonomous_execution_request"}}' FROM ids WHERE label<>'other';
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
SELECT id,'work_intelligence_classified','system',2,'{"schema_version":1,"data":{"classification":"test"}}' FROM ids WHERE label<>'other';
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
SELECT id,'work_blocked','anima',2,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
 'reason',CASE WHEN label='wrong' THEN 'permission_missing' ELSE 'user_attempt_budget_exhausted' END,
 'reached_limit','attempts','resolution','awaits_budget_window')) FROM ids WHERE label<>'other';

-- Seis attempts históricos continuam no ledger; a concessão não os apaga.
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_work_budget_before_start;
DO $$ DECLARE n int; a uuid; BEGIN FOR n IN 1..6 LOOP a:=gen_random_uuid();
 INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
 VALUES((SELECT id FROM ids WHERE label='other'),'execution_started','anima',2,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',a,'claim_id',gen_random_uuid())));
 INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
 VALUES((SELECT id FROM ids WHERE label='other'),'execution_failed','executor',2,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',a,'retryable',false)));
 END LOOP; END $$;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_work_budget_before_start;

SELECT set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000001',true);
SELECT is(public.autonomous_work_budget_status((SELECT id FROM ids WHERE label='target'))->>'reason','user_attempt_budget_exhausted','pré-condição: teto global segue esgotado');
CREATE TEMP TABLE grant_result AS SELECT public.authorize_work_resume((SELECT id FROM ids WHERE label='target'),2,pg_temp.auth()) value;
SELECT is(value->>'additionalAttempts','1','concede exatamente +1') FROM grant_result;
SELECT is(value->>'workItemId',(SELECT id::text FROM ids WHERE label='target'),'readmite o mesmo item') FROM grant_result;
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM ids WHERE label='target')),'approved','blocked vira approved');
SELECT is((SELECT count(*)::int FROM public.work_events WHERE work_item_id=(SELECT id FROM ids WHERE label='target') AND event_type='execution_started'),0,'concessão não executa');
SELECT is((public.autonomous_work_budget_status((SELECT id FROM ids WHERE label='target'))#>>'{usage,userAttempts24Hours}')::int,6,'contador global não é resetado');
SELECT is(public.autonomous_work_budget_status((SELECT id FROM ids WHERE label='target'))->>'admitted','true','token projeta readmissão');
SELECT is((public.authorize_work_resume((SELECT id FROM ids WHERE label='target'),2,pg_temp.auth()))->>'replayed','true','replay idempotente');
SELECT is((SELECT count(*)::int FROM public.work_budget_resume_authorizations),1,'replay não duplica concessão');
SELECT throws_ok($$SELECT public.authorize_work_resume((SELECT id FROM ids WHERE label='wrong'),2,pg_temp.auth('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','user_attempt_budget_exhausted'))$$,
 '55000','work_item_not_budget_blocked','blocked por outro motivo é recusado');
SELECT throws_ok($$SELECT public.authorize_work_resume((SELECT id FROM ids WHERE label='other'),2,pg_temp.auth('cccccccc-cccc-4ccc-8ccc-cccccccccccc'))$$,
 '55000','work_item_not_budget_blocked','item fora de blocked é recusado');
SELECT throws_ok($$SELECT public.authorize_work_resume((SELECT id FROM ids WHERE label='target'),1,pg_temp.auth())$$,
 '55000','authorization_conflict','versão divergente é recusada até em replay');

RESET ROLE;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
VALUES((SELECT id FROM ids WHERE label='target'),'execution_started','anima',2,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
 'attempt_id','76000000-0000-4000-8000-000000000099','claim_id','76000000-0000-4000-8000-000000000098')));
SELECT ok((SELECT consumed_at IS NOT NULL FROM public.work_budget_resume_authorizations),'primeiro execution_started consome o token');
SELECT is((SELECT consumed_attempt_id::text FROM public.work_budget_resume_authorizations),'76000000-0000-4000-8000-000000000099','consumo correlaciona attempt');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
VALUES((SELECT id FROM ids WHERE label='target'),'execution_failed','executor',2,'{"schema_version":1,"data":{"attempt_id":"76000000-0000-4000-8000-000000000099","retryable":true}}');
SELECT throws_ok($$INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
 VALUES((SELECT id FROM ids WHERE label='target'),'execution_started','anima',2,'{"schema_version":1,"data":{"attempt_id":"76000000-0000-4000-8000-000000000097","claim_id":"76000000-0000-4000-8000-000000000096"}}')$$,
 'P0001','user_attempt_budget_exhausted','segunda tentativa extra sem nova autoridade é recusada');
SELECT is((SELECT count(*)::int FROM public.work_events WHERE work_item_id=(SELECT id FROM ids WHERE label='target') AND event_type IN ('result_accepted','branch_published','review_request_created')),0,'concessão não integra/publica/aceita');

ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_routing_on_attempt;
SELECT * FROM finish();
ROLLBACK;
