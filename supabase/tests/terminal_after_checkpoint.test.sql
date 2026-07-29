-- Etapa 2B.1 — o terminal comandado pode vir depois de checkpoints.
--
-- Prova a nova guarda de sequência de `record_commanded_work_terminal`: terminal
-- é inteiro positivo e, quando há checkpoint persistido, vem à frente do maior.
-- progress não é persistido, então lacunas entre checkpoint e terminal são
-- legítimas. Idempotência do terminal e recusa de tentativa abandonada
-- permanecem. Prefixo de UUID livre: 86000000.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir helpers/routing.inc
SELECT plan(9);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('86000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','term2b@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
SELECT ('86000000-0000-0000-0000-0000000000'||lpad(n::text,2,'0'))::uuid,'86000000-0000-0000-0000-000000000000','user','pedido '||n
FROM generate_series(1,6) AS n;
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('86000000-0000-0000-0000-000000000000');
RESET ROLE;

\set prop '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'
\set intel '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-28T12:00:00Z","classifierId":"test"}}'
\set g1 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"term-t1"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set g2 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"term-t2"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set g3 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"term-t3"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set g4 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"term-t4"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set g6 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"term-t6"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','86000000-0000-0000-0000-000000000000',true);

CREATE FUNCTION pg_temp.cp(p_item uuid, p_attempt uuid, p_seq integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('kind','checkpoint','workItemId',p_item,'attemptId',p_attempt,
    'approvedProposalVersion',1,'origin','executor','sequence',p_seq,
    'checkpoint',jsonb_build_object('schemaVersion',1,'handoffReference','runner-bundle:cp',
      'completedSteps',jsonb_build_array('feito'),'remainingSteps',jsonb_build_array('resta'),'nextStep','seguir',
      'decisions','[]'::jsonb,'risks','[]'::jsonb,'touchedResources','[]'::jsonb,
      'validations',jsonb_build_array(jsonb_build_object('label','tests','outcome','passed')),
      'failures','[]'::jsonb,'evidenceReferences','[]'::jsonb));
$$;
CREATE FUNCTION pg_temp.res(p_item uuid, p_attempt uuid, p_seq integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('kind','result','workItemId',p_item,'attemptId',p_attempt,
    'approvedProposalVersion',1,'origin','executor','sequence',p_seq,'summary','ok',
    'resultReferences','[]'::jsonb,'validations',jsonb_build_array(jsonb_build_object('label','tests','outcome','passed')),
    'limitations','[]'::jsonb,'handoffReference','runner-bundle:r');
$$;

-- Fixtures: cada item aprovado, com claim e tentativa iniciada.
CREATE TEMP TABLE i1 AS SELECT (public.create_work_proposal('86000000-0000-0000-0000-000000000001','low','programming',:'g1'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i1),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i1),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i1),1,'86000000-0000-0000-0000-0000000000c1','sup',3600);
SELECT pg_temp.record_test_route((SELECT id FROM i1),'86000000-0000-0000-0000-0000000000a1','local-runner-v1');
SELECT public.start_claimed_work_attempt('86000000-0000-0000-0000-0000000000c1','86000000-0000-0000-0000-0000000000a1','local-runner-v1');

CREATE TEMP TABLE i2 AS SELECT (public.create_work_proposal('86000000-0000-0000-0000-000000000002','low','programming',:'g2'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i2),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i2),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i2),1,'86000000-0000-0000-0000-0000000000c2','sup',3600);
SELECT pg_temp.record_test_route((SELECT id FROM i2),'86000000-0000-0000-0000-0000000000a2','local-runner-v1');
SELECT public.start_claimed_work_attempt('86000000-0000-0000-0000-0000000000c2','86000000-0000-0000-0000-0000000000a2','local-runner-v1');

CREATE TEMP TABLE i3 AS SELECT (public.create_work_proposal('86000000-0000-0000-0000-000000000003','low','programming',:'g3'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i3),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i3),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i3),1,'86000000-0000-0000-0000-0000000000c3','sup',3600);
SELECT pg_temp.record_test_route((SELECT id FROM i3),'86000000-0000-0000-0000-0000000000a3','local-runner-v1');
SELECT public.start_claimed_work_attempt('86000000-0000-0000-0000-0000000000c3','86000000-0000-0000-0000-0000000000a3','local-runner-v1');

CREATE TEMP TABLE i4 AS SELECT (public.create_work_proposal('86000000-0000-0000-0000-000000000004','low','programming',:'g4'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i4),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i4),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i4),1,'86000000-0000-0000-0000-0000000000c4','sup',3600);
SELECT pg_temp.record_test_route((SELECT id FROM i4),'86000000-0000-0000-0000-0000000000a4','local-runner-v1');
SELECT public.start_claimed_work_attempt('86000000-0000-0000-0000-0000000000c4','86000000-0000-0000-0000-0000000000a4','local-runner-v1');

CREATE TEMP TABLE i6 AS SELECT (public.create_work_proposal('86000000-0000-0000-0000-000000000006','low','programming',:'g6'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i6),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i6),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i6),1,'86000000-0000-0000-0000-0000000000c6','sup',3600);
SELECT pg_temp.record_test_route((SELECT id FROM i6),'86000000-0000-0000-0000-0000000000a6','local-runner-v1');
SELECT public.start_claimed_work_attempt('86000000-0000-0000-0000-0000000000c6','86000000-0000-0000-0000-0000000000a6','local-runner-v1');
SET LOCAL ROLE service_role;
UPDATE public.work_claims SET acquired_at=now()-interval '2 hours', expires_at=now()-interval '1 hour' WHERE id='86000000-0000-0000-0000-0000000000c6';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','86000000-0000-0000-0000-000000000000',true);
SELECT public.reconcile_supervised_work();

-- (1) terminal sequence=1 sem checkpoints continua válido
SELECT is((public.record_commanded_work_terminal((SELECT id FROM i1),1,'86000000-0000-0000-0000-0000000000a1',
  pg_temp.res((SELECT id FROM i1),'86000000-0000-0000-0000-0000000000a1',1))).state::text,'review',
  'terminal seq=1 sem checkpoint é válido e leva a review');

-- (2) terminal duplicado preserva idempotência (um único result_submitted)
SELECT public.record_commanded_work_terminal((SELECT id FROM i1),1,'86000000-0000-0000-0000-0000000000a1',
  pg_temp.res((SELECT id FROM i1),'86000000-0000-0000-0000-0000000000a1',1));
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='result_submitted'),1::bigint,
  'reentrega do mesmo terminal é idempotente, sem novo evento');

-- (3) checkpoints com lacuna (progress não persistido): seq 2 e 5
SELECT public.record_work_checkpoint((SELECT id FROM i2),1,'86000000-0000-0000-0000-0000000000a2',pg_temp.cp((SELECT id FROM i2),'86000000-0000-0000-0000-0000000000a2',2));
SELECT public.record_work_checkpoint((SELECT id FROM i2),1,'86000000-0000-0000-0000-0000000000a2',pg_temp.cp((SELECT id FROM i2),'86000000-0000-0000-0000-0000000000a2',5));
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i2) AND event_type='checkpoint_recorded'),2::bigint,
  'dois checkpoints com lacuna de sequência (progress não persistido) coexistem');

-- (4) terminal com sequence maior que o último checkpoint é válido
SELECT is((public.record_commanded_work_terminal((SELECT id FROM i2),1,'86000000-0000-0000-0000-0000000000a2',
  pg_temp.res((SELECT id FROM i2),'86000000-0000-0000-0000-0000000000a2',6))).state::text,'review',
  'terminal seq=6 depois dos checkpoints 2 e 5 é válido');

-- (5) terminal com sequence IGUAL ao último checkpoint é recusado
SELECT public.record_work_checkpoint((SELECT id FROM i3),1,'86000000-0000-0000-0000-0000000000a3',pg_temp.cp((SELECT id FROM i3),'86000000-0000-0000-0000-0000000000a3',5));
SELECT throws_ok(
  $$ SELECT public.record_commanded_work_terminal((SELECT id FROM i3),1,'86000000-0000-0000-0000-0000000000a3',
       pg_temp.res((SELECT id FROM i3),'86000000-0000-0000-0000-0000000000a3',5)) $$,
  '55000',NULL,'terminal com sequence igual ao último checkpoint é recusado');

-- (7) terminal com sequence não positiva é recusado (22023), antes da guarda de checkpoint
SELECT throws_ok(
  $$ SELECT public.record_commanded_work_terminal((SELECT id FROM i3),1,'86000000-0000-0000-0000-0000000000a3',
       pg_temp.res((SELECT id FROM i3),'86000000-0000-0000-0000-0000000000a3',0)) $$,
  '22023',NULL,'terminal com sequence não positiva é recusado');

-- (6) terminal com sequence MENOR que o último checkpoint é recusado
SELECT public.record_work_checkpoint((SELECT id FROM i4),1,'86000000-0000-0000-0000-0000000000a4',pg_temp.cp((SELECT id FROM i4),'86000000-0000-0000-0000-0000000000a4',5));
SELECT throws_ok(
  $$ SELECT public.record_commanded_work_terminal((SELECT id FROM i4),1,'86000000-0000-0000-0000-0000000000a4',
       pg_temp.res((SELECT id FROM i4),'86000000-0000-0000-0000-0000000000a4',3)) $$,
  '55000',NULL,'terminal com sequence menor que o último checkpoint é recusado');

-- (8) terminal tardio de tentativa abandonada pelo SUP-04 continua recusado
SELECT throws_ok(
  $$ SELECT public.record_commanded_work_terminal((SELECT id FROM i6),1,'86000000-0000-0000-0000-0000000000a6',
       pg_temp.res((SELECT id FROM i6),'86000000-0000-0000-0000-0000000000a6',7)) $$,
  '55000',NULL,'terminal tardio de tentativa abandonada é recusado');

-- (9) nada aceita ou integra resultado
SELECT is((SELECT count(*) FROM public.work_events WHERE event_type='result_accepted'
  AND work_item_id IN (SELECT id FROM i1 UNION SELECT id FROM i2 UNION SELECT id FROM i3 UNION SELECT id FROM i4 UNION SELECT id FROM i6)),0::bigint,
  'nenhum result_accepted foi criado pelo caminho de terminal');

SELECT * FROM finish();
ROLLBACK;
