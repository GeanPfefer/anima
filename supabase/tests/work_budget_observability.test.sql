BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('8f000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','budget-observability@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('8f000000-0000-0000-0000-000000000011','8f000000-0000-0000-0000-000000000001','user','budget');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('8f000000-0000-0000-0000-000000000001');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','8f000000-0000-0000-0000-000000000001',true);
CREATE TEMP TABLE observed_item AS SELECT id FROM public.create_work_proposal(
  '8f000000-0000-0000-0000-000000000011','low','programming',
  jsonb_build_object('execution_spec',jsonb_build_object('coder_backend','openai','limits',jsonb_build_object('max_attempts',3))),
  '{"schema_version":1,"data":{"summary":"budget","objective":"observe","included_scope":["x"],"excluded_scope":[],"expected_effects":[],"risks":[]}}');
GRANT SELECT ON observed_item TO service_role;
SELECT public.resolve_approval((SELECT id FROM observed_item),1,'approve','{}');
RESET ROLE;
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_routing_on_attempt;
SET LOCAL ROLE service_role;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at)
SELECT id,'execution_started','anima',1,'{"schema_version":1,"data":{"attempt_id":"8f000000-0000-0000-0000-000000000021","claim_id":"8f000000-0000-0000-0000-000000000031"}}',now()-interval '2 hours' FROM observed_item;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at)
SELECT id,'execution_failed','executor',1,'{"schema_version":1,"data":{"attempt_id":"8f000000-0000-0000-0000-000000000021"}}',now()-interval '119 minutes' FROM observed_item;
CREATE TEMP TABLE budget_event_baseline AS
SELECT count(*)::int AS total FROM public.work_events WHERE work_item_id=(SELECT id FROM observed_item);
GRANT SELECT ON budget_event_baseline TO authenticated;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','8f000000-0000-0000-0000-000000000001',true);

SELECT is((public.autonomous_work_budget_status((SELECT id FROM observed_item))#>>'{attempts,user,used}')::int,1,'saldo: uso do usuário vem do reader canônico');
SELECT is((public.autonomous_work_budget_status((SELECT id FROM observed_item))#>>'{attempts,user,remaining}')::int,5,'saldo: remaining correto');
SELECT is(public.autonomous_work_budget_status((SELECT id FROM observed_item))->>'admitted','true','budget com saldo é admitido');
SELECT is(public.autonomous_work_budget_status((SELECT id FROM observed_item))#>>'{windows,attemptsHours}','24','janela temporal é explícita');
SELECT ok((public.autonomous_work_budget_status((SELECT id FROM observed_item))#>>'{attempts,user,nextReleaseAt}')::timestamptz BETWEEN now()+interval '21 hours 59 minutes' AND now()+interval '22 hours 1 minute','próxima expiração usa o timestamp real');
SELECT is((public.autonomous_work_budget_status((SELECT id FROM observed_item))#>>'{attempts,external,used}')::int,1,'tentativa externa é observável');
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE n integer; v_attempt uuid;
BEGIN
  FOR n IN 2..3 LOOP
    v_attempt:=('8f000000-0000-0000-0000-'||lpad((20+n)::text,12,'0'))::uuid;
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at)
    SELECT id,'execution_started','anima',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',v_attempt,'claim_id',gen_random_uuid())),now()-interval '90 minutes'+n*interval '1 minute' FROM observed_item;
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at)
    SELECT id,'execution_failed','executor',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',v_attempt)),now()-interval '90 minutes'+n*interval '1 minute'+interval '1 second' FROM observed_item;
  END LOOP;
END $$;
UPDATE budget_event_baseline SET total=(SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM observed_item));
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','8f000000-0000-0000-0000-000000000001',true);
SELECT is(public.autonomous_work_budget_status((SELECT id FROM observed_item))->>'reason','item_attempt_budget_exhausted','budget esgotado mantém a razão canônica');
SELECT is(public.autonomous_work_budget_status((SELECT id FROM observed_item))->>'nextBudgetReleaseAt',
  public.autonomous_work_budget_status((SELECT id FROM observed_item))#>>'{attempts,item,nextReleaseAt}',
  'liberação no teto exato coincide com a primeira expiração real');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM observed_item))::int,
  (SELECT total FROM budget_event_baseline),'consultas não criam evento nem attempt');

RESET ROLE;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_routing_on_attempt;
SELECT * FROM finish();
ROLLBACK;
