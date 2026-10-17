-- A2-0 / Recorte 1 — fato de CONTEXTO DE EXECUÇÃO (execution_mode / actor_kind) observado pelo host.
--
-- O que estas asserções provam: `record_host_observed_execution_context` só executa para o Trusted System
-- Writer; deriva a AUTORIDADE do ledger (nunca do cliente); confere a identidade do runner contra o dono
-- do item; correlaciona o fato à attempt e à versão aprovada; recusa `unattended` quando o ledger o
-- contradiz (lease, ato humano após o mandato, attempt sem claim); é idempotente por attempt; é
-- append-only e não toca estado, aceite nem integração; mantém o ledger histórico intacto.
--
-- Prefixo de UUID livre: d2000000.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir helpers/routing.inc
SELECT * FROM no_plan();

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('d2000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a20@test.invalid','',now(),'{}','{}',now(),now()),
('d2000000-0000-0000-0000-0000000000ff','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a20-out@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) SELECT ('d2000000-0000-0000-0000-00000000010'||n)::uuid,'d2000000-0000-0000-0000-000000000000','user','pedido '||n FROM generate_series(1,8) n;
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('d2000000-0000-0000-0000-000000000000');
RESET ROLE;

-- Wrappers de TESTE: assumem a identidade de um writer registrado para o dono da sessão corrente
-- (role=anima_system_writer) e chamam a RPC real. A fronteira de GRANT é provada abaixo com ACL.
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
CREATE FUNCTION pg_temp.rec(a uuid, b integer, c uuid, d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $w$
DECLARE v_sub text := current_setting('request.jwt.claim.sub', true); v_claims text := current_setting('request.jwt.claims', true); v_w uuid; r jsonb;
BEGIN
  v_w := pg_temp.writer_for(nullif(v_sub,'')::uuid);
  PERFORM set_config('request.jwt.claim.sub', v_w::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','anima_system_writer','sub',v_w)::text, true);
  BEGIN
    r := public.record_host_observed_execution_context(a,b,c,d);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
    PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
  RETURN r;
END $w$;
GRANT EXECUTE ON FUNCTION pg_temp.rec(a uuid, b integer, c uuid, d jsonb) TO authenticated, anon;

\set env '{"envelope_version":1,"authority":"autonomous_policy","source_id":"FIX-A20","checks":["state_proposed","governor_permit"]}'

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000000',true);

-- Evidência declarada pelo host (o que o cliente envia). Parametrizável para o caminho adulterado.
CREATE FUNCTION pg_temp.ctx(p_item uuid, p_attempt uuid, p_mode text DEFAULT 'unattended', p_actor text DEFAULT 'automated_runner',
  p_at text DEFAULT '2026-10-16T10:00:00Z', p_runner_user text DEFAULT 'd2000000-0000-0000-0000-000000000000', p_version integer DEFAULT 1)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('schemaVersion',1,'workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',p_version,
    'executionMode',p_mode,'actorKind',p_actor,'observedAt',p_at,
    'runner',jsonb_build_object('kind','single_item_cli','authenticatedUserId',p_runner_user,'instanceId','sched-1'));
$$;

-- Item aprovado + classificado + claim + attempt. p_policy => aprovação por política autônoma (system).
CREATE FUNCTION pg_temp.start_attempt(p_conv uuid, p_ref text, p_claim uuid, p_attempt uuid, p_policy boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_item uuid;
BEGIN
  SELECT (public.create_work_proposal(p_conv,'low','programming',
    CASE WHEN p_policy THEN jsonb_build_object(
      'execution_spec','{"schema_version":1,"target":{"kind":"project","reference":"anima"},"executor":"worktree","coder_backend":"ollama","base_sha":"abc123","permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"t","command":"npm test"}],"limits":{"max_attempts":3,"max_duration_minutes":30}}'::jsonb,
      'canonical_provenance','{"kind":"canonical_backlog","sourceId":"FIX-A20","document":"docs/x.md","heading":"FIX-A20","canonicalObjective":"obj","planningGeneration":1,"materializationReason":"selected_ready"}'::jsonb)
    ELSE jsonb_build_object('execution_spec',jsonb_build_object('schema_version',1,'target',jsonb_build_object('kind','project','reference',p_ref),
      'permissions','[]'::jsonb,'validation_criteria','[{"label":"tests"}]'::jsonb,'limits','{"max_attempts":1}'::jsonb)) END,
    '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["src/a.ts"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'::jsonb)).id INTO v_item;
  IF p_policy THEN PERFORM public.auto_approve_autonomous_work(v_item,1,'{"envelope_version":1,"authority":"autonomous_policy","source_id":"FIX-A20","checks":["state_proposed","governor_permit"]}'::jsonb);
  ELSE PERFORM public.resolve_approval(v_item,1,'approve','{}'); END IF;
  PERFORM public.record_work_intelligence_classification(v_item,1,0,
    '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-10-16T09:00:00Z","classifierId":"test"}}'::jsonb);
  PERFORM public.acquire_work_claim(v_item,1,p_claim,'sup',3600);
  PERFORM pg_temp.record_test_route(v_item,p_attempt,'local-runner-v1');
  PERFORM public.start_claimed_work_attempt(p_claim,p_attempt,'local-runner-v1');
  RETURN v_item;
END $$;

CREATE TEMP TABLE i1 AS SELECT pg_temp.start_attempt('d2000000-0000-0000-0000-000000000101','a20-t1','d2000000-0000-0000-0000-0000000000c1','d2000000-0000-0000-0000-0000000000a1') AS id;
CREATE TEMP TABLE i2 AS SELECT pg_temp.start_attempt('d2000000-0000-0000-0000-000000000102','a20-t2','d2000000-0000-0000-0000-0000000000c2','d2000000-0000-0000-0000-0000000000a2') AS id;
CREATE TEMP TABLE i3 AS SELECT pg_temp.start_attempt('d2000000-0000-0000-0000-000000000103','a20-t3','d2000000-0000-0000-0000-0000000000c3','d2000000-0000-0000-0000-0000000000a3') AS id;
CREATE TEMP TABLE i4 AS SELECT pg_temp.start_attempt('d2000000-0000-0000-0000-000000000104','a20-t4','d2000000-0000-0000-0000-0000000000c4','d2000000-0000-0000-0000-0000000000a4',true) AS id;

-- ============================================================
-- (1) Registro válido com mandato HUMANO prévio: autoridade derivada do ledger
-- ============================================================
SELECT is((pg_temp.rec((SELECT id FROM i1),1,'d2000000-0000-0000-0000-0000000000a1',
  pg_temp.ctx((SELECT id FROM i1),'d2000000-0000-0000-0000-0000000000a1')))->>'action','recorded','unattended com mandato humano prévio, sem lease e sem ato humano posterior, é registrado');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_execution_context_recorded'),1::bigint,'exatamente um fato');
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_execution_context_recorded'),'system','autor system — o runner não forja');
SELECT is((SELECT payload#>>'{data,recorded_by}' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_execution_context_recorded'),'trusted_system_writer','proveniência: Trusted System Writer');
SELECT is((SELECT payload#>>'{data,origin}' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_execution_context_recorded'),'host','origem host');
SELECT is((SELECT payload#>>'{data,execution_mode}' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_execution_context_recorded'),'unattended','execution_mode no topo do fato');
SELECT is((SELECT payload#>>'{data,actor_kind}' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_execution_context_recorded'),'automated_runner','actor_kind no topo do fato');
SELECT is((SELECT payload#>>'{data,authority,approval_author}' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_execution_context_recorded'),'user','autoridade derivada: aprovação humana');
SELECT is((SELECT payload#>>'{data,authority,approval_authority}' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_execution_context_recorded'),'human','autoridade derivada: human');
SELECT is((SELECT (payload#>>'{data,authority,approved_seq}')::bigint FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_execution_context_recorded'),
  (SELECT seq FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='work_approved'),'approved_seq aponta o work_approved real');
SELECT is((SELECT (payload#>>'{data,authority,leases_observed}')::int FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_execution_context_recorded'),0,'zero leases observadas');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i1)),'in_progress','registrar o contexto não muda o estado');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type IN ('result_accepted','integration_decided','integration_effect_authorized','integration_completed','verifier_opinion_recorded')),0::bigint,'não aceita, não integra, não emite parecer');

-- ============================================================
-- (2) Idempotência por attempt
-- ============================================================
SELECT is((pg_temp.rec((SELECT id FROM i1),1,'d2000000-0000-0000-0000-0000000000a1',
  pg_temp.ctx((SELECT id FROM i1),'d2000000-0000-0000-0000-0000000000a1','unattended','automated_runner','2026-10-16T23:59:00Z')))->>'action','replayed','replay com outro observedAt');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='host_observed_execution_context_recorded'),1::bigint,'replay não cria evento');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i1),1,'d2000000-0000-0000-0000-0000000000a1',
  pg_temp.ctx((SELECT id FROM i1),'d2000000-0000-0000-0000-0000000000a1','supervised','automated_runner')) $$,'55000',NULL,'mesmo attempt com modo divergente é conflito (nunca duas verdades)');

-- ============================================================
-- (3) Fronteira de confiança: só o Trusted System Writer
-- ============================================================
SELECT throws_ok($$ SELECT public.record_host_observed_execution_context((SELECT id FROM i1),1,'d2000000-0000-0000-0000-0000000000a1',
  pg_temp.ctx((SELECT id FROM i1),'d2000000-0000-0000-0000-0000000000a1')) $$,'42501',NULL,'sessão humana/runner autenticada NÃO executa a RPC');
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT public.record_host_observed_execution_context('d2000000-0000-0000-0000-000000000001',1,'d2000000-0000-0000-0000-0000000000a1','{}'::jsonb) $$,'42501',NULL,'anon não executa');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000000',true);
RESET ROLE;
SELECT ok(has_function_privilege('anima_system_writer','public.record_host_observed_execution_context(uuid,integer,uuid,jsonb)','EXECUTE'),'ACL: writer executa');
SELECT ok(NOT has_function_privilege('authenticated','public.record_host_observed_execution_context(uuid,integer,uuid,jsonb)','EXECUTE'),'ACL: authenticated não executa');
SELECT ok(NOT has_function_privilege('anon','public.record_host_observed_execution_context(uuid,integer,uuid,jsonb)','EXECUTE'),'ACL: anon não executa');
SELECT ok(NOT has_function_privilege('service_role','public.record_host_observed_execution_context(uuid,integer,uuid,jsonb)','EXECUTE'),'ACL: service_role não executa');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000000',true);

-- falsificação de identidade do runner e de dono
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2','unattended','automated_runner','2026-10-16T10:00:00Z','d2000000-0000-0000-0000-0000000000ff')) $$,'42501',NULL,'runner declarando outra identidade é recusado');
SELECT set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-0000000000ff',true);
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i1),1,'d2000000-0000-0000-0000-0000000000a1',
  pg_temp.ctx((SELECT id FROM i1),'d2000000-0000-0000-0000-0000000000a1','unattended','automated_runner','2026-10-16T10:00:00Z','d2000000-0000-0000-0000-0000000000ff')) $$,'42501',NULL,'dono fora da allowlist é recusado');
SELECT set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000000',true);

-- ============================================================
-- (4) Régua estrutural e correlação fail-closed
-- ============================================================
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-000000000abc')) $$,'22023',NULL,'attempt declarada ≠ parâmetro (correlação)');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  pg_temp.ctx((SELECT id FROM i1),'d2000000-0000-0000-0000-0000000000a2')) $$,'22023',NULL,'item declarado ≠ parâmetro (correlação)');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2','autonomous')) $$,'22023',NULL,'execution_mode fora do conjunto');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2','unattended','root')) $$,'22023',NULL,'actor_kind fora do conjunto');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2','unattended','human_operator')) $$,'22023',NULL,'unattended + operador humano é incoerente');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2','manual','automated_runner')) $$,'22023',NULL,'manual + runner automático é incoerente');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2') || '{"role":"anima_system_writer"}'::jsonb) $$,'22023',NULL,'campo extra (role) é recusado');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2') || '{"authority":{"approval_author":"user"}}'::jsonb) $$,'22023',NULL,'autoridade declarada pelo cliente é recusada');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  jsonb_set(pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2'),'{runner,extra}','"x"')) $$,'22023',NULL,'runner com campo extra');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  jsonb_set(pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2'),'{runner,instanceId}','"C:\\x"')) $$,'22023',NULL,'instância com caminho');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  jsonb_set(pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2'),'{runner,kind}','"root"')) $$,'22023',NULL,'runner.kind fora do conjunto');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  jsonb_set(pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2'),'{runner,authenticatedUserId}','"service_role"')) $$,'22023',NULL,'runner.authenticatedUserId não UUID');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2', '[]'::jsonb) $$,'22023',NULL,'evidência não-objeto');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),0,'d2000000-0000-0000-0000-0000000000a2',
  pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2','unattended','automated_runner','2026-10-16T10:00:00Z','d2000000-0000-0000-0000-000000000000',0)) $$,'22023',NULL,'versão aprovada inválida');

-- ausência de contexto / divergência de attempt e versão
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-000000000abc',
  pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-000000000abc')) $$,'P0002',NULL,'attempt inexistente');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a1',
  pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a1')) $$,'P0002',NULL,'attempt de OUTRO item');
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),2,'d2000000-0000-0000-0000-0000000000a2',
  pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2','unattended','automated_runner','2026-10-16T10:00:00Z','d2000000-0000-0000-0000-000000000000',2)) $$,'P0002',NULL,'versão aprovada divergente da attempt');
SELECT throws_ok($$ SELECT pg_temp.rec('d2000000-0000-0000-0000-0000000000dd',1,'d2000000-0000-0000-0000-0000000000a2',
  pg_temp.ctx('d2000000-0000-0000-0000-0000000000dd','d2000000-0000-0000-0000-0000000000a2')) $$,'P0002',NULL,'item inexistente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i2) AND event_type='host_observed_execution_context_recorded'),0::bigint,'nenhuma recusa deixou fato parcial');

-- ============================================================
-- (5) `unattended` sem sustentação no ledger é recusado; rebaixamentos seguros são aceitos
-- ============================================================
-- lease de supervisão humana
SELECT public.grant_work_supervision((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000e2',600);
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2')) $$,'55000',NULL,'unattended com supervision lease é recusado');
SELECT public.revoke_work_supervision((SELECT id FROM i2));
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2')) $$,'55000',NULL,'lease REVOGADA continua provando supervisão');
SELECT is((pg_temp.rec((SELECT id FROM i2),1,'d2000000-0000-0000-0000-0000000000a2',
  pg_temp.ctx((SELECT id FROM i2),'d2000000-0000-0000-0000-0000000000a2','supervised','automated_runner')))->>'action','recorded','supervised é rebaixamento seguro e é aceito');
SELECT is((SELECT (payload#>>'{data,authority,leases_observed}')::int FROM public.work_events WHERE work_item_id=(SELECT id FROM i2) AND event_type='host_observed_execution_context_recorded'),1,'a lease fica registrada na autoridade');

-- ato humano depois do mandato
RESET ROLE;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES ((SELECT id FROM i3),'input_provided','user',1,'{"schema_version":1,"data":{"note":"intervenção"}}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000000',true);
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i3),1,'d2000000-0000-0000-0000-0000000000a3',
  pg_temp.ctx((SELECT id FROM i3),'d2000000-0000-0000-0000-0000000000a3')) $$,'55000',NULL,'unattended com ato humano após o mandato é recusado');
SELECT is((pg_temp.rec((SELECT id FROM i3),1,'d2000000-0000-0000-0000-0000000000a3',
  pg_temp.ctx((SELECT id FROM i3),'d2000000-0000-0000-0000-0000000000a3','manual','human_operator')))->>'action','recorded','manual + operador humano é aceito');
SELECT is((SELECT (payload#>>'{data,authority,human_acts_after_mandate}')::int FROM public.work_events WHERE work_item_id=(SELECT id FROM i3) AND event_type='host_observed_execution_context_recorded'),1,'o ato humano fica registrado na autoridade');

-- mandato por política autônoma (system), não humano
SELECT is((pg_temp.rec((SELECT id FROM i4),1,'d2000000-0000-0000-0000-0000000000a4',
  pg_temp.ctx((SELECT id FROM i4),'d2000000-0000-0000-0000-0000000000a4')))->>'action','recorded','unattended com mandato por política autônoma');
SELECT is((SELECT payload#>>'{data,authority,approval_author}' FROM public.work_events WHERE work_item_id=(SELECT id FROM i4) AND event_type='host_observed_execution_context_recorded'),'system','autoridade derivada: system');
SELECT is((SELECT payload#>>'{data,authority,approval_authority}' FROM public.work_events WHERE work_item_id=(SELECT id FROM i4) AND event_type='host_observed_execution_context_recorded'),'autonomous_policy','autoridade derivada: autonomous_policy');

-- attempt SEM claim (início comandado): unattended recusado
CREATE FUNCTION pg_temp.start_commanded(p_conv uuid, p_ref text, p_attempt uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_item uuid;
BEGIN
  SELECT (public.create_work_proposal(p_conv,'low','programming',
    jsonb_build_object('execution_spec',jsonb_build_object('schema_version',1,'target',jsonb_build_object('kind','project','reference',p_ref),
      'permissions','[]'::jsonb,'validation_criteria','[{"label":"tests"}]'::jsonb,'limits','{"max_attempts":1}'::jsonb)),
    '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["src/a.ts"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'::jsonb)).id INTO v_item;
  PERFORM public.resolve_approval(v_item,1,'approve','{}');
  PERFORM public.record_work_intelligence_classification(v_item,1,0,
    '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-10-16T09:00:00Z","classifierId":"test"}}'::jsonb);
  PERFORM pg_temp.record_test_route(v_item,p_attempt,'local-runner-v1');
  PERFORM public.start_commanded_work_attempt(v_item,1,p_attempt,'local-runner-v1');
  RETURN v_item;
END $$;
CREATE TEMP TABLE i5 AS SELECT pg_temp.start_commanded('d2000000-0000-0000-0000-000000000105','a20-t5','d2000000-0000-0000-0000-0000000000a5') AS id;
SELECT throws_ok($$ SELECT pg_temp.rec((SELECT id FROM i5),1,'d2000000-0000-0000-0000-0000000000a5',
  pg_temp.ctx((SELECT id FROM i5),'d2000000-0000-0000-0000-0000000000a5')) $$,'55000',NULL,'unattended em attempt sem claim é recusado');

-- ============================================================
-- (6) Compatibilidade com o ledger histórico e índice único
-- ============================================================
SELECT is((SELECT count(*) FROM public.work_events WHERE event_type='host_observed_execution_context_recorded'),4::bigint,'só os 4 fatos aceitos existem; recusas não escrevem');
SELECT is((SELECT count(*) FROM public.work_events WHERE event_type<>'host_observed_execution_context_recorded' AND payload ? 'execution_mode'),0::bigint,'nenhum evento histórico ganhou execution_mode');
SELECT is((SELECT count(*) FROM public.work_events WHERE event_type<>'host_observed_execution_context_recorded' AND payload->'data' ? 'actor_kind'),0::bigint,'nenhum evento histórico ganhou actor_kind');
RESET ROLE;
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='work_events_host_execution_context_attempt_idx'),'índice único por attempt existe');
SELECT throws_ok($$ INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES ((SELECT id FROM i1),'host_observed_execution_context_recorded','system',1,
          jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id','d2000000-0000-0000-0000-0000000000a1'))) $$,'23505',NULL,'segunda linha para a mesma attempt é barrada pelo banco');
SELECT * FROM finish();
ROLLBACK;
