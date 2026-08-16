-- Persistência append-only da evidência OBSERVADA PELO HOST (git).
--
-- O que estas asserções provam: `record_host_observed_evidence` decide só por
-- fato persistido e fail-closed; carimba proveniência `system`/`host` que o sinal
-- do executor não forja; exige tentativa real correlacionada; é idempotente por
-- tentativa ignorando `observedAt` (reobservação determinística replaya, conteúdo
-- divergente é conflito) e não cria duas verdades; nunca muda estado do item.
--
-- Prefixo de UUID livre: a5000000 (84 é do checkpoint, 71/72 da evidência de
-- resultado, 89/88/92/95/97/99 dos SUP).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir helpers/routing.inc
SELECT plan(20);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('a5000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hoe@test.invalid','',now(),'{}','{}',now(),now()),
('a5000000-0000-0000-0000-0000000000ff','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hoe-out@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('a5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000000','user','pedido 1'),
('a5000000-0000-0000-0000-000000000002','a5000000-0000-0000-0000-000000000000','user','pedido 2');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('a5000000-0000-0000-0000-000000000000');
RESET ROLE;

\set prop '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["packages/core/src/a.ts"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'
\set intel '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-08-15T12:00:00Z","classifierId":"test"}}'
\set t1 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"hoe-t1"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set t2 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"hoe-t2"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a5000000-0000-0000-0000-000000000000',true);

-- Construtor de evidência observada válida (HostObservedGitEvidenceV1), parametrizável.
CREATE FUNCTION pg_temp.hoe(
  p_item uuid, p_attempt uuid,
  p_path text DEFAULT 'packages/core/src/a.ts',
  p_commit text DEFAULT 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  p_base text DEFAULT 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  p_at text DEFAULT '2026-08-15T10:00:00Z',
  p_version integer DEFAULT 1)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'schemaVersion',1,
    'workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',p_version,
    'baseSha',p_base,'observedCommitSha',p_commit,
    'observedChangedFiles',jsonb_build_array(p_path),
    'observedDiffSummary',jsonb_build_object(
      'filesChanged',1,'insertions',3,'deletions',1,
      'files',jsonb_build_array(jsonb_build_object('path',p_path,'insertions',3,'deletions',1))),
    'observedAt',p_at,
    'coverage',jsonb_build_object('git',true,'gates',false));
$$;

-- ============================================================
-- Fixtures: i1/i2 com tentativa iniciada (execution_started), em in_progress.
-- ============================================================

CREATE TEMP TABLE i1 AS SELECT (public.create_work_proposal('a5000000-0000-0000-0000-000000000001','low','programming',:'t1'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i1),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i1),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i1),1,'a5000000-0000-0000-0000-0000000000c1','sup-1',3600);
SELECT pg_temp.record_test_route((SELECT id FROM i1),'a5000000-0000-0000-0000-0000000000a1','local-runner-v1');
SELECT public.start_claimed_work_attempt('a5000000-0000-0000-0000-0000000000c1','a5000000-0000-0000-0000-0000000000a1','local-runner-v1');

CREATE TEMP TABLE i2 AS SELECT (public.create_work_proposal('a5000000-0000-0000-0000-000000000002','low','programming',:'t2'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i2),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i2),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i2),1,'a5000000-0000-0000-0000-0000000000c2','sup-2',3600);
SELECT pg_temp.record_test_route((SELECT id FROM i2),'a5000000-0000-0000-0000-0000000000a2','local-runner-v1');
SELECT public.start_claimed_work_attempt('a5000000-0000-0000-0000-0000000000c2','a5000000-0000-0000-0000-0000000000a2','local-runner-v1');

-- ============================================================
-- (1) Registro válido, proveniência system/host, sem tocar o estado
-- ============================================================

SELECT is(
  (public.record_host_observed_evidence((SELECT id FROM i1),1,'a5000000-0000-0000-0000-0000000000a1',
    pg_temp.hoe((SELECT id FROM i1),'a5000000-0000-0000-0000-0000000000a1')))->>'action',
  'recorded','evidência observada válida é registrada');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_evidence_recorded'),
  1::bigint,'exatamente um evento host_observed_evidence_recorded');
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_evidence_recorded'),
  'system','o autor é system — o executor não forja esta proveniência');
SELECT is((SELECT payload->'data'->>'origin' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_evidence_recorded'),
  'host','a origem é host (inspeção de git pelo host)');
SELECT is((SELECT payload#>>'{data,coverage,gates}' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_evidence_recorded'),
  'false','cobertura honesta: gates NÃO são observados independentemente no V0');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i1)),'in_progress',
  'registrar evidência observada não muda o estado do item');
SELECT is(
  (SELECT payload#>'{data,evidence,observedChangedFiles}' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_evidence_recorded'),
  '["packages/core/src/a.ts"]'::jsonb,'os fatos observados persistem exatamente como o host os produziu');

-- ============================================================
-- (2) Idempotência: replay ignora observedAt; conflito por conteúdo divergente
-- ============================================================

SELECT is(
  (public.record_host_observed_evidence((SELECT id FROM i1),1,'a5000000-0000-0000-0000-0000000000a1',
    pg_temp.hoe((SELECT id FROM i1),'a5000000-0000-0000-0000-0000000000a1','packages/core/src/a.ts',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','2026-08-15T23:59:59Z')))->>'action',
  'replayed','reobservação do MESMO git com outro observedAt é replay idempotente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_evidence_recorded'),
  1::bigint,'replay não cria novo evento');
SELECT throws_ok(
  $$ SELECT public.record_host_observed_evidence((SELECT id FROM i1),1,'a5000000-0000-0000-0000-0000000000a1',
       pg_temp.hoe((SELECT id FROM i1),'a5000000-0000-0000-0000-0000000000a1','packages/core/src/a.ts',
         'cccccccccccccccccccccccccccccccccccccccc')) $$,
  '55000',NULL,'mesmo attempt com commit divergente é conflito: nunca duas verdades');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_evidence_recorded'),
  1::bigint,'conflito não cria novo evento');

-- ============================================================
-- (3) Correlação e existência real da tentativa (cliente não fabrica)
-- ============================================================

-- Evidência cuja tríade declarada discorda dos parâmetros: 22023.
SELECT throws_ok(
  $$ SELECT public.record_host_observed_evidence((SELECT id FROM i1),1,'a5000000-0000-0000-0000-0000000000a1',
       pg_temp.hoe((SELECT id FROM i1),'a5000000-0000-0000-0000-000000000abc')) $$,
  '22023',NULL,'correlação declarada divergente dos parâmetros é recusada');
-- attemptId inexistente (sem execution_started): P0002.
SELECT throws_ok(
  $$ SELECT public.record_host_observed_evidence((SELECT id FROM i1),1,'a5000000-0000-0000-0000-000000000abc',
       pg_temp.hoe((SELECT id FROM i1),'a5000000-0000-0000-0000-000000000abc')) $$,
  'P0002',NULL,'tentativa inexistente é recusada: não há git a observar');
-- tentativa de OUTRO item (a2 sob i1): P0002.
SELECT throws_ok(
  $$ SELECT public.record_host_observed_evidence((SELECT id FROM i1),1,'a5000000-0000-0000-0000-0000000000a2',
       pg_temp.hoe((SELECT id FROM i1),'a5000000-0000-0000-0000-0000000000a2')) $$,
  'P0002',NULL,'tentativa de outro item é recusada');
-- versão aprovada divergente (v2 não tem execution_started): P0002.
SELECT throws_ok(
  $$ SELECT public.record_host_observed_evidence((SELECT id FROM i1),2,'a5000000-0000-0000-0000-0000000000a1',
       pg_temp.hoe((SELECT id FROM i1),'a5000000-0000-0000-0000-0000000000a1','packages/core/src/a.ts',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','2026-08-15T10:00:00Z',2)) $$,
  'P0002',NULL,'versão aprovada sem tentativa correspondente é recusada');

-- ============================================================
-- (4) Régua estrutural fail-closed
-- ============================================================

-- base == commit: nada teria sido registrado.
SELECT throws_ok(
  $$ SELECT public.record_host_observed_evidence((SELECT id FROM i2),1,'a5000000-0000-0000-0000-0000000000a2',
       pg_temp.hoe((SELECT id FROM i2),'a5000000-0000-0000-0000-0000000000a2','packages/core/src/a.ts',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')) $$,
  '22023',NULL,'base == commit é recusada');
-- caminho absoluto no changedFiles: credencial/caminho local nunca entra.
SELECT throws_ok(
  $$ SELECT public.record_host_observed_evidence((SELECT id FROM i2),1,'a5000000-0000-0000-0000-0000000000a2',
       pg_temp.hoe((SELECT id FROM i2),'a5000000-0000-0000-0000-0000000000a2','/etc/passwd')) $$,
  '22023',NULL,'caminho absoluto no diff observado é recusado');
-- cobertura mentida (gates=true) é recusada: independência honesta é fixa.
SELECT throws_ok(
  $$ SELECT public.record_host_observed_evidence((SELECT id FROM i2),1,'a5000000-0000-0000-0000-0000000000a2',
       jsonb_set(pg_temp.hoe((SELECT id FROM i2),'a5000000-0000-0000-0000-0000000000a2'),'{coverage,gates}','true')) $$,
  '22023',NULL,'coverage.gates=true é recusada — gates não são observados no V0');

-- ============================================================
-- (5) Autoridade: allowlist e posse
-- ============================================================

SELECT set_config('request.jwt.claim.sub','a5000000-0000-0000-0000-0000000000ff',true);
SELECT throws_ok(
  $$ SELECT public.record_host_observed_evidence((SELECT id FROM i1),1,'a5000000-0000-0000-0000-0000000000a1',
       pg_temp.hoe((SELECT id FROM i1),'a5000000-0000-0000-0000-0000000000a1')) $$,
  '42501',NULL,'usuário fora da allowlist é recusado');
SELECT set_config('request.jwt.claim.sub','a5000000-0000-0000-0000-000000000000',true);

-- Nada disso submeteu, aceitou ou integrou resultado por este caminho.
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id IN ((SELECT id FROM i1),(SELECT id FROM i2))
  AND event_type IN ('result_submitted','result_accepted','integration_decided')),0::bigint,
  'a evidência observada não submete, aceita nem autoriza integração');

SELECT * FROM finish();
ROLLBACK;
