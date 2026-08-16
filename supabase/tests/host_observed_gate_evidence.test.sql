-- Persistência append-only da evidência de GATE OBSERVADA PELO HOST.
--
-- O que estas asserções provam: `record_host_observed_gate_evidence` decide só por
-- fato persistido e fail-closed; carimba proveniência system/host que o sinal do
-- executor não forja; exige tentativa real; o outcome tem de ser o DERIVADO do
-- exitCode/timeout/cancelamento (outcome adulterado é recusado); é idempotente por
-- tentativa ignorando observedAt; nunca muda estado do item.
--
-- Prefixo de UUID livre: c7000000.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir helpers/routing.inc
SELECT plan(16);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('c7000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hge@test.invalid','',now(),'{}','{}',now(),now()),
('c7000000-0000-0000-0000-0000000000ff','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hge-out@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('c7000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000000','user','pedido 1'),
('c7000000-0000-0000-0000-000000000002','c7000000-0000-0000-0000-000000000000','user','pedido 2');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('c7000000-0000-0000-0000-000000000000');
RESET ROLE;

\set prop '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["src/a.ts"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'
\set intel '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-08-16T12:00:00Z","classifierId":"test"}}'
\set t1 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"hge-t1"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set t2 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"hge-t2"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c7000000-0000-0000-0000-000000000000',true);

-- Construtor de evidência de gate. p_outcome NULL usa o derivado; um valor força
-- (para testar o outcome adulterado, que a régua recusa).
CREATE FUNCTION pg_temp.hge(p_item uuid, p_attempt uuid, p_exit integer DEFAULT 0, p_outcome text DEFAULT NULL,
  p_at text DEFAULT '2026-08-16T10:00:00Z', p_label text DEFAULT 'unit')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('schemaVersion',1,'workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',1,
    'gates',jsonb_build_array(jsonb_build_object('label',p_label,'command','npm test','exitCode',p_exit,'durationMs',100,'timedOut',false,'cancelled',false,
      'outcome',coalesce(p_outcome, CASE WHEN p_exit=0 THEN 'passed' ELSE 'failed' END))),
    'observedAt',p_at,'coverage',jsonb_build_object('gates',true));
$$;

CREATE FUNCTION pg_temp.start_attempt(p_conv uuid, p_target jsonb, p_claim uuid, p_attempt uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_item uuid;
BEGIN
  SELECT (public.create_work_proposal(p_conv,'low','programming',p_target,
    '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["src/a.ts"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'::jsonb)).id INTO v_item;
  PERFORM public.resolve_approval(v_item,1,'approve','{}');
  PERFORM public.record_work_intelligence_classification(v_item,1,0,
    '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-08-16T12:00:00Z","classifierId":"test"}}'::jsonb);
  PERFORM public.acquire_work_claim(v_item,1,p_claim,'sup',3600);
  PERFORM pg_temp.record_test_route(v_item,p_attempt,'local-runner-v1');
  PERFORM public.start_claimed_work_attempt(p_claim,p_attempt,'local-runner-v1');
  RETURN v_item;
END $$;

CREATE TEMP TABLE i1 AS SELECT pg_temp.start_attempt('c7000000-0000-0000-0000-000000000001',:'t1'::jsonb,'c7000000-0000-0000-0000-0000000000c1','c7000000-0000-0000-0000-0000000000a1') AS id;
CREATE TEMP TABLE i2 AS SELECT pg_temp.start_attempt('c7000000-0000-0000-0000-000000000002',:'t2'::jsonb,'c7000000-0000-0000-0000-0000000000c2','c7000000-0000-0000-0000-0000000000a2') AS id;

-- ============================================================
-- (1) Registro válido, proveniência system/host, sem tocar o estado
-- ============================================================

SELECT is(
  (public.record_host_observed_gate_evidence((SELECT id FROM i1),1,'c7000000-0000-0000-0000-0000000000a1',
    pg_temp.hge((SELECT id FROM i1),'c7000000-0000-0000-0000-0000000000a1')))->>'action',
  'recorded','evidência de gate válida é registrada');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_gate_evidence_recorded'),1::bigint,'exatamente um evento');
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_gate_evidence_recorded'),'system','autor system — o executor não forja');
SELECT is((SELECT payload->'data'->>'origin' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_gate_evidence_recorded'),'host','origem host');
SELECT is((SELECT payload#>>'{data,coverage,gates}' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_gate_evidence_recorded'),'true','cobertura de gate observada');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i1)),'in_progress','registrar evidência de gate não muda o estado');

-- ============================================================
-- (2) Idempotência: replay ignora observedAt; conflito por conteúdo divergente
-- ============================================================

SELECT is(
  (public.record_host_observed_gate_evidence((SELECT id FROM i1),1,'c7000000-0000-0000-0000-0000000000a1',
    pg_temp.hge((SELECT id FROM i1),'c7000000-0000-0000-0000-0000000000a1',0,NULL,'2026-08-16T23:59:00Z')))->>'action',
  'replayed','reobservação idêntica com outro observedAt é replay');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_gate_evidence_recorded'),1::bigint,'replay não cria novo evento');
SELECT throws_ok(
  $$ SELECT public.record_host_observed_gate_evidence((SELECT id FROM i1),1,'c7000000-0000-0000-0000-0000000000a1',
       pg_temp.hge((SELECT id FROM i1),'c7000000-0000-0000-0000-0000000000a1',1)) $$,
  '55000',NULL,'mesmo attempt com desfecho de gate divergente é conflito');

-- ============================================================
-- (3) Correlação e existência real da tentativa
-- ============================================================

SELECT throws_ok(
  $$ SELECT public.record_host_observed_gate_evidence((SELECT id FROM i1),1,'c7000000-0000-0000-0000-0000000000a1',
       pg_temp.hge((SELECT id FROM i1),'c7000000-0000-0000-0000-000000000abc')) $$,
  '22023',NULL,'correlação declarada divergente dos parâmetros é recusada');
SELECT throws_ok(
  $$ SELECT public.record_host_observed_gate_evidence((SELECT id FROM i1),1,'c7000000-0000-0000-0000-000000000abc',
       pg_temp.hge((SELECT id FROM i1),'c7000000-0000-0000-0000-000000000abc')) $$,
  'P0002',NULL,'tentativa inexistente é recusada');
SELECT throws_ok(
  $$ SELECT public.record_host_observed_gate_evidence((SELECT id FROM i1),1,'c7000000-0000-0000-0000-0000000000a2',
       pg_temp.hge((SELECT id FROM i1),'c7000000-0000-0000-0000-0000000000a2')) $$,
  'P0002',NULL,'tentativa de outro item é recusada');

-- ============================================================
-- (4) Régua estrutural fail-closed
-- ============================================================

-- outcome adulterado: exitCode 1 mas outcome "passed" (mentira sobre o gate).
SELECT throws_ok(
  $$ SELECT public.record_host_observed_gate_evidence((SELECT id FROM i2),1,'c7000000-0000-0000-0000-0000000000a2',
       pg_temp.hge((SELECT id FROM i2),'c7000000-0000-0000-0000-0000000000a2',1,'passed')) $$,
  '22023',NULL,'outcome que não é o DERIVADO do exitCode é recusado');
-- gates vazio.
SELECT throws_ok(
  $$ SELECT public.record_host_observed_gate_evidence((SELECT id FROM i2),1,'c7000000-0000-0000-0000-0000000000a2',
       jsonb_set(pg_temp.hge((SELECT id FROM i2),'c7000000-0000-0000-0000-0000000000a2'),'{gates}','[]'::jsonb)) $$,
  '22023',NULL,'nenhum gate observado é recusado');

-- ============================================================
-- (5) Autoridade e separação
-- ============================================================

SELECT set_config('request.jwt.claim.sub','c7000000-0000-0000-0000-0000000000ff',true);
SELECT throws_ok(
  $$ SELECT public.record_host_observed_gate_evidence((SELECT id FROM i1),1,'c7000000-0000-0000-0000-0000000000a1',
       pg_temp.hge((SELECT id FROM i1),'c7000000-0000-0000-0000-0000000000a1')) $$,
  '42501',NULL,'usuário fora da allowlist é recusado');
SELECT set_config('request.jwt.claim.sub','c7000000-0000-0000-0000-000000000000',true);

SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id IN ((SELECT id FROM i1),(SELECT id FROM i2))
  AND event_type IN ('result_accepted','integration_decided')),0::bigint,
  'a evidência de gate não aceita resultado nem decide integração');

SELECT * FROM finish();
ROLLBACK;
