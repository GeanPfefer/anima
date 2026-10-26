-- Project Builder V0 — T5: autorização humana de integração EXTERNA (ff_only) + exclusividade física transacional.
-- Prova: (1) identidade/chave física derivadas no servidor (aliases colidem; interno não tem chave); (2) autorização: só ff_only, destino
-- seguro, commit/attempt derivados do handoff, Verifier `verified` obrigatório, identidade congelada, idempotência/conflito;
-- (3) kind: autorização interna não serve ao externo e vice-versa; (4) receipt pelo `record_integration_completed` existente;
-- (5) lease: exclusão mútua por repositório físico, renovação, expiração/recuperação, liberação idempotente, RLS; (6) claim: item externo
-- não nasce com outro item ocupando o mesmo repositório físico, e o fluxo interno segue intacto. Prefixo de UUID livre: e5000000.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(62);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('e5000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','xi-owner@test.invalid','',now(),'{}','{}',now(),now()),
('e5000000-0000-0000-0000-0000000000ff','00000000-0000-0000-0000-000000000000','authenticated','authenticated','xi-other@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES('e5000000-0000-0000-0000-0000000000a1','e5000000-0000-0000-0000-000000000000','user','a');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('e5000000-0000-0000-0000-000000000000'),('e5000000-0000-0000-0000-0000000000ff');
RESET ROLE;

CREATE FUNCTION pg_temp.writer_for(p_owner uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $w$
DECLARE v_writer uuid := md5('trusted-writer:'||coalesce(p_owner::text,'none'))::uuid;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES(v_writer,'00000000-0000-0000-0000-000000000000','anima_system_writer','anima_system_writer','writer-'||v_writer||'@test.invalid','',now(),'{}','{}',now(),now()) ON CONFLICT (id) DO NOTHING;
  IF p_owner IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_owner) THEN
    INSERT INTO private.trusted_system_writers(writer_user_id,owner_user_id) VALUES(v_writer,p_owner) ON CONFLICT (writer_user_id) DO NOTHING;
  END IF;
  RETURN v_writer;
END $w$;
CREATE FUNCTION pg_temp.record_integration_completed(a uuid, b integer, c text, d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $w$
DECLARE v_sub text := current_setting('request.jwt.claim.sub', true); v_claims text := current_setting('request.jwt.claims', true); v_w uuid; r jsonb;
BEGIN
  v_w := pg_temp.writer_for(nullif(v_sub,'')::uuid);
  PERFORM set_config('request.jwt.claim.sub', v_w::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','anima_system_writer','sub',v_w)::text, true);
  BEGIN r := public.record_integration_completed(a,b,c,d);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true); PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true); RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub,''), true); PERFORM set_config('request.jwt.claims', coalesce(v_claims,''), true);
  RETURN r;
END $w$;
GRANT EXECUTE ON FUNCTION pg_temp.record_integration_completed(a uuid, b integer, c text, d jsonb) TO authenticated, anon;
CREATE TEMP TABLE ids(k text PRIMARY KEY, v text);
GRANT ALL ON ids TO authenticated;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT v::uuid FROM ids WHERE k=p $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO authenticated;

-- Intent de item externo: identidade canônica no execution_spec.target + proveniência do materializador (T2).
CREATE FUNCTION pg_temp.ext_intent(p_ref text, p_gitdir text, p_base text DEFAULT repeat('a',40)) RETURNS text LANGUAGE sql AS $$
  SELECT jsonb_build_object('external_work_provenance',jsonb_build_object('kind','external_work_proposal','origin','cli_propose_external_v1','reference',p_ref,'preparedAt','2026-10-26T00:00:00.000Z'),
    'execution_spec',jsonb_build_object('schema_version',1,'base_sha',p_base,'executor','worktree',
      'target',jsonb_build_object('kind','project','reference',p_ref,'identity',jsonb_build_object('repo_root_canonical',regexp_replace(p_gitdir,'.git$',''),
        'git_common_dir_canonical',p_gitdir,'root_commit_sha',repeat('a',40),'base_sha',p_base)),
      'permissions',jsonb_build_array('workspace_read','workspace_write_isolated'),'validation_criteria',jsonb_build_array(jsonb_build_object('label','tests')),'limits',jsonb_build_object('max_attempts',1)))::text
$$;
GRANT EXECUTE ON FUNCTION pg_temp.ext_intent(text,text,text) TO authenticated;
CREATE FUNCTION pg_temp.proposal() RETURNS text LANGUAGE sql AS $$ SELECT '{"schema_version":1,"data":{"summary":"x","objective":"o","included_scope":["a.ts"],"excluded_scope":["z"],"expected_effects":["e"],"risks":[]}}' $$;
GRANT EXECUTE ON FUNCTION pg_temp.proposal() TO authenticated;

CREATE FUNCTION pg_temp.rkey(j jsonb) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT private.external_repo_key(j) $$;
GRANT EXECUTE ON FUNCTION pg_temp.rkey(jsonb) TO authenticated;
-- 1. chave física: derivada do git-common-dir; aliases (barra, caixa Windows, barra final) colidem; interno não tem chave.
SELECT is(private.external_repo_key(pg_temp.ext_intent('ext:a','G:\lab\.git')::jsonb), private.external_repo_key(pg_temp.ext_intent('ext:b','g:/LAB/.git/')::jsonb),
  '1a. mesma chave física para aliases do mesmo git-common-dir sob referências diferentes');
SELECT isnt(private.external_repo_key(pg_temp.ext_intent('ext:a','G:\lab\.git')::jsonb), private.external_repo_key(pg_temp.ext_intent('ext:a','G:\outro\.git')::jsonb),
  '1b. repositórios diferentes ⇒ chaves diferentes');
SELECT is(private.external_repo_key('{"execution_spec":{"target":{"kind":"project","reference":"anima"}}}'::jsonb), NULL, '1c. item interno não tem chave física');
SELECT is(private.external_repo_key(pg_temp.ext_intent('anima','G:\lab\.git')::jsonb), NULL, '1d. referência fora de ext:<slug> não é identidade externa');
SELECT is(private.external_repo_key(jsonb_set(pg_temp.ext_intent('ext:a','G:\lab\.git')::jsonb,'{execution_spec,target,identity,root_commit_sha}','"abc"')), NULL, '1e. identidade com SHA inválido não é externa');
SELECT is(private.external_repo_key(pg_temp.ext_intent('ext:a','/srv/Lab/.git')::jsonb) = private.external_repo_key(pg_temp.ext_intent('ext:a','/srv/lab/.git')::jsonb), false, '1f. caminho POSIX diferencia caixa');

-- Fixtures: A = externo completed/aceito/verified (ext:alpha); B = outro item no MESMO repositório (ext:beta); I = interno.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e5000000-0000-0000-0000-000000000000',true);
INSERT INTO ids SELECT 'A',(public.create_work_proposal('e5000000-0000-0000-0000-0000000000a1','low','programming',pg_temp.ext_intent('ext:alpha','G:\lab\.git')::jsonb,pg_temp.proposal()::jsonb)).id::text;
INSERT INTO ids SELECT 'B',(public.create_work_proposal('e5000000-0000-0000-0000-0000000000a1','low','programming',pg_temp.ext_intent('ext:beta','G:\lab\.git')::jsonb,pg_temp.proposal()::jsonb)).id::text;
INSERT INTO ids SELECT 'I',(public.create_work_proposal('e5000000-0000-0000-0000-0000000000a1','low','programming',
  '{"execution_spec":{"schema_version":1,"base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","target":{"kind":"project","reference":"xi-internal"},"permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'::jsonb,pg_temp.proposal()::jsonb)).id::text;
INSERT INTO ids VALUES('attA','e5000000-0000-0000-0000-00000000a0a0'),('attI','e5000000-0000-0000-0000-00000000a0a1');
SELECT public.resolve_approval(pg_temp.id('A'),1,'approve','{}');
SELECT public.resolve_approval(pg_temp.id('I'),1,'approve','{}');
SELECT public.start_commanded_work_attempt(pg_temp.id('A'),1,pg_temp.id('attA'),'worktree-v1');
SELECT public.record_commanded_work_terminal(pg_temp.id('A'),1,pg_temp.id('attA'),jsonb_build_object('kind','result','workItemId',pg_temp.id('A'),
  'attemptId',pg_temp.id('attA'),'approvedProposalVersion',1,'origin','executor','sequence',1,'summary','feito','resultReferences','[]'::jsonb,
  'validations','[]'::jsonb,'limitations','[]'::jsonb,'handoffReference','worktree:ext:alpha:anima-work/x',
  'worktreeHandoff',jsonb_build_object('commitSha',repeat('b',40),'baseSha',repeat('a',40),'attemptId',pg_temp.id('attA'),'workItemId',pg_temp.id('A'),'approvedProposalVersion',1)));
INSERT INTO ids SELECT 'resA', id::text FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type='result_submitted';
SELECT public.start_commanded_work_attempt(pg_temp.id('I'),1,pg_temp.id('attI'),'worktree-v1');
SELECT public.record_commanded_work_terminal(pg_temp.id('I'),1,pg_temp.id('attI'),jsonb_build_object('kind','result','workItemId',pg_temp.id('I'),
  'attemptId',pg_temp.id('attI'),'approvedProposalVersion',1,'origin','executor','sequence',1,'summary','feito','resultReferences','[]'::jsonb,
  'validations','[]'::jsonb,'limitations','[]'::jsonb,'handoffReference','worktree:xi-internal:anima-work/x',
  'worktreeHandoff',jsonb_build_object('commitSha',repeat('b',40),'baseSha',repeat('a',40),'attemptId',pg_temp.id('attI'),'workItemId',pg_temp.id('I'),'approvedProposalVersion',1)));
INSERT INTO ids SELECT 'resI', id::text FROM public.work_events WHERE work_item_id=pg_temp.id('I') AND event_type='result_submitted';

-- 2. autorização antes do aceite ⇒ recusada.
SELECT throws_ok($$SELECT public.authorize_external_integration_effect(pg_temp.id('A'),1,pg_temp.id('resA'),'xa-0','refs/heads/main',repeat('c',40))$$,
  '55000',NULL,'2a. sem aceite (item não completed) ⇒ recusada');
SELECT public.review_work_result_versioned(pg_temp.id('A'),1,pg_temp.id('resA'),'accept','{}');
SELECT public.review_work_result_versioned(pg_temp.id('I'),1,pg_temp.id('resI'),'accept','{}');

-- destino e entrada
SELECT throws_ok($$SELECT public.authorize_external_integration_effect(pg_temp.id('A'),1,pg_temp.id('resA'),'xa-1','main',repeat('c',40))$$,'22023','integration target not allowed','2b. destino sem refs/heads/ negado');
SELECT throws_ok($$SELECT public.authorize_external_integration_effect(pg_temp.id('A'),1,pg_temp.id('resA'),'xa-1','refs/tags/v1',repeat('c',40))$$,'22023','integration target not allowed','2c. tag negada');
SELECT throws_ok($$SELECT public.authorize_external_integration_effect(pg_temp.id('A'),1,pg_temp.id('resA'),'xa-1','refs/heads/anima-work/x',repeat('c',40))$$,'22023','integration target not allowed','2d. namespace de attempts negado');
SELECT throws_ok($$SELECT public.authorize_external_integration_effect(pg_temp.id('A'),1,pg_temp.id('resA'),'xa-1','refs/heads/a..b',repeat('c',40))$$,'22023','integration target not allowed','2e. ".." negado');
SELECT throws_ok($$SELECT public.authorize_external_integration_effect(pg_temp.id('A'),1,pg_temp.id('resA'),'xa-1','refs/heads/main.lock',repeat('c',40))$$,'22023','integration target not allowed','2f. .lock negado');
SELECT throws_ok($$SELECT public.authorize_external_integration_effect(pg_temp.id('A'),1,pg_temp.id('resA'),'xa-1','refs/heads/main','HEAD')$$,'22023',NULL,'2g. SHA-alvo esperado precisa ser SHA');
SELECT throws_ok($$SELECT public.authorize_external_integration_effect(pg_temp.id('I'),1,pg_temp.id('resI'),'xa-1','refs/heads/main',repeat('c',40))$$,'22023','work item is not an external target','2h. item interno recusado');
SELECT throws_ok($$SELECT public.authorize_external_integration_effect(pg_temp.id('A'),1,pg_temp.id('attA'),'xa-1','refs/heads/main',repeat('c',40))$$,'55000','accepted result changed','2i. outro resultado ⇒ recusado');
SELECT throws_ok($$SELECT public.authorize_external_integration_effect(pg_temp.id('A'),2,pg_temp.id('resA'),'xa-1','refs/heads/main',repeat('c',40))$$,'55000',NULL,'2j. versão divergente ⇒ recusada');
-- Verifier ausente ⇒ recusada (sem parecer verified correlacionado ao resultado aceito).
SELECT throws_ok($$SELECT public.authorize_external_integration_effect(pg_temp.id('A'),1,pg_temp.id('resA'),'xa-1','refs/heads/main',repeat('c',40))$$,'55000','verifier opinion is not verified for the accepted result','2k. sem Verifier verified ⇒ recusada');
RESET ROLE;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
VALUES(pg_temp.id('A'),'verifier_opinion_recorded','system',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('work_item_id',pg_temp.id('A'),'attempt_id',pg_temp.id('attA'),
  'approved_proposal_version',1,'opinion',jsonb_build_object('verdict','inconclusive','evidenceBasis',jsonb_build_object('resultEventId',pg_temp.id('resA')))))) ;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','e5000000-0000-0000-0000-000000000000',true);
SELECT throws_ok($$SELECT public.authorize_external_integration_effect(pg_temp.id('A'),1,pg_temp.id('resA'),'xa-1','refs/heads/main',repeat('c',40))$$,'55000','verifier opinion is not verified for the accepted result','2l. parecer inconclusive ⇒ recusada');
RESET ROLE;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
VALUES(pg_temp.id('A'),'verifier_opinion_recorded','system',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('work_item_id',pg_temp.id('A'),'attempt_id',pg_temp.id('attA'),
  'approved_proposal_version',1,'opinion',jsonb_build_object('verdict','verified','evidenceBasis',jsonb_build_object('resultEventId',pg_temp.id('resA')))))) ;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','e5000000-0000-0000-0000-000000000000',true);

-- 3. autorização válida: derivados do handoff, identidade congelada, author=user, mode ff_only.
SELECT is((public.authorize_external_integration_effect(pg_temp.id('A'),1,pg_temp.id('resA'),'xa-1','refs/heads/main',repeat('c',40)))->>'result_commit_sha',repeat('b',40),'3a. commit derivado do handoff persistido');
SELECT is((SELECT author::text FROM public.work_events WHERE event_type='integration_effect_authorized' AND payload->'data'->>'authorization_id'='xa-1'),'user','3b. ato humano (author=user)');
SELECT is((SELECT payload->'data'->>'mode' FROM public.work_events WHERE event_type='integration_effect_authorized' AND payload->'data'->>'authorization_id'='xa-1'),'ff_only','3c. modo único ff_only');
SELECT is((SELECT payload->'data'->>'repository_id' FROM public.work_events WHERE event_type='integration_effect_authorized' AND payload->'data'->>'authorization_id'='xa-1'),'external:ext:alpha','3d. repositório ligado à referência');
SELECT is((SELECT payload->'data'->'external' FROM public.work_events WHERE event_type='integration_effect_authorized' AND payload->'data'->>'authorization_id'='xa-1'),
  jsonb_build_object('reference','ext:alpha','repo_root_canonical','G:\lab\','git_common_dir_canonical','G:\lab\.git','root_commit_sha',repeat('a',40),'base_sha',repeat('a',40)),'3e. identidade canônica congelada no efeito');
SELECT is((SELECT payload->'data'->>'operation_key' FROM public.work_events WHERE event_type='integration_effect_authorized' AND payload->'data'->>'authorization_id'='xa-1'),
  'integration-effect:xa-1:'||pg_temp.id('resA')::text||':external:ext:alpha:refs/heads/main:'||repeat('c',40)||':'||repeat('b',40)||':ff_only','3f. chave de operação no formato do core');
SELECT is((public.authorize_external_integration_effect(pg_temp.id('A'),1,pg_temp.id('resA'),'xa-1','refs/heads/main',repeat('c',40)))->>'action','replayed','3g. idempotente');
SELECT throws_ok($$SELECT public.authorize_external_integration_effect(pg_temp.id('A'),1,pg_temp.id('resA'),'xa-1','refs/heads/main',repeat('e',40))$$,'55000','integration effect authorization conflict','3h. mesma autorização com SHA-alvo diferente ⇒ conflito');
SELECT is((SELECT state::text FROM public.work_items WHERE id=pg_temp.id('A')),'completed','3i. autorização não muda o estado do item');

-- 4. autorização INTERNA não serve a item externo; a EXTERNA não serve a item interno (trigger de tipo).
SELECT throws_ok($$SELECT public.authorize_integration_effect(pg_temp.id('A'),1,pg_temp.id('resA'),'xa-int','https://github.com/example/anima','refs/heads/dev',repeat('c',40),'ff_only')$$,
  '55000','external work items require the external integration authorization','4a. item externo não usa a autorização interna');
RESET ROLE;
SELECT throws_ok($$INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(pg_temp.id('I'),'integration_effect_authorized','user',1,
  jsonb_build_object('schema_version',1,'data',jsonb_build_object('authorization_id','xa-forged','external',jsonb_build_object('reference','ext:x'))))$$,
  '55000','external integration authorization requires an external work item','4b. marca externa em item interno recusada');
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','e5000000-0000-0000-0000-000000000000',true);
SELECT is((public.authorize_integration_effect(pg_temp.id('I'),1,pg_temp.id('resI'),'xi-1','https://github.com/example/anima','refs/heads/dev',repeat('c',40),'ff_only'))->>'action','recorded','4c. regressão: o caminho INTERNO segue autorizando normalmente');

-- 5. receipt ff_only do efeito externo pelo record_integration_completed EXISTENTE.
CREATE FUNCTION pg_temp.receipt_ext(p_over jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('kind','integration_effect',
    'operationKey',(SELECT payload->'data'->>'operation_key' FROM public.work_events WHERE event_type='integration_effect_authorized' AND payload->'data'->>'authorization_id'='xa-1'),
    'authorizationId','xa-1','workItemId',pg_temp.id('A'),'proposalVersion',1,'attemptId',pg_temp.id('attA'),'acceptedResultEventId',pg_temp.id('resA'),
    'resultCommitSha',repeat('b',40),'repositoryId','external:ext:alpha','targetRef','refs/heads/main','mode','ff_only','previousTargetSha',repeat('c',40),
    'resultingTargetSha',repeat('b',40),'mergeCommitSha',NULL::text,'mergeParents','[]'::jsonb,'observed',true,'disposition','effected') || p_over;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.receipt_ext(jsonb) TO authenticated;
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('A'),1,'xa-1',pg_temp.receipt_ext('{"resultingTargetSha":"dddddddddddddddddddddddddddddddddddddddd"}'))$$,'55000','integration receipt mismatch','5a. alvo resultante ≠ commit do resultado ⇒ recusado');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('A'),1,'xa-1',pg_temp.receipt_ext('{"targetRef":"refs/heads/release"}'))$$,'55000','integration receipt mismatch','5b. destino diferente do autorizado ⇒ recusado');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('A'),1,'xa-1',pg_temp.receipt_ext('{"repositoryId":"external:ext:beta"}'))$$,'55000','integration receipt mismatch','5c. outra referência ⇒ recusado');
SELECT throws_ok($$SELECT pg_temp.record_integration_completed(pg_temp.id('A'),1,'xa-1',pg_temp.receipt_ext('{"mergeParents":["cccccccccccccccccccccccccccccccccccccccc"]}'))$$,'55000','integration receipt mismatch','5d. ff_only com pais ⇒ recusado');
SELECT is((pg_temp.record_integration_completed(pg_temp.id('A'),1,'xa-1',pg_temp.receipt_ext()))->>'action','recorded','5e. receipt coerente com a autorização externa registrado');
SELECT is((pg_temp.record_integration_completed(pg_temp.id('A'),1,'xa-1',pg_temp.receipt_ext('{"disposition":"reconciled"}')))->>'action','replayed','5f. retry/reconciliação idempotente (não duplica o efeito)');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type='integration_completed'),1::bigint,'5g. exatamente um integration_completed');
SELECT throws_ok($$SELECT public.authorize_external_integration_effect(pg_temp.id('A'),1,pg_temp.id('resA'),'xa-2','refs/heads/main',repeat('c',40))$$,'55000','work item already integrated','5h. item já integrado não aceita nova autorização');

-- 6. lease físico: A (ext:alpha) e B (ext:beta) apontam para o MESMO repositório.
SELECT is((SELECT repo_key FROM public.acquire_external_repo_lease(pg_temp.id('A'),'host-1',120)), pg_temp.rkey(pg_temp.ext_intent('ext:x','G:\lab\.git')::jsonb),'6a. lease adquirido com a chave física derivada no servidor');
SELECT throws_ok($$SELECT public.acquire_external_repo_lease(pg_temp.id('B'),'host-2',120)$$,'55000','external repository is held by an active lease','6b. outra referência no mesmo repositório físico é bloqueada');
SELECT throws_ok($$SELECT public.acquire_external_repo_lease(pg_temp.id('A'),'host-2',120)$$,'55000','external repository is held by an active lease','6c. mesmo item, outro dono ⇒ bloqueado');
SELECT is((SELECT count(*) FROM public.acquire_external_repo_lease(pg_temp.id('A'),'host-1',300)),1::bigint,'6d. mesmo dono renova (idempotente)');
SELECT is((SELECT count(*) FROM public.external_repo_leases WHERE released_at IS NULL),1::bigint,'6e. um único lease aberto');
SELECT throws_ok($$SELECT public.acquire_external_repo_lease(pg_temp.id('I'),'host-1',120)$$,'22023','work item is not an external target','6f. item interno não pode pedir lease físico');
SELECT throws_ok($$SELECT public.acquire_external_repo_lease(pg_temp.id('A'),'host-1',5)$$,'22023',NULL,'6g. duração inválida recusada');
SELECT throws_ok($$INSERT INTO public.external_repo_leases(user_id,work_item_id,repo_key,operation,owner_instance_id,expires_at) VALUES('e5000000-0000-0000-0000-000000000000',pg_temp.id('B'),repeat('1',64),'integration','x',now()+interval '1 min')$$,
  '42501',NULL,'6h. escrita direta no lease negada ao usuário (só pelas RPCs)');
-- liberação idempotente e reaquisição
SELECT is((SELECT release_reason FROM public.release_external_repo_lease((SELECT id FROM public.external_repo_leases WHERE released_at IS NULL),'completed')),'completed','6i. liberação registra o motivo');
SELECT is((SELECT release_reason FROM public.release_external_repo_lease((SELECT id FROM public.external_repo_leases ORDER BY acquired_at DESC LIMIT 1),'failed')),'completed','6j. liberação repetida é idempotente (motivo original preservado)');
SELECT is((SELECT work_item_id FROM public.acquire_external_repo_lease(pg_temp.id('B'),'host-2',120)),pg_temp.id('B'),'6k. liberado ⇒ outra referência adquire');
-- lease vencido (processo caiu) é recuperado na próxima aquisição
RESET ROLE;
UPDATE public.external_repo_leases SET expires_at=now()-interval '1 second', acquired_at=now()-interval '10 minutes' WHERE released_at IS NULL;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','e5000000-0000-0000-0000-000000000000',true);
SELECT is((SELECT work_item_id FROM public.acquire_external_repo_lease(pg_temp.id('A'),'host-3',120)),pg_temp.id('A'),'6l. lease expirado é liberado e o repositório é readquirido');
SELECT is((SELECT count(*) FROM public.external_repo_leases WHERE release_reason='expired'),1::bigint,'6m. o vencido ficou registrado como expired');
SELECT public.release_external_repo_lease((SELECT id FROM public.external_repo_leases WHERE released_at IS NULL),'released');

-- 7. outro usuário não vê nem libera leases alheios (RLS).
SELECT set_config('request.jwt.claim.sub','e5000000-0000-0000-0000-0000000000ff',true);
SELECT is((SELECT count(*) FROM public.external_repo_leases),0::bigint,'7a. RLS: outro usuário não enxerga leases');
SELECT throws_ok($$SELECT public.release_external_repo_lease((SELECT id FROM public.external_repo_leases LIMIT 1),'released')$$,'P0002',NULL,'7b. outro usuário não libera lease alheio');
SELECT throws_ok($$SELECT public.acquire_external_repo_lease(pg_temp.id('A'),'host-1',120)$$,'P0002','work item not found','7c. outro usuário não adquire lease de item alheio');
SELECT set_config('request.jwt.claim.sub','e5000000-0000-0000-0000-000000000000',true);

-- 8. claim de item externo não nasce com outro item ocupando o mesmo repositório físico (e o interno passa intacto).
RESET ROLE;
ALTER TABLE public.work_claims DISABLE TRIGGER enforce_autonomous_intelligence_on_claim;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','e5000000-0000-0000-0000-000000000000',true);
SELECT public.acquire_external_repo_lease(pg_temp.id('A'),'host-1',120);
RESET ROLE;
SELECT throws_ok($$INSERT INTO public.work_claims(id,work_item_id,user_id,approved_proposal_version,owner_instance_id,acquired_at,expires_at,target_reference)
  VALUES('e5000000-0000-0000-0000-0000000000c1',pg_temp.id('B'),'e5000000-0000-0000-0000-000000000000',1,'t',now(),now()+interval '10 minutes','ext:beta')$$,
  '55000','external repository is held by an active lease','8a. lease ativo bloqueia claim de OUTRA referência no mesmo repositório');
UPDATE public.external_repo_leases SET released_at=now(), release_reason='released' WHERE released_at IS NULL;
UPDATE public.work_items SET state='in_progress' WHERE id=pg_temp.id('A');
SELECT throws_ok($$INSERT INTO public.work_claims(id,work_item_id,user_id,approved_proposal_version,owner_instance_id,acquired_at,expires_at,target_reference)
  VALUES('e5000000-0000-0000-0000-0000000000c1',pg_temp.id('B'),'e5000000-0000-0000-0000-000000000000',1,'t',now(),now()+interval '10 minutes','ext:beta')$$,
  '55000','external repository is busy with a running work item','8b. outro item in_progress no mesmo repositório bloqueia o claim (mesmo sob referência diferente)');
UPDATE public.work_items SET state='completed' WHERE id=pg_temp.id('A');
INSERT INTO public.work_claims(id,work_item_id,user_id,approved_proposal_version,owner_instance_id,acquired_at,expires_at,target_reference)
  VALUES('e5000000-0000-0000-0000-0000000000c1',pg_temp.id('B'),'e5000000-0000-0000-0000-000000000000',1,'t',now(),now()+interval '10 minutes','ext:beta');
SELECT is((SELECT count(*) FROM public.work_claims WHERE id='e5000000-0000-0000-0000-0000000000c1'),1::bigint,'8c. livre ⇒ o claim nasce');
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','e5000000-0000-0000-0000-000000000000',true);
SELECT throws_ok($$SELECT public.acquire_external_repo_lease(pg_temp.id('A'),'host-1',120)$$,'55000','external repository is busy with an active claim','8d. claim vigente de outro item bloqueia o lease');
RESET ROLE;
UPDATE public.work_claims SET expires_at=now()-interval '1 second', acquired_at=now()-interval '11 minutes' WHERE id='e5000000-0000-0000-0000-0000000000c1';
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','e5000000-0000-0000-0000-000000000000',true);
SELECT is((SELECT work_item_id FROM public.acquire_external_repo_lease(pg_temp.id('A'),'host-1',120)),pg_temp.id('A'),'8e. claim expirado não ocupa o repositório');
RESET ROLE;
INSERT INTO public.work_claims(id,work_item_id,user_id,approved_proposal_version,owner_instance_id,acquired_at,expires_at,target_reference)
  VALUES('e5000000-0000-0000-0000-0000000000c2',pg_temp.id('I'),'e5000000-0000-0000-0000-000000000000',1,'t',now(),now()+interval '10 minutes','xi-internal');
SELECT is((SELECT count(*) FROM public.work_claims WHERE id='e5000000-0000-0000-0000-0000000000c2'),1::bigint,'8f. regressão: claim de item INTERNO não é afetado pelo lease externo');

-- 9. compatibilidade: assinaturas internas inalteradas.
SELECT has_function('public','authorize_integration_effect',ARRAY['uuid','integer','uuid','text','text','text','text','text'],'9a. authorize_integration_effect interna preservada');
SELECT has_function('public','record_integration_completed',ARRAY['uuid','integer','text','jsonb'],'9b. record_integration_completed preservada');

SELECT * FROM finish();
RESET ROLE;
ROLLBACK;
