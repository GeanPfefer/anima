BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('8e000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','supervised@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('8e000000-0000-0000-0000-000000000011','8e000000-0000-0000-0000-000000000001','user','a'),
('8e000000-0000-0000-0000-000000000012','8e000000-0000-0000-0000-000000000001','user','b'),
('8e000000-0000-0000-0000-000000000013','8e000000-0000-0000-0000-000000000001','user','target'),
('8e000000-0000-0000-0000-000000000014','8e000000-0000-0000-0000-000000000001','user','other');
SET LOCAL ROLE service_role; INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('8e000000-0000-0000-0000-000000000001'); RESET ROLE;
CREATE TEMP TABLE sitems(label text,id uuid); GRANT ALL ON sitems TO authenticated,service_role;
CREATE FUNCTION pg_temp.intent(t text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('execution_spec',jsonb_build_object('target',jsonb_build_object('kind','project','reference',t),'coder_backend','openai','permissions','[]'::jsonb,'validation_criteria',jsonb_build_array(jsonb_build_object('label','jest')),'limits',jsonb_build_object('max_attempts',3,'max_duration_minutes',30)))$$;
CREATE FUNCTION pg_temp.proposal(t text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('schema_version',1,'data',jsonb_build_object('summary',t,'objective','test','included_scope',jsonb_build_array('x'),'excluded_scope',jsonb_build_array('main'),'expected_effects',jsonb_build_array('review'),'risks','[]'::jsonb))$$;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','8e000000-0000-0000-0000-000000000001',true);
INSERT INTO sitems SELECT x.label,(public.create_work_proposal(x.msg,'low','programming',pg_temp.intent(x.label),pg_temp.proposal(x.label))).id FROM (VALUES
('a','8e000000-0000-0000-0000-000000000011'::uuid),('b','8e000000-0000-0000-0000-000000000012'::uuid),('target','8e000000-0000-0000-0000-000000000013'::uuid),('other','8e000000-0000-0000-0000-000000000014'::uuid)) x(label,msg);
SELECT public.resolve_approval(id,1,'approve','{}') FROM sitems;
RESET ROLE;
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_routing_on_attempt;
SET LOCAL ROLE service_role;
DO $$DECLARE l text;n int:=0;k int;a uuid; BEGIN FOREACH l IN ARRAY ARRAY['a','b'] LOOP FOR k IN 1..3 LOOP n:=n+1;a:=('8e000000-0000-0000-0000-'||lpad((100+n)::text,12,'0'))::uuid;INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at) SELECT id,'execution_started','anima',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',a,'claim_id',gen_random_uuid())),now()-interval '2 hours'+n*interval '1 minute' FROM sitems WHERE label=l;INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at) SELECT id,'execution_failed','executor',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',a)),now()-interval '2 hours'+n*interval '1 minute'+interval '1 second' FROM sitems WHERE label=l;END LOOP;END LOOP;END$$;
RESET ROLE; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','8e000000-0000-0000-0000-000000000001',true);
SELECT is(public.autonomous_work_budget_status((SELECT id FROM sitems WHERE label='target'))->>'admitted','false','unattended esgotado bloqueia');
SELECT is(public.autonomous_work_budget_status((SELECT id FROM sitems WHERE label='target'))->>'unattendedReason','user_attempt_budget_exhausted','razão unattended preservada');
CREATE TEMP TABLE lease AS SELECT public.grant_work_supervision((SELECT id FROM sitems WHERE label='target'),1,'8e000000-0000-0000-0000-000000000201',300) v; GRANT SELECT ON lease TO service_role;
SELECT is(public.autonomous_work_budget_status((SELECT id FROM sitems WHERE label='target'))->>'admitted','true','lease válido admite o mesmo budget');
SELECT is(public.autonomous_work_budget_status((SELECT id FROM sitems WHERE label='target'))->>'supervised','true','modo human_supervised observável');
SELECT is(public.autonomous_work_budget_status((SELECT id FROM sitems WHERE label='other'))->>'admitted','false','lease de outro item não vale');
SELECT is((public.autonomous_work_budget_status((SELECT id FROM sitems WHERE label='target'))#>>'{usage,userAttempts24Hours}')::int,6,'supervisão não reseta contadores');
SELECT is((public.grant_work_supervision((SELECT id FROM sitems WHERE label='target'),1,'8e000000-0000-0000-0000-000000000201',300))->>'replayed','true','request id replaya idempotente');
SELECT is((SELECT count(*) FROM public.work_supervision_leases)::int,1,'replay não duplica lease');
SELECT is((SELECT count(*) FROM public.paid_compute_authorizations)::int,0,'supervisão não cria paid-compute authority');
RESET ROLE; SET LOCAL ROLE service_role; UPDATE public.work_supervision_leases SET issued_at=now()-interval '10 minutes',expires_at=now()-interval '1 second' WHERE id=((SELECT v->>'leaseId' FROM lease))::uuid; RESET ROLE;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','8e000000-0000-0000-0000-000000000001',true);
SELECT is(public.autonomous_work_budget_status((SELECT id FROM sitems WHERE label='target'))->>'admitted','false','lease expirado volta a bloquear');
SELECT is((public.autonomous_work_budget_status((SELECT id FROM sitems WHERE label='target'))#>>'{usage,userAttempts24Hours}')::int,6,'ao expirar os mesmos contadores voltam a valer');
SELECT is((public.revoke_work_supervision((SELECT id FROM sitems WHERE label='target')))->>'replayed','true','revogação sem lease ativo é idempotente');
RESET ROLE;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_routing_on_attempt;
SELECT * FROM finish(); ROLLBACK;
