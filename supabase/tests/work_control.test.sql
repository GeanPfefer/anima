-- UX-01 — controle cooperativo da execução autônoma (pausa/cancelamento).
--
-- O que estas asserções provam: request_work_control persiste a intenção sem
-- mudar estado; replay é idempotente e ação divergente falha fechado; versão
-- obsoleta e tentativa inexistente são recusadas; apply_work_control_at_checkpoint
-- só aplica após um checkpoint, move o item para blocked/cancelled, grava o
-- evento terminal e libera o claim; e uma pausa aplicada encerra a contagem de
-- runtime do orçamento (INTEL-04/UX-01).
--
-- Prefixo de UUID livre: b1000000.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir helpers/routing.inc
SELECT plan(20);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('b1000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ctrl@test.invalid','',now(),'{}','{}',now(),now()),
('b1000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ctrl2@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('b1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000000','user','pedido 1'),
('b1000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000000','user','pedido 2'),
('b1000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000000','user','pedido 3'),
('b1000000-0000-0000-0000-000000000011','b1000000-0000-0000-0000-000000000010','user','pedido 4');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES
('b1000000-0000-0000-0000-000000000000'),('b1000000-0000-0000-0000-000000000010');
RESET ROLE;

\set prop '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'
\set intel '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-28T12:00:00Z","classifierId":"test"}}'
\set t1 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"ctrl-t1"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set t2 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"ctrl-t2"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set t3 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"ctrl-t3"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set t4 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"ctrl-t4"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'

-- Construtor de sinal de checkpoint válido.
CREATE FUNCTION pg_temp.cp_signal(p_item uuid, p_attempt uuid, p_seq integer)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'kind','checkpoint','workItemId',p_item,'attemptId',p_attempt,
    'approvedProposalVersion',1,'origin','executor','sequence',p_seq,
    'checkpoint', jsonb_build_object(
      'schemaVersion',1,'handoffReference','runner-bundle:cp',
      'completedSteps',jsonb_build_array('feito'),'remainingSteps',jsonb_build_array('resta'),
      'nextStep','continuar','decisions','[]'::jsonb,'risks','[]'::jsonb,
      'touchedResources','[]'::jsonb,
      'validations',jsonb_build_array(jsonb_build_object('label','tests','outcome','passed')),
      'failures','[]'::jsonb,'evidenceReferences','[]'::jsonb));
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000000',true);

-- ============================================================
-- i1 — pausa: pedido, replay, conflito, aplicação, liberação.
-- ============================================================
SELECT (public.create_work_proposal('b1000000-0000-0000-0000-000000000001','low','programming',:'t1'::jsonb,:'prop'::jsonb)).id AS i1 \gset
SELECT public.resolve_approval(:'i1',1,'approve','{}');
SELECT public.record_work_intelligence_classification(:'i1',1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim(:'i1',1,'b1000000-0000-0000-0000-0000000000c1','sup-1',3600);
SELECT pg_temp.record_test_route(:'i1','b1000000-0000-0000-0000-0000000000a1','local-runner-v1');
SELECT public.start_claimed_work_attempt('b1000000-0000-0000-0000-0000000000c1','b1000000-0000-0000-0000-0000000000a1','local-runner-v1');
SELECT public.record_work_checkpoint(:'i1',1,'b1000000-0000-0000-0000-0000000000a1',pg_temp.cp_signal(:'i1','b1000000-0000-0000-0000-0000000000a1',1));

SELECT is((public.request_work_control(:'i1',1,'b1000000-0000-0000-0000-0000000000a1','pause'))->>'action','recorded','pedido de pausa é registrado');
SELECT is((SELECT count(*)::int FROM public.work_events WHERE work_item_id=:'i1' AND event_type='work_control_requested'),1,'exatamente um work_control_requested');
SELECT is((SELECT state::text FROM public.work_items WHERE id=:'i1'),'in_progress','o pedido não muda o estado do item');
SELECT is((public.request_work_control(:'i1',1,'b1000000-0000-0000-0000-0000000000a1','pause'))->>'action','replayed','mesmo pedido é replay idempotente');
SELECT is((SELECT count(*)::int FROM public.work_events WHERE work_item_id=:'i1' AND event_type='work_control_requested'),1,'replay não duplica evento');
SELECT throws_ok(
  'SELECT public.request_work_control('||quote_literal(:'i1')||',1,'||quote_literal('b1000000-0000-0000-0000-0000000000a1')||',''cancel'')',
  '55000',NULL,'ação divergente pendente falha fechado');

SELECT is((public.apply_work_control_at_checkpoint(:'i1',1,'b1000000-0000-0000-0000-0000000000a1'))->>'applied','true','aplica o pedido pendente no checkpoint');
SELECT is((SELECT state::text FROM public.work_items WHERE id=:'i1'),'blocked','pausa aplicada move o item para blocked');
SELECT is((SELECT count(*)::int FROM public.work_events WHERE work_item_id=:'i1' AND event_type='work_paused'),1,'grava exatamente um work_paused');
SELECT is((SELECT release_reason FROM public.work_claims WHERE work_item_id=:'i1'),'attempt_finished','o claim é liberado com attempt_finished');
SELECT is((SELECT released_at IS NOT NULL FROM public.work_claims WHERE work_item_id=:'i1'),true,'o claim tem released_at preenchido');
SELECT throws_ok(
  'SELECT public.request_work_control('||quote_literal(:'i1')||',1,'||quote_literal('b1000000-0000-0000-0000-0000000000a1')||',''pause'')',
  '55000',NULL,'novo pedido após aplicação é recusado (item não está mais in_progress)');

-- ============================================================
-- i2 — cancelamento aplicado: item cancelled, evento referencia o pedido.
-- ============================================================
SELECT (public.create_work_proposal('b1000000-0000-0000-0000-000000000002','low','programming',:'t2'::jsonb,:'prop'::jsonb)).id AS i2 \gset
SELECT public.resolve_approval(:'i2',1,'approve','{}');
SELECT public.record_work_intelligence_classification(:'i2',1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim(:'i2',1,'b1000000-0000-0000-0000-0000000000c2','sup-2',3600);
SELECT pg_temp.record_test_route(:'i2','b1000000-0000-0000-0000-0000000000a2','local-runner-v1');
SELECT public.start_claimed_work_attempt('b1000000-0000-0000-0000-0000000000c2','b1000000-0000-0000-0000-0000000000a2','local-runner-v1');
SELECT public.record_work_checkpoint(:'i2',1,'b1000000-0000-0000-0000-0000000000a2',pg_temp.cp_signal(:'i2','b1000000-0000-0000-0000-0000000000a2',1));
SELECT public.request_work_control(:'i2',1,'b1000000-0000-0000-0000-0000000000a2','cancel');
SELECT is((public.apply_work_control_at_checkpoint(:'i2',1,'b1000000-0000-0000-0000-0000000000a2'))->>'action','cancel','cancelamento é aplicado');
SELECT is((SELECT state::text FROM public.work_items WHERE id=:'i2'),'cancelled','cancelamento aplicado move o item para cancelled');
SELECT is((SELECT (payload->'data'->>'control_request_event_seq') IS NOT NULL FROM public.work_events WHERE work_item_id=:'i2' AND event_type='work_cancelled'),true,'work_cancelled referencia o pedido de controle');

-- ============================================================
-- i3 — aplicação exige checkpoint; versão obsoleta e tentativa inexistente.
-- ============================================================
SELECT (public.create_work_proposal('b1000000-0000-0000-0000-000000000003','low','programming',:'t3'::jsonb,:'prop'::jsonb)).id AS i3 \gset
SELECT public.resolve_approval(:'i3',1,'approve','{}');
SELECT public.record_work_intelligence_classification(:'i3',1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim(:'i3',1,'b1000000-0000-0000-0000-0000000000c3','sup-3',3600);
SELECT pg_temp.record_test_route(:'i3','b1000000-0000-0000-0000-0000000000a3','local-runner-v1');
SELECT public.start_claimed_work_attempt('b1000000-0000-0000-0000-0000000000c3','b1000000-0000-0000-0000-0000000000a3','local-runner-v1');
-- Sem checkpoint: pedido é aceito, mas a aplicação é recusada.
SELECT public.request_work_control(:'i3',1,'b1000000-0000-0000-0000-0000000000a3','pause');
SELECT throws_ok(
  'SELECT public.apply_work_control_at_checkpoint('||quote_literal(:'i3')||',1,'||quote_literal('b1000000-0000-0000-0000-0000000000a3')||')',
  '55000',NULL,'aplicação sem checkpoint é recusada');
SELECT throws_ok(
  'SELECT public.request_work_control('||quote_literal(:'i3')||',2,'||quote_literal('b1000000-0000-0000-0000-0000000000a3')||',''pause'')',
  '55000',NULL,'versão obsoleta é recusada');
SELECT throws_ok(
  'SELECT public.request_work_control('||quote_literal(:'i3')||',1,'||quote_literal('b1000000-0000-0000-0000-0000000000f0')||',''pause'')',
  'P0002',NULL,'tentativa autônoma inexistente é recusada');

-- ============================================================
-- i4 (user2) — pausa aplicada encerra a contagem de runtime do orçamento.
-- ============================================================
SELECT set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000010',true);
SELECT (public.create_work_proposal('b1000000-0000-0000-0000-000000000011','low','programming',:'t4'::jsonb,:'prop'::jsonb)).id AS i4 \gset
SELECT public.resolve_approval(:'i4',1,'approve','{}');
SELECT public.record_work_intelligence_classification(:'i4',1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim(:'i4',1,'b1000000-0000-0000-0000-0000000000c4','sup-4',3600);
SELECT pg_temp.record_test_route(:'i4','b1000000-0000-0000-0000-0000000000a4','local-runner-v1');
SELECT public.start_claimed_work_attempt('b1000000-0000-0000-0000-0000000000c4','b1000000-0000-0000-0000-0000000000a4','local-runner-v1');
SELECT public.record_work_checkpoint(:'i4',1,'b1000000-0000-0000-0000-0000000000a4',pg_temp.cp_signal(:'i4','b1000000-0000-0000-0000-0000000000a4',1));
-- Recua o início 30 min para o runtime ser mensurável.
SET LOCAL ROLE service_role;
UPDATE public.work_events SET created_at=now()-interval '30 minutes'
 WHERE event_type='execution_started' AND payload->'data'->>'attempt_id'='b1000000-0000-0000-0000-0000000000a4';
-- Antes da pausa: tentativa aberta consome tempo até o instante observado.
SELECT ok(((private.autonomous_work_budget_usage('b1000000-0000-0000-0000-000000000010',:'i4',now()+interval '10 hours'))->>'userRuntimeSeconds24Hours')::bigint > 30000,
  'tentativa aberta acumula runtime até o instante observado');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000010',true);
SELECT public.request_work_control(:'i4',1,'b1000000-0000-0000-0000-0000000000a4','pause');
SELECT public.apply_work_control_at_checkpoint(:'i4',1,'b1000000-0000-0000-0000-0000000000a4');
SET LOCAL ROLE service_role;
-- Depois da pausa: o runtime para no work_paused e não cresce com o observado.
SELECT ok(((private.autonomous_work_budget_usage('b1000000-0000-0000-0000-000000000010',:'i4',now()+interval '10 hours'))->>'userRuntimeSeconds24Hours')::bigint < 3600,
  'pausa aplicada encerra a contagem de runtime');
RESET ROLE;

SELECT finish();
ROLLBACK;
