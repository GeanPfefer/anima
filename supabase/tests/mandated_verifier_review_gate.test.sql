-- Mandated Verifier Enforcement V0.1 — fronteira de review do lane com Verifier obrigatório.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(29);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('9a000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mvg@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-000000000000','user','a'),
('9a000000-0000-0000-0000-0000000000b1','9a000000-0000-0000-0000-000000000000','user','b'),
('9a000000-0000-0000-0000-0000000000c1','9a000000-0000-0000-0000-000000000000','user','c');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('9a000000-0000-0000-0000-000000000000');
RESET ROLE;

-- Helpers de fixture (executam como postgres: evidência do host inserida direto).
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON ids TO authenticated;
CREATE FUNCTION pg_temp.spec(p_required boolean, p_ref text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('execution_spec', jsonb_build_object(
    'schema_version',1,'target',jsonb_build_object('kind','project','reference',p_ref),
    'permissions',jsonb_build_array('workspace_read','workspace_write_isolated'),
    'validation_criteria',jsonb_build_array(jsonb_build_object('label','tests')),
    'limits',jsonb_build_object('max_attempts',1))
    || CASE WHEN p_required THEN '{"verifier_requirement":"required_fail_closed"}'::jsonb ELSE '{}'::jsonb END);
$$;
CREATE FUNCTION pg_temp.signal(p_item uuid, p_attempt uuid, p_commit text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('kind','result','workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',1,
    'origin','executor','sequence',1,'summary','feito','resultReferences','[]'::jsonb,'validations','[]'::jsonb,
    'limitations','[]'::jsonb,'handoffReference','worktree:anima:anima-work/x',
    'worktreeHandoff',jsonb_build_object('commitSha',p_commit));
$$;
CREATE FUNCTION pg_temp.evidence(p_item uuid, p_attempt uuid, p_type public.work_event_type, p_commit text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(p_item,p_type,'system',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'work_item_id',p_item,'attempt_id',p_attempt,'approved_proposal_version',1,'origin','host',
    'evidence',jsonb_build_object('observedCommitSha',p_commit))))
  RETURNING id;
$$;
CREATE FUNCTION pg_temp.opinion(p_item uuid, p_attempt uuid, p_verdict text, p_result uuid, p_git uuid, p_gate uuid, p_version text DEFAULT 'work-verifier-v3') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('schemaVersion',1,'workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',1,
    'verifierVersion',p_version,'verdict',p_verdict,'restsOnAttestedEvidence',false,
    'summary',jsonb_build_object('violations',0,'gaps',0,'checks',1,'attested',0,'independent',1),'findings','[]'::jsonb,
    'evidenceBasis',jsonb_build_object('resultEventId',p_result,'observedEventId',p_git,'observedGateEventId',p_gate,
      'coverage',jsonb_build_object('git',p_git IS NOT NULL,'gates',p_gate IS NOT NULL)));
$$;
GRANT EXECUTE ON FUNCTION pg_temp.opinion(uuid,uuid,text,uuid,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.signal(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.spec(boolean,text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9a000000-0000-0000-0000-000000000000',true);

-- Item A (obrigatório), B (obrigatório, rejected), C (advisory).
INSERT INTO ids SELECT 'A',(public.create_work_proposal('9a000000-0000-0000-0000-0000000000a1','low','programming',pg_temp.spec(true,'mvg-a'),
  '{"schema_version":1,"data":{"summary":"x","objective":"o","included_scope":["a.ts"],"excluded_scope":["z"],"expected_effects":["e"],"risks":[]}}')).id;
INSERT INTO ids SELECT 'B',(public.create_work_proposal('9a000000-0000-0000-0000-0000000000b1','low','programming',pg_temp.spec(true,'mvg-b'),
  '{"schema_version":1,"data":{"summary":"x","objective":"o","included_scope":["a.ts"],"excluded_scope":["z"],"expected_effects":["e"],"risks":[]}}')).id;
INSERT INTO ids SELECT 'C',(public.create_work_proposal('9a000000-0000-0000-0000-0000000000c1','low','programming',pg_temp.spec(false,'mvg-c'),
  '{"schema_version":1,"data":{"summary":"x","objective":"o","included_scope":["a.ts"],"excluded_scope":["z"],"expected_effects":["e"],"risks":[]}}')).id;
INSERT INTO ids VALUES ('attA','9a000000-0000-0000-0000-00000000a0a0'),('attB','9a000000-0000-0000-0000-00000000b0b0'),('attC','9a000000-0000-0000-0000-00000000c0c0');
SELECT public.resolve_approval((SELECT v FROM ids WHERE k=x),1,'approve','{}') FROM (VALUES('A'),('B'),('C')) t(x);
SELECT public.start_commanded_work_attempt((SELECT v FROM ids WHERE k=x),1,(SELECT v FROM ids WHERE k='att'||x),'worktree-v1') FROM (VALUES('A'),('B'),('C')) t(x);

-- 1. Lane obrigatório: o resultado é CANDIDATO; o item NÃO entra em review.
SELECT is((public.record_commanded_work_terminal((SELECT v FROM ids WHERE k='A'),1,(SELECT v FROM ids WHERE k='attA'),
  pg_temp.signal((SELECT v FROM ids WHERE k='A'),(SELECT v FROM ids WHERE k='attA'),repeat('b',40)))).state,
  'in_progress','1. lane obrigatório: resultado candidato mantém in_progress');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT v FROM ids WHERE k='A') AND event_type='result_submitted'),
  1::bigint,'resultado candidato é durável (result_submitted persistido)');
SELECT lives_ok($$SELECT public.record_commanded_work_terminal((SELECT v FROM ids WHERE k='A'),1,(SELECT v FROM ids WHERE k='attA'),
  pg_temp.signal((SELECT v FROM ids WHERE k='A'),(SELECT v FROM ids WHERE k='attA'),repeat('b',40)))$$,'20. terminal replay idempotente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT v FROM ids WHERE k='A') AND event_type='result_submitted'),
  1::bigint,'20. sem resultado duplicado');

-- 18. Lane advisory inalterado: vai direto para review.
SELECT is((public.record_commanded_work_terminal((SELECT v FROM ids WHERE k='C'),1,(SELECT v FROM ids WHERE k='attC'),
  pg_temp.signal((SELECT v FROM ids WHERE k='C'),(SELECT v FROM ids WHERE k='attC'),repeat('b',40)))).state,
  'review','18. lane advisory: review direto, como antes');

-- 19. Reconciliação (restart) não abre janela de review sem verificação.
SELECT is((SELECT r.finding FROM public.reconcile_supervised_work() r WHERE r.work_item_id=(SELECT v FROM ids WHERE k='A') LIMIT 1),
  'result_pending_verification','19. reconciliação relata candidato pendente');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT v FROM ids WHERE k='A')),'in_progress','19. reconciliação não materializa review');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT v FROM ids WHERE k='A') AND event_type='attempt_abandoned'),
  0::bigint,'19. candidato pendente não é abandonado');

-- Defesa persistente: nenhuma escrita coloca o lane em review sem veredito.
RESET ROLE;
SELECT throws_ok($$UPDATE public.work_items SET state='review' WHERE id=(SELECT v FROM ids WHERE k='A')$$,
  '55000',NULL,'trigger recusa review sem veredito (qualquer caminho)');

-- Evidência do host para A: git (commit coerente), gate, coder; e um git INCOERENTE.
INSERT INTO ids SELECT 'rA', id FROM public.work_events WHERE work_item_id=(SELECT v FROM ids WHERE k='A') AND event_type='result_submitted';
INSERT INTO ids SELECT 'gitA', pg_temp.evidence((SELECT v FROM ids WHERE k='A'),(SELECT v FROM ids WHERE k='attA'),'host_observed_evidence_recorded',repeat('b',40));
-- Re-observação (variante permitida pelo índice de base) com commit INCOERENTE.
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
SELECT (SELECT v FROM ids WHERE k='A'),'host_observed_evidence_recorded','system',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
  'work_item_id',(SELECT v FROM ids WHERE k='A'),'attempt_id',(SELECT v FROM ids WHERE k='attA'),'approved_proposal_version',1,'origin','host',
  'evidence',jsonb_build_object('observedCommitSha',repeat('c',40),'observedChangedFilesSinceStart','[]'::jsonb)));
INSERT INTO ids SELECT 'gitBad', id FROM public.work_events WHERE work_item_id=(SELECT v FROM ids WHERE k='A')
  AND event_type='host_observed_evidence_recorded' AND payload #>> '{data,evidence,observedCommitSha}'=repeat('c',40);
INSERT INTO ids SELECT 'gateA', pg_temp.evidence((SELECT v FROM ids WHERE k='A'),(SELECT v FROM ids WHERE k='attA'),'host_observed_gate_evidence_recorded',NULL);
SET LOCAL ROLE authenticated;

-- 4. inconclusive ⇒ não review-ready.
SELECT is((public.record_verifier_opinion((SELECT v FROM ids WHERE k='A'),1,(SELECT v FROM ids WHERE k='attA'),
  pg_temp.opinion((SELECT v FROM ids WHERE k='A'),(SELECT v FROM ids WHERE k='attA'),'inconclusive',(SELECT v FROM ids WHERE k='rA'),NULL,NULL)))->>'released_for_review',
  'false','4. inconclusive não libera');
-- Evidência incompleta: verified sem gate/coder correlacionado não libera.
SELECT is((public.record_verifier_opinion((SELECT v FROM ids WHERE k='A'),1,(SELECT v FROM ids WHERE k='attA'),
  pg_temp.opinion((SELECT v FROM ids WHERE k='A'),(SELECT v FROM ids WHERE k='attA'),'verified',(SELECT v FROM ids WHERE k='rA'),(SELECT v FROM ids WHERE k='gitA'),NULL)))->>'released_for_review',
  'false','verified sem evidência de gate não libera');
-- 12. commit incoerente com o handoff ⇒ não libera (coder ainda ausente também).
RESET ROLE;
INSERT INTO ids SELECT 'coderA', pg_temp.evidence((SELECT v FROM ids WHERE k='A'),(SELECT v FROM ids WHERE k='attA'),'host_observed_coder_evidence_recorded',NULL);
SET LOCAL ROLE authenticated;
SELECT is((public.record_verifier_opinion((SELECT v FROM ids WHERE k='A'),1,(SELECT v FROM ids WHERE k='attA'),
  pg_temp.opinion((SELECT v FROM ids WHERE k='A'),(SELECT v FROM ids WHERE k='attA'),'verified',(SELECT v FROM ids WHERE k='rA'),(SELECT v FROM ids WHERE k='gitBad'),(SELECT v FROM ids WHERE k='gateA'))))->>'released_for_review',
  'false','12. commit observado ≠ commit do handoff não libera');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT v FROM ids WHERE k='A')),'in_progress','ainda in_progress');
-- 9/11. attempt ou versão errados: recusados na persistência.
SELECT throws_ok($$SELECT public.record_verifier_opinion((SELECT v FROM ids WHERE k='A'),1,'9a000000-0000-0000-0000-00000000ffff',
  pg_temp.opinion((SELECT v FROM ids WHERE k='A'),'9a000000-0000-0000-0000-00000000ffff','verified',(SELECT v FROM ids WHERE k='rA'),(SELECT v FROM ids WHERE k='gitA'),(SELECT v FROM ids WHERE k='gateA')))$$,
  'P0002',NULL,'9. parecer de outra attempt recusado');
SELECT throws_ok($$SELECT public.record_verifier_opinion((SELECT v FROM ids WHERE k='A'),2,(SELECT v FROM ids WHERE k='attA'),
  pg_temp.opinion((SELECT v FROM ids WHERE k='A'),(SELECT v FROM ids WHERE k='attA'),'verified',(SELECT v FROM ids WHERE k='rA'),(SELECT v FROM ids WHERE k='gitA'),(SELECT v FROM ids WHERE k='gateA')))$$,
  '22023',NULL,'11. versão de proposta errada recusada');
-- 10. resultEventId errado: recusado na persistência.
SELECT throws_ok($$SELECT public.record_verifier_opinion((SELECT v FROM ids WHERE k='A'),1,(SELECT v FROM ids WHERE k='attA'),
  pg_temp.opinion((SELECT v FROM ids WHERE k='A'),(SELECT v FROM ids WHERE k='attA'),'verified',(SELECT v FROM ids WHERE k='gitA'),(SELECT v FROM ids WHERE k='gitA'),(SELECT v FROM ids WHERE k='gateA')))$$,
  'P0002',NULL,'10. resultEventId que não é resultado da attempt recusado');

-- 2. verified persistido + correlação completa ⇒ review (atômico com a persistência).
SELECT is((public.record_verifier_opinion((SELECT v FROM ids WHERE k='A'),1,(SELECT v FROM ids WHERE k='attA'),
  pg_temp.opinion((SELECT v FROM ids WHERE k='A'),(SELECT v FROM ids WHERE k='attA'),'verified',(SELECT v FROM ids WHERE k='rA'),(SELECT v FROM ids WHERE k='gitA'),(SELECT v FROM ids WHERE k='gateA'))))->>'released_for_review',
  'true','2. verified correlacionado libera para review');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT v FROM ids WHERE k='A')),'review','2. item em review');
-- 16. verified sozinho não aceita.
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT v FROM ids WHERE k='A') AND event_type='result_accepted'),
  0::bigint,'16. verified não produz result_accepted');
-- 20. replay do parecer: sem evento novo.
SELECT is((public.record_verifier_opinion((SELECT v FROM ids WHERE k='A'),1,(SELECT v FROM ids WHERE k='attA'),
  pg_temp.opinion((SELECT v FROM ids WHERE k='A'),(SELECT v FROM ids WHERE k='attA'),'verified',(SELECT v FROM ids WHERE k='rA'),(SELECT v FROM ids WHERE k='gitA'),(SELECT v FROM ids WHERE k='gateA'))))->>'action',
  'replayed','20. parecer idempotente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT v FROM ids WHERE k='A') AND event_type='verifier_opinion_recorded'),
  4::bigint,'20. sem parecer duplicado');

-- 13/14. parecer rejected MAIS RECENTE derruba o verified: aceite direto recusado.
SELECT is((public.record_verifier_opinion((SELECT v FROM ids WHERE k='A'),1,(SELECT v FROM ids WHERE k='attA'),
  pg_temp.opinion((SELECT v FROM ids WHERE k='A'),(SELECT v FROM ids WHERE k='attA'),'rejected',(SELECT v FROM ids WHERE k='rA'),(SELECT v FROM ids WHERE k='gitA'),(SELECT v FROM ids WHERE k='gateA'),'work-verifier-v3-b')))->>'action',
  'recorded','parecer rejected mais recente');
SELECT throws_ok($$SELECT public.review_work_result_versioned((SELECT v FROM ids WHERE k='A'),1,(SELECT v FROM ids WHERE k='rA'),'accept','{}')$$,
  '55000','verifier requirement not satisfied','14. RPC direta: aceite sem verified corrente recusado');
-- 10. aceite de resultado que não é o último: recusado.
SELECT throws_ok($$SELECT public.review_work_result_versioned((SELECT v FROM ids WHERE k='A'),1,(SELECT v FROM ids WHERE k='gitA'),'accept','{}')$$,
  '55000',NULL,'10. aceite com resultEventId errado recusado');

-- Item B: rejected libera para inspeção/retrabalho, mas o aceite é recusado.
SELECT public.record_commanded_work_terminal((SELECT v FROM ids WHERE k='B'),1,(SELECT v FROM ids WHERE k='attB'),
  pg_temp.signal((SELECT v FROM ids WHERE k='B'),(SELECT v FROM ids WHERE k='attB'),repeat('b',40)));
RESET ROLE;
INSERT INTO ids SELECT 'rB', id FROM public.work_events WHERE work_item_id=(SELECT v FROM ids WHERE k='B') AND event_type='result_submitted';
INSERT INTO ids SELECT 'gitB', pg_temp.evidence((SELECT v FROM ids WHERE k='B'),(SELECT v FROM ids WHERE k='attB'),'host_observed_evidence_recorded',repeat('b',40));
INSERT INTO ids SELECT 'gateB', pg_temp.evidence((SELECT v FROM ids WHERE k='B'),(SELECT v FROM ids WHERE k='attB'),'host_observed_gate_evidence_recorded',NULL);
INSERT INTO ids SELECT 'coderB', pg_temp.evidence((SELECT v FROM ids WHERE k='B'),(SELECT v FROM ids WHERE k='attB'),'host_observed_coder_evidence_recorded',NULL);
SET LOCAL ROLE authenticated;
SELECT is((public.record_verifier_opinion((SELECT v FROM ids WHERE k='B'),1,(SELECT v FROM ids WHERE k='attB'),
  pg_temp.opinion((SELECT v FROM ids WHERE k='B'),(SELECT v FROM ids WHERE k='attB'),'rejected',(SELECT v FROM ids WHERE k='rB'),(SELECT v FROM ids WHERE k='gitB'),(SELECT v FROM ids WHERE k='gateB'))))->>'released_for_review',
  'true','3. rejected libera para inspeção');
SELECT throws_ok($$SELECT public.review_work_result_versioned((SELECT v FROM ids WHERE k='B'),1,(SELECT v FROM ids WHERE k='rB'),'accept','{}')$$,
  '55000','verifier requirement not satisfied','15. RPC direta com rejected: aceite recusado');
SELECT is((public.review_work_result_versioned((SELECT v FROM ids WHERE k='B'),1,(SELECT v FROM ids WHERE k='rB'),'request_changes','{"requested_changes":"corrigir"}')).state,
  'changes_requested','3. rejected segue o caminho de retrabalho');

-- 17. aceite humano após verified corrente funciona (novo parecer verified mais recente em A).
SELECT public.record_verifier_opinion((SELECT v FROM ids WHERE k='A'),1,(SELECT v FROM ids WHERE k='attA'),
  pg_temp.opinion((SELECT v FROM ids WHERE k='A'),(SELECT v FROM ids WHERE k='attA'),'verified',(SELECT v FROM ids WHERE k='rA'),(SELECT v FROM ids WHERE k='gitA'),(SELECT v FROM ids WHERE k='gateA'),'work-verifier-v3-c'));
SELECT is((public.review_work_result_versioned((SELECT v FROM ids WHERE k='A'),1,(SELECT v FROM ids WHERE k='rA'),'accept','{}')).state,
  'completed','17. aceite humano com verified corrente funciona');

-- 18. advisory: aceite sem parecer segue como antes.
SELECT is((public.review_work_result_versioned((SELECT v FROM ids WHERE k='C'),1,
  (SELECT id FROM public.work_events WHERE work_item_id=(SELECT v FROM ids WHERE k='C') AND event_type='result_submitted'),'accept','{}')).state,
  'completed','18. advisory: aceite sem parecer inalterado');

SELECT * FROM finish();
RESET ROLE;
ROLLBACK;
