-- Etapa 2A — persistência append-only de checkpoints mid-flight.
--
-- O que estas asserções provam: `record_work_checkpoint` decide só por fato
-- persistido e fail-closed; a monotonicidade por sequência separa replay,
-- conflito e regressão; o checkpoint jamais muda estado, conclui ou integra; e
-- `latest_work_checkpoint` reconstrói o mais recente, com ausência tipada.
--
-- Prefixo de UUID livre: 84000000 (89/88 são do SUP-04, 92/95/97/99 do SUP-03/05).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(25);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('84000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cp2a@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
SELECT ('84000000-0000-0000-0000-0000000000'||lpad(n::text,2,'0'))::uuid,'84000000-0000-0000-0000-000000000000','user','pedido '||n
FROM generate_series(1,4) AS n;
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('84000000-0000-0000-0000-000000000000');
RESET ROLE;

\set prop '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'
\set intel '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-28T12:00:00Z","classifierId":"test"}}'
-- Alvos distintos: o SUP-05 recusaria dois inícios no mesmo alvo.
\set t1 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"cp-t1"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set t2 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"cp-t2"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set t3 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"cp-t3"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
-- i4 sem max_duration_minutes: o lease é o único limite, então basta vencê-lo
-- para o SUP-04 abandonar.
\set t4 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"cp-t4"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','84000000-0000-0000-0000-000000000000',true);

-- Construtor de sinal de checkpoint válido, parametrizável para os cenários.
CREATE FUNCTION pg_temp.cp_signal(p_item uuid, p_attempt uuid, p_seq integer, p_next text DEFAULT 'seguir', p_version integer DEFAULT 1)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'kind','checkpoint','workItemId',p_item,'attemptId',p_attempt,
    'approvedProposalVersion',p_version,'origin','executor','sequence',p_seq,
    'checkpoint', jsonb_build_object(
      'schemaVersion',1,'handoffReference','runner-bundle:cp',
      'completedSteps',jsonb_build_array('feito'),'remainingSteps',jsonb_build_array('resta'),
      'nextStep',p_next,'decisions','[]'::jsonb,'risks','[]'::jsonb,
      'touchedResources','[]'::jsonb,
      'validations',jsonb_build_array(jsonb_build_object('label','tests','outcome','passed')),
      'failures','[]'::jsonb,'evidenceReferences','[]'::jsonb));
$$;

-- ============================================================
-- Fixtures: i1/i2 em execução; i3 encerrado em review; i4 abandonado.
-- ============================================================

CREATE TEMP TABLE i1 AS SELECT (public.create_work_proposal('84000000-0000-0000-0000-000000000001','low','programming',:'t1'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i1),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i1),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i1),1,'84000000-0000-0000-0000-0000000000c1','sup-1',3600);
SELECT public.start_claimed_work_attempt('84000000-0000-0000-0000-0000000000c1','84000000-0000-0000-0000-0000000000a1','local-runner-v1');

CREATE TEMP TABLE i2 AS SELECT (public.create_work_proposal('84000000-0000-0000-0000-000000000002','low','programming',:'t2'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i2),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i2),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i2),1,'84000000-0000-0000-0000-0000000000c2','sup-2',3600);
SELECT public.start_claimed_work_attempt('84000000-0000-0000-0000-0000000000c2','84000000-0000-0000-0000-0000000000a2','local-runner-v1');

CREATE TEMP TABLE i3 AS SELECT (public.create_work_proposal('84000000-0000-0000-0000-000000000003','low','programming',:'t3'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i3),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i3),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i3),1,'84000000-0000-0000-0000-0000000000c3','sup-3',3600);
SELECT public.start_claimed_work_attempt('84000000-0000-0000-0000-0000000000c3','84000000-0000-0000-0000-0000000000a3','local-runner-v1');
SELECT public.record_commanded_work_terminal((SELECT id FROM i3),1,'84000000-0000-0000-0000-0000000000a3',
  jsonb_build_object('kind','result','workItemId',(SELECT id FROM i3),'attemptId','84000000-0000-0000-0000-0000000000a3',
    'approvedProposalVersion',1,'origin','executor','sequence',1,'summary','ok','resultReferences','[]'::jsonb,
    'validations',jsonb_build_array(jsonb_build_object('label','tests','outcome','passed')),'limitations','[]'::jsonb,
    'handoffReference','runner-bundle:r'));

CREATE TEMP TABLE i4 AS SELECT (public.create_work_proposal('84000000-0000-0000-0000-000000000004','low','programming',:'t4'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i4),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i4),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i4),1,'84000000-0000-0000-0000-0000000000c4','sup-4',3600);
SELECT public.start_claimed_work_attempt('84000000-0000-0000-0000-0000000000c4','84000000-0000-0000-0000-0000000000a4','local-runner-v1');
-- Vence o lease e reconcilia: o SUP-04 abandona a tentativa (item volta a approved).
-- Recua acquired_at junto para preservar o CHECK (expires_at > acquired_at); o
-- lease fica no passado (vencido) sem violar a restrição da tabela.
SET LOCAL ROLE service_role;
UPDATE public.work_claims SET acquired_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE id='84000000-0000-0000-0000-0000000000c4';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','84000000-0000-0000-0000-000000000000',true);
SELECT public.reconcile_supervised_work();

-- ============================================================
-- (1) Primeiro checkpoint válido, sem tocar o estado do item
-- ============================================================

SELECT is(
  (public.record_work_checkpoint((SELECT id FROM i1),1,'84000000-0000-0000-0000-0000000000a1',
    pg_temp.cp_signal((SELECT id FROM i1),'84000000-0000-0000-0000-0000000000a1',2)))->>'action',
  'recorded','primeiro checkpoint é registrado');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i1)),'in_progress',
  'registrar checkpoint não muda o estado do item');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='checkpoint_recorded'),
  1::bigint,'exatamente um evento checkpoint_recorded');

-- ============================================================
-- (2) Sequências crescentes não consecutivas e reconstrução do maior
-- ============================================================

SELECT is(
  (public.record_work_checkpoint((SELECT id FROM i1),1,'84000000-0000-0000-0000-0000000000a1',
    pg_temp.cp_signal((SELECT id FROM i1),'84000000-0000-0000-0000-0000000000a1',5,'passo do 5')))->>'action',
  'recorded','sequência maior não consecutiva (2 → 5) é registrada');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='checkpoint_recorded'),
  2::bigint,'agora há dois checkpoints');
SELECT is(
  (public.latest_work_checkpoint((SELECT id FROM i1),'84000000-0000-0000-0000-0000000000a1'))#>>'{checkpoint,nextStep}',
  'passo do 5','a reconstrução escolhe o checkpoint de maior sequência');

-- ============================================================
-- (3) Regressão, replay idêntico e conflito na mesma sequência
-- ============================================================

SELECT throws_ok(
  $$ SELECT public.record_work_checkpoint((SELECT id FROM i1),1,'84000000-0000-0000-0000-0000000000a1',
       pg_temp.cp_signal((SELECT id FROM i1),'84000000-0000-0000-0000-0000000000a1',3)) $$,
  '55000',NULL,'sequência menor que a última é recusada por regressão');

SELECT is(
  (public.record_work_checkpoint((SELECT id FROM i1),1,'84000000-0000-0000-0000-0000000000a1',
    pg_temp.cp_signal((SELECT id FROM i1),'84000000-0000-0000-0000-0000000000a1',5,'passo do 5')))->>'action',
  'replayed','mesma sequência com conteúdo idêntico é replay idempotente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='checkpoint_recorded'),
  2::bigint,'replay não cria novo evento');

SELECT throws_ok(
  $$ SELECT public.record_work_checkpoint((SELECT id FROM i1),1,'84000000-0000-0000-0000-0000000000a1',
       pg_temp.cp_signal((SELECT id FROM i1),'84000000-0000-0000-0000-0000000000a1',5,'conteúdo diferente')) $$,
  '55000',NULL,'mesma sequência com conteúdo diferente é conflito');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='checkpoint_recorded'),
  2::bigint,'conflito não cria novo evento');

-- Concorrência determinística: duas entregas idênticas na mesma sequência
-- produzem um único evento (a segunda é replay). Corrida multi-sessão real
-- pertence à prova ao vivo, como nos itens SUP.

-- ============================================================
-- (4) Guardas de correlação e payload
-- ============================================================

SELECT throws_ok(
  $$ SELECT public.record_work_checkpoint((SELECT id FROM i1),1,'84000000-0000-0000-0000-0000000000a1',
       jsonb_set(pg_temp.cp_signal((SELECT id FROM i1),'84000000-0000-0000-0000-0000000000a1',7),'{origin}','"user"')) $$,
  '22023',NULL,'origem diferente de executor é recusada');
SELECT throws_ok(
  $$ SELECT public.record_work_checkpoint((SELECT id FROM i1),1,'84000000-0000-0000-0000-0000000000a1',
       jsonb_set(pg_temp.cp_signal((SELECT id FROM i1),'84000000-0000-0000-0000-0000000000a1',7),'{checkpoint,nextStep}','"   "')) $$,
  '22023',NULL,'payload malformado (nextStep em branco) é recusado');
SELECT throws_ok(
  $$ SELECT public.record_work_checkpoint((SELECT id FROM i1),1,'84000000-0000-0000-0000-000000000abc',
       pg_temp.cp_signal((SELECT id FROM i1),'84000000-0000-0000-0000-000000000abc',2)) $$,
  'P0002',NULL,'tentativa inexistente é recusada');
SELECT throws_ok(
  $$ SELECT public.record_work_checkpoint((SELECT id FROM i2),1,'84000000-0000-0000-0000-0000000000a1',
       pg_temp.cp_signal((SELECT id FROM i2),'84000000-0000-0000-0000-0000000000a1',2)) $$,
  'P0002',NULL,'tentativa de outro item é recusada');
SELECT throws_ok(
  $$ SELECT public.record_work_checkpoint((SELECT id FROM i1),2,'84000000-0000-0000-0000-0000000000a1',
       pg_temp.cp_signal((SELECT id FROM i1),'84000000-0000-0000-0000-0000000000a1',7)) $$,
  '22023',NULL,'versão aprovada divergente é recusada');

-- ============================================================
-- (5) Estados que impedem checkpoint: terminal e abandono
-- ============================================================

SELECT throws_ok(
  $$ SELECT public.record_work_checkpoint((SELECT id FROM i3),1,'84000000-0000-0000-0000-0000000000a3',
       pg_temp.cp_signal((SELECT id FROM i3),'84000000-0000-0000-0000-0000000000a3',2)) $$,
  '55000',NULL,'tentativa com terminal (item em review) é recusada');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i3) AND event_type='checkpoint_recorded'),
  0::bigint,'nenhum checkpoint é gravado sobre tentativa encerrada');

SELECT throws_ok(
  $$ SELECT public.record_work_checkpoint((SELECT id FROM i4),1,'84000000-0000-0000-0000-0000000000a4',
       pg_temp.cp_signal((SELECT id FROM i4),'84000000-0000-0000-0000-0000000000a4',2)) $$,
  '55000',NULL,'tentativa abandonada pelo SUP-04 é recusada');

-- ============================================================
-- (6) Ausência tipada, ausência de efeito e histórico append-only
-- ============================================================

SELECT is(public.latest_work_checkpoint((SELECT id FROM i2),'84000000-0000-0000-0000-0000000000a2'),NULL,
  'sem checkpoint, a reconstrução devolve ausência tipada (NULL)');

SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1)
  AND event_type IN ('result_submitted','result_accepted')),0::bigint,
  'nenhum resultado foi submetido, aceito ou integrado pelo caminho de checkpoint');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i1)),'in_progress',
  'o item de checkpoints permanece em in_progress, nunca completed');

-- Append-only: ambos os checkpoints (seq 2 e 5) continuam presentes e distintos.
SELECT is((SELECT count(DISTINCT (payload->'data'->>'signal_sequence')) FROM public.work_events
  WHERE work_item_id=(SELECT id FROM i1) AND event_type='checkpoint_recorded'),2::bigint,
  'o histórico preserva as duas sequências distintas, sem sobrescrita');
SELECT ok(EXISTS(SELECT 1 FROM public.work_events WHERE work_item_id=(SELECT id FROM i1)
  AND event_type='checkpoint_recorded' AND (payload->'data'->>'signal_sequence')='2'),
  'o checkpoint mais antigo (seq 2) não foi apagado pelo mais novo');

-- (7) latest_work_checkpoint exige allowlist, como as demais RPCs de orquestração.
SELECT set_config('request.jwt.claim.sub','84000000-0000-0000-0000-0000000000ff',true);
SELECT throws_ok(
  $$ SELECT public.latest_work_checkpoint((SELECT id FROM i1),'84000000-0000-0000-0000-0000000000a1') $$,
  '42501',NULL,'latest_work_checkpoint recusa usuário fora da allowlist');
SELECT set_config('request.jwt.claim.sub','84000000-0000-0000-0000-000000000000',true);

SELECT * FROM finish();
ROLLBACK;
