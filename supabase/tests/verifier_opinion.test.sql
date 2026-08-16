-- Persistência append-only do PARECER do Verifier (advisory, versionado).
--
-- O que estas asserções provam: `record_verifier_opinion` decide só por fato
-- persistido e fail-closed; carimba proveniência system/verifier que o executor não
-- forja; exige tentativa real e base de evidência DESTA tentativa; é histórico
-- versionado (nova base ou nova versão = novo parecer, sem apagar o anterior;
-- mesma identidade + conteúdo divergente = conflito); nunca muda estado nem cria
-- decisão de integração.
--
-- Prefixo de UUID livre: b6000000.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir helpers/routing.inc
SELECT plan(22);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('b6000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vop@test.invalid','',now(),'{}','{}',now(),now()),
('b6000000-0000-0000-0000-0000000000ff','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vop-out@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('b6000000-0000-0000-0000-000000000001','b6000000-0000-0000-0000-000000000000','user','pedido 1'),
('b6000000-0000-0000-0000-000000000002','b6000000-0000-0000-0000-000000000000','user','pedido 2');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('b6000000-0000-0000-0000-000000000000');
RESET ROLE;

\set prop '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["src/a.ts"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'
\set intel '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-08-16T12:00:00Z","classifierId":"test"}}'
\set t1 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"vop-t1"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set t2 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"vop-t2"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','b6000000-0000-0000-0000-000000000000',true);

-- Construtor de parecer válido. `p_observed` uuid ⇒ string; NULL ⇒ JSON null.
CREATE FUNCTION pg_temp.vop(p_item uuid, p_attempt uuid, p_result uuid, p_observed uuid,
  p_verdict text DEFAULT 'verified', p_version text DEFAULT 'work-verifier-v1', p_git boolean DEFAULT false, p_gate uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'schemaVersion',1,
    'workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',1,
    'verifierVersion',p_version,'verdict',p_verdict,'restsOnAttestedEvidence',true,
    'summary',jsonb_build_object('violations',0,'gaps',0,'checks',2,'attested',2,'independent',0),
    'findings',jsonb_build_array(
      jsonb_build_object('code','scope_respected','severity','ok','provenance',CASE WHEN p_git THEN 'independent' ELSE 'attested' END),
      jsonb_build_object('code','gates_passed','severity','ok','provenance','attested')),
    'evidenceBasis',jsonb_build_object(
      'resultEventId',p_result,'observedEventId',p_observed,'observedGateEventId',p_gate,
      'coverage',jsonb_build_object('git',p_git,'gates',p_gate IS NOT NULL)));
$$;

-- Construtor de evidência de gate observada (para referência da base de gate).
CREATE FUNCTION pg_temp.hge(p_item uuid, p_attempt uuid)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('schemaVersion',1,'workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',1,
    'gates',jsonb_build_array(jsonb_build_object('label','unit','command','npm test','exitCode',0,'durationMs',100,'timedOut',false,'cancelled',false,'outcome','passed')),
    'observedAt','2026-08-16T10:00:00Z','coverage',jsonb_build_object('gates',true));
$$;

-- Construtor de evidência observada válida (para referência da base observada).
CREATE FUNCTION pg_temp.hoe(p_item uuid, p_attempt uuid)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('schemaVersion',1,'workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',1,
    'baseSha','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','observedCommitSha','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'observedChangedFiles',jsonb_build_array('src/a.ts'),
    'observedDiffSummary',jsonb_build_object('filesChanged',1,'insertions',3,'deletions',1,
      'files',jsonb_build_array(jsonb_build_object('path','src/a.ts','insertions',3,'deletions',1))),
    'observedAt','2026-08-16T10:00:00Z','coverage',jsonb_build_object('git',true,'gates',false));
$$;

-- Helper: leva um item de proposta a review com um result_submitted da tentativa.
CREATE FUNCTION pg_temp.to_review(p_conv uuid, p_target jsonb, p_claim uuid, p_attempt uuid)
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
  PERFORM public.record_commanded_work_terminal(v_item,1,p_attempt,
    jsonb_build_object('kind','result','workItemId',v_item,'attemptId',p_attempt,'approvedProposalVersion',1,
      'origin','executor','sequence',1,'summary','ok','resultReferences','[]'::jsonb,
      'validations',jsonb_build_array(jsonb_build_object('label','tests','outcome','passed')),'limitations','[]'::jsonb,
      'handoffReference','runner-bundle:r'));
  RETURN v_item;
END $$;

CREATE TEMP TABLE i1 AS SELECT pg_temp.to_review('b6000000-0000-0000-0000-000000000001',:'t1'::jsonb,'b6000000-0000-0000-0000-0000000000c1','b6000000-0000-0000-0000-0000000000a1') AS id;
CREATE TEMP TABLE i2 AS SELECT pg_temp.to_review('b6000000-0000-0000-0000-000000000002',:'t2'::jsonb,'b6000000-0000-0000-0000-0000000000c2','b6000000-0000-0000-0000-0000000000a2') AS id;

-- Referências de evidência reais.
CREATE TEMP TABLE r1 AS SELECT id FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='result_submitted' LIMIT 1;
CREATE TEMP TABLE r2 AS SELECT id FROM public.work_events WHERE work_item_id=(SELECT id FROM i2) AND event_type='result_submitted' LIMIT 1;
-- Evidência observada persistida para a1 (base observada opcional do parecer).
SELECT public.record_host_observed_evidence((SELECT id FROM i1),1,'b6000000-0000-0000-0000-0000000000a1',
  pg_temp.hoe((SELECT id FROM i1),'b6000000-0000-0000-0000-0000000000a1'));
CREATE TEMP TABLE ho1 AS SELECT id FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_evidence_recorded' LIMIT 1;
SELECT public.record_host_observed_gate_evidence((SELECT id FROM i1),1,'b6000000-0000-0000-0000-0000000000a1',
  pg_temp.hge((SELECT id FROM i1),'b6000000-0000-0000-0000-0000000000a1'));
CREATE TEMP TABLE hg1 AS SELECT id FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_gate_evidence_recorded' LIMIT 1;

-- ============================================================
-- (1) Registro válido, proveniência system/verifier, sem tocar o estado
-- ============================================================

SELECT is(
  (public.record_verifier_opinion((SELECT id FROM i1),1,'b6000000-0000-0000-0000-0000000000a1',
    pg_temp.vop((SELECT id FROM i1),'b6000000-0000-0000-0000-0000000000a1',(SELECT id FROM r1),NULL)))->>'action',
  'recorded','parecer válido é registrado');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='verifier_opinion_recorded'),1::bigint,'exatamente um parecer');
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='verifier_opinion_recorded'),'system','autor system — o executor não forja o parecer');
SELECT is((SELECT payload->'data'->>'origin' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='verifier_opinion_recorded'),'verifier','origem verifier');
SELECT is((SELECT payload->'data'->>'verdict' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='verifier_opinion_recorded'),'verified','veredito persistido');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i1)),'review','registrar parecer NÃO muda o estado (review, nunca completed)');

-- ============================================================
-- (2) Idempotência e conflito na mesma identidade
-- ============================================================

SELECT is(
  (public.record_verifier_opinion((SELECT id FROM i1),1,'b6000000-0000-0000-0000-0000000000a1',
    pg_temp.vop((SELECT id FROM i1),'b6000000-0000-0000-0000-0000000000a1',(SELECT id FROM r1),NULL)))->>'action',
  'replayed','mesma identidade + conteúdo idêntico é replay idempotente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='verifier_opinion_recorded'),1::bigint,'replay não cria novo evento');
SELECT throws_ok(
  $$ SELECT public.record_verifier_opinion((SELECT id FROM i1),1,'b6000000-0000-0000-0000-0000000000a1',
       pg_temp.vop((SELECT id FROM i1),'b6000000-0000-0000-0000-0000000000a1',(SELECT id FROM r1),NULL,'rejected')) $$,
  '55000',NULL,'mesma identidade + conteúdo divergente é conflito (Verifier é determinístico)');

-- ============================================================
-- (3) Histórico versionado: nova base e nova versão APPEND, sem apagar
-- ============================================================

SELECT is(
  (public.record_verifier_opinion((SELECT id FROM i1),1,'b6000000-0000-0000-0000-0000000000a1',
    pg_temp.vop((SELECT id FROM i1),'b6000000-0000-0000-0000-0000000000a1',(SELECT id FROM r1),(SELECT id FROM ho1),'verified','work-verifier-v1',true)))->>'action',
  'recorded','base de evidência diferente (observação chegou) é NOVO parecer append-only');
SELECT is(
  (public.record_verifier_opinion((SELECT id FROM i1),1,'b6000000-0000-0000-0000-0000000000a1',
    pg_temp.vop((SELECT id FROM i1),'b6000000-0000-0000-0000-0000000000a1',(SELECT id FROM r1),NULL,'rejected','work-verifier-v2')))->>'action',
  'recorded','versão do Verifier diferente é NOVO parecer append-only');
-- A evidência de GATE observada aparece: a base muda ⇒ novo parecer, NÃO conflito.
SELECT is(
  (public.record_verifier_opinion((SELECT id FROM i1),1,'b6000000-0000-0000-0000-0000000000a1',
    pg_temp.vop((SELECT id FROM i1),'b6000000-0000-0000-0000-0000000000a1',(SELECT id FROM r1),NULL,'verified','work-verifier-v1',false,(SELECT id FROM hg1))))->>'action',
  'recorded','a chegada da evidência de gate é NOVA base ⇒ novo parecer, não conflito');
SELECT throws_ok(
  $$ SELECT public.record_verifier_opinion((SELECT id FROM i1),1,'b6000000-0000-0000-0000-0000000000a1',
       pg_temp.vop((SELECT id FROM i1),'b6000000-0000-0000-0000-0000000000a1',(SELECT id FROM r1),NULL,'verified','work-verifier-v1',false,'b6000000-0000-0000-0000-000000000fff')) $$,
  'P0002',NULL,'observedGateEventId inexistente é recusado');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='verifier_opinion_recorded'),4::bigint,'a história preserva os quatro pareceres distintos');

-- ============================================================
-- (4) Correlação e base de evidência DESTA tentativa
-- ============================================================

SELECT throws_ok(
  $$ SELECT public.record_verifier_opinion((SELECT id FROM i1),1,'b6000000-0000-0000-0000-0000000000a1',
       pg_temp.vop((SELECT id FROM i1),'b6000000-0000-0000-0000-000000000abc',(SELECT id FROM r1),NULL)) $$,
  '22023',NULL,'correlação declarada divergente dos parâmetros é recusada');
SELECT throws_ok(
  $$ SELECT public.record_verifier_opinion((SELECT id FROM i1),1,'b6000000-0000-0000-0000-000000000abc',
       pg_temp.vop((SELECT id FROM i1),'b6000000-0000-0000-0000-000000000abc',(SELECT id FROM r1),NULL)) $$,
  'P0002',NULL,'tentativa inexistente é recusada');
SELECT throws_ok(
  $$ SELECT public.record_verifier_opinion((SELECT id FROM i1),1,'b6000000-0000-0000-0000-0000000000a1',
       pg_temp.vop((SELECT id FROM i1),'b6000000-0000-0000-0000-0000000000a1',(SELECT id FROM r2),NULL)) $$,
  'P0002',NULL,'result de OUTRA tentativa/item não pode ser a base (parecer não referencia evidência alheia)');
SELECT throws_ok(
  $$ SELECT public.record_verifier_opinion((SELECT id FROM i1),1,'b6000000-0000-0000-0000-0000000000a1',
       pg_temp.vop((SELECT id FROM i1),'b6000000-0000-0000-0000-0000000000a1',(SELECT id FROM r1),'b6000000-0000-0000-0000-000000000fff')) $$,
  'P0002',NULL,'observedEventId inexistente é recusado');

-- ============================================================
-- (5) Régua estrutural e autoridade
-- ============================================================

SELECT throws_ok(
  $$ SELECT public.record_verifier_opinion((SELECT id FROM i1),1,'b6000000-0000-0000-0000-0000000000a1',
       pg_temp.vop((SELECT id FROM i1),'b6000000-0000-0000-0000-0000000000a1',(SELECT id FROM r1),NULL,'talvez')) $$,
  '22023',NULL,'verdict fora do enum é recusado');
SELECT set_config('request.jwt.claim.sub','b6000000-0000-0000-0000-0000000000ff',true);
SELECT throws_ok(
  $$ SELECT public.record_verifier_opinion((SELECT id FROM i1),1,'b6000000-0000-0000-0000-0000000000a1',
       pg_temp.vop((SELECT id FROM i1),'b6000000-0000-0000-0000-0000000000a1',(SELECT id FROM r1),NULL)) $$,
  '42501',NULL,'usuário fora da allowlist é recusado');
SELECT set_config('request.jwt.claim.sub','b6000000-0000-0000-0000-000000000000',true);

-- ============================================================
-- (6) Separação rígida: parecer ≠ decisão
-- ============================================================

SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1)
  AND event_type IN ('result_accepted','integration_decided')),0::bigint,
  'o parecer não aceita resultado nem decide integração');
SELECT is((SELECT count(*) FROM public.work_events WHERE event_type='verifier_opinion_recorded' AND author='user'),0::bigint,
  'nenhum parecer tem autoria humana — parecer nunca se passa por decisão');

SELECT * FROM finish();
ROLLBACK;
