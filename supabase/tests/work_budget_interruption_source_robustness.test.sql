BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

-- INTEL-04 (coerência V0). Prova focal da ROBUSTEZ de
-- budget_interruption_resumption_source: ela encontra a interrupção EM tentativa
-- pendente mesmo quando um bloqueio PRÉ-tentativa posterior (sem attempt_id) veio
-- por cima (o caso de corrida do registro), e encerra a fonte quando uma tentativa
-- posterior já superou a interrupção ou quando nunca houve interrupção em tentativa.

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('88000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'robust@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('88000000-0000-0000-0000-0000000000a1','88000000-0000-0000-0000-000000000001','user','masked'),
('88000000-0000-0000-0000-0000000000a2','88000000-0000-0000-0000-000000000001','user','superseded'),
('88000000-0000-0000-0000-0000000000a3','88000000-0000-0000-0000-000000000001','user','preonly');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('88000000-0000-0000-0000-000000000001');
RESET ROLE;

CREATE TEMP TABLE rob_items(label text PRIMARY KEY,id uuid NOT NULL);
GRANT ALL ON rob_items TO authenticated,service_role;
CREATE FUNCTION pg_temp.proposal(label text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('schema_version',1,'data',jsonb_build_object('summary',label,'objective','robustez',
    'included_scope',jsonb_build_array('a.py'),'excluded_scope',jsonb_build_array('deploy'),
    'expected_effects',jsonb_build_array('ok'),'risks',jsonb_build_array()))
$$;
CREATE FUNCTION pg_temp.intent(target text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('execution_spec',jsonb_build_object('schema_version',1,
    'target',jsonb_build_object('kind','project','reference',target),'permissions',jsonb_build_array(),
    'validation_criteria',jsonb_build_array(jsonb_build_object('label','gate')),
    'limits',jsonb_build_object('max_attempts',3,'max_duration_minutes',120)))
$$;
-- Um checkpoint_recorded COMPLETO para a tentativa dada.
CREATE FUNCTION pg_temp.cp(v_item uuid, v_attempt text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item,'checkpoint_recorded','executor',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'attempt_id',v_attempt,'signal_sequence',1,'checkpoint',jsonb_build_object('schemaVersion',1,
    'handoffReference','worktree:x:anima-work/'||v_attempt,'completedSteps',jsonb_build_array('isolou'),
    'remainingSteps',jsonb_build_array('reexecutar'),'decisions',jsonb_build_array(),'risks',jsonb_build_array('t'),
    'nextStep','reexecutar','touchedResources',jsonb_build_array('a.py'),
    'validations',jsonb_build_array(jsonb_build_object('label','gate','outcome','failed')),
    'failures',jsonb_build_array('gate incompleto'),'evidenceReferences',jsonb_build_array()))));
$$;
CREATE FUNCTION pg_temp.exec_started(v_item uuid, v_attempt text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item,'execution_started','anima',1,jsonb_build_object('schema_version',1,'data',
    jsonb_build_object('attempt_id',v_attempt,'claim_id',gen_random_uuid())));
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000001',true);
INSERT INTO rob_items SELECT 'masked',id FROM public.create_work_proposal(
  '88000000-0000-0000-0000-0000000000a1','low','programming',pg_temp.intent('rob-masked'),pg_temp.proposal('masked'));
INSERT INTO rob_items SELECT 'superseded',id FROM public.create_work_proposal(
  '88000000-0000-0000-0000-0000000000a2','low','programming',pg_temp.intent('rob-superseded'),pg_temp.proposal('superseded'));
INSERT INTO rob_items SELECT 'preonly',id FROM public.create_work_proposal(
  '88000000-0000-0000-0000-0000000000a3','low','programming',pg_temp.intent('rob-preonly'),pg_temp.proposal('preonly'));
SELECT public.resolve_approval(id,1,'approve','{}') FROM rob_items;
RESET ROLE;

ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_routing_on_attempt;
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_work_budget_before_start;

SET LOCAL ROLE service_role;
-- MASKED: interrupção EM tentativa e, POR CIMA, um bloqueio PRÉ-tentativa. Item approved.
DO $$
DECLARE v_item uuid:=(SELECT id FROM rob_items WHERE label='masked'); v_cp bigint;
BEGIN
  PERFORM pg_temp.exec_started(v_item,'88000000-0000-0000-0000-0000000000b1');
  PERFORM pg_temp.cp(v_item,'88000000-0000-0000-0000-0000000000b1');
  v_cp:=(SELECT seq FROM public.work_events WHERE work_item_id=v_item AND event_type='checkpoint_recorded' ORDER BY seq DESC LIMIT 1);
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item,'work_blocked','anima',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'attempt_id','88000000-0000-0000-0000-0000000000b1','reason','interactive_reserve_protected',
    'reached_limit','resources','checkpoint_event_seq',v_cp))); -- a interrupção EM tentativa
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item,'work_approved','system',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'reason','budget_window_recovered','budget_interruption',true)));
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item,'work_blocked','anima',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'reason','user_attempt_budget_exhausted','reached_limit','attempts','resolution','awaits_budget_window'))); -- PRÉ-tentativa por cima
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item,'work_approved','system',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'reason','budget_window_recovered')));
  UPDATE public.work_items SET state='approved' WHERE id=v_item;
END $$;
-- SUPERSEDED: interrupção seguida de uma tentativa NOVA (execution_started posterior).
DO $$
DECLARE v_item uuid:=(SELECT id FROM rob_items WHERE label='superseded'); v_cp bigint;
BEGIN
  PERFORM pg_temp.exec_started(v_item,'88000000-0000-0000-0000-0000000000c1');
  PERFORM pg_temp.cp(v_item,'88000000-0000-0000-0000-0000000000c1');
  v_cp:=(SELECT seq FROM public.work_events WHERE work_item_id=v_item AND event_type='checkpoint_recorded' ORDER BY seq DESC LIMIT 1);
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item,'work_blocked','anima',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'attempt_id','88000000-0000-0000-0000-0000000000c1','reason','interactive_reserve_protected',
    'reached_limit','resources','checkpoint_event_seq',v_cp)));
  PERFORM pg_temp.exec_started(v_item,'88000000-0000-0000-0000-0000000000c2'); -- tentativa posterior supera
  UPDATE public.work_items SET state='approved' WHERE id=v_item;
END $$;
-- PREONLY: apenas bloqueio PRÉ-tentativa, nenhuma interrupção em tentativa.
DO $$
DECLARE v_item uuid:=(SELECT id FROM rob_items WHERE label='preonly');
BEGIN
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item,'work_blocked','anima',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'reason','user_attempt_budget_exhausted','reached_limit','attempts')));
  UPDATE public.work_items SET state='approved' WHERE id=v_item;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000001',true);
SELECT is(public.budget_interruption_resumption_source((SELECT id FROM rob_items WHERE label='masked'))->>'kind',
  'budget_interruption_checkpoint','encontra a interrupção mesmo sob um bloqueio pré-tentativa posterior');
SELECT is((public.budget_interruption_resumption_source((SELECT id FROM rob_items WHERE label='masked'))->>'interruption_event_seq')::bigint,
  (SELECT seq FROM public.work_events WHERE work_item_id=(SELECT id FROM rob_items WHERE label='masked')
    AND event_type='work_blocked' AND payload#>>'{data,attempt_id}'='88000000-0000-0000-0000-0000000000b1' LIMIT 1),
  'aponta a interrupção EM tentativa, não o bloqueio pré-tentativa que veio por cima');
SELECT is(public.budget_interruption_resumption_source((SELECT id FROM rob_items WHERE label='masked'))#>>'{handoff,stopReason}',
  'time_limit_reached','o handoff é uma pausa temporal');
SELECT ok(public.budget_interruption_resumption_source((SELECT id FROM rob_items WHERE label='superseded')) IS NULL,
  'uma tentativa posterior supera a interrupção e encerra a fonte');
SELECT ok(public.budget_interruption_resumption_source((SELECT id FROM rob_items WHERE label='preonly')) IS NULL,
  'sem interrupção EM tentativa, a fonte não existe');

RESET ROLE;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_routing_on_attempt;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_work_budget_before_start;
SELECT * FROM finish();
ROLLBACK;
