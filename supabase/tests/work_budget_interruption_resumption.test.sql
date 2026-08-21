BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(15);

-- INTEL-04 (coerência V0). Prova viva da retomada de uma tentativa interrompida
-- NO MEIO por orçamento TEMPORAL (reserva interativa): interrupção real ->
-- blocked -> janela envelhecida por timestamps controlados -> readmissão ->
-- retomada DO CHECKPOINT (não do zero) -> in_progress, idempotente e auditável.

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('87000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'resume@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
VALUES('87000000-0000-0000-0000-0000000000a1','87000000-0000-0000-0000-000000000001','user','resume');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('87000000-0000-0000-0000-000000000001');
RESET ROLE;

CREATE TEMP TABLE ri_items(label text PRIMARY KEY,id uuid NOT NULL);
GRANT ALL ON ri_items TO authenticated,service_role;
CREATE FUNCTION pg_temp.proposal(label text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'summary',label,'objective','retomar do checkpoint','included_scope',jsonb_build_array('calculator.py'),
    'excluded_scope',jsonb_build_array('deploy'),'expected_effects',jsonb_build_array('gate verde'),
    'risks',jsonb_build_array()))
$$;
CREATE FUNCTION pg_temp.intent(target text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('execution_spec',jsonb_build_object(
    'schema_version',1,'target',jsonb_build_object('kind','project','reference',target),
    'permissions',jsonb_build_array(),'validation_criteria',jsonb_build_array(jsonb_build_object('label','gate')),
    'limits',jsonb_build_object('max_attempts',3,'max_duration_minutes',120)))
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','87000000-0000-0000-0000-000000000001',true);
INSERT INTO ri_items SELECT 'alvo',id FROM public.create_work_proposal(
  '87000000-0000-0000-0000-0000000000a1','low','programming',pg_temp.intent('resume-alvo'),pg_temp.proposal('alvo'));
SELECT public.resolve_approval((SELECT id FROM ri_items WHERE label='alvo'),1,'approve','{}');
RESET ROLE;

-- Gates de classificação/roteamento suspensos só nos inserts sintéticos e no
-- execution_started da retomada; a guarda de ORÇAMENTO permanece ATIVA para
-- provar que a retomada revalida o orçamento.
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_routing_on_attempt;
ALTER TABLE public.work_claims DISABLE TRIGGER enforce_autonomous_intelligence_on_claim;

-- Tentativa aberta há 46 minutos + checkpoint COMPLETO (campos de handoff).
SET LOCAL ROLE service_role;
UPDATE public.work_items SET state='in_progress' WHERE id=(SELECT id FROM ri_items WHERE label='alvo');
INSERT INTO public.work_claims(id,work_item_id,user_id,approved_proposal_version,owner_instance_id,acquired_at,expires_at,attempt_id,target_reference)
VALUES('87000000-0000-0000-0000-0000000000c1',(SELECT id FROM ri_items WHERE label='alvo'),
  '87000000-0000-0000-0000-000000000001',1,'test',now()-interval '46 minutes',now()+interval '10 minutes',
  '87000000-0000-0000-0000-0000000000b1','resume-alvo');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at)
VALUES((SELECT id FROM ri_items WHERE label='alvo'),'execution_started','anima',1,
  jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'attempt_id','87000000-0000-0000-0000-0000000000b1','claim_id','87000000-0000-0000-0000-0000000000c1')),
  now()-interval '46 minutes');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
VALUES((SELECT id FROM ri_items WHERE label='alvo'),'checkpoint_recorded','executor',1,
  jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'attempt_id','87000000-0000-0000-0000-0000000000b1','signal_sequence',1,
    'checkpoint',jsonb_build_object('schemaVersion',1,'handoffReference','worktree:resume-alvo:anima-work/b1',
      'completedSteps',jsonb_build_array('isolou a workspace'),'remainingSteps',jsonb_build_array('reexecutar o gate'),
      'decisions',jsonb_build_array(),'risks',jsonb_build_array('tempo excedido'),'nextStep','reexecutar o gate',
      'touchedResources',jsonb_build_array('calculator.py'),
      'validations',jsonb_build_array(jsonb_build_object('label','gate','outcome','failed')),
      'failures',jsonb_build_array('gate incompleto'),'evidenceReferences',jsonb_build_array()))));
RESET ROLE;

-- ---------- Interrupção real por reserva interativa ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','87000000-0000-0000-0000-000000000001',true);
SELECT ok((public.interrupt_work_on_budget(
  (SELECT id FROM ri_items WHERE label='alvo'),1,'87000000-0000-0000-0000-0000000000b1'))->>'interrupted'='true',
  '46 min autônomos interrompem a tentativa após o checkpoint');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM ri_items WHERE label='alvo')),
  'blocked','a interrupção deixa o item bloqueado');
SELECT is((SELECT payload#>>'{data,reason}' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM ri_items WHERE label='alvo') AND event_type='work_blocked'
  ORDER BY seq DESC LIMIT 1),'interactive_reserve_protected','bloqueio tem razão temporal tipada');
SELECT is((SELECT payload#>>'{data,attempt_id}' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM ri_items WHERE label='alvo') AND event_type='work_blocked'
  ORDER BY seq DESC LIMIT 1),'87000000-0000-0000-0000-0000000000b1','bloqueio EM tentativa referencia a tentativa');

-- ---------- Ainda esgotado: nada re-admitido ----------
SELECT is((SELECT count(*) FROM public.readmit_budget_interrupted_work())::int,
  0,'enquanto a reserva não recupera, nenhuma interrupção é re-admitida');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM ri_items WHERE label='alvo')),
  'blocked','o item permanece bloqueado enquanto o orçamento não recupera');

-- ---------- Envelhece a janela (sem esperar 60 min reais) ----------
SET LOCAL ROLE service_role;
UPDATE public.work_events SET created_at=created_at-interval '90 minutes'
 WHERE work_item_id=(SELECT id FROM ri_items WHERE label='alvo')
   AND event_type IN ('execution_started','work_blocked','input_requested','checkpoint_recorded');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','87000000-0000-0000-0000-000000000001',true);

-- ---------- Readmissão da interrupção EM tentativa ----------
SELECT is((SELECT string_agg(work_item_id::text,',') FROM public.readmit_budget_interrupted_work()),
  (SELECT id::text FROM ri_items WHERE label='alvo'),'a janela liberou re-admite a interrupção em tentativa');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM ri_items WHERE label='alvo')),
  'approved','a readmissão devolve o item a approved');
SELECT ok(EXISTS(SELECT 1 FROM public.work_events
  WHERE work_item_id=(SELECT id FROM ri_items WHERE label='alvo') AND event_type='work_approved'
    AND author='system' AND payload#>>'{data,reason}'='budget_window_recovered'
    AND (payload#>>'{data,budget_interruption}')::boolean=true),
  'readmissão auditável (work_approved system/budget_window_recovered/budget_interruption)');

-- ---------- Fonte de retomada: parte do checkpoint, handoff temporal ----------
SELECT is(public.budget_interruption_resumption_source((SELECT id FROM ri_items WHERE label='alvo'))->>'kind',
  'budget_interruption_checkpoint','a fonte de retomada por interrupção existe');
SELECT is(public.budget_interruption_resumption_source((SELECT id FROM ri_items WHERE label='alvo'))#>>'{handoff,stopReason}',
  'time_limit_reached','o handoff é uma pausa por limite temporal, não decisão humana');
SELECT is(public.budget_interruption_resumption_source((SELECT id FROM ri_items WHERE label='alvo'))#>>'{handoff,remainingSteps,0}',
  'reexecutar o gate','o handoff carrega o próximo trabalho do checkpoint');

-- ---------- Retomada real DO CHECKPOINT (revalida orçamento na guarda) ----------
-- Volta ao owner para alternar gatilhos; a claim JWT segue local à transação.
-- As RPCs são SECURITY DEFINER e leem auth.uid() da claim, então funcionam aqui.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','87000000-0000-0000-0000-000000000001',true);
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_routing_on_attempt;
DO $$
DECLARE
  v_item uuid:=(SELECT id FROM ri_items WHERE label='alvo');
  v_src jsonb:=public.budget_interruption_resumption_source((SELECT id FROM ri_items WHERE label='alvo'));
BEGIN
  PERFORM public.begin_budget_interruption_resumed_attempt(
    v_item,1,(v_src->>'interruption_event_seq')::bigint,(v_src->>'checkpoint_event_seq')::bigint,
    '87000000-0000-0000-0000-0000000000c2','87000000-0000-0000-0000-0000000000b2','test',1800,'worktree-v1');
END $$;
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM ri_items WHERE label='alvo')),
  'in_progress','a retomada inicia a nova tentativa (in_progress)');
SELECT ok(EXISTS(SELECT 1 FROM public.work_events
  WHERE work_item_id=(SELECT id FROM ri_items WHERE label='alvo') AND event_type='execution_started'
    AND payload#>>'{data,attempt_id}'='87000000-0000-0000-0000-0000000000b2'
    AND payload#>>'{data,reason}'='budget_resumed'
    AND payload#>>'{data,resumed_from_attempt_id}'='87000000-0000-0000-0000-0000000000b1'),
  'a nova tentativa é uma RETOMADA do checkpoint (budget_resumed), correlacionada à origem');
-- Idempotência: re-executar begin com as mesmas identidades não cria 2ª tentativa.
DO $$
DECLARE v_item uuid:=(SELECT id FROM ri_items WHERE label='alvo');
  v_seq bigint:=(SELECT seq FROM public.work_events WHERE work_item_id=v_item AND event_type='work_blocked'
    AND payload#>>'{data,attempt_id}'='87000000-0000-0000-0000-0000000000b1' ORDER BY seq DESC LIMIT 1);
  v_cp bigint:=(SELECT seq FROM public.work_events WHERE work_item_id=v_item AND event_type='checkpoint_recorded'
    AND payload#>>'{data,attempt_id}'='87000000-0000-0000-0000-0000000000b1' ORDER BY seq DESC LIMIT 1);
BEGIN
  PERFORM public.begin_budget_interruption_resumed_attempt(
    v_item,1,v_seq,v_cp,'87000000-0000-0000-0000-0000000000c2','87000000-0000-0000-0000-0000000000b2','test',1800,'worktree-v1');
END $$;
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM ri_items WHERE label='alvo')
  AND event_type='execution_started' AND payload#>>'{data,attempt_id}'='87000000-0000-0000-0000-0000000000b2')::int,
  1,'a retomada é idempotente: replay não cria uma segunda tentativa');

RESET ROLE;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_routing_on_attempt;
ALTER TABLE public.work_claims ENABLE TRIGGER enforce_autonomous_intelligence_on_claim;
SELECT * FROM finish();
ROLLBACK;
