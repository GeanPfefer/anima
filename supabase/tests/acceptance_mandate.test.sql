-- A2-0 / Recorte 2 — ACEITE SOB MANDATO ANTECIPADO (acceptance-mandate-v1).
--
-- O que estas asserções provam: (1) fronteira de identidade — só o GRANTOR concede/revoga, só o WRITER aceita sob mandato,
-- o runner (sessão residente), anon e service_role não executam nada disso; (2) concessão fail-closed (risco, escopo, hash,
-- janela, compute pago, attempt já iniciada); (3) aceite recalculado pelo banco: mandato (expiração, revogação, replay, política),
-- contrato, base, Verifier v6 verified com zero gaps/violations, fato de contexto, integridade do candidato e escopo exato;
-- (4) consumo atômico e idempotência; (5) compatibilidade: o aceite humano continua igual; (6) imutabilidade.
-- Prefixo de UUID livre: d3000000.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT * FROM no_plan();

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('d3000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','am-owner@test.invalid','',now(),'{}','{}',now(),now()),
('d3000000-0000-0000-0000-0000000000ff','00000000-0000-0000-0000-000000000000','authenticated','authenticated','am-other@test.invalid','',now(),'{}','{}',now(),now());
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('d3000000-0000-0000-0000-000000000000');
RESET ROLE;

-- ─── Atores de teste: assumem a identidade (claims role/sub) de um writer/grantor REGISTRADO e chamam a RPC real ───
CREATE FUNCTION pg_temp.actor(p_kind text, p_owner uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $w$
DECLARE v_id uuid := md5(p_kind||':'||coalesce(p_owner::text,'none'))::uuid;
        v_role text := CASE p_kind WHEN 'writer' THEN 'anima_system_writer' WHEN 'grantor' THEN 'anima_mandate_grantor' WHEN 'rogue' THEN 'anima_mandate_grantor' ELSE 'authenticated' END;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES(v_id,'00000000-0000-0000-0000-000000000000',v_role,v_role,p_kind||'-'||v_id||'@test.invalid','',now(),'{}','{}',now(),now()) ON CONFLICT (id) DO NOTHING;
  IF p_owner IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_owner) THEN
    IF p_kind='writer' THEN INSERT INTO private.trusted_system_writers(writer_user_id,owner_user_id) VALUES(v_id,p_owner) ON CONFLICT (writer_user_id) DO NOTHING;
    ELSIF p_kind='grantor' THEN INSERT INTO private.acceptance_mandate_grantors(grantor_user_id,owner_user_id) VALUES(v_id,p_owner) ON CONFLICT (grantor_user_id) DO NOTHING; END IF;
  END IF;
  RETURN v_id;
END $w$;
CREATE FUNCTION pg_temp.as_actor(p_kind text, p_sql text, p_role_claim text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $w$
DECLARE v_sub text := current_setting('request.jwt.claim.sub', true); v_claims text := current_setting('request.jwt.claims', true); v_a uuid; r jsonb;
        v_role text := coalesce(p_role_claim, CASE p_kind WHEN 'writer' THEN 'anima_system_writer' WHEN 'grantor' THEN 'anima_mandate_grantor' WHEN 'rogue' THEN 'anima_mandate_grantor' ELSE 'authenticated' END);
BEGIN
  v_a := pg_temp.actor(p_kind, nullif(v_sub,'')::uuid);
  PERFORM set_config('request.jwt.claim.sub', v_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role',v_role,'sub',v_a)::text, true);
  BEGIN
    EXECUTE 'SELECT '||p_sql INTO r;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
    PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
  RETURN r;
END $w$;
GRANT EXECUTE ON FUNCTION pg_temp.actor(text,uuid), pg_temp.as_actor(text,text,text) TO authenticated, anon;

-- ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.spec(p_o jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('execution_spec', jsonb_strip_nulls(jsonb_build_object(
    'schema_version',1,'target',jsonb_build_object('kind','project','reference','anima-'||coalesce(p_o->>'tag','x')),
    'executor',coalesce(p_o->>'executor','worktree'),'coder_backend',coalesce(p_o->>'coder','codex-cli'),'model','default',
    'base_sha',repeat('b',40),'permissions',jsonb_build_array('workspace_read','workspace_write_isolated'),
    'limits',jsonb_build_object('max_attempts',coalesce((p_o->>'attempts')::int,1),'max_duration_minutes',35),
    'verifier_requirement',coalesce(p_o->>'verifier','required_fail_closed'),
    'validation_criteria',CASE WHEN coalesce(p_o->>'tb','no')='yes'
      THEN jsonb_build_array(jsonb_build_object('label','t','proof','gate','claim_kind','test_binding','command','npm test'))
      ELSE jsonb_build_array(jsonb_build_object('label','g','proof','gate','claim_kind','gate_assertion','command','npm test')) END,
    'resume_from_checkpoint',CASE WHEN p_o->>'resume'='yes' THEN jsonb_build_object('commit_sha',repeat('d',40)) END)));
$$;
CREATE TEMP TABLE kv(k text PRIMARY KEY, v jsonb);
GRANT ALL ON kv TO authenticated;

-- Pipeline completo até review (ou até onde o cenário pedir). Executa como superuser só para semear a evidência do host.
CREATE FUNCTION pg_temp.build(p_tag text, p_o jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $w$
DECLARE
  o jsonb := coalesce(p_o,'{}') || jsonb_build_object('tag',p_tag);
  v_owner uuid := 'd3000000-0000-0000-0000-000000000000';
  v_conv uuid := md5('conv:'||p_tag)::uuid; v_att uuid := md5('att:'||p_tag)::uuid;
  v_item uuid; v_hash text; v_prev jsonb; v_grant jsonb; v_mandate uuid; v_result uuid; v_git uuid; v_gate uuid; v_coder uuid;
  v_commit text := coalesce(o->>'handoff_commit', repeat('c',40)); v_obs_commit text := coalesce(o->>'obs_commit', coalesce(o->>'handoff_commit', repeat('c',40)));
  v_files jsonb := coalesce(o->'host_files', '["packages/core/src/a.test.ts","packages/core/src/a.ts"]'::jsonb);
  v_opinion jsonb; v_ver text := coalesce(o->>'verdict','verified'); v_ctx jsonb; v_op_res jsonb;
BEGIN
  INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES(v_conv,v_owner,'user','am '||p_tag);
  v_item := (public.create_work_proposal(v_conv, coalesce(o->>'impact','low')::public.work_impact_level, 'programming', pg_temp.spec(o),
    '{"schema_version":1,"data":{"summary":"am","objective":"o","included_scope":["packages/core/src/a.ts","packages/core/src/a.test.ts"],"excluded_scope":["z"],"expected_effects":["e"],"risks":[]}}'::jsonb)).id;
  IF coalesce(o->>'approve','yes')='yes' THEN PERFORM public.resolve_approval(v_item,1,'approve','{}'); END IF;
  IF coalesce(o->>'classify','human')='human' THEN
    PERFORM public.record_work_intelligence_classification(v_item,1,0,
      '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-10-17T00:00:00Z","classifierId":"test"}}'::jsonb);
  ELSIF o->>'classify'='system' THEN
    PERFORM public.record_work_intelligence_classification(v_item,1,0,
      '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"system_assessed","classifiedAt":"2026-10-17T00:00:00Z","classifierId":"test"}}'::jsonb);
  END IF;
  v_prev := pg_temp.as_actor('grantor', format('public.preview_acceptance_contract(%L)', v_item));
  v_hash := v_prev->>'contractSha256';
  IF coalesce(o->>'grant','yes')='yes' THEN
    v_grant := pg_temp.as_actor('grantor', format('public.grant_acceptance_mandate(%L,1,%L,%L,%L::text[],%L,%L,%L)', v_item, v_hash, repeat('b',40),
      '{packages/core/src/a.test.ts,packages/core/src/a.ts}',
      CASE WHEN o ? 'not_before' THEN o->>'not_before' ELSE clock_timestamp()::text END,
      CASE WHEN o ? 'expires_at' THEN o->>'expires_at' ELSE (clock_timestamp() + interval '1 hour')::text END,
      md5('req:'||p_tag)::uuid));
    v_mandate := (v_grant->>'mandate_id')::uuid;
  END IF;
  PERFORM public.start_commanded_work_attempt(v_item,1,v_att,'worktree-v1');
  PERFORM public.record_commanded_work_terminal(v_item,1,v_att, jsonb_build_object('kind','result','workItemId',v_item,'attemptId',v_att,'approvedProposalVersion',1,
    'origin','executor','sequence',1,'summary','feito','resultReferences','[]'::jsonb,'validations','[]'::jsonb,'limitations','[]'::jsonb,
    'handoffReference','worktree:anima:anima-work/x','worktreeHandoff',jsonb_build_object('commitSha',v_commit)));
  SELECT id INTO v_result FROM public.work_events WHERE work_item_id=v_item AND event_type='result_submitted' ORDER BY seq DESC LIMIT 1;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
   (v_item,'host_observed_evidence_recorded','system',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('work_item_id',v_item,'attempt_id',v_att,'approved_proposal_version',1,'origin','host',
     'evidence',jsonb_build_object('baseSha',coalesce(o->>'host_base',repeat('b',40)),'observedCommitSha',v_obs_commit,'observedChangedFiles',v_files)))) RETURNING id INTO v_git;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
   (v_item,'host_observed_gate_evidence_recorded','system',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('work_item_id',v_item,'attempt_id',v_att,'approved_proposal_version',1,'origin','host','evidence','{}'::jsonb))) RETURNING id INTO v_gate;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
   (v_item,'host_observed_coder_evidence_recorded','system',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('work_item_id',v_item,'attempt_id',v_att,'approved_proposal_version',1,'origin','host','evidence','{}'::jsonb))) RETURNING id INTO v_coder;
  IF coalesce(o->>'ctx','supervised')<>'none' THEN
    v_ctx := pg_temp.as_actor('writer', format('public.record_host_observed_execution_context(%L,1,%L,%L::jsonb)', v_item, v_att, jsonb_build_object('schemaVersion',1,'workItemId',v_item,'attemptId',v_att,
      'approvedProposalVersion',1,'executionMode',coalesce(o->>'ctx','supervised'),'actorKind',CASE WHEN o->>'ctx'='manual' THEN 'human_operator' ELSE 'automated_runner' END,
      'runner',jsonb_build_object('kind','single_item_cli','authenticatedUserId',v_owner,'instanceId','am-test'),'observedAt','2026-10-17T00:00:00Z')));
  END IF;
  v_opinion := jsonb_build_object('schemaVersion',1,'workItemId',v_item,'attemptId',v_att,'approvedProposalVersion',1,
    'verifierVersion',coalesce(o->>'vver','work-verifier-v6'),'verdict',v_ver,'restsOnAttestedEvidence',false,
    'summary',jsonb_build_object('violations',coalesce((o->>'violations')::int,0),'gaps',coalesce((o->>'gaps')::int,0),'checks',1,'attested',0,'independent',1),
    'findings',CASE WHEN coalesce(o->>'tb_finding','no')='yes' THEN jsonb_build_array(jsonb_build_object('code','test_binding_satisfied','provenance','independent')) ELSE '[]'::jsonb END,
    'evidenceBasis',jsonb_build_object('resultEventId',v_result,'observedEventId',v_git,'observedGateEventId',v_gate,'coverage',jsonb_build_object('git',true,'gates',true)));
  v_op_res := pg_temp.as_actor('writer', format('public.record_verifier_opinion(%L,1,%L,%L::jsonb)', v_item, v_att, v_opinion));
  RETURN jsonb_build_object('item',v_item,'att',v_att,'result',v_result,'mandate',v_mandate,'hash',v_hash,'git',v_git,'released',v_op_res->>'released_for_review');
END $w$;
GRANT EXECUTE ON FUNCTION pg_temp.spec(jsonb), pg_temp.build(text,jsonb) TO authenticated;

CREATE FUNCTION pg_temp.integ(c jsonb, p_over jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT (jsonb_build_object('schemaVersion',1,'commitSha',repeat('c',40),'baseSha',repeat('b',40),'parentShas',jsonb_build_array(repeat('b',40)),
    'commitCount',1,'mergeCount',0,'baseIsAncestor',true,
    'changedFiles','["packages/core/src/a.ts","packages/core/src/a.test.ts"]'::jsonb,
    'changeStatuses','[{"path":"packages/core/src/a.ts","status":"A"},{"path":"packages/core/src/a.test.ts","status":"A"}]'::jsonb,
    'checkedAt','2026-10-17T00:00:00Z') || coalesce(p_over,'{}'::jsonb)) - coalesce((SELECT array_agg(key) FROM jsonb_each_text(coalesce(p_over,'{}')) WHERE value IS NULL),'{}');
$$;
CREATE FUNCTION pg_temp.accept(c jsonb, p_over jsonb DEFAULT '{}', p_kind text DEFAULT 'writer', p_mandate uuid DEFAULT NULL, p_result uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.as_actor(p_kind, format('public.accept_work_result_under_mandate(%L,1,%L,%L,%L::jsonb)', c->>'item', coalesce(p_result,(c->>'result')::uuid), coalesce(p_mandate,(c->>'mandate')::uuid), pg_temp.integ(c,p_over)));
$$;
GRANT EXECUTE ON FUNCTION pg_temp.integ(jsonb,jsonb), pg_temp.accept(jsonb,jsonb,text,uuid,uuid) TO authenticated, anon;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);

-- ============================================================
-- (1) FLUXO FELIZ + efeitos
-- ============================================================
INSERT INTO kv SELECT 'ok', pg_temp.build('ok', '{"tb":"yes","tb_finding":"yes"}');
SELECT is((SELECT v->>'released' FROM kv WHERE k='ok'),'true','fixture: parecer v6 verified libera o item para review');
SELECT is((SELECT state::text FROM public.work_items WHERE id=((SELECT v->>'item' FROM kv WHERE k='ok'))::uuid),'review','fixture: item em review');
SELECT is((pg_temp.accept((SELECT v FROM kv WHERE k='ok')))->>'action','accepted','1. aceite sob mandato válido é registrado');
SELECT is((SELECT state::text FROM public.work_items WHERE id=((SELECT v->>'item' FROM kv WHERE k='ok'))::uuid),'completed','1. item completed (nunca integrated)');
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=((SELECT v->>'item' FROM kv WHERE k='ok'))::uuid AND event_type='result_accepted'),'system','1. result_accepted author system (não user)');
SELECT is((SELECT payload#>>'{data,authority,kind}' FROM public.work_events WHERE work_item_id=((SELECT v->>'item' FROM kv WHERE k='ok'))::uuid AND event_type='result_accepted'),'human_mandate','1. authority.kind human_mandate');
SELECT is((SELECT payload#>>'{data,decided_by}' FROM public.work_events WHERE work_item_id=((SELECT v->>'item' FROM kv WHERE k='ok'))::uuid AND event_type='result_accepted'),'trusted_system_writer','1. decidido pelo Trusted System Writer');
SELECT is((SELECT payload#>>'{data,accepted_result_event_id}' FROM public.work_events WHERE work_item_id=((SELECT v->>'item' FROM kv WHERE k='ok'))::uuid AND event_type='result_accepted'),(SELECT v->>'result' FROM kv WHERE k='ok'),'1. compatível com a integração: accepted_result_event_id preservado');
SELECT is((SELECT payload#>>'{data,authority,grant_event_seq}' FROM public.work_events WHERE work_item_id=((SELECT v->>'item' FROM kv WHERE k='ok'))::uuid AND event_type='result_accepted')::bigint,
  (SELECT seq FROM public.work_events WHERE work_item_id=((SELECT v->>'item' FROM kv WHERE k='ok'))::uuid AND event_type='work_mandate_granted'),'1. cita o evento humano de concessão');
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=((SELECT v->>'item' FROM kv WHERE k='ok'))::uuid AND event_type='work_mandate_granted'),'user','concessão é ato humano (author user)');
SELECT ok((SELECT consumed_at IS NOT NULL AND consumed_event_id IS NOT NULL FROM public.work_acceptance_mandates WHERE id=((SELECT v->>'mandate' FROM kv WHERE k='ok'))::uuid),'1. mandato consumido atomicamente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=((SELECT v->>'item' FROM kv WHERE k='ok'))::uuid AND (event_type::text LIKE 'integration%')),0::bigint,'1. aceite não integra nem publica');
SELECT is((pg_temp.accept((SELECT v FROM kv WHERE k='ok')))->>'action','replayed','2. replay do mesmo aceite é idempotente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=((SELECT v->>'item' FROM kv WHERE k='ok'))::uuid AND event_type='result_accepted'),1::bigint,'2. replay não cria novo evento');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='ok'),'{}','writer',NULL,'d3000000-0000-0000-0000-00000000dead') $$,'%mandate_consumed%','2. mandato consumido recusa outro resultado');

-- ============================================================
-- (2) FRONTEIRA DE IDENTIDADE (ACL e papéis)
-- ============================================================
INSERT INTO kv SELECT 'idn', pg_temp.build('idn');
SELECT throws_ok($$ SELECT public.accept_work_result_under_mandate((SELECT (v->>'item')::uuid FROM kv WHERE k='idn'),1,(SELECT (v->>'result')::uuid FROM kv WHERE k='idn'),(SELECT (v->>'mandate')::uuid FROM kv WHERE k='idn'),'{}'::jsonb) $$,'42501',NULL,'3. runner (sessão residente) NÃO executa o aceite sob mandato');
SELECT throws_ok($$ SELECT public.grant_acceptance_mandate((SELECT (v->>'item')::uuid FROM kv WHERE k='idn'),1,repeat('a',64),repeat('b',40),ARRAY['x.ts'],now(),now()+interval '1 hour',gen_random_uuid()) $$,'42501',NULL,'3. runner NÃO concede mandato');
SELECT throws_ok($$ SELECT public.revoke_acceptance_mandate((SELECT (v->>'mandate')::uuid FROM kv WHERE k='idn'),'x') $$,'42501',NULL,'3. runner NÃO revoga mandato');
SELECT throws_ok($$ SELECT public.preview_acceptance_contract((SELECT (v->>'item')::uuid FROM kv WHERE k='idn')) $$,'42501',NULL,'3. runner NÃO usa o preview do grantor');
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT public.accept_work_result_under_mandate('d3000000-0000-0000-0000-000000000001',1,'d3000000-0000-0000-0000-000000000002','d3000000-0000-0000-0000-000000000003','{}'::jsonb) $$,'42501',NULL,'3. anon não aceita');
SELECT throws_ok($$ SELECT public.grant_acceptance_mandate('d3000000-0000-0000-0000-000000000001',1,repeat('a',64),repeat('b',40),ARRAY['x.ts'],now(),now()+interval '1 hour',gen_random_uuid()) $$,'42501',NULL,'3. anon não concede');
SET LOCAL ROLE service_role;
SELECT throws_ok($$ SELECT public.accept_work_result_under_mandate('d3000000-0000-0000-0000-000000000001',1,'d3000000-0000-0000-0000-000000000002','d3000000-0000-0000-0000-000000000003','{}'::jsonb) $$,'42501',NULL,'3. service_role não aceita');
SELECT throws_ok($$ SELECT public.grant_acceptance_mandate('d3000000-0000-0000-0000-000000000001',1,repeat('a',64),repeat('b',40),ARRAY['x.ts'],now(),now()+interval '1 hour',gen_random_uuid()) $$,'42501',NULL,'3. service_role não concede');
RESET ROLE;
SELECT ok(has_function_privilege('anima_system_writer','public.accept_work_result_under_mandate(uuid,integer,uuid,uuid,jsonb)','EXECUTE'),'ACL: writer executa o aceite');
SELECT ok(NOT has_function_privilege('anima_mandate_grantor','public.accept_work_result_under_mandate(uuid,integer,uuid,uuid,jsonb)','EXECUTE'),'ACL: grantor NÃO executa o aceite');
SELECT ok(has_function_privilege('anima_mandate_grantor','public.grant_acceptance_mandate(uuid,integer,text,text,text[],timestamptz,timestamptz,uuid)','EXECUTE'),'ACL: grantor executa a concessão');
SELECT ok(NOT has_function_privilege('anima_system_writer','public.grant_acceptance_mandate(uuid,integer,text,text,text[],timestamptz,timestamptz,uuid)','EXECUTE'),'ACL: writer NÃO concede');
SELECT ok(NOT has_function_privilege('anima_system_writer','public.revoke_acceptance_mandate(uuid,text)','EXECUTE'),'ACL: writer NÃO revoga');
SELECT ok(NOT has_function_privilege('authenticated','public.accept_work_result_under_mandate(uuid,integer,uuid,uuid,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.accept_work_result_under_mandate(uuid,integer,uuid,uuid,jsonb)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.accept_work_result_under_mandate(uuid,integer,uuid,uuid,jsonb)','EXECUTE'),'ACL: authenticated/anon/service_role sem EXECUTE no aceite');
SELECT ok(NOT has_function_privilege(r,fn,'EXECUTE'),'ACL: '||r||' sem EXECUTE em '||split_part(fn,'(',1)) FROM (VALUES ('authenticated'),('anon'),('service_role'),('public')) a(r), (VALUES
  ('public.grant_acceptance_mandate(uuid,integer,text,text,text[],timestamptz,timestamptz,uuid)'),('public.revoke_acceptance_mandate(uuid,text)'),('public.preview_acceptance_contract(uuid)'),('public.accept_work_result_under_mandate(uuid,integer,uuid,uuid,jsonb)')) b(fn);
SELECT ok(has_function_privilege('anima_mandate_grantor','public.revoke_acceptance_mandate(uuid,text)','EXECUTE') AND has_function_privilege('anima_mandate_grantor','public.preview_acceptance_contract(uuid)','EXECUTE'),'ACL: grantor executa preview e revoke');
SELECT ok(NOT has_table_privilege('authenticated','public.work_acceptance_mandates','INSERT') AND NOT has_table_privilege('authenticated','public.work_acceptance_mandates','UPDATE') AND NOT has_table_privilege('authenticated','public.work_acceptance_mandates','DELETE') AND NOT has_table_privilege('service_role','public.work_acceptance_mandates','INSERT'),'ACL: tabela de mandatos sem escrita direta para authenticated/service_role');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);
SELECT throws_ok($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='idn'),'{}','grantor') $$,'42501',NULL,'3. o GRANTOR não aceita');
SELECT throws_ok($$ SELECT pg_temp.as_actor('writer',format('public.grant_acceptance_mandate(%L,1,%L,%L,ARRAY[%L],now(),now()+interval ''1 hour'',gen_random_uuid())',(SELECT v->>'item' FROM kv WHERE k='idn'),repeat('a',64),repeat('b',40),'x.ts')) $$,'42501',NULL,'3. o WRITER não concede');
SELECT throws_ok($$ SELECT pg_temp.as_actor('rogue',format('public.preview_acceptance_contract(%L)',(SELECT v->>'item' FROM kv WHERE k='idn'))) $$,'42501',NULL,'3. papel de grantor SEM registro é recusado');
SELECT throws_ok($$ SELECT pg_temp.as_actor('grantor',format('public.preview_acceptance_contract(%L)',(SELECT v->>'item' FROM kv WHERE k='idn')),'authenticated') $$,'42501',NULL,'3. grantor registrado com claim role=authenticated (sessão comum) é recusado');
SELECT throws_ok($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='idn'),'{}','resident') $$,'42501',NULL,'3. identidade authenticated disfarçada com o mesmo sub não vira writer');
RESET ROLE;
SELECT throws_ok($$ INSERT INTO private.acceptance_mandate_grantors(grantor_user_id,owner_user_id) VALUES('d3000000-0000-0000-0000-000000000000','d3000000-0000-0000-0000-0000000000ff') $$,'42501',NULL,'3. um usuário da allowlist de trabalho (o humano/runner) NÃO pode ser registrado como grantor');
SELECT throws_ok($$ INSERT INTO private.acceptance_mandate_grantors(grantor_user_id,owner_user_id) VALUES(md5('writer:d3000000-0000-0000-0000-000000000000')::uuid,'d3000000-0000-0000-0000-0000000000ff') $$,'42501',NULL,'3. o Trusted System Writer NÃO pode ser registrado como grantor');
SELECT throws_ok($$ INSERT INTO private.acceptance_mandate_grantors(grantor_user_id,owner_user_id) VALUES('d3000000-0000-0000-0000-0000000000ff','d3000000-0000-0000-0000-0000000000ff') $$,'23514',NULL,'3. grantor não pode ser o próprio dono');
UPDATE private.acceptance_mandate_grantors SET revoked_at=now() WHERE grantor_user_id=md5('grantor:d3000000-0000-0000-0000-000000000000')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);
SELECT throws_ok($$ SELECT pg_temp.as_actor('grantor',format('public.preview_acceptance_contract(%L)',(SELECT v->>'item' FROM kv WHERE k='idn'))) $$,'42501',NULL,'3. grantor REVOGADO é recusado');
RESET ROLE;
UPDATE private.acceptance_mandate_grantors SET revoked_at=NULL WHERE grantor_user_id=md5('grantor:d3000000-0000-0000-0000-000000000000')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);

-- ============================================================
-- (3) CONCESSÃO fail-closed
-- ============================================================
CREATE FUNCTION pg_temp.mk_plain(p_tag text, p_o jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $w$
DECLARE o jsonb := coalesce(p_o,'{}') || jsonb_build_object('tag',p_tag); v_conv uuid := md5('conv:'||p_tag)::uuid; v_item uuid;
BEGIN
  INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES(v_conv,'d3000000-0000-0000-0000-000000000000','user',p_tag);
  v_item := (public.create_work_proposal(v_conv, coalesce(o->>'impact','low')::public.work_impact_level, coalesce(o->>'capability','programming')::public.work_capability, pg_temp.spec(o),
    '{"schema_version":1,"data":{"summary":"am","objective":"o","included_scope":["packages/core/src/a.ts","packages/core/src/a.test.ts"],"excluded_scope":["z"],"expected_effects":["e"],"risks":[]}}'::jsonb)).id;
  IF coalesce(o->>'approve','yes')='yes' THEN PERFORM public.resolve_approval(v_item,1,'approve','{}'); END IF;
  IF coalesce(o->>'classify','human')='human' THEN
    PERFORM public.record_work_intelligence_classification(v_item,1,0,'{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-10-17T00:00:00Z","classifierId":"test"}}'::jsonb);
  ELSIF o->>'classify'='system' THEN
    PERFORM public.record_work_intelligence_classification(v_item,1,0,'{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"system_assessed","classifiedAt":"2026-10-17T00:00:00Z","classifierId":"test"}}'::jsonb);
  ELSIF o->>'classify'='risky' THEN
    PERFORM public.record_work_intelligence_classification(v_item,1,0,'{"schemaVersion":1,"complexity":"complex","risk":"high","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-10-17T00:00:00Z","classifierId":"test"}}'::jsonb);
  END IF;
  RETURN v_item;
END $w$;
CREATE FUNCTION pg_temp.try_grant(p_item uuid, p_o jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.as_actor('grantor', format('public.grant_acceptance_mandate(%L,%s,%L,%L,%L::text[],%L,%L,%L)', p_item, coalesce(p_o->>'version','1'),
    coalesce(p_o->>'hash', (pg_temp.as_actor('grantor', format('public.preview_acceptance_contract(%L)', p_item)))->>'contractSha256'),
    coalesce(p_o->>'base', repeat('b',40)), coalesce(p_o->>'scope','{packages/core/src/a.test.ts,packages/core/src/a.ts}'),
    coalesce(p_o->>'nb', clock_timestamp()::text), coalesce(p_o->>'exp', (clock_timestamp()+interval '1 hour')::text), coalesce(p_o->>'req', gen_random_uuid()::text)));
$$;
GRANT EXECUTE ON FUNCTION pg_temp.mk_plain(text,jsonb), pg_temp.try_grant(uuid,jsonb) TO authenticated;
INSERT INTO kv SELECT 'g0', to_jsonb(pg_temp.mk_plain('g0'));
SELECT is((pg_temp.as_actor('grantor',format('public.preview_acceptance_contract(%L)',(SELECT v#>>'{}' FROM kv WHERE k='g0'))))->>'blockers','[]','preview: item elegível não tem bloqueios');
SELECT matches((pg_temp.as_actor('grantor',format('public.preview_acceptance_contract(%L)',(SELECT v#>>'{}' FROM kv WHERE k='g0'))))->>'contractSha256','^[0-9a-f]{64}$','preview devolve o hash canônico (64 caracteres)');
SELECT is((pg_temp.try_grant((SELECT (v#>>'{}')::uuid FROM kv WHERE k='g0')))->>'action','granted','4. concessão válida');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT (v#>>'{}')::uuid FROM kv WHERE k='g0') AND event_type='work_mandate_granted'),1::bigint,'4. evento humano de concessão gravado');
SELECT throws_like($$ SELECT pg_temp.try_grant((SELECT (v#>>'{}')::uuid FROM kv WHERE k='g0'),'{"req":"d3000000-0000-0000-0000-00000000aa01"}') $$,'%active mandate already exists%','4. segundo mandato ativo no mesmo item é recusado');
-- replay do mesmo request_id com os mesmos termos
INSERT INTO kv SELECT 'g1', to_jsonb(pg_temp.mk_plain('g1'));
INSERT INTO kv SELECT 'g1r', pg_temp.try_grant((SELECT (v#>>'{}')::uuid FROM kv WHERE k='g1'),'{"req":"d3000000-0000-0000-0000-00000000bb01","nb":"2030-01-01T00:00:00Z","exp":"2030-01-01T05:00:00Z"}');
SELECT is((SELECT v->>'action' FROM kv WHERE k='g1r'),'granted','4. janela futura (antecipada) dentro de 24 h é aceita');
SELECT is((pg_temp.try_grant((SELECT (v#>>'{}')::uuid FROM kv WHERE k='g1'),'{"req":"d3000000-0000-0000-0000-00000000bb01","nb":"2030-01-01T00:00:00Z","exp":"2030-01-01T05:00:00Z"}'))->>'action','replayed','4. mesmo request_id e mesmos termos ⇒ replay idempotente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT (v#>>'{}')::uuid FROM kv WHERE k='g1') AND event_type='work_mandate_granted'),1::bigint,'4. replay não duplica o evento humano');
SELECT throws_like($$ SELECT pg_temp.try_grant((SELECT (v#>>'{}')::uuid FROM kv WHERE k='g1'),'{"req":"d3000000-0000-0000-0000-00000000bb01","nb":"2030-01-01T00:00:00Z","exp":"2030-01-01T06:00:00Z"}') $$,'%mandate request conflict%','4. mesmo request_id com termos diferentes ⇒ conflito');

SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gp',jsonb_build_object('approve','no','classify','none'))) $$,'%mandate not grantable:%item_not_approved%','4. item não aprovado');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gi',jsonb_build_object('impact','significant'))) $$,'%mandate not grantable:%impact_not_low%','4. impacto acima de low');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('ge',jsonb_build_object('executor','investigation-v1'))) $$,'%mandate not grantable:%executor_not_worktree%','4. executor diferente de worktree');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gv',jsonb_build_object('verifier','advisory'))) $$,'%mandate not grantable:%verifier_not_fail_closed%','4. Verifier advisory');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('ga',jsonb_build_object('attempts',3))) $$,'%mandate not grantable:%attempts_not_one%','4. mais de uma attempt');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gc',jsonb_build_object('coder','openai'))) $$,'%mandate not grantable:%coder_backend_not_local_or_subscription%','4. coder pago (openai)');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gr',jsonb_build_object('resume','yes'))) $$,'%mandate not grantable:%resume_not_allowed%','4. resume_from_checkpoint');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gk',jsonb_build_object('classify','none'))) $$,'%mandate not grantable:%classification_not_human_bounded_low%','4. sem classificação');
INSERT INTO kv SELECT 'gsys', to_jsonb(pg_temp.mk_plain('gsys'));
RESET ROLE;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(((SELECT v#>>'{}' FROM kv WHERE k='gsys'))::uuid,'work_intelligence_classified','system',1,
  '{"schema_version":1,"data":{"classification":{"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","provenance":{"kind":"system_assessed"}}}}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);
SELECT throws_like($$ SELECT pg_temp.try_grant((SELECT (v#>>'{}')::uuid FROM kv WHERE k='gsys')) $$,'%mandate not grantable:%classification_not_human_bounded_low%','4. classificação vigente não humana');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gh',jsonb_build_object('classify','risky'))) $$,'%mandate not grantable:%classification_not_human_bounded_low%','4. classificação de risco alto');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gb'),'{"base":"cccccccccccccccccccccccccccccccccccccccc"}') $$,'%mandate not grantable:%base_sha_mismatch%','4. base_sha divergente do contrato (item novo)');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gsc'),'{"scope":"{packages/core/src/a.ts}"}') $$,'%mandate not grantable:%scope_differs_from_contract%','4. escopo diferente do included_scope do contrato');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gsc2'),'{"scope":"{packages/core/src/a.ts,packages/core/src/a.test.ts,packages/core/src/extra.ts}"}') $$,'%mandate not grantable:%scope_differs_from_contract%','4. escopo ampliado');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gsm'),'{"scope":"{supabase/migrations/1.sql}"}') $$,'%invalid mandate request%','4. escopo em prefixo sensível (migrations)');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gse'),'{"scope":"{../x.ts}"}') $$,'%invalid mandate request%','4. escopo com escape de caminho');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gsd'),'{"scope":"{packages/core/src/a.ts,packages/core/src/a.ts}"}') $$,'%invalid mandate request%','4. escopo duplicado');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gh1'),'{"hash":"0000000000000000000000000000000000000000000000000000000000000000"}') $$,'%contract hash does not match%','4. hash do contrato que o humano NÃO viu');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gh2'),'{"hash":"abc"}') $$,'%invalid mandate request%','4. hash malformado');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gw1'),format('{"nb":"%s","exp":"%s"}',clock_timestamp(),clock_timestamp()+interval '25 hours')::jsonb) $$,'%invalid mandate request%','4. validade acima de 24 h');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gw2'),format('{"nb":"%s","exp":"%s"}',clock_timestamp()-interval '3 hours',clock_timestamp()-interval '1 hour')::jsonb) $$,'%not in the future%','4. mandato já expirado');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gw3'),format('{"nb":"%s","exp":"%s"}',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour')::jsonb) $$,'%not in the future%','4. início retroativo');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gw4'),format('{"nb":"%s","exp":"%s"}',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '30 minutes')::jsonb) $$,'%invalid mandate request%','4. janela invertida');
SELECT throws_like($$ SELECT pg_temp.try_grant(pg_temp.mk_plain('gver'),'{"version":"2"}') $$,'%state or proposal version changed%','4. versão divergente');
SELECT throws_like($$ SELECT pg_temp.as_actor('grantor',format('public.grant_acceptance_mandate(%L,1,%L,%L,ARRAY[%L],now(),now()+interval ''1 hour'',NULL)',(SELECT v#>>'{}' FROM kv WHERE k='g0'),repeat('a',64),repeat('b',40),'x.ts')) $$,'%invalid mandate request%','4. request_id ausente');
-- compute pago presente
INSERT INTO kv SELECT 'gpaid', to_jsonb(pg_temp.mk_plain('gpaid'));
RESET ROLE;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(((SELECT v#>>'{}' FROM kv WHERE k='gpaid'))::uuid,'compute_preference_recorded','user',1,'{"schema_version":1,"data":{"preference":{"strategy":"provider_api","provider":"openai","model":"m","schemaVersion":1}}}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);
SELECT throws_like($$ SELECT pg_temp.try_grant((SELECT (v#>>'{}')::uuid FROM kv WHERE k='gpaid')) $$,'%mandate not grantable:%paid_compute_present%','4. preferência de compute pago');
-- attempt já iniciada
INSERT INTO kv SELECT 'gstarted', to_jsonb(pg_temp.mk_plain('gstarted'));
SELECT public.start_commanded_work_attempt(((SELECT v#>>'{}' FROM kv WHERE k='gstarted'))::uuid,1,'d3000000-0000-0000-0000-0000000000a9','worktree-v1');
SELECT throws_like($$ SELECT pg_temp.try_grant((SELECT (v#>>'{}')::uuid FROM kv WHERE k='gstarted')) $$,'%mandate not grantable:%attempt_already_started%','4. mandato tem que ser ANTECIPADO: attempt já iniciada recusa');
-- outro usuário (dono diferente) não enxerga nem concede
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-0000000000ff',true);
SELECT throws_ok($$ SELECT pg_temp.as_actor('grantor',format('public.preview_acceptance_contract(%L)',(SELECT v#>>'{}' FROM kv WHERE k='g0'))) $$,'42501',NULL,'4. grantor de usuário fora da allowlist/sem registro é recusado');
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);

-- ============================================================
-- (4) REVOGAÇÃO
-- ============================================================
INSERT INTO kv SELECT 'rv', pg_temp.build('rv');
SELECT is((pg_temp.as_actor('grantor',format('public.revoke_acceptance_mandate(%L,%L)',(SELECT v->>'mandate' FROM kv WHERE k='rv'),'mudei de ideia')))->>'action','revoked','5. grantor revoga');
SELECT is((pg_temp.as_actor('grantor',format('public.revoke_acceptance_mandate(%L,%L)',(SELECT v->>'mandate' FROM kv WHERE k='rv'),'de novo')))->>'action','replayed','5. revogação idempotente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=((SELECT v->>'item' FROM kv WHERE k='rv'))::uuid AND event_type='work_mandate_revoked'),1::bigint,'5. um evento humano de revogação');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='rv')) $$,'%mandate_revoked%','5. mandato revogado não aceita');
SELECT throws_like($$ SELECT pg_temp.as_actor('grantor',format('public.revoke_acceptance_mandate(%L,%L)',(SELECT v->>'mandate' FROM kv WHERE k='ok'),'tarde demais')) $$,'%already consumed%','5. mandato consumido não pode ser revogado');
SELECT throws_ok($$ SELECT pg_temp.as_actor('grantor',format('public.revoke_acceptance_mandate(%L,%L)',(SELECT v->>'mandate' FROM kv WHERE k='rv'),'  ')) $$,'22023',NULL,'5. revogação exige motivo');

-- ============================================================
-- (5) ACEITE: negações recalculadas pelo banco
-- ============================================================
-- janela
INSERT INTO kv SELECT 'exp', pg_temp.build('exp', jsonb_build_object('expires_at',(clock_timestamp()+interval '3 seconds')::text));
SELECT pg_sleep(3.6);
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='exp')) $$,'%mandate_expired%','6. mandato expirado');
INSERT INTO kv SELECT 'nyv', pg_temp.build('nyv', jsonb_build_object('not_before',(clock_timestamp()+interval '1 hour')::text,'expires_at',(clock_timestamp()+interval '2 hours')::text));
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='nyv')) $$,'%mandate_not_yet_valid%','6. mandato ainda não vigente');
-- item/versão diferentes
INSERT INTO kv SELECT 'other', pg_temp.build('other');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='other'),'{}','writer',((SELECT v->>'mandate' FROM kv WHERE k='idn'))::uuid) $$,'%wrong_item_or_version%','7. mandato de OUTRO item');
-- mandato ausente
SELECT throws_ok($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='other'),'{}','writer','d3000000-0000-0000-0000-00000000ffff') $$,'P0002',NULL,'7. mandato inexistente');
-- contrato alterado depois da concessão
INSERT INTO kv SELECT 'cc', pg_temp.build('cc');
RESET ROLE;
UPDATE public.work_items SET proposal = jsonb_set(proposal,'{data,objective}','"objetivo ampliado depois da concessão"') WHERE id=((SELECT v->>'item' FROM kv WHERE k='cc'))::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='cc')) $$,'%contract_changed%','8. contrato alterado depois da concessão');
-- base alterada no contrato (hash também muda; o hash é checado primeiro)
INSERT INTO kv SELECT 'bc', pg_temp.build('bc');
RESET ROLE;
UPDATE public.work_items SET intent = jsonb_set(intent,'{execution_spec,base_sha}',to_jsonb(repeat('e',40))) WHERE id=((SELECT v->>'item' FROM kv WHERE k='bc'))::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='bc')) $$,'%contract_changed%','8. base alterada no contrato (invalida o hash)');
-- impacto
INSERT INTO kv SELECT 'imp', pg_temp.build('imp');
RESET ROLE;
UPDATE public.work_items SET impact_level='significant' WHERE id=((SELECT v->>'item' FROM kv WHERE k='imp'))::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='imp')) $$,'%contract_changed%','8. impacto elevado depois da concessão (invalida o hash do contrato)');
-- mandato concedido DEPOIS da attempt (semeado direto: a RPC não permite) ⇒ não antecipado
INSERT INTO kv SELECT 'late', pg_temp.build('late', '{"grant":"no"}');
RESET ROLE;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(((SELECT v->>'item' FROM kv WHERE k='late'))::uuid,'work_mandate_granted','user',1,'{"schema_version":1,"data":{"late":true}}');
INSERT INTO public.work_acceptance_mandates(user_id,work_item_id,proposal_version,contract_sha256,base_sha,scope_files,not_before,expires_at,policy_version,request_id,granted_event_id,granted_event_seq)
  SELECT 'd3000000-0000-0000-0000-000000000000', e.work_item_id, 1, (SELECT v->>'hash' FROM kv WHERE k='late'), repeat('b',40),
         ARRAY['packages/core/src/a.test.ts','packages/core/src/a.ts'], now()-interval '1 minute', now()+interval '1 hour', 'acceptance-mandate-v1', gen_random_uuid(), e.id, e.seq
  FROM public.work_events e WHERE e.work_item_id=((SELECT v->>'item' FROM kv WHERE k='late'))::uuid AND e.event_type='work_mandate_granted';
UPDATE kv SET v = v || jsonb_build_object('mandate',(SELECT id FROM public.work_acceptance_mandates WHERE work_item_id=((SELECT v->>'item' FROM kv WHERE k='late'))::uuid)) WHERE k='late';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='late')) $$,'%not_anticipated%','9. mandato concedido depois do início da attempt');
-- política alterada (mandato semeado com policy_version antiga)
INSERT INTO kv SELECT 'pol', pg_temp.build('pol', '{"grant":"no"}');
RESET ROLE;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(((SELECT v->>'item' FROM kv WHERE k='pol'))::uuid,'work_mandate_granted','user',1,'{"schema_version":1,"data":{"old":true}}');
INSERT INTO public.work_acceptance_mandates(user_id,work_item_id,proposal_version,contract_sha256,base_sha,scope_files,not_before,expires_at,policy_version,request_id,granted_event_id,granted_event_seq)
  SELECT 'd3000000-0000-0000-0000-000000000000', e.work_item_id, 1, (SELECT v->>'hash' FROM kv WHERE k='pol'), repeat('b',40),
         ARRAY['packages/core/src/a.test.ts','packages/core/src/a.ts'], now()-interval '1 minute', now()+interval '1 hour', 'acceptance-mandate-v0', gen_random_uuid(), e.id, 0
  FROM public.work_events e WHERE e.work_item_id=((SELECT v->>'item' FROM kv WHERE k='pol'))::uuid AND e.event_type='work_mandate_granted';
UPDATE kv SET v = v || jsonb_build_object('mandate',(SELECT id FROM public.work_acceptance_mandates WHERE work_item_id=((SELECT v->>'item' FROM kv WHERE k='pol'))::uuid)) WHERE k='pol';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='pol')) $$,'%policy_changed%','10. política do mandato diferente da vigente');

-- Verifier
INSERT INTO kv SELECT 'v5', pg_temp.build('v5', '{"vver":"work-verifier-v5"}');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='v5')) $$,'%verifier_version_too_old%','11. Verifier v5 (anterior ao v6)');
INSERT INTO kv SELECT 'gap', pg_temp.build('gap', '{"gaps":1}');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='gap')) $$,'%verifier_gaps_or_violations%','11. Verifier com lacuna');
INSERT INTO kv SELECT 'vio', pg_temp.build('vio', '{"violations":1}');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='vio')) $$,'%verifier_gaps_or_violations%','11. Verifier com violação');
INSERT INTO kv SELECT 'inc', pg_temp.build('inc', '{"verdict":"inconclusive"}');
SELECT is((SELECT v->>'released' FROM kv WHERE k='inc'),'false','fixture: inconclusive não libera para review');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='inc')) $$,'%item_not_in_review%','11. Verifier inconclusivo ⇒ item nunca chega a review');
INSERT INTO kv SELECT 'rej', pg_temp.build('rej', '{"verdict":"rejected"}');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='rej')) $$,'%verifier_not_verified%','11. Verifier rejeitado');
INSERT INTO kv SELECT 'tb', pg_temp.build('tb', '{"tb":"yes"}');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='tb')) $$,'%test_binding_not_independent%','11. contrato com test_binding sem prova independente');
-- fato de contexto
INSERT INTO kv SELECT 'noctx', pg_temp.build('noctx', '{"ctx":"none"}');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='noctx')) $$,'%context_fact_missing_or_invalid%','12. sem fato de contexto de execução (R1)');
INSERT INTO kv SELECT 'manual', pg_temp.build('manual', '{"ctx":"manual"}');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='manual')) $$,'%context_fact_missing_or_invalid%','12. fato de contexto manual não sustenta mandato');
-- classificação posterior não humana
INSERT INTO kv SELECT 'cls', pg_temp.build('cls');
RESET ROLE;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(((SELECT v->>'item' FROM kv WHERE k='cls'))::uuid,'work_intelligence_classified','system',1,
  '{"schema_version":1,"data":{"classification":{"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","provenance":{"kind":"system_assessed"}}}}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='cls')) $$,'%classification_not_human_confirmed%','13. classificação vigente deixou de ser humana');
-- compute pago depois
INSERT INTO kv SELECT 'paid', pg_temp.build('paid');
RESET ROLE;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(((SELECT v->>'item' FROM kv WHERE k='paid'))::uuid,'compute_preference_recorded','user',1,
  '{"schema_version":1,"data":{"preference":{"strategy":"provider_api","provider":"openai","model":"m","schemaVersion":1}}}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='paid')) $$,'%acceptance mandate: paid_compute_present%','13. compute pago presente');
-- duas attempts
INSERT INTO kv SELECT 'two', pg_temp.build('two');
RESET ROLE;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(((SELECT v->>'item' FROM kv WHERE k='two'))::uuid,'execution_started','anima',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',md5('att2:two'),'origin','anima')));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='two')) $$,'%multiple_attempts%','13. mais de uma attempt');
-- resultado revisado não é o mais recente
INSERT INTO kv SELECT 'old', pg_temp.build('old');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='old'),'{}','writer',NULL,'d3000000-0000-0000-0000-00000000d00d') $$,'%result_not_latest%','14. resultado diferente do mais recente');

-- Integridade do candidato (independente de declaração do runner)
INSERT INTO kv SELECT 'i1', pg_temp.build('i1');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='i1'),jsonb_build_object('commitSha',repeat('d',40))) $$,'%candidate_integrity_failed%','15. commit do relatório ≠ handoff/host');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='i1'),jsonb_build_object('baseSha',repeat('e',40))) $$,'%candidate_integrity_failed%','15. base do relatório ≠ base do mandato');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='i1'),jsonb_build_object('baseIsAncestor',false)) $$,'%candidate_integrity_failed%','15. base não é ancestral');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='i1'),jsonb_build_object('mergeCount',1)) $$,'%candidate_integrity_failed%','15. candidato com merge');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='i1'),jsonb_build_object('commitCount',2)) $$,'%candidate_integrity_failed%','15. dois commits desde a base');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='i1'),jsonb_build_object('parentShas',jsonb_build_array(repeat('e',40)))) $$,'%candidate_integrity_failed%','15. pai diferente da base');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='i1'),jsonb_build_object('parentShas',jsonb_build_array(repeat('b',40),repeat('e',40)))) $$,'%candidate_integrity_failed%','15. dois pais');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='i1'),'{"changedFiles":["packages/core/src/a.ts","packages/core/src/a.test.ts","packages/core/src/extra.ts"]}') $$,'%candidate_integrity_failed%','15. arquivo extra declarado');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='i1'),'{"changedFiles":["packages/core/src/a.ts"]}') $$,'%candidate_integrity_failed%','15. arquivo a menos');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='i1'),'{"changeStatuses":[{"path":"packages/core/src/a.ts","status":"M"},{"path":"packages/core/src/a.test.ts","status":"A"}]}') $$,'%candidate_integrity_failed%','15. modificação em vez de adição');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='i1'),'{"changeStatuses":[{"path":"packages/core/src/a.ts","status":"A"}]}') $$,'%candidate_integrity_failed%','15. status sem um dos arquivos');
SELECT throws_ok($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='i1'),'{"extra":"x"}') $$,'22023',NULL,'15. chave extra no relatório');
SELECT throws_ok($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='i1'),'{"schemaVersion":2}') $$,'22023',NULL,'15. versão do relatório');
SELECT throws_ok($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='i1'),'{"mergeCount":null}') $$,'22023',NULL,'15. campo ausente');
INSERT INTO kv SELECT 'hf', pg_temp.build('hf', '{"host_files":["packages/core/src/a.ts","packages/core/src/a.test.ts","packages/core/src/y.ts"]}');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='hf')) $$,'%candidate_integrity_failed%','15. o HOST observou arquivo extra (relatório do writer sozinho não basta)');
INSERT INTO kv SELECT 'hb', pg_temp.build('hb', '{"host_base":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='hb')) $$,'%candidate_integrity_failed%','15. base observada pelo host ≠ base do mandato');
INSERT INTO kv SELECT 'ho', pg_temp.build('ho', '{"obs_commit":"dddddddddddddddddddddddddddddddddddddddd"}');
SELECT is((SELECT v->>'released' FROM kv WHERE k='ho'),'false','fixture: commit do host ≠ handoff ⇒ o próprio gate do Verifier não libera para review');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='ho')) $$,'%item_not_in_review%','15. commit observado ≠ handoff nunca chega a review');
-- aceite continua exigindo o dono certo
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-0000000000ff',true);
SELECT throws_ok($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='i1')) $$,'42501',NULL,'16. writer de outro dono (sem allowlist) é recusado');
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);

-- ============================================================
-- (6) Trigger aditivo, imutabilidade, RLS e compatibilidade com o aceite humano
-- ============================================================
RESET ROLE;
SELECT throws_ok($$ INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(((SELECT v->>'item' FROM kv WHERE k='i1'))::uuid,'result_accepted','system',1,
  jsonb_build_object('schema_version',1,'data',jsonb_build_object('accepted_result_event_id',gen_random_uuid(),'decided_by','trusted_system_writer','authority',jsonb_build_object('kind','human_mandate','mandate_id',(SELECT v->>'mandate' FROM kv WHERE k='i1'))))) $$,
  '42501',NULL,'17. INSERT direto de aceite de sistema é barrado até para superuser (sem writer)');
SELECT throws_ok($$ UPDATE public.work_acceptance_mandates SET expires_at = expires_at + interval '1 hour' WHERE id=((SELECT v->>'mandate' FROM kv WHERE k='i1'))::uuid $$,'42501',NULL,'18. termos do mandato são imutáveis');
SELECT throws_ok($$ UPDATE public.work_acceptance_mandates SET scope_files = ARRAY['packages/core/src/z.ts'] WHERE id=((SELECT v->>'mandate' FROM kv WHERE k='i1'))::uuid $$,'42501',NULL,'18. escopo do mandato é imutável');
SELECT throws_ok($$ DELETE FROM public.work_acceptance_mandates WHERE id=((SELECT v->>'mandate' FROM kv WHERE k='i1'))::uuid $$,'42501',NULL,'18. mandato é append-only');
SELECT throws_ok($$ UPDATE public.work_acceptance_mandates SET revoked_at=NULL WHERE id=((SELECT v->>'mandate' FROM kv WHERE k='rv'))::uuid $$,'42501',NULL,'18. revogação é final');
SELECT throws_ok($$ UPDATE public.work_acceptance_mandates SET consumed_at=NULL, consumed_event_id=NULL WHERE id=((SELECT v->>'mandate' FROM kv WHERE k='ok'))::uuid $$,'42501',NULL,'18. consumo é final');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);
SELECT ok((SELECT count(*) FROM public.work_acceptance_mandates) > 0,'19. o dono LÊ os próprios mandatos (RLS)');
SELECT throws_ok($$ INSERT INTO public.work_acceptance_mandates(user_id,work_item_id,proposal_version,contract_sha256,base_sha,scope_files,not_before,expires_at,policy_version,request_id,granted_event_id,granted_event_seq)
  VALUES('d3000000-0000-0000-0000-000000000000',(SELECT (v->>'item')::uuid FROM kv WHERE k='i1'),1,repeat('a',64),repeat('b',40),ARRAY['x.ts'],now(),now()+interval '1 hour','acceptance-mandate-v1',gen_random_uuid(),gen_random_uuid(),1) $$,'42501',NULL,'19. o runner NÃO escreve mandato direto na tabela');
SELECT throws_ok($$ INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES((SELECT (v->>'item')::uuid FROM kv WHERE k='i1'),'work_mandate_granted','user',1,'{}') $$,'42501',NULL,'19. o runner NÃO escreve evento de concessão direto');
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-0000000000ff',true);
SELECT is((SELECT count(*) FROM public.work_acceptance_mandates),0::bigint,'19. outro usuário não enxerga mandatos alheios (RLS)');
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);

-- Aceite HUMANO preservado: item advisory (sem mandato) aceito pela sessão residente continua author user e sem authority.
INSERT INTO kv SELECT 'human', pg_temp.build('human', '{"grant":"no"}');
SELECT is((public.review_work_result_versioned(((SELECT v->>'item' FROM kv WHERE k='human'))::uuid,1,((SELECT v->>'result' FROM kv WHERE k='human'))::uuid,'accept','{"authority":{"kind":"human_mandate"}}')).state::text,'completed','20. aceite humano existente continua funcionando');
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=((SELECT v->>'item' FROM kv WHERE k='human'))::uuid AND event_type='result_accepted'),'user','20. aceite humano continua author user');
SELECT ok((SELECT NOT (payload->'data' ? 'authority') FROM public.work_events WHERE work_item_id=((SELECT v->>'item' FROM kv WHERE k='human'))::uuid AND event_type='result_accepted'),'20. decision_context forjado NÃO vira authority no aceite humano');
-- Mandato nunca valida o aceite humano de outro item e não vira integração.
SELECT is((SELECT count(*) FROM public.work_events WHERE event_type='result_accepted' AND author='system'),1::bigint,'21. exatamente 1 aceite de sistema em todo o teste (o do fluxo feliz)');
SELECT is((SELECT count(*) FROM public.work_events WHERE event_type::text LIKE 'integration%'),0::bigint,'21. nenhuma integração foi criada por mandato');

-- ============================================================
-- (7) Revisão final: ordem de locks do revoke e publicação/integração prévias
-- ============================================================
-- Regressão do deadlock aceite×revogação (40P01): o revoke precisa travar o ITEM antes do MANDATO, como o aceite e a concessão.
-- (A prova dinâmica com duas sessões reais está no registro; aqui fica o guarda estrutural.)
SELECT ok(position('FROM public.work_items i WHERE i.id = v_item_id FOR UPDATE' IN p.prosrc) > 0
  AND position('FROM public.work_items i WHERE i.id = v_item_id FOR UPDATE' IN p.prosrc) < position('AND m.user_id = v_owner FOR UPDATE' IN p.prosrc),
  '22. revoke trava o item antes do mandato (mesma ordem do aceite; sem deadlock)') FROM pg_proc p WHERE p.oid = 'public.revoke_acceptance_mandate(uuid,text)'::regprocedure;
SELECT ok(position('FROM public.work_items i WHERE i.id = p_work_item_id AND i.user_id = v_owner FOR UPDATE' IN p.prosrc) > 0
  AND position('FROM public.work_items i WHERE i.id = p_work_item_id AND i.user_id = v_owner FOR UPDATE' IN p.prosrc) < position('FROM public.work_acceptance_mandates m WHERE m.id = p_mandate_id AND m.user_id = v_owner FOR UPDATE' IN p.prosrc),
  '22. aceite trava item e depois mandato') FROM pg_proc p WHERE p.oid = 'public.accept_work_result_under_mandate(uuid,integer,uuid,uuid,jsonb)'::regprocedure;
-- Escopo seguro (host Windows/NTFS): caixa, ponto/espaço final, nome curto, stream, curinga, controle e .git aliasam diretórios protegidos.
RESET ROLE;
SELECT is(private.acceptance_mandate_scope_is_safe(ARRAY[p]), false, '22. escopo recusado: '||replace(p,E'\x07','<BEL>'))
FROM unnest(ARRAY['Supabase/migrations/1.sql','SCRIPTS/a.ts','.GitHub/workflows/a.yml','apps/web/lib/work-orchestration/Trusted-System-Writer.ts',
  'packages/core/src/work-orchestration/Acceptance-Mandate.ts','.gitmodules','.gitattributes','.git/hooks/pre-commit','SUPABA~1/x.sql',
  'packages/core/src/a.ts:evil','packages/core/src/*.ts',E'packages/core/src/a\x07.ts','packages/core/src/a.','packages /core/src/a.ts','packages/core/src/"a".ts']) p;
SELECT is(private.acceptance_mandate_scope_is_safe(ARRAY['packages/core/src/a.ts','packages/core/src/a.test.ts']), true, '22. escopo normal continua aceito');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);
INSERT INTO kv SELECT 'ipb', pg_temp.build('ipb');
INSERT INTO kv SELECT 'ipi', pg_temp.build('ipi');
RESET ROLE;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(((SELECT v->>'item' FROM kv WHERE k='ipb'))::uuid,'branch_published','system',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('receipt',jsonb_build_object(
    'receiptId','r1','providerId','p1','repositoryId','repo1','remoteName','origin','remoteBranch','b','baseBranch','dev','commitSha',repeat('c',40),'verifiedBaseSha',repeat('b',40)))));
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(((SELECT v->>'item' FROM kv WHERE k='ipi'))::uuid,'integration_decided','system',1,'{"schema_version":1,"data":{}}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-0000-0000-000000000000',true);
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='ipb')) $$,'%integration_present%','23. branch já publicada antes do aceite ⇒ recusa');
SELECT throws_like($$ SELECT pg_temp.accept((SELECT v FROM kv WHERE k='ipi')) $$,'%integration_present%','23. integração já decidida antes do aceite ⇒ recusa');
SELECT is((SELECT state::text FROM public.work_items WHERE id=((SELECT v->>'item' FROM kv WHERE k='ipb'))::uuid),'review','23. item segue em review após a recusa');

SELECT * FROM finish();
ROLLBACK;
