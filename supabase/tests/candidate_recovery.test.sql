BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(62);

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
DECLARE v_att uuid := ('97000000-0000-0000-0000-a' || right(p_id::text,11))::uuid;
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
    (p_id,'execution_started','anima',3,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',v_att))),
    (p_id,'execution_failed','executor',3,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',v_att,'retryable',p_retryable,'reason','execution_failed')));
  IF p_evidence THEN
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
      (p_id,'host_observed_coder_evidence_recorded','system',3,jsonb_build_object('schema_version',1,'data',jsonb_build_object('origin','host',
        'attempt_id',v_att,
        'evidence',jsonb_build_object('attemptId',v_att,'workItemId',p_id,'outcome',p_coder)))),
      (p_id,'host_observed_gate_evidence_recorded','system',3,jsonb_build_object('schema_version',1,'data',jsonb_build_object('origin','host',
        'attempt_id',v_att,
        'evidence',jsonb_build_object('attemptId',v_att,'workItemId',p_id,'gates',jsonb_build_array(
          jsonb_build_object('label','typecheck','command',p_gate_cmd,'exitCode',2,'timedOut',false,'cancelled',false,'outcome','failed','durationMs',1000)))))),
      (p_id,'host_observed_evidence_recorded','system',3,jsonb_build_object('schema_version',1,'data',jsonb_build_object('origin','host',
        'attempt_id',v_att,
        'evidence',jsonb_build_object('attemptId',v_att,'workItemId',p_id,
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

-- Gate npm.cmd (evidência real do host) e conteúdo legítimo/proibido no envelope.
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000e1',1,false,'codex-cli','succeeded','npm.cmd run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts"]',true,'{}');
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000e2',1,false,'codex-cli','succeeded','npm.cmd run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts"]',true,'{}');
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000e3',1,false,'codex-cli','succeeded','pnpm.cmd run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts"]',true,'{}');
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000e4',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts"]',true,'{"paid":false,"notes":["paid-compute-readiness.ts"]}');
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000e5',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts"]',true,'{"paid_compute":true}');
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000e6',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts"]',true,'{"financial_authorization":"x"}');
SELECT pg_temp.cand_item('97000000-0000-0000-0000-0000000000e7',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts"]',true,'{"auto_provision":true}');

-- Checkpoint-relative fixtures: cumulative evidence includes a preserved outside-scope file.
SELECT pg_temp.cand_item('97000000-0000-0000-0000-000000000101',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts","apps/web/outro.ts"]',true,'{"resume_from_checkpoint": {"commit_sha": "cccccccccccccccccccccccccccccccccccccccc"}}');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
SELECT work_item_id,event_type,author,proposal_version,
  jsonb_set(payload,'{data,evidence}',(payload#>'{data,evidence}') ||
    jsonb_build_object('observedChangedFilesSinceStart','["apps/web/lib/x.ts"]'::jsonb))
FROM public.work_events WHERE work_item_id='97000000-0000-0000-0000-000000000101' AND event_type='host_observed_evidence_recorded'
ORDER BY seq DESC LIMIT 1;
SELECT pg_temp.cand_item('97000000-0000-0000-0000-000000000102',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts","apps/web/outro.ts"]',true,'{"resume_from_checkpoint": {"commit_sha": "cccccccccccccccccccccccccccccccccccccccc"}}');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
SELECT work_item_id,event_type,author,proposal_version,
  jsonb_set(payload,'{data,evidence}',(payload#>'{data,evidence}') ||
    jsonb_build_object('observedChangedFilesSinceStart','["apps/web/lib/x.ts", "apps/web/outro.ts"]'::jsonb))
FROM public.work_events WHERE work_item_id='97000000-0000-0000-0000-000000000102' AND event_type='host_observed_evidence_recorded'
ORDER BY seq DESC LIMIT 1;
SELECT pg_temp.cand_item('97000000-0000-0000-0000-000000000103',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts","apps/web/outro.ts"]',true,'{"resume_from_checkpoint": {"commit_sha": "cccccccccccccccccccccccccccccccccccccccc"}}');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
SELECT work_item_id,event_type,author,proposal_version,
  jsonb_set(payload,'{data,evidence}',(payload#>'{data,evidence}') ||
    jsonb_build_object('observedChangedFilesSinceStart','[]'::jsonb))
FROM public.work_events WHERE work_item_id='97000000-0000-0000-0000-000000000103' AND event_type='host_observed_evidence_recorded'
ORDER BY seq DESC LIMIT 1;
SELECT pg_temp.cand_item('97000000-0000-0000-0000-000000000104',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts","apps/web/outro.ts"]',true,'{"resume_from_checkpoint": {"commit_sha": "invalid"}}');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
SELECT work_item_id,event_type,author,proposal_version,
  jsonb_set(payload,'{data,evidence}',(payload#>'{data,evidence}') ||
    jsonb_build_object('observedChangedFilesSinceStart','["apps/web/lib/x.ts"]'::jsonb))
FROM public.work_events WHERE work_item_id='97000000-0000-0000-0000-000000000104' AND event_type='host_observed_evidence_recorded'
ORDER BY seq DESC LIMIT 1;
SELECT pg_temp.cand_item('97000000-0000-0000-0000-000000000105',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts","apps/web/outro.ts"]',true,'{"resume_from_checkpoint": {"commit_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
SELECT work_item_id,event_type,author,proposal_version,
  jsonb_set(payload,'{data,evidence}',(payload#>'{data,evidence}') ||
    jsonb_build_object('observedChangedFilesSinceStart','["apps/web/lib/x.ts"]'::jsonb))
FROM public.work_events WHERE work_item_id='97000000-0000-0000-0000-000000000105' AND event_type='host_observed_evidence_recorded'
ORDER BY seq DESC LIMIT 1;
SELECT pg_temp.cand_item('97000000-0000-0000-0000-000000000106',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts","apps/web/outro.ts"]',true,'{"resume_from_checkpoint": {"commit_sha": "cccccccccccccccccccccccccccccccccccccccc"}}');
SELECT pg_temp.cand_item('97000000-0000-0000-0000-000000000107',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts","apps/web/outro.ts"]',true,'{"resume_from_checkpoint": {"commit_sha": "cccccccccccccccccccccccccccccccccccccccc"}}');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
SELECT work_item_id,event_type,author,proposal_version,
  jsonb_set(payload,'{data,evidence}',(payload#>'{data,evidence}') ||
    jsonb_build_object('observedChangedFilesSinceStart','{}'::jsonb))
FROM public.work_events WHERE work_item_id='97000000-0000-0000-0000-000000000107' AND event_type='host_observed_evidence_recorded'
ORDER BY seq DESC LIMIT 1;
SELECT pg_temp.cand_item('97000000-0000-0000-0000-000000000108',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts","apps/web/outro.ts"]',true,'{"resume_from_checkpoint": {"commit_sha": "cccccccccccccccccccccccccccccccccccccccc"}}');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
SELECT work_item_id,event_type,author,proposal_version,
  jsonb_set(payload,'{data,evidence}',(payload#>'{data,evidence}') ||
    jsonb_build_object('observedChangedFilesSinceStart','[42]'::jsonb))
FROM public.work_events WHERE work_item_id='97000000-0000-0000-0000-000000000108' AND event_type='host_observed_evidence_recorded'
ORDER BY seq DESC LIMIT 1;
SELECT pg_temp.cand_item('97000000-0000-0000-0000-000000000109',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts","apps/web/outro.ts"]',true,'{"resume_from_checkpoint": {"commit_sha": "cccccccccccccccccccccccccccccccccccccccc"}}');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
SELECT work_item_id,event_type,author,proposal_version,
  jsonb_set(payload,'{data,evidence}',(payload#>'{data,evidence}') ||
    jsonb_build_object('observedChangedFilesSinceStart','["apps/web/lib/z.ts"]'::jsonb))
FROM public.work_events WHERE work_item_id='97000000-0000-0000-0000-000000000109' AND event_type='host_observed_evidence_recorded'
ORDER BY seq DESC LIMIT 1;
SELECT pg_temp.cand_item('97000000-0000-0000-0000-00000000010a',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts","apps/web/outro.ts"]',true,'{"resume_from_checkpoint": {"commit_sha": "cccccccccccccccccccccccccccccccccccccccc"}}');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
SELECT work_item_id,event_type,author,proposal_version,
  jsonb_set(payload,'{data,evidence}',(payload#>'{data,evidence}') ||
    jsonb_build_object('observedChangedFilesSinceStart','["apps/web/lib/x.ts"]'::jsonb))
FROM public.work_events WHERE work_item_id='97000000-0000-0000-0000-00000000010a' AND event_type='host_observed_evidence_recorded'
ORDER BY seq DESC LIMIT 1;
SELECT pg_temp.cand_item('97000000-0000-0000-0000-00000000010b',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts","apps/web/outro.ts"]',true,'{}');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
SELECT work_item_id,event_type,author,proposal_version,
  jsonb_set(payload,'{data,evidence}',(payload#>'{data,evidence}') ||
    jsonb_build_object('observedChangedFilesSinceStart','["apps/web/lib/x.ts"]'::jsonb))
FROM public.work_events WHERE work_item_id='97000000-0000-0000-0000-00000000010b' AND event_type='host_observed_evidence_recorded'
ORDER BY seq DESC LIMIT 1;
SELECT pg_temp.cand_item('97000000-0000-0000-0000-00000000010c',1,false,'codex-cli','succeeded','npm run typecheck --workspace=apps/web',repeat('a',40),'["apps/web/lib/x.ts","apps/web/outro.ts"]',true,'{"resume_from_checkpoint": []}');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
SELECT work_item_id,event_type,author,proposal_version,
  jsonb_set(payload,'{data,evidence}',(payload#>'{data,evidence}') ||
    jsonb_build_object('observedChangedFilesSinceStart','["apps/web/lib/x.ts"]'::jsonb))
FROM public.work_events WHERE work_item_id='97000000-0000-0000-0000-00000000010c' AND event_type='host_observed_evidence_recorded'
ORDER BY seq DESC LIMIT 1;

CREATE TEMP TABLE failure AS SELECT work_item_id, id FROM public.work_events WHERE event_type='execution_failed'
  AND work_item_id::text LIKE '97000000-0000-0000-0000-000000000%';
GRANT SELECT ON failure TO authenticated;

CREATE FUNCTION pg_temp.auth(p_request text, p_item text DEFAULT '97000000-0000-0000-0000-0000000000f1') RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object(
  'schemaVersion',1,'kind','production_candidate_incorrect_v1','requestId',p_request,
  'reason','Candidato com erro de tipo real em produção','finding','production_candidate_incorrect',
  'candidateCommitSha',repeat('a',40),'sourceAttemptId','97000000-0000-0000-0000-a' || right(p_item,11),
  'gate',jsonb_build_object('label','typecheck','command','npm run typecheck --workspace=apps/web','exitCode',2),
  'location',jsonb_build_object('path','apps/web/lib/x.ts','line',12),
  'observedError','TS2322: Type string is not assignable to type number.',
  'evidenceReference','docs/registros/2026-10-03-x.md',
  'corrections',jsonb_build_array(jsonb_build_object('kind','type_error','instruction','Alinhar o tipo retornado ao contrato público.')),
  'additionalAttempts',1) $$;
CREATE FUNCTION pg_temp.fid(p_item text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM failure WHERE work_item_id = p_item::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.auth(text,text), pg_temp.fid(text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',true);

-- Sucesso multi-arquivo com retryable=false e orçamento 1/1 esgotado.
CREATE TEMP TABLE r1 AS SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f1',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f1'),pg_temp.auth('97000000-0000-0000-0000-0000000000b1','97000000-0000-0000-0000-0000000000f1')) AS v;
GRANT SELECT ON r1 TO authenticated;
SELECT is((SELECT v->>'replayed' FROM r1),'false','materializa o sucessor');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),'proposed','sucessor nasce proposed (sem aprovação)');
SELECT is((SELECT proposal FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),
  (SELECT proposal FROM public.work_items WHERE id='97000000-0000-0000-0000-0000000000f1'),'mesma proposta e mesmo included_scope (sem ampliação)');
SELECT is((SELECT intent#>>'{execution_spec,limits,max_attempts}' FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),'1','orçamento próprio: max_attempts = 1');
SELECT is((SELECT intent#>'{execution_spec,resume_from_checkpoint}' FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),
  jsonb_build_object('base_sha',repeat('b',40),'commit_sha',repeat('a',40),'branch','anima-work/97000000-0000-0000-0000-a000000000f1'),'resume_from_checkpoint aponta para o candidato anterior');
SELECT is((SELECT intent#>>'{execution_spec,base_sha}' FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),repeat('b',40),'spec.base_sha = baseSha observado');
SELECT is((SELECT intent#>'{execution_spec,validation_criteria}' FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),
  (SELECT intent#>'{execution_spec,validation_criteria}' FROM public.work_items WHERE id='97000000-0000-0000-0000-0000000000f1'),'validation_criteria preservados integralmente');
SELECT is((SELECT intent#>>'{execution_spec,candidate_recovery,source_attempt_id}' FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),
  '97000000-0000-0000-0000-a000000000f1','proveniência da attempt de origem no spec');
SELECT is((SELECT jsonb_build_array(original_work_item_id,recovery_sequence) FROM public.work_recovery_lineage WHERE successor_work_item_id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),
  jsonb_build_array('97000000-0000-0000-0000-0000000000f1'::uuid,1),'sucessor na mesma lineage (original→sucessor seq 1)');
SELECT is((SELECT state::text FROM public.work_items WHERE id='97000000-0000-0000-0000-0000000000f1'),'failed','original permanece failed (evidência preservada)');
SELECT is((SELECT v->>'checkpointCommitSha' FROM r1),repeat('a',40),'retorna o commit do checkpoint');

-- Replay idempotente e conflito.
SELECT is((public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f1',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f1'),pg_temp.auth('97000000-0000-0000-0000-0000000000b1','97000000-0000-0000-0000-0000000000f1')))->>'replayed','true','mesmo pedido é replay');
SELECT is((SELECT count(*) FROM public.work_recovery_lineage WHERE original_work_item_id='97000000-0000-0000-0000-0000000000f1'),1::bigint,'replay não cria segundo sucessor');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f1',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f1'),pg_temp.auth('97000000-0000-0000-0000-0000000000b2','97000000-0000-0000-0000-0000000000f1'))$$,
  '55000','candidate_recovery_conflict','outro pedido para o mesmo item falho é recusado');

-- Orçamento NÃO esgotado: o caminho é `work retry`.
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000b3','97000000-0000-0000-0000-0000000000f2'))$$,
  '55000','budget_not_exhausted','com tentativas restantes a recovery é recusada');

-- Autorização inválida.
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000b4','97000000-0000-0000-0000-0000000000f2')||'{"extra":1}')$$,
  '22023','invalid candidate recovery authorization','chave extra é recusada');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000b5','97000000-0000-0000-0000-0000000000f2')||'{"finding":"test_code_incorrect"}')$$,
  '22023','invalid candidate recovery authorization','finding errado é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000b6','97000000-0000-0000-0000-0000000000f2')||
  '{"corrections":[{"kind":"resolve_imports","instruction":"Resolver os imports do módulo."}]}')$$,
  '22023','invalid candidate recovery authorization','kind fora do enum fechado é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000b7','97000000-0000-0000-0000-0000000000f2')||'{"location":{"path":"apps/../x.ts"}}')$$,
  '22023','invalid candidate recovery authorization','path com .. é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000b8','97000000-0000-0000-0000-0000000000f2')||'{"candidateCommitSha":"abc"}')$$,
  '22023','invalid candidate recovery authorization','sha inválido é recusado');

-- Fatos do candidato (host) que a RPC revalida.
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f3',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f3'),pg_temp.auth('97000000-0000-0000-0000-0000000000b9','97000000-0000-0000-0000-0000000000f3'))$$,
  '55000','host_coder_evidence_missing','candidato sem evidência host é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f4',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f4'),pg_temp.auth('97000000-0000-0000-0000-0000000000c1','97000000-0000-0000-0000-0000000000f4'))$$,
  '55000','gate_evidence_mismatch','gate divergente da evidência host é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f5',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f5'),pg_temp.auth('97000000-0000-0000-0000-0000000000c2','97000000-0000-0000-0000-0000000000f5'))$$,
  '55000','git_evidence_mismatch','commit divergente da evidência host é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f6',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f6'),pg_temp.auth('97000000-0000-0000-0000-0000000000c3','97000000-0000-0000-0000-0000000000f6'))$$,
  '55000','scope_evidence_mismatch','arquivo fora do escopo aprovado é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f7',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f7'),pg_temp.auth('97000000-0000-0000-0000-0000000000c4','97000000-0000-0000-0000-0000000000f7'))$$,
  '55000','host_coder_evidence_missing','coder failed não é defeito de candidato');

-- Backend não suportado e recovery em cadeia.
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f8',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f8'),pg_temp.auth('97000000-0000-0000-0000-0000000000c5','97000000-0000-0000-0000-0000000000f8'))$$,
  '55000','execution_envelope_unsupported','backend ollama é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f9',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f9'),pg_temp.auth('97000000-0000-0000-0000-0000000000c6','97000000-0000-0000-0000-0000000000f9'))$$,
  '55000','execution_envelope_unsupported','backend openai é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000fa',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000fa'),pg_temp.auth('97000000-0000-0000-0000-0000000000c7','97000000-0000-0000-0000-0000000000fa'))$$,
  '55000','execution_envelope_unsupported','recovery em cadeia (spec já com candidate_recovery) é recusada');

-- B: apenas o executável inicial `npm.cmd` ≡ `npm`; o resto do comando, label e exitCode são exatos.
SELECT is((public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000e1',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000e1'),pg_temp.auth('97000000-0000-0000-0000-0000000000f1','97000000-0000-0000-0000-0000000000e1')))->>'replayed','false','npm na autorização aceita evidência npm.cmd');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000e2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000e2'),pg_temp.auth('97000000-0000-0000-0000-0000000000f2','97000000-0000-0000-0000-0000000000e2')||
  '{"gate":{"label":"typecheck","command":"npm run typecheck --workspace=apps/mobile","exitCode":2}}')$$,
  '55000','gate_evidence_mismatch','argumento diferente é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000e2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000e2'),pg_temp.auth('97000000-0000-0000-0000-0000000000f3','97000000-0000-0000-0000-0000000000e2')||
  '{"gate":{"label":"lint","command":"npm run typecheck --workspace=apps/web","exitCode":2}}')$$,
  '55000','gate_evidence_mismatch','label divergente é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000e2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000e2'),pg_temp.auth('97000000-0000-0000-0000-0000000000f4','97000000-0000-0000-0000-0000000000e2')||
  '{"gate":{"label":"typecheck","command":"npm run typecheck --workspace=apps/web","exitCode":3}}')$$,
  '55000','gate_evidence_mismatch','exitCode divergente é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000e3',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000e3'),pg_temp.auth('97000000-0000-0000-0000-0000000000f5','97000000-0000-0000-0000-0000000000e3')||
  '{"gate":{"label":"typecheck","command":"pnpm run typecheck --workspace=apps/web","exitCode":2}}')$$,
  '55000','gate_evidence_mismatch','pnpm.cmd não é equivalente a pnpm');

-- C: `paid` legítimo é aceito; só os marcadores semânticos são recusados.
SELECT is((public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000e4',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000e4'),pg_temp.auth('97000000-0000-0000-0000-0000000000f6','97000000-0000-0000-0000-0000000000e4')))->>'replayed','false','"paid": false e paths paid-compute-* são aceitos');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000e5',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000e5'),pg_temp.auth('97000000-0000-0000-0000-0000000000f7','97000000-0000-0000-0000-0000000000e5'))$$,
  '55000','execution_envelope_unsupported','paid_compute é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000e6',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000e6'),pg_temp.auth('97000000-0000-0000-0000-0000000000f8','97000000-0000-0000-0000-0000000000e6'))$$,
  '55000','execution_envelope_unsupported','financial_authorization é recusado');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000e7',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000e7'),pg_temp.auth('97000000-0000-0000-0000-0000000000f9','97000000-0000-0000-0000-0000000000e7'))$$,
  '55000','execution_envelope_unsupported','auto_provision é recusado');

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
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000d1','97000000-0000-0000-0000-0000000000f2'))$$,
  'P0002','work_item_not_found','item de outro usuário não é encontrado');
SELECT is((SELECT count(*) FROM public.work_candidate_recoveries),0::bigint,'RLS: outro usuário não lê recoveries alheias');
SELECT set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000003',true);
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-0000000000f2',3,
  pg_temp.fid('97000000-0000-0000-0000-0000000000f2'),pg_temp.auth('97000000-0000-0000-0000-0000000000d2','97000000-0000-0000-0000-0000000000f2'))$$,
  '42501','authentication_or_allowlist_required','usuário fora da allowlist é recusado');
SELECT set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',true);
SELECT is((SELECT count(*) FROM public.work_candidate_recoveries),3::bigint,'RLS: o dono lê as próprias recoveries');
SELECT ok(has_function_privilege('authenticated','public.authorize_candidate_recovery(uuid,integer,uuid,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.authorize_candidate_recovery(uuid,integer,uuid,jsonb)','EXECUTE'),
  'EXECUTE só para authenticated (nunca anon)');

-- A/C: narrow delta authorizes despite preserved cumulative files; B/G remain fail-closed.
-- E: SQL checks malformed/equal checkpoint; real Git ancestry is exclusively a host proof.
-- F: [] is evidence of an empty set, never missing; the host rejects it if Git differs.
CREATE TEMP TABLE checkpoint_01 AS SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-000000000101',3,pg_temp.fid('97000000-0000-0000-0000-000000000101'),pg_temp.auth('97000000-0000-0000-0000-000000000201','97000000-0000-0000-0000-000000000101')) AS v;
SELECT is((SELECT v->>'replayed' FROM checkpoint_01),'false','checkpoint case 01 authorizes');
SELECT is((SELECT intent#>'{execution_spec,candidate_recovery,scope_basis}'
FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM checkpoint_01)),
'{"kind": "checkpoint", "start_sha": "cccccccccccccccccccccccccccccccccccccccc", "files": ["apps/web/lib/x.ts"]}'::jsonb,'checkpoint scope_basis records validated set');
SELECT is((SELECT payload#>'{data,evidence,observedChangedFiles}' FROM public.work_events
WHERE work_item_id='97000000-0000-0000-0000-000000000101' AND event_type='host_observed_evidence_recorded' ORDER BY seq DESC LIMIT 1),
'["apps/web/lib/x.ts","apps/web/outro.ts"]'::jsonb,'cumulative evidence remains intact');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-000000000102',3,pg_temp.fid('97000000-0000-0000-0000-000000000102'),pg_temp.auth('97000000-0000-0000-0000-000000000202','97000000-0000-0000-0000-000000000102'))$$,'55000','scope_evidence_mismatch','checkpoint case 02 fails closed');
CREATE TEMP TABLE checkpoint_03 AS SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-000000000103',3,pg_temp.fid('97000000-0000-0000-0000-000000000103'),pg_temp.auth('97000000-0000-0000-0000-000000000203','97000000-0000-0000-0000-000000000103')) AS v;
SELECT is((SELECT v->>'replayed' FROM checkpoint_03),'false','checkpoint case 03 authorizes');
SELECT is((SELECT intent#>'{execution_spec,candidate_recovery,scope_basis}'
FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM checkpoint_03)),
'{"kind": "checkpoint", "start_sha": "cccccccccccccccccccccccccccccccccccccccc", "files": []}'::jsonb,'checkpoint scope_basis records validated set');
SELECT is((SELECT payload#>'{data,evidence,observedChangedFiles}' FROM public.work_events
WHERE work_item_id='97000000-0000-0000-0000-000000000103' AND event_type='host_observed_evidence_recorded' ORDER BY seq DESC LIMIT 1),
'["apps/web/lib/x.ts","apps/web/outro.ts"]'::jsonb,'cumulative evidence remains intact');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-000000000104',3,pg_temp.fid('97000000-0000-0000-0000-000000000104'),pg_temp.auth('97000000-0000-0000-0000-000000000204','97000000-0000-0000-0000-000000000104'))$$,'55000','checkpoint_not_ancestor','checkpoint case 04 fails closed');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-000000000105',3,pg_temp.fid('97000000-0000-0000-0000-000000000105'),pg_temp.auth('97000000-0000-0000-0000-000000000205','97000000-0000-0000-0000-000000000105'))$$,'55000','checkpoint_not_ancestor','checkpoint case 05 fails closed');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-000000000106',3,pg_temp.fid('97000000-0000-0000-0000-000000000106'),pg_temp.auth('97000000-0000-0000-0000-000000000206','97000000-0000-0000-0000-000000000106'))$$,'55000','checkpoint_delta_evidence_missing','checkpoint case 06 fails closed');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-000000000107',3,pg_temp.fid('97000000-0000-0000-0000-000000000107'),pg_temp.auth('97000000-0000-0000-0000-000000000207','97000000-0000-0000-0000-000000000107'))$$,'55000','checkpoint_delta_evidence_missing','checkpoint case 07 fails closed');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-000000000108',3,pg_temp.fid('97000000-0000-0000-0000-000000000108'),pg_temp.auth('97000000-0000-0000-0000-000000000208','97000000-0000-0000-0000-000000000108'))$$,'55000','checkpoint_delta_evidence_missing','checkpoint case 08 fails closed');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-000000000109',3,pg_temp.fid('97000000-0000-0000-0000-000000000109'),pg_temp.auth('97000000-0000-0000-0000-000000000209','97000000-0000-0000-0000-000000000109'))$$,'55000','checkpoint_delta_evidence_inconsistent','checkpoint case 09 fails closed');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-00000000010a',3,pg_temp.fid('97000000-0000-0000-0000-00000000010a'),pg_temp.auth('97000000-0000-0000-0000-00000000020a','97000000-0000-0000-0000-00000000010a') || '{"location":{"path":"apps/web/outro.ts","line":12}}'::jsonb)$$,'55000','scope_evidence_mismatch','checkpoint case 0a fails closed');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-00000000010b',3,pg_temp.fid('97000000-0000-0000-0000-00000000010b'),pg_temp.auth('97000000-0000-0000-0000-00000000020b','97000000-0000-0000-0000-00000000010b'))$$,'55000','scope_evidence_mismatch','checkpoint case 0b fails closed');
SELECT throws_ok($$SELECT public.authorize_candidate_recovery('97000000-0000-0000-0000-00000000010c',3,pg_temp.fid('97000000-0000-0000-0000-00000000010c'),pg_temp.auth('97000000-0000-0000-0000-00000000020c','97000000-0000-0000-0000-00000000010c'))$$,'55000','checkpoint_not_ancestor','checkpoint case 0c fails closed');
SELECT is((SELECT intent#>'{execution_spec,candidate_recovery,scope_basis}' FROM public.work_items
WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),
jsonb_build_object('kind','base','start_sha',repeat('b',40),'files',
jsonb_build_array('apps/web/lib/x.ts','apps/web/lib/y.ts')),'D: legacy base scope_basis is audited');

SELECT * FROM finish();
ROLLBACK;
