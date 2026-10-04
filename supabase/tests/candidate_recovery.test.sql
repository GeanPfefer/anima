BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(36);

-- Três usuários: dono (allowlist), outro usuário (allowlist) e um fora da allowlist.
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES
 ('97000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cand-owner@test.invalid','',now(),'{}','{}',now(),now()),
 ('97000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cand-other@test.invalid','',now(),'{}','{}',now(),now()),
 ('97000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cand-outsider@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
VALUES('97000000-0000-0000-0000-000000000011','97000000-0000-0000-0000-000000000001','user','recovery de candidato');
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES
 ('97000000-0000-0000-0000-000000000001'),('97000000-0000-0000-0000-000000000002');

-- Item failed por defeito real do candidato: coder rodou (succeeded), gate `typecheck` falhou,
-- commit candidato observado pelo host com 2 arquivos dentro do escopo aprovado.
CREATE FUNCTION pg_temp.cand_item(
  p_id uuid, p_max integer, p_retryable boolean, p_backend text, p_coder text,
  p_gate_cmd text, p_commit text, p_files jsonb, p_evidence boolean, p_extra jsonb
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.work_items(id,user_id,source_message_id,state,impact_level,capability,original_request,intent,proposal,proposal_version)
  VALUES(p_id,'97000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000011','failed','structural','programming','rota',
    jsonb_build_object('execution_spec',jsonb_build_object('schema_version',1,'executor','worktree','coder_backend',p_backend,
      'permissions',jsonb_build_array('workspace_read','workspace_write_isolated'),
      'target',jsonb_build_object('kind','project','reference','anima'),
      'limits',jsonb_build_object('max_attempts',p_max,'max_duration_minutes',30),
      'validation_criteria',jsonb_build_array(
        jsonb_build_object('label','typecheck','command','npm run typecheck --workspace=apps/web'),
        jsonb_build_object('label','testes','command','npm test')))
      || p_extra),
    '{"schema_version":1,"data":{"summary":"rota","objective":"criar rota","included_scope":["apps/web/lib/x.ts","apps/web/lib/y.ts","apps/web/lib/x.test.ts"],"excluded_scope":["db"],"expected_effects":["ok"],"risks":["r"]}}',3);
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
    (p_id,'execution_started','anima',3,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id','97000000-0000-0000-0000-0000000000a1'))),
    (p_id,'execution_failed','executor',3,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id','97000000-0000-0000-0000-0000000000a1','retryable',p_retryable,'reason','execution_failed')));
  IF p_evidence THEN
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
      (p_id,'host_observed_coder_evidence_recorded','system',3,jsonb_build_object('schema_version',1,'data',jsonb_build_object('origin','host',
        'attempt_id','97000000-0000-0000-0000-0000000000a1',
        'evidence',jsonb_build_object('attemptId','97000000-0000-0000-0000-0000000000a1','workItemId',p_id,'outcome',p_coder)))),
      (p_id,'host_observed_gate_evidence_recorded','system',3,jsonb_build_object('schema_version',1,'data',jsonb_build_object('origin','host',
        'attempt_id','97000000-0000-0000-0000-0000000000a1',
        'evidence',jsonb_build_object('attemptId','97000000-0000-0000-0000-0000000000a1','workItemId',p_id,'gates',jsonb_build_array(
          jsonb_build_object('label','typecheck','command',p_gate_cmd,'exitCode',2,'timedOut',false,'cancelled',false,'outcome','failed','durationMs',1000))))),
      (p_id,'host_observed_evidence_recorded','system',3,jsonb_build_object('schema_version',1,'data',jsonb_build_object('origin','host',
        'attempt_id','97000000-0000-0000-0000-0000000000a1',
        'evidence',jsonb_build_object('attemptId','97000000-0000-0000-0000-0000000000a1','workItemId',p_id,
          'baseSha',repeat('b',40),'observedCommitSha',p_commit,'observedChangedFiles',p_files))));
  END IF;
END $$;

SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000f1',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts","apps/web/lib/y.ts"]',true,'{}');       -- sucesso, retryable=false, 1/1
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000f2',2,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts"]',true,'{}');                           -- orçamento restante
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000f3',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts"]',false,'{}');                          -- sem evidência host
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000f4',1,false,'codex-cli','succeeded','npm run lint',repeat('a',40),'["apps/web/lib/x.ts"]',true,'{}');                                                  -- gate divergente
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000f5',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('c',40),'["apps/web/lib/x.ts"]',true,'{}');                          -- commit divergente
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000f6',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts","apps/web/outro.ts"]',true,'{}');    -- arquivo fora do escopo
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000f7',1,false,'codex-cli','failed','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts"]',true,'{}');                              -- coder falhou
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000f8',1,false,'ollama','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts"]',true,'{}');                             -- backend não suportado
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000f9',1,false,'openai','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts"]',true,'{}');                             -- backend não suportado
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000fa',1,true,'claude-code','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts"]',true,
  '{"candidate_recovery":{"predecessor_id":"97000000-0000-0000-0000-0000000000f1"}}');                                                                                                                              -- recovery em cadeia

CREATE TEMP TABLE failure AS SELECT work_item_id, id FROM public.work_events WHERE event_type='execution_failed'
  AND work_item_id::text LIKE '97000000-0000-0000-0000-0000000000f%';
GRANT SELECT ON failure TO authenticated;

CREATE FUNCTION pg_temp.auth(p_request text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object(
  'schemaVersion',1,'kind','production_candidate_incorrect_v1','requestId',p_request,
  'reason','Candidato com erro de tipo real em produção','finding','production_candidate_incorrect',
  'candidateCommitSha',repeat('a',40),'sourceAttemptId','97000000-0000-0000-0000-0000000000a1',
  'gate',jsonb_build_object('label','typecheck','command','npm run typecheck --workspace=apps/web','exitCode',2),
  'location',jsonb_build_object('path','apps/web/lib/x.ts','line',12),
  'observedError','TS2322: Type string is not assignable to type number.',
  'evidenceReference','docs/registros/2026-10-03-x.md',
  'corrections',jsonb_build_array(jsonb_build_object('kind','type_error','instruction','Alinhar o tipo retornado ao contrato público.')),
  'additionalAttempts',1) $$;
CREATE FUNCTION pg_temp.fid(p_item text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM failure WHERE work_item_id = p_item::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.auth(text), pg_temp.fid(text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',true);

-- Sucesso multi-arquivo com retryable=false e orçamento 1/1 esgotado.
CREATE TEMP TABLE r1 AS SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f1',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f1'),pg_temp.auth('97000000-0000-0000-0000-0000000000b1')) AS v;
GRANT SELECT ON r1 TO authenticated;
SELECT is((SELECT v->>'replayed' FROM r1),'false','materializa o sucessor');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),'proposed','sucessor nasce proposed (sem aprovação)');
SELECT is((SELECT proposal FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),
  (SELECT proposal FROM public.work_items WHERE id='97000000-0000-0000-0000-0000000000f1'),'mesma proposta e mesmo included_scope (sem ampliação)');
SELECT is((SELECT intent#>>'{execution_spec,limits,max_attempts}' FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),'1','orçamento próprio: max_attempts = 1');
SELECT is((SELECT intent#>'{execution_spec,resume_from_checkpoint}' FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),
  jsonb_build_object('base_sha',repeat('b',40),'commit_sha',repeat('a',40),'branch','anima-work/97000000-0000-0000-0000-0000000000a1'),'resume_from_checkpoint aponta para o candidato anterior');
SELECT is((SELECT intent#>>'{execution_spec,base_sha}' FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),repeat('b',40),'spec.base_sha = baseSha observado');
SELECT is((SELECT intent#>'{execution_spec,validation_criteria}' FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),
  (SELECT intent#>'{execution_spec,validation_criteria}' FROM public.work_items WHERE id='97000000-0000-0000-0000-0000000000f1'),'validation_criteria preservados integralmente');
SELECT is((SELECT intent#>>'{execution_spec,candidate_recovery,source_attempt_id}' FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),
  '97000000-0000-0000-0000-0000000000a1','proveniência da attempt de origem no spec');
SELECT is((SELECT jsonb_build_array(original_work_item_id,recovery_sequence) FROM public.work_recovery_lineage WHERE successor_work_item_id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),
  jsonb_build_array('97000000-0000-0000-0000-0000000000f1'::uuid,1),'sucessor na mesma lineage (original→sucessor seq 1)');
SELECT is((SELECT state::text FROM public.work_items WHERE id='97000000-0000-0000-0000-0000000000f1'),'failed','original permanece failed (evidência preservada)');
SELECT is((SELECT v->>'checkpointCommitSha' FROM r1),repeat('a',40),'retorna o commit do checkpoint');

-- Replay idempotente e conflito.
SELECT is((public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f1',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f1'),pg_temp.auth('97000000-0000-0000-0000-0000000000b1')))->>'replayed','true','mesmo pedido é replay');
SELECT is((SELECT count(*) FROM public.work_recovery_lineage WHERE original_work_item_id='97000000-0000-0000-0000-0000000000f1'),1::bigint,'replay não cria segundo sucessor');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f1',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f1'),pg_temp.auth('97000000-0000-0000-0000-0000000000b2'))$$,
  '55000','candidate_recovery_conflict','outro pedido para o mesmo item falho é recusado');

-- Orçamento NÃO esgotado: o caminho é `work retry`.
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000b3'))$$,
  '55000','budget_not_exhausted','com tentativas restantes a recovery é recusada');

-- Autorização inválida.
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000b4')||'{"extra":1}')$$,
  '22023','invalid candidate recovery authorization','chave extra é recusada');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000b5')||'{"finding":"test_code_incorrect"}')$$,
  '22023','invalid candidate recovery authorization','finding errado é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000b6')||
  '{"corrections":[{"kind":"resolve_imports","instruction":"Resolver os imports do módulo."}]}')$$,
  '22023','invalid candidate recovery authorization','kind fora do enum fechado é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000b7')||'{"location":{"path":"apps/../x.ts"}}')$$,
  '22023','invalid candidate recovery authorization','path com .. é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000b8')||'{"candidateCommitSha":"abc"}')$$,
  '22023','invalid candidate recovery authorization','sha inválido é recusado');

-- Fatos do candidato (host) que a RPC revalida.
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f3',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f3'),pg_temp.auth('97000000-0000-0000-0000-0000000000b9'))$$,
  '55000','host_coder_evidence_missing','candidato sem evidência host é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f4',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f4'),pg_temp.auth('97000000-0000-0000-0000-0000000000c1'))$$,
  '55000','gate_evidence_mismatch','gate divergente da evidência host é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f5',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f5'),pg_temp.auth('97000000-0000-0000-0000-0000000000c2'))$$,
  '55000','git_evidence_mismatch','commit divergente da evidência host é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f6',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f6'),pg_temp.auth('97000000-0000-0000-0000-0000000000c3'))$$,
  '55000','scope_evidence_mismatch','arquivo fora do escopo aprovado é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f7',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f7'),pg_temp.auth('97000000-0000-0000-0000-0000000000c4'))$$,
  '55000','host_coder_evidence_missing','coder failed não é defeito de candidato');

-- Backend não suportado e recovery em cadeia.
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f8',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f8'),pg_temp.auth('97000000-0000-0000-0000-0000000000c5'))$$,
  '55000','execution_envelope_unsupported','backend ollama é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f9',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f9'),pg_temp.auth('97000000-0000-0000-0000-0000000000c6'))$$,
  '55000','execution_envelope_unsupported','backend openai é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000fa',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000fa'),pg_temp.auth('97000000-0000-0000-0000-0000000000c7'))$$,
  '55000','execution_envelope_unsupported','recovery em cadeia (spec já com candidate_recovery) é recusada');

-- O sucessor proposed não é um failed corrente.
SELECT throws_ok(format($q$SELECT public.authorize_candidate_recovery(%L,1,%L,pg_temp.auth('97000000-0000-0000-0000-0000000000c8'))$q$,
  (SELECT v->>'successorWorkItemId' FROM r1),pg_temp.fid('97000000-0000-0000-0000-0000000000f1')),
  '55000','predecessor_not_current_failed','o sucessor proposed não pode ser recuperado');

-- Nada executa, aprova ou paga.
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)
  AND event_type IN ('work_approved','compute_preference_recorded','execution_started')),0::bigint,'sucessor não aprova, não prefere compute e não executa');
SELECT is((SELECT count(*) FROM public.paid_compute_authorizations WHERE work_item_id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1))
  + (SELECT count(*) FROM public.paid_compute_budget_events WHERE work_item_id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),0::bigint,
  'sucessor não herda authority nem reservation');

-- Permissão / RLS de outro usuário.
SELECT set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000002',true);
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000d1'))$$,
  'P0002','work_item_not_found','item de outro usuário não é encontrado');
SELECT is((SELECT count(*) FROM public.work_candidate_recoveries),0::bigint,'RLS: outro usuário não lê recoveries alheias');
SELECT set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000003',true);
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000d2'))$$,
  '42501','authentication_or_allowlist_required','usuário fora da allowlist é recusado');
SELECT set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',true);
SELECT is((SELECT count(*) FROM public.work_candidate_recoveries),1::bigint,'RLS: o dono lê a própria recovery');
SELECT ok(has_function_privilege('authenticated','public.authorize_candidate_recovery(uuid,integer,uuid,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.authorize_candidate_recovery(uuid,integer,uuid,jsonb)','EXECUTE'),
  'EXECUTE só para authenticated (nunca anon)');

SELECT * FROM finish();
ROLLBACK;
