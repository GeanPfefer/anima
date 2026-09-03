-- Persistência append-only da evidência do CODER OBSERVADA PELO HOST.
--
-- O que estas asserções provam: `record_host_observed_coder_evidence` decide só por fato
-- persistido e fail-closed; carimba proveniência system/host que o sinal do executor não
-- forja; exige tentativa real correlacionada; a régua estrutural recusa desfecho fora do
-- conjunto e duração inválida; é idempotente por tentativa ignorando observedAt; nunca muda
-- estado do item nem aceita/integra.
--
-- Prefixo de UUID livre: c8000000.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir helpers/routing.inc
SELECT plan(20);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('c8000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hce@test.invalid','',now(),'{}','{}',now(),now()),
('c8000000-0000-0000-0000-0000000000ff','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hce-out@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('c8000000-0000-0000-0000-000000000001','c8000000-0000-0000-0000-000000000000','user','pedido 1'),
('c8000000-0000-0000-0000-000000000002','c8000000-0000-0000-0000-000000000000','user','pedido 2');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('c8000000-0000-0000-0000-000000000000');
RESET ROLE;

\set t1 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"hce-t1"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set t2 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"hce-t2"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c8000000-0000-0000-0000-000000000000',true);

-- Construtor de evidência do coder. Duração/desfecho/backend parametrizáveis para
-- exercitar tanto o caminho válido quanto o adulterado (que a régua recusa).
CREATE FUNCTION pg_temp.hce(p_item uuid, p_attempt uuid, p_duration integer DEFAULT 84000,
  p_outcome text DEFAULT 'succeeded', p_at text DEFAULT '2026-08-17T10:00:00Z', p_backend text DEFAULT 'ollama-coder')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('schemaVersion',1,'workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',1,
    'backendId',p_backend,'durationMs',p_duration,'outcome',p_outcome,'observedAt',p_at,'transcripts','[{"schemaVersion":1,"call":0,"previousCall":null,"gateFingerprint":null,"diffFingerprint":null,"termination":"ollama_ambiguous_replacement","truncated":false,"entries":[{"step":1,"round":0,"phase":"read","path":"src/a.ts","operation":"read","operationStep":null,"readRefs":[],"anchorReadRefs":[],"readHash":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","expectedHash":null,"fingerprint":"2367956d2d282920bf34b21e806edd81ab4db0a25cc75f370f4861dd39a5292e","normalizedFingerprint":"2367956d2d282920bf34b21e806edd81ab4db0a25cc75f370f4861dd39a5292e","length":8,"structure":"xx xxxxx","lines":[1],"clipped":false,"rawMatchCount":null,"matchCount":null,"result":"served"},{"step":2,"round":1,"phase":"edit","path":"src/a.ts","operation":"replace_exact","operationStep":null,"readRefs":[1],"anchorReadRefs":[],"readHash":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","expectedHash":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","fingerprint":"5ad38304b535c2987dbd24657c1a11b884984ff600d9f389deb0d4e634fee792","normalizedFingerprint":"5ad38304b535c2987dbd24657c1a11b884984ff600d9f389deb0d4e634fee792","length":6,"structure":"xxxxxx","lines":[],"clipped":false,"rawMatchCount":0,"matchCount":0,"result":"invalid_anchor"},{"step":3,"round":1,"phase":"application","path":"src/a.ts","operation":"replace_exact","operationStep":2,"readRefs":[1],"anchorReadRefs":[],"readHash":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","expectedHash":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","fingerprint":"5ad38304b535c2987dbd24657c1a11b884984ff600d9f389deb0d4e634fee792","normalizedFingerprint":"5ad38304b535c2987dbd24657c1a11b884984ff600d9f389deb0d4e634fee792","length":6,"structure":"xxxxxx","lines":[],"clipped":false,"rawMatchCount":0,"matchCount":0,"result":"batch_failed"}]}]'::jsonb);
$$;

CREATE FUNCTION pg_temp.start_attempt(p_conv uuid, p_target jsonb, p_claim uuid, p_attempt uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_item uuid;
BEGIN
  SELECT (public.create_work_proposal(p_conv,'low','programming',p_target,
    '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["src/a.ts"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'::jsonb)).id INTO v_item;
  PERFORM public.resolve_approval(v_item,1,'approve','{}');
  PERFORM public.record_work_intelligence_classification(v_item,1,0,
    '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-08-17T12:00:00Z","classifierId":"test"}}'::jsonb);
  PERFORM public.acquire_work_claim(v_item,1,p_claim,'sup',3600);
  PERFORM pg_temp.record_test_route(v_item,p_attempt,'local-runner-v1');
  PERFORM public.start_claimed_work_attempt(p_claim,p_attempt,'local-runner-v1');
  RETURN v_item;
END $$;

CREATE TEMP TABLE i1 AS SELECT pg_temp.start_attempt('c8000000-0000-0000-0000-000000000001',:'t1'::jsonb,'c8000000-0000-0000-0000-0000000000c1','c8000000-0000-0000-0000-0000000000a1') AS id;
CREATE TEMP TABLE i2 AS SELECT pg_temp.start_attempt('c8000000-0000-0000-0000-000000000002',:'t2'::jsonb,'c8000000-0000-0000-0000-0000000000c2','c8000000-0000-0000-0000-0000000000a2') AS id;

-- ============================================================
-- (1) Registro válido, proveniência system/host, sem tocar o estado
-- ============================================================

SELECT is(
  (public.record_host_observed_coder_evidence((SELECT id FROM i1),1,'c8000000-0000-0000-0000-0000000000a1',
    pg_temp.hce((SELECT id FROM i1),'c8000000-0000-0000-0000-0000000000a1')))->>'action',
  'recorded','evidência do coder válida é registrada');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_coder_evidence_recorded'),1::bigint,'exatamente um evento');
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_coder_evidence_recorded'),'system','autor system — o executor não forja');
SELECT is((SELECT payload->'data'->>'origin' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_coder_evidence_recorded'),'host','origem host');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i1)),'in_progress','registrar evidência do coder não muda o estado');

-- ============================================================
-- (2) Idempotência: replay ignora observedAt; conflito por conteúdo divergente
-- ============================================================

SELECT is(
  (public.record_host_observed_coder_evidence((SELECT id FROM i1),1,'c8000000-0000-0000-0000-0000000000a1',
    pg_temp.hce((SELECT id FROM i1),'c8000000-0000-0000-0000-0000000000a1',84000,'succeeded','2026-08-17T23:59:00Z')))->>'action',
  'replayed','reobservação idêntica com outro observedAt é replay');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_coder_evidence_recorded'),1::bigint,'replay não cria novo evento');
SELECT throws_ok(
  $$ SELECT public.record_host_observed_coder_evidence((SELECT id FROM i1),1,'c8000000-0000-0000-0000-0000000000a1',
       pg_temp.hce((SELECT id FROM i1),'c8000000-0000-0000-0000-0000000000a1',99999)) $$,
  '55000',NULL,'mesmo attempt com duração divergente é conflito');

-- ============================================================
-- (3) Correlação e existência real da tentativa
-- ============================================================

SELECT throws_ok(
  $$ SELECT public.record_host_observed_coder_evidence((SELECT id FROM i1),1,'c8000000-0000-0000-0000-0000000000a1',
       pg_temp.hce((SELECT id FROM i1),'c8000000-0000-0000-0000-000000000abc')) $$,
  '22023',NULL,'correlação declarada divergente dos parâmetros é recusada');
SELECT throws_ok(
  $$ SELECT public.record_host_observed_coder_evidence((SELECT id FROM i1),1,'c8000000-0000-0000-0000-000000000abc',
       pg_temp.hce((SELECT id FROM i1),'c8000000-0000-0000-0000-000000000abc')) $$,
  'P0002',NULL,'tentativa inexistente é recusada');
SELECT throws_ok(
  $$ SELECT public.record_host_observed_coder_evidence((SELECT id FROM i1),1,'c8000000-0000-0000-0000-0000000000a2',
       pg_temp.hce((SELECT id FROM i1),'c8000000-0000-0000-0000-0000000000a2')) $$,
  'P0002',NULL,'tentativa de outro item é recusada');

-- ============================================================
-- (4) Régua estrutural fail-closed
-- ============================================================

-- desfecho fora do conjunto succeeded|failed|cancelled.
SELECT throws_ok(
  $$ SELECT public.record_host_observed_coder_evidence((SELECT id FROM i2),1,'c8000000-0000-0000-0000-0000000000a2',
       pg_temp.hce((SELECT id FROM i2),'c8000000-0000-0000-0000-0000000000a2',84000,'timeout')) $$,
  '22023',NULL,'desfecho fora do conjunto é recusado');
-- duração negativa.
SELECT throws_ok(
  $$ SELECT public.record_host_observed_coder_evidence((SELECT id FROM i2),1,'c8000000-0000-0000-0000-0000000000a2',
       pg_temp.hce((SELECT id FROM i2),'c8000000-0000-0000-0000-0000000000a2',-1)) $$,
  '22023',NULL,'duração negativa é recusada');

-- ============================================================
-- (5) Autoridade e separação
-- ============================================================

SELECT set_config('request.jwt.claim.sub','c8000000-0000-0000-0000-0000000000ff',true);
SELECT throws_ok(
  $$ SELECT public.record_host_observed_coder_evidence((SELECT id FROM i1),1,'c8000000-0000-0000-0000-0000000000a1',
       pg_temp.hce((SELECT id FROM i1),'c8000000-0000-0000-0000-0000000000a1')) $$,
  '42501',NULL,'usuário fora da allowlist é recusado');
SELECT set_config('request.jwt.claim.sub','c8000000-0000-0000-0000-000000000000',true);

-- Identidade opcional de placement: compatível com legado e fail-closed quando presente.
SET LOCAL ROLE service_role;
SELECT ok(private.is_valid_host_coder_evidence(
  pg_temp.hce('c8000000-0000-0000-0000-000000000011','c8000000-0000-0000-0000-0000000000a1')
  || '{"placement":"remote","nodeId":"gpu-a","model":"qwen3-coder:latest"}'::jsonb),
  'placement remoto completo é válido');
SELECT ok(NOT private.is_valid_host_coder_evidence(
  pg_temp.hce('c8000000-0000-0000-0000-000000000011','c8000000-0000-0000-0000-0000000000a1')
  || '{"placement":"remote","nodeId":null,"model":"m"}'::jsonb),
  'placement remoto sem node falha fechado');
SELECT ok(private.is_valid_host_coder_evidence(
  pg_temp.hce('c8000000-0000-0000-0000-000000000011','c8000000-0000-0000-0000-0000000000a1')
  || '{"placement":"local","nodeId":null,"model":"m"}'::jsonb),
  'placement local com node nulo é válido');
SELECT ok(NOT private.is_valid_host_coder_evidence(
  pg_temp.hce('c8000000-0000-0000-0000-000000000011','c8000000-0000-0000-0000-0000000000a1')
  || '{"placement":"local","nodeId":"gpu-a","model":"m"}'::jsonb),
  'placement local não pode declarar node remoto');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c8000000-0000-0000-0000-000000000000',true);

SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id IN ((SELECT id FROM i1),(SELECT id FROM i2))
  AND event_type IN ('result_accepted','integration_decided')),0::bigint,
  'a evidência do coder não aceita resultado nem decide integração');

SELECT is((SELECT payload#>>'{data,evidence,transcripts,0,entries,1,result}' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_coder_evidence_recorded'),'invalid_anchor','RPC existente preserva transcript READ EDIT e falha correlacionada');
SELECT * FROM finish();
ROLLBACK;
