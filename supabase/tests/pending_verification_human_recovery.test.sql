-- Pending Verification Human Recovery V0 — saída humana do candidato retido (lane com Verifier obrigatório).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(51);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('9b000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pvr@test.invalid','',now(),'{}','{}',now(),now()),
('9b000000-0000-0000-0000-00000000000f','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pvr-other@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
SELECT ('9b000000-0000-0000-0000-0000000000'||x||'1')::uuid,'9b000000-0000-0000-0000-000000000000','user',x
FROM (VALUES('a'),('b'),('c'),('d'),('e'),('f')) t(x);
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('9b000000-0000-0000-0000-000000000000'),('9b000000-0000-0000-0000-00000000000f');
RESET ROLE;

-- Wrapper de TESTE do sink do Verifier (writer de sistema registrado para o dono corrente),
-- igual a mandated_verifier_review_gate.test.sql. A fronteira real de papel está em
-- trusted_system_writer.test.sql.
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
GRANT EXECUTE ON FUNCTION pg_temp.record_verifier_opinion(a uuid, b integer, c uuid, d jsonb) TO authenticated;

CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON ids TO authenticated;
CREATE FUNCTION pg_temp.id(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT v FROM ids WHERE k=p_k $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO authenticated;
CREATE FUNCTION pg_temp.spec(p_required boolean, p_ref text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('execution_spec', jsonb_build_object(
    'schema_version',1,'target',jsonb_build_object('kind','project','reference',p_ref),
    'permissions',jsonb_build_array('workspace_read','workspace_write_isolated'),
    'validation_criteria',jsonb_build_array(jsonb_build_object('label','tests')),
    'limits',jsonb_build_object('max_attempts',1))
    || CASE WHEN p_required THEN '{"verifier_requirement":"required_fail_closed"}'::jsonb ELSE '{}'::jsonb END);
$$;
CREATE FUNCTION pg_temp.signal(p_item uuid, p_attempt uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('kind','result','workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',1,
    'origin','executor','sequence',1,'summary','feito','resultReferences','[]'::jsonb,'validations','[]'::jsonb,
    'limitations','[]'::jsonb,'handoffReference','worktree:anima:anima-work/x',
    'worktreeHandoff',jsonb_build_object('commitSha',repeat('b',40)));
$$;
CREATE FUNCTION pg_temp.evidence(p_item uuid, p_attempt uuid, p_type public.work_event_type) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(p_item,p_type,'system',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'work_item_id',p_item,'attempt_id',p_attempt,'approved_proposal_version',1,'origin','host',
    'evidence',jsonb_build_object('observedCommitSha',repeat('b',40)))))
  RETURNING id;
$$;
CREATE FUNCTION pg_temp.opinion(p_item uuid, p_attempt uuid, p_verdict text, p_result uuid, p_git uuid, p_gate uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('schemaVersion',1,'workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',1,
    'verifierVersion','work-verifier-v3','verdict',p_verdict,'restsOnAttestedEvidence',false,
    'summary',jsonb_build_object('violations',0,'gaps',0,'checks',1,'attested',0,'independent',1),'findings','[]'::jsonb,
    'evidenceBasis',jsonb_build_object('resultEventId',p_result,'observedEventId',p_git,'observedGateEventId',p_gate,
      'coverage',jsonb_build_object('git',p_git IS NOT NULL,'gates',p_gate IS NOT NULL)));
$$;
GRANT EXECUTE ON FUNCTION pg_temp.opinion(uuid,uuid,text,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.signal(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.spec(boolean,text) TO authenticated;
CREATE FUNCTION pg_temp.count_events(p_item uuid, p_type text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.work_events WHERE work_item_id=p_item AND event_type::text=p_type $$;
GRANT EXECUTE ON FUNCTION pg_temp.count_events(uuid,text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000000',true);

-- A,B,D,E,F: lane obrigatório; C: advisory.
INSERT INTO ids SELECT upper(x),(public.create_work_proposal(('9b000000-0000-0000-0000-0000000000'||x||'1')::uuid,'low','programming',
  pg_temp.spec(x<>'c','pvr-'||x),
  '{"schema_version":1,"data":{"summary":"x","objective":"o","included_scope":["a.ts"],"excluded_scope":["z"],"expected_effects":["e"],"risks":[]}}')).id
FROM (VALUES('a'),('b'),('c'),('d'),('e'),('f')) t(x);
INSERT INTO ids SELECT 'att'||k, md5('pvr-attempt-'||k)::uuid FROM (VALUES('A'),('B'),('C'),('D'),('E'),('F')) t(k);
SELECT public.resolve_approval(pg_temp.id(x),1,'approve','{}') FROM (VALUES('A'),('B'),('C'),('D'),('E'),('F')) t(x);
SELECT public.start_commanded_work_attempt(pg_temp.id(x),1,pg_temp.id('att'||x),'worktree-v1') FROM (VALUES('A'),('B'),('C'),('D'),('E'),('F')) t(x);
-- Terminal de resultado em A,B,D,E,F (C fica sem resultado, in_progress).
SELECT public.record_commanded_work_terminal(pg_temp.id(x),1,pg_temp.id('att'||x),pg_temp.signal(pg_temp.id(x),pg_temp.id('att'||x)))
FROM (VALUES('A'),('B'),('D'),('E'),('F')) t(x);
INSERT INTO ids SELECT 'r'||x, (SELECT id FROM public.work_events WHERE work_item_id=pg_temp.id(x) AND event_type='result_submitted')
FROM (VALUES('A'),('B'),('D'),('E'),('F')) t(x);

SELECT is((SELECT r.finding FROM public.reconcile_supervised_work() r WHERE r.work_item_id=pg_temp.id('A') LIMIT 1),
  'result_pending_verification','pré: A é candidato pendente de verificação');

-- 6. resultEventId errado ⇒ recusado (candidato de outro item / id inexistente).
SELECT throws_ok($$SELECT public.resolve_pending_verification(pg_temp.id('A'),pg_temp.id('rB'),'cancel','{}')$$,
  '55000',NULL,'6. resultEventId de outro item recusado');
SELECT throws_ok($$SELECT public.resolve_pending_verification(pg_temp.id('A'),'9b000000-0000-0000-0000-0000000fffff','cancel','{}')$$,
  '55000',NULL,'6. resultEventId inexistente recusado');
-- Entrada inválida.
SELECT throws_ok($$SELECT public.resolve_pending_verification(pg_temp.id('A'),pg_temp.id('rA'),'accept','{}')$$,
  '22023',NULL,'decisão fora de request_changes|cancel recusada (não existe accept/verify)');
SELECT throws_ok($$SELECT public.resolve_pending_verification(pg_temp.id('A'),pg_temp.id('rA'),'request_changes','{}')$$,
  '22023','requested_changes is required','request_changes exige requested_changes');
-- 8. advisory ⇒ recusado.
SELECT throws_ok($$SELECT public.resolve_pending_verification(pg_temp.id('C'),pg_temp.id('rA'),'cancel','{}')$$,
  '55000','work item has no mandated verifier; use the review path','8. item advisory recusado');

-- 19. outro usuário ⇒ não encontra o item (posse).
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-00000000000f',true);
SELECT throws_ok($$SELECT public.resolve_pending_verification(pg_temp.id('A'),pg_temp.id('rA'),'cancel','{}')$$,
  'P0002',NULL,'19. outro usuário recusado');
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-0000000000ee',true);
SELECT throws_ok($$SELECT public.resolve_pending_verification(pg_temp.id('A'),pg_temp.id('rA'),'cancel','{}')$$,
  '42501',NULL,'19. usuário fora da allowlist recusado');
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000000',true);

-- 18. Trusted System Writer AUSENTE para este dono: a recuperação humana funciona.
RESET ROLE;
SELECT is((SELECT count(*) FROM private.trusted_system_writers WHERE owner_user_id='9b000000-0000-0000-0000-000000000000'),
  0::bigint,'18. nenhum writer de sistema provisionado para o dono');
SET LOCAL ROLE authenticated;

-- 1. request_changes ⇒ changes_requested.
SELECT is((public.resolve_pending_verification(pg_temp.id('A'),pg_temp.id('rA'),'request_changes','{"requested_changes":"refazer testes"}')).state,
  'changes_requested','1. pending + request_changes ⇒ changes_requested');
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type='changes_requested'),
  'user','7(authorship). evento author=user');
SELECT is((SELECT payload->'data'->>'reviewed_result_event_id' FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type='changes_requested'),
  pg_temp.id('rA')::text,'1. payload preserva o shape do review (reviewed_result_event_id) para a correção existente');
SELECT is((SELECT payload->'data'->>'attempt_id' FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type='changes_requested'),
  pg_temp.id('attA')::text,'1. attempt derivado do candidato');
SELECT is(pg_temp.count_events(pg_temp.id('A'),'result_submitted'),1::bigint,'1. candidato preservado');

-- 2. cancel ⇒ cancelled.
SELECT is((public.resolve_pending_verification(pg_temp.id('B'),pg_temp.id('rB'),'cancel','{"reason":"abandonar"}')).state,
  'cancelled','2. pending + cancel ⇒ cancelled');
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=pg_temp.id('B') AND event_type='work_cancelled'),
  'user','2. work_cancelled author=user');
SELECT is(pg_temp.count_events(pg_temp.id('B'),'result_submitted'),1::bigint,'2. candidato preservado');

-- 18 (cont.). Ainda nenhum writer: as decisões acima não dependeram dele.
RESET ROLE;
SELECT is((SELECT count(*) FROM private.trusted_system_writers WHERE owner_user_id='9b000000-0000-0000-0000-000000000000'),
  0::bigint,'18. recuperação humana concluída sem Trusted System Writer');
SET LOCAL ROLE authenticated;

-- 3/4/5/20. nenhuma decisão cria review, parecer, aceite ou integração.
SELECT is((SELECT count(*) FROM public.work_items WHERE id IN (pg_temp.id('A'),pg_temp.id('B')) AND state IN ('review','completed')),
  0::bigint,'3. nenhuma decisão produz review');
SELECT is(pg_temp.count_events(pg_temp.id('A'),'verifier_opinion_recorded')+pg_temp.count_events(pg_temp.id('B'),'verifier_opinion_recorded'),
  0::bigint,'4. nenhuma decisão cria verifier opinion');
SELECT is(pg_temp.count_events(pg_temp.id('A'),'result_accepted')+pg_temp.count_events(pg_temp.id('B'),'result_accepted'),
  0::bigint,'5. nenhuma decisão cria result_accepted');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id IN (pg_temp.id('A'),pg_temp.id('B'))
  AND event_type::text LIKE 'integration%'),0::bigint,'20. nenhuma decisão cria integração');

-- 11. replay idempotente.
SELECT is((public.resolve_pending_verification(pg_temp.id('A'),pg_temp.id('rA'),'request_changes','{"requested_changes":"refazer testes"}')).state,
  'changes_requested','11. replay request_changes idempotente');
SELECT is(pg_temp.count_events(pg_temp.id('A'),'changes_requested'),1::bigint,'11. sem evento duplicado');
SELECT is((public.resolve_pending_verification(pg_temp.id('B'),pg_temp.id('rB'),'cancel','{"reason":"abandonar"}')).state,
  'cancelled','replay cancel idempotente');
SELECT is(pg_temp.count_events(pg_temp.id('B'),'work_cancelled'),1::bigint,'replay cancel sem evento duplicado');

-- 12/13. decisão divergente após resolução ⇒ conflito.
SELECT throws_ok($$SELECT public.resolve_pending_verification(pg_temp.id('A'),pg_temp.id('rA'),'cancel','{}')$$,
  '55000','pending verification already resolved with a different decision','12. request_changes depois cancel ⇒ conflito');
SELECT throws_ok($$SELECT public.resolve_pending_verification(pg_temp.id('A'),pg_temp.id('rA'),'request_changes','{"requested_changes":"outro texto"}')$$,
  '55000','pending verification already resolved with a different decision','request_changes com texto divergente ⇒ conflito');
SELECT throws_ok($$SELECT public.resolve_pending_verification(pg_temp.id('B'),pg_temp.id('rB'),'request_changes','{"requested_changes":"x"}')$$,
  '55000','pending verification already resolved with a different decision','13. cancel depois request_changes ⇒ conflito');

-- 16. reconciliação após resolução não relata mais o candidato.
SELECT is((SELECT count(*) FROM public.reconcile_supervised_work() r WHERE r.work_item_id IN (pg_temp.id('A'),pg_temp.id('B'))
  AND r.finding='result_pending_verification'),0::bigint,'16. reconcile não retorna pending verification após resolução');
SELECT is((SELECT count(*) FROM public.reconcile_supervised_work() r WHERE r.work_item_id=pg_temp.id('D')
  AND r.finding='result_pending_verification'),1::bigint,'16. candidato NÃO resolvido continua pendente');

-- 14/15 (Verifier DEPOIS do humano): parecer verified completo e tardio não libera review.
RESET ROLE;
INSERT INTO ids SELECT 'git'||x, pg_temp.evidence(pg_temp.id(x),pg_temp.id('att'||x),'host_observed_evidence_recorded') FROM (VALUES('A'),('B'),('E')) t(x);
INSERT INTO ids SELECT 'gate'||x, pg_temp.evidence(pg_temp.id(x),pg_temp.id('att'||x),'host_observed_gate_evidence_recorded') FROM (VALUES('A'),('B'),('E')) t(x);
SELECT pg_temp.evidence(pg_temp.id(x),pg_temp.id('att'||x),'host_observed_coder_evidence_recorded') FROM (VALUES('A'),('B'),('E')) t(x);
SET LOCAL ROLE authenticated;
SELECT is((pg_temp.record_verifier_opinion(pg_temp.id('A'),1,pg_temp.id('attA'),
  pg_temp.opinion(pg_temp.id('A'),pg_temp.id('attA'),'verified',pg_temp.id('rA'),pg_temp.id('gitA'),pg_temp.id('gateA'))))->>'released_for_review',
  'false','14. Verifier depois de request_changes: parecer não libera review');
SELECT is((SELECT state::text FROM public.work_items WHERE id=pg_temp.id('A')),'changes_requested','14. A permanece changes_requested');
SELECT is((pg_temp.record_verifier_opinion(pg_temp.id('B'),1,pg_temp.id('attB'),
  pg_temp.opinion(pg_temp.id('B'),pg_temp.id('attB'),'verified',pg_temp.id('rB'),pg_temp.id('gitB'),pg_temp.id('gateB'))))->>'released_for_review',
  'false','15. Verifier depois de cancel: parecer não libera review');
SELECT is((SELECT state::text FROM public.work_items WHERE id=pg_temp.id('B')),'cancelled','15. B permanece cancelled');
-- Defesa persistente: candidato resolvido nunca entra em review, nem com parecer verified correlacionado.
RESET ROLE;
SELECT is(private.mandated_result_verdict(pg_temp.id('A'),1,pg_temp.id('rA')),'human_resolved','veredito do candidato resolvido = human_resolved');
SELECT throws_ok($$UPDATE public.work_items SET state='review' WHERE id=pg_temp.id('A')$$,
  '55000',NULL,'changes_requested ⇒ review impossível (trigger)');
-- Mesmo que o item volte a in_progress (retrabalho manual), o candidato resolvido não é liberado.
UPDATE public.work_items SET state='in_progress' WHERE id=pg_temp.id('A');
SELECT is(private.release_mandated_result((SELECT i FROM public.work_items i WHERE i.id=pg_temp.id('A'))),false,
  'retomada: release do candidato resolvido recusado');
SELECT throws_ok($$UPDATE public.work_items SET state='review' WHERE id=pg_temp.id('A')$$,
  '55000',NULL,'retomada: trigger recusa review do candidato resolvido');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.reconcile_supervised_work() r WHERE r.work_item_id=pg_temp.id('A')
  AND r.finding IN ('result_pending_verification','terminal_not_materialized','attempt_abandoned')),0::bigint,
  'retomada: reconcile não relata, não materializa review, não abandona o candidato resolvido');
SELECT is((SELECT state::text FROM public.work_items WHERE id=pg_temp.id('A')),'in_progress','retomada: estado intocado pela reconciliação');
RESET ROLE;
UPDATE public.work_items SET state='changes_requested' WHERE id=pg_temp.id('A');
SET LOCAL ROLE authenticated;

-- 14/15 (Verifier ANTES do humano): E liberado para review; decisão humana recusada.
SELECT is((pg_temp.record_verifier_opinion(pg_temp.id('E'),1,pg_temp.id('attE'),
  pg_temp.opinion(pg_temp.id('E'),pg_temp.id('attE'),'verified',pg_temp.id('rE'),pg_temp.id('gitE'),pg_temp.id('gateE'))))->>'released_for_review',
  'true','pré: Verifier vence ⇒ E em review');
SELECT throws_ok($$SELECT public.resolve_pending_verification(pg_temp.id('E'),pg_temp.id('rE'),'request_changes','{"requested_changes":"x"}')$$,
  '55000','work item is not holding a pending verification candidate','9/14. item já em review ⇒ recusa (usar review normal)');
SELECT throws_ok($$SELECT public.resolve_pending_verification(pg_temp.id('E'),pg_temp.id('rE'),'cancel','{}')$$,
  '55000','work item is not holding a pending verification candidate','15. cancel após Verifier liberar ⇒ recusa');
-- 10. completed ⇒ recusa.
SELECT is((public.review_work_result_versioned(pg_temp.id('E'),1,pg_temp.id('rE'),'accept','{}')).state,'completed','pré: E aceito pelo review normal');
SELECT throws_ok($$SELECT public.resolve_pending_verification(pg_temp.id('E'),pg_temp.id('rE'),'cancel','{}')$$,
  '55000',NULL,'10. item completed recusado');

-- 7. attempt/versão stale ⇒ recusado.
RESET ROLE;
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
VALUES(pg_temp.id('D'),'execution_started','system',1,jsonb_build_object('schema_version',1,'data',
  jsonb_build_object('attempt_id','9b000000-0000-0000-0000-00000000dddd','approved_proposal_version',1)));
UPDATE public.work_items SET proposal_version=2 WHERE id=pg_temp.id('F');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.resolve_pending_verification(pg_temp.id('D'),pg_temp.id('rD'),'cancel','{}')$$,
  '55000','pending verification candidate changed','7. candidato de attempt anterior à vigente recusado');
SELECT throws_ok($$SELECT public.resolve_pending_verification(pg_temp.id('F'),pg_temp.id('rF'),'cancel','{}')$$,
  '55000','pending verification candidate changed','7. candidato de versão de proposta stale recusado');

-- 20. nenhum bypass: aceite do candidato resolvido continua impossível pelo caminho de review.
SELECT throws_ok($$SELECT public.review_work_result_versioned(pg_temp.id('A'),1,pg_temp.id('rA'),'accept','{}')$$,
  '55000',NULL,'20. aceite do candidato resolvido recusado');
-- A primitive não é executável por anon.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.resolve_pending_verification('9b000000-0000-0000-0000-0000000000aa','9b000000-0000-0000-0000-0000000000ab','cancel','{}')$$,
  '42501',NULL,'anon não executa a primitive');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.work_items WHERE id IN (pg_temp.id('A'),pg_temp.id('B')) AND state='review'),
  0::bigint,'3. final: nenhum candidato resolvido chegou a review');

SELECT * FROM finish();
ROLLBACK;
