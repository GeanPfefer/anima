-- Carimbo canônico de contrato no estado residente (trigger + CHECK).
--
-- O que estas asserções provam: todo evento canônico inserido em work_events recebe
-- payload.canonical_contract = {id, version} derivado do event_type e fixado pelo
-- servidor; o carimbo é AUTORITATIVO (sobrescreve qualquer valor vindo do cliente);
-- eventos não-canônicos ficam intactos; a CHECK recusa carimbo malformado.
--
-- Prefixo de UUID livre: ca000000.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir helpers/routing.inc
SELECT plan(6);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('ca000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','crc@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('ca000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000000','user','pedido 1'),
('ca000000-0000-0000-0000-000000000002','ca000000-0000-0000-0000-000000000000','user','pedido 2');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('ca000000-0000-0000-0000-000000000000');
RESET ROLE;

-- Trusted System Writer V0: fatos de sistema são gravados pelo WRITER DE SISTEMA (não pela
-- sessão humana). Estes wrappers de TESTE assumem a identidade de um writer registrado para o
-- dono da sessão corrente (claims role=anima_system_writer + sub do writer) e chamam a RPC
-- real — exercitam a defesa em profundidade da função. A fronteira de GRANT (humano/anon
-- negados; writer permitido) é provada com SET ROLE real em trusted_system_writer.test.sql.
CREATE FUNCTION pg_temp.writer_for(p_owner uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $w$
DECLARE v_writer uuid := md5('trusted-writer:'||coalesce(p_owner::text,'none'))::uuid;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES(v_writer,'00000000-0000-0000-0000-000000000000','anima_system_writer','anima_system_writer','writer-'||v_writer||'@test.invalid','',now(),'{}','{}',now(),now())
  ON CONFLICT (id) DO NOTHING;
  IF p_owner IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_owner) THEN
    INSERT INTO private.trusted_system_writers(writer_user_id,owner_user_id) VALUES(v_writer,p_owner) ON CONFLICT (writer_user_id) DO NOTHING;
  END IF;
  RETURN v_writer;
END $w$;
CREATE FUNCTION pg_temp.record_host_observed_evidence(a uuid, b integer, c uuid, d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $w$
DECLARE v_sub text := current_setting('request.jwt.claim.sub', true); v_claims text := current_setting('request.jwt.claims', true); v_w uuid; r jsonb;
BEGIN
  v_w := pg_temp.writer_for(nullif(v_sub,'')::uuid);
  PERFORM set_config('request.jwt.claim.sub', v_w::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','anima_system_writer','sub',v_w)::text, true);
  BEGIN
    r := public.record_host_observed_evidence(a,b,c,d);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
    PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
  RETURN r;
END $w$;
GRANT EXECUTE ON FUNCTION pg_temp.record_host_observed_evidence(a uuid, b integer, c uuid, d jsonb) TO authenticated, anon;
CREATE FUNCTION pg_temp.record_host_observed_gate_evidence(a uuid, b integer, c uuid, d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $w$
DECLARE v_sub text := current_setting('request.jwt.claim.sub', true); v_claims text := current_setting('request.jwt.claims', true); v_w uuid; r jsonb;
BEGIN
  v_w := pg_temp.writer_for(nullif(v_sub,'')::uuid);
  PERFORM set_config('request.jwt.claim.sub', v_w::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','anima_system_writer','sub',v_w)::text, true);
  BEGIN
    r := public.record_host_observed_gate_evidence(a,b,c,d);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
    PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
  RETURN r;
END $w$;
GRANT EXECUTE ON FUNCTION pg_temp.record_host_observed_gate_evidence(a uuid, b integer, c uuid, d jsonb) TO authenticated, anon;
CREATE FUNCTION pg_temp.record_host_observed_coder_evidence(a uuid, b integer, c uuid, d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $w$
DECLARE v_sub text := current_setting('request.jwt.claim.sub', true); v_claims text := current_setting('request.jwt.claims', true); v_w uuid; r jsonb;
BEGIN
  v_w := pg_temp.writer_for(nullif(v_sub,'')::uuid);
  PERFORM set_config('request.jwt.claim.sub', v_w::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','anima_system_writer','sub',v_w)::text, true);
  BEGIN
    r := public.record_host_observed_coder_evidence(a,b,c,d);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
    PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
  RETURN r;
END $w$;
GRANT EXECUTE ON FUNCTION pg_temp.record_host_observed_coder_evidence(a uuid, b integer, c uuid, d jsonb) TO authenticated, anon;
CREATE FUNCTION pg_temp.record_verifier_opinion(a uuid, b integer, c uuid, d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $w$
DECLARE v_sub text := current_setting('request.jwt.claim.sub', true); v_claims text := current_setting('request.jwt.claims', true); v_w uuid; r jsonb;
BEGIN
  v_w := pg_temp.writer_for(nullif(v_sub,'')::uuid);
  PERFORM set_config('request.jwt.claim.sub', v_w::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','anima_system_writer','sub',v_w)::text, true);
  BEGIN
    r := public.record_verifier_opinion(a,b,c,d);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
    PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
  RETURN r;
END $w$;
GRANT EXECUTE ON FUNCTION pg_temp.record_verifier_opinion(a uuid, b integer, c uuid, d jsonb) TO authenticated, anon;
CREATE FUNCTION pg_temp.record_integration_completed(a uuid, b integer, c text, d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $w$
DECLARE v_sub text := current_setting('request.jwt.claim.sub', true); v_claims text := current_setting('request.jwt.claims', true); v_w uuid; r jsonb;
BEGIN
  v_w := pg_temp.writer_for(nullif(v_sub,'')::uuid);
  PERFORM set_config('request.jwt.claim.sub', v_w::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','anima_system_writer','sub',v_w)::text, true);
  BEGIN
    r := public.record_integration_completed(a,b,c,d);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
    PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
  RETURN r;
END $w$;
GRANT EXECUTE ON FUNCTION pg_temp.record_integration_completed(a uuid, b integer, c text, d jsonb) TO authenticated, anon;

\set t1 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"crc-t1"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set t2 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"crc-t2"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ca000000-0000-0000-0000-000000000000',true);

CREATE FUNCTION pg_temp.hce(p_item uuid, p_attempt uuid)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('schemaVersion',1,'workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',1,
    'backendId','ollama-coder','durationMs',84000,'outcome','succeeded','observedAt','2026-09-17T10:00:00Z');
$$;

CREATE FUNCTION pg_temp.start_attempt(p_conv uuid, p_target jsonb, p_claim uuid, p_attempt uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_item uuid;
BEGIN
  SELECT (public.create_work_proposal(p_conv,'low','programming',p_target,
    '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["src/a.ts"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'::jsonb)).id INTO v_item;
  PERFORM public.resolve_approval(v_item,1,'approve','{}');
  PERFORM public.record_work_intelligence_classification(v_item,1,0,
    '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-09-17T12:00:00Z","classifierId":"test"}}'::jsonb);
  PERFORM public.acquire_work_claim(v_item,1,p_claim,'sup',3600);
  PERFORM pg_temp.record_test_route(v_item,p_attempt,'local-runner-v1');
  PERFORM public.start_claimed_work_attempt(p_claim,p_attempt,'local-runner-v1');
  RETURN v_item;
END $$;

CREATE TEMP TABLE i1 AS SELECT pg_temp.start_attempt('ca000000-0000-0000-0000-000000000001',:'t1'::jsonb,'ca000000-0000-0000-0000-0000000000c1','ca000000-0000-0000-0000-0000000000a1') AS id;
CREATE TEMP TABLE i2 AS SELECT pg_temp.start_attempt('ca000000-0000-0000-0000-000000000002',:'t2'::jsonb,'ca000000-0000-0000-0000-0000000000c2','ca000000-0000-0000-0000-0000000000a2') AS id;

-- Captura os ids como literais client-side: as inserções diretas rodam como
-- service_role, que não enxerga as TEMP tables criadas pelo papel authenticated.
SELECT id AS i1id FROM i1 \gset
SELECT id AS i2id FROM i2 \gset

-- ============================================================
-- (1-2) Writer real (RPC) recebe o carimbo canônico correto
-- ============================================================

SELECT pg_temp.record_host_observed_coder_evidence((SELECT id FROM i1),1,'ca000000-0000-0000-0000-0000000000a1',
  pg_temp.hce((SELECT id FROM i1),'ca000000-0000-0000-0000-0000000000a1'));

SELECT is(
  (SELECT payload->'canonical_contract'->>'id' FROM public.work_events
     WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_coder_evidence_recorded'),
  'host_observed_coder_evidence','evento do coder é carimbado com o id canônico correto');
SELECT is(
  (SELECT payload->'canonical_contract'->>'version' FROM public.work_events
     WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_coder_evidence_recorded'),
  '1','evento do coder é carimbado com a versão canônica atual');

-- ============================================================
-- (3) Evento NÃO-canônico não é carimbado
-- ============================================================

SELECT ok(
  (SELECT bool_and(payload -> 'canonical_contract' IS NULL) FROM public.work_events
     WHERE work_item_id=(SELECT id FROM i1) AND event_type='execution_started'),
  'evento não-canônico (execution_started) não recebe carimbo');

-- ============================================================
-- (4-5) Carimbo é AUTORITATIVO: sobrescreve valor forjado pelo cliente
-- ============================================================

-- Sessão de OPERADOR: desde 20260929000000 nenhum papel de API (nem service_role) insere fato
-- reservado direto na tabela; o carimbo continua autoritativo mesmo para o operador.
RESET ROLE;
INSERT INTO public.work_events(work_item_id, event_type, author, proposal_version, payload)
VALUES (:'i2id','host_observed_coder_evidence_recorded','system',1,
  jsonb_build_object('schema_version',1,
    'data',jsonb_build_object('attempt_id','ca000000-0000-0000-0000-0000000000a2'),
    'canonical_contract',jsonb_build_object('id','forjado','version',99)));

SELECT is(
  (SELECT payload->'canonical_contract'->>'id' FROM public.work_events
     WHERE work_item_id=(SELECT id FROM i2) AND event_type='host_observed_coder_evidence_recorded'),
  'host_observed_coder_evidence','trigger sobrescreve o id forjado pelo cliente');
SELECT is(
  (SELECT payload->'canonical_contract'->>'version' FROM public.work_events
     WHERE work_item_id=(SELECT id FROM i2) AND event_type='host_observed_coder_evidence_recorded'),
  '1','trigger sobrescreve a versão forjada pelo cliente (sem versão arbitrária)');

-- ============================================================
-- (6) CHECK recusa carimbo malformado (versão < 1) em evento não-canônico
-- ============================================================

SET LOCAL ROLE service_role;
SELECT throws_ok(
  format($$ INSERT INTO public.work_events(work_item_id, event_type, author, proposal_version, payload)
     VALUES (%L,'execution_started','system',1,
       jsonb_build_object('schema_version',1,'data',jsonb_build_object('x',1),
         'canonical_contract',jsonb_build_object('id','host_observed_evidence','version',0))) $$, :'i1id'::uuid),
  '23514',NULL,'carimbo malformado (version < 1) é recusado pela CHECK');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
