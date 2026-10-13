-- V1: preparado para banco descartável; NÃO executado no residente.
-- AUTO-02 — asserções preparadas; prova PostgreSQL ainda pendente.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
-- Resolve somente metadata como postgres; a ACL continua medida para authenticated.
SELECT 'private.begin_work_attempt(uuid,uuid,integer,uuid,text,text,uuid)'::regprocedure::oid AS proof_private_begin_oid \gset
\ir helpers/routing.inc
SELECT plan(55);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('a1000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','single-item@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000000','user','supervisione'),
('a1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000000','user','segundo item'),
('a1000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000000','user','terceiro item');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('a1000000-0000-0000-0000-000000000000');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000000',true);
\set intel '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-28T12:00:00Z","classifierId":"test"}}'

CREATE TEMP TABLE item AS SELECT (public.create_work_proposal('a1000000-0000-0000-0000-000000000001','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":["workspace_read"],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}',
  '{"schema_version":1,"data":{"summary":"x","objective":"corrigir","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}')).id;
SELECT public.resolve_approval((SELECT id FROM item),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM item),1,0,:'intel'::jsonb);

-- Item ainda não aprovado, usado para provar que inelegível não é reivindicável.
CREATE TEMP TABLE pending AS SELECT (public.create_work_proposal('a1000000-0000-0000-0000-000000000002','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}',
  '{"schema_version":1,"data":{"summary":"y","objective":"outro","included_scope":["b.py"],"excluded_scope":["deploy"],"expected_effects":["ok"],"risks":[]}}')).id;

CREATE TEMP TABLE neighbour AS SELECT (public.create_work_proposal('a1000000-0000-0000-0000-000000000003','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}',
  '{"schema_version":1,"data":{"summary":"n","objective":"vizinho","included_scope":["c.py"],"excluded_scope":["deploy"],"expected_effects":["ok"],"risks":[]}}')).id;
SELECT public.resolve_approval((SELECT id FROM neighbour),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM neighbour),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM neighbour),1,'a1000000-0000-0000-0000-0000000000a1','neighbour',300);
CREATE TEMP TABLE before_neighbour AS
SELECT to_jsonb(i) AS item, to_jsonb(c) AS claim,
  (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.seq) FROM public.work_events e WHERE e.work_item_id=i.id) AS events
FROM public.work_items i JOIN public.work_claims c ON c.work_item_id=i.id WHERE i.id=(SELECT id FROM neighbour);
SELECT throws_ok($$SELECT public.acquire_single_item_work_claim((SELECT id FROM item),1,'a1000000-0000-0000-0000-0000000000b1','single',300)$$,'55000','single_item_foreign_claim_open','claim alheio ativo recusa');
SELECT is((SELECT to_jsonb(i) FROM public.work_items i WHERE i.id=(SELECT id FROM neighbour)),(SELECT item FROM before_neighbour),'item alheio intacto');
SELECT is((SELECT to_jsonb(i) FROM public.work_claims i WHERE i.id='a1000000-0000-0000-0000-0000000000a1'),(SELECT claim FROM before_neighbour),'claim ativo intacto');
SELECT is((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.seq) FROM public.work_events e WHERE e.work_item_id=(SELECT id FROM neighbour)),(SELECT events FROM before_neighbour),'eventos alheios intactos');
RESET ROLE;
UPDATE public.work_claims SET acquired_at=now()-interval '2 hours', expires_at=now()-interval '1 hour' WHERE id='a1000000-0000-0000-0000-0000000000a1';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000000',true);
UPDATE before_neighbour SET claim=(SELECT to_jsonb(c) FROM public.work_claims c WHERE id='a1000000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$SELECT public.acquire_single_item_work_claim((SELECT id FROM item),1,'a1000000-0000-0000-0000-0000000000b1','single',300)$$,'55000','single_item_foreign_claim_open','claim alheio vencido também recusa');
SELECT is((SELECT to_jsonb(c) FROM public.work_claims c WHERE id='a1000000-0000-0000-0000-0000000000a1'),(SELECT claim FROM before_neighbour),'claim vencido integralmente preservado');
SELECT is((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.seq) FROM public.work_events e WHERE e.work_item_id=(SELECT id FROM neighbour)),(SELECT events FROM before_neighbour),'nenhum evento de liberação alheia');
SELECT is((SELECT count(*) FROM public.work_claims WHERE work_item_id=(SELECT id FROM item)),0::bigint,'recusa não cria claim próprio');
SELECT public.release_work_claim('a1000000-0000-0000-0000-0000000000a1','expired');
SELECT throws_ok($$SELECT public.acquire_single_item_work_claim((SELECT id FROM item),2,'a1000000-0000-0000-0000-0000000000b1','single',300)$$,'55000','work item is not eligible for an autonomous claim','versão divergente recusa');
SELECT throws_ok($$SELECT public.acquire_single_item_work_claim((SELECT id FROM pending),1,'a1000000-0000-0000-0000-0000000000b1','single',300)$$,'55000','work item is not eligible for an autonomous claim','proposed recusa');
SELECT is((public.acquire_single_item_work_claim((SELECT id FROM item),1,'a1000000-0000-0000-0000-0000000000b1','single',300)).id,'a1000000-0000-0000-0000-0000000000b1'::uuid,'claim scoped adquirido');
SELECT is((public.acquire_single_item_work_claim((SELECT id FROM item),1,'a1000000-0000-0000-0000-0000000000b1','single',300)).id,'a1000000-0000-0000-0000-0000000000b1'::uuid,'replay retorna claim idêntico');
SELECT throws_ok($$SELECT public.acquire_single_item_work_claim((SELECT id FROM item),1,'a1000000-0000-0000-0000-0000000000b1','different',300)$$,'55000','claim identity conflict','replay divergente recusa');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='work_claimed'),1::bigint,'replay não duplica evento');
SELECT pg_temp.record_test_route((SELECT id FROM item),'a1000000-0000-0000-0000-0000000000c1');
SELECT pg_temp.record_test_route((SELECT id FROM item),'a1000000-0000-0000-0000-0000000000c2');
SELECT lives_ok($$SELECT public.start_claimed_work_attempt('a1000000-0000-0000-0000-0000000000b1','a1000000-0000-0000-0000-0000000000c1','local-runner-v1')$$,'início usa contrato sob claim');
SELECT is((SELECT payload#>>'{data,claim_id}' FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='execution_started'),'a1000000-0000-0000-0000-0000000000b1','execution_started mantém claim_id para orçamento');
SELECT lives_ok($$SELECT public.start_claimed_work_attempt('a1000000-0000-0000-0000-0000000000b1','a1000000-0000-0000-0000-0000000000c1','local-runner-v1')$$,'replay da attempt idempotente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='execution_started'),1::bigint,'uma única attempt');
SELECT throws_ok($$SELECT public.start_claimed_work_attempt('a1000000-0000-0000-0000-0000000000b1','a1000000-0000-0000-0000-0000000000c2','local-runner-v1')$$,'55000','claim already started another attempt','segunda attempt recusa');
-- Fixture sintética de reaprovação: só neste teste transacional descartável.
-- Não altera policy nem concede exceção de orçamento.
RESET ROLE;
UPDATE public.work_items SET state='approved' WHERE id=(SELECT id FROM item);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT public.release_work_claim('a1000000-0000-0000-0000-0000000000b1','attempt_finished');
SELECT public.acquire_single_item_work_claim((SELECT id FROM item),1,'a1000000-0000-0000-0000-0000000000b2','single',300);
CREATE TEMP TABLE before_denial AS SELECT
  (SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM item)) AS events;
SELECT throws_ok($$SELECT public.start_claimed_work_attempt('a1000000-0000-0000-0000-0000000000b2','a1000000-0000-0000-0000-0000000000c2','local-runner-v1')$$,
  'P0001','item_attempt_budget_exhausted','orçamento atômico recusa segunda attempt max_attempts=1');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM item)),'approved','rollback preserva estado');
SELECT is((SELECT attempt_id FROM public.work_claims WHERE id='a1000000-0000-0000-0000-0000000000b2'),NULL::uuid,'rollback desfaz associação da attempt');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM item)),(SELECT events FROM before_denial),'rollback não deixa eventos parciais');
SELECT is((SELECT payload#>>'{data,claim_id}' FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='execution_started'),'a1000000-0000-0000-0000-0000000000b1','nenhum início sem claim foi introduzido');
RESET ROLE;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('a2000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','single-other@test.invalid','',now(),'{}','{}',now(),now());
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('a2000000-0000-0000-0000-000000000000');
RESET ROLE;
GRANT SELECT ON item TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2000000-0000-0000-0000-000000000000',true);
SELECT throws_ok($$SELECT public.acquire_single_item_work_claim((SELECT id FROM item),1,'a2000000-0000-0000-0000-0000000000b1','other-user',300)$$,'P0002','work item not found','outro usuário não adquire item alheio');
SELECT is((SELECT count(*) FROM public.work_claims WHERE id='a1000000-0000-0000-0000-0000000000b1'),0::bigint,'RLS esconde claim alheio');
SELECT ok(NOT has_function_privilege('anon','public.acquire_single_item_work_claim(uuid,integer,uuid,text,integer)','EXECUTE'),'anon não executa RPC');
SELECT ok(NOT has_function_privilege('authenticated',:'proof_private_begin_oid'::oid,'EXECUTE'),'cliente não acessa início privado');

RESET ROLE;
SELECT ok(NOT has_function_privilege('service_role','public.acquire_single_item_work_claim(uuid,integer,uuid,text,integer)','EXECUTE'),'service_role não herda EXECUTE da ACL default');
SELECT ok(has_function_privilege('authenticated','public.acquire_single_item_work_claim(uuid,integer,uuid,text,integer)','EXECUTE'),'authenticated mantém EXECUTE efetivo');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
 WHERE p.oid='public.acquire_single_item_work_claim(uuid,integer,uuid,text,integer)'::regprocedure
 AND a.grantee=0 AND a.privilege_type='EXECUTE'),'PUBLIC sem EXECUTE');
SELECT is((SELECT proconfig::text FROM pg_proc WHERE oid='public.acquire_single_item_work_claim(uuid,integer,uuid,text,integer)'::regprocedure),'{search_path=pg_catalog}','search_path fixo');

-- Toda fixture abaixo tem alvo novo. Nenhuma aquisição global prévia o bloqueia.
CREATE FUNCTION pg_temp.fresh_single(label text, classified boolean DEFAULT true) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m uuid:=gen_random_uuid(); w uuid; base public.work_items;
BEGIN
 SELECT * INTO base FROM public.work_items WHERE id=(SELECT id FROM pg_temp.item);
 INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES(m,auth.uid(),'user',label);
 SELECT (public.create_work_proposal(m,'low','programming',
   jsonb_set(base.intent,'{execution_spec,target,reference}',to_jsonb(label)),base.proposal)).id INTO w;
 PERFORM public.resolve_approval(w,1,'approve','{}');
 IF classified THEN PERFORM public.record_work_intelligence_classification(w,1,0,
   (SELECT payload#>'{data,classification}' FROM public.work_events WHERE work_item_id=base.id AND event_type='work_intelligence_classified' ORDER BY seq DESC LIMIT 1)); END IF;
 RETURN w;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000000',true);
CREATE TEMP TABLE probe AS SELECT pg_temp.fresh_single('single-rpc-lock-probe') id;
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_locks l WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted AND objsubid=1
 AND classid::bigint=((hashtextextended('work_target:a1000000-0000-0000-0000-000000000000:single-rpc-lock-probe',0)>>32)&4294967295::bigint)
 AND objid::bigint=(hashtextextended('work_target:a1000000-0000-0000-0000-000000000000:single-rpc-lock-probe',0)&4294967295::bigint)),'alvo novo não tinha lock antes da RPC scoped');
SELECT public.acquire_single_item_work_claim((SELECT id FROM probe),1,'a1000000-0000-0000-0000-0000000000d1','probe',300);
SELECT ok(EXISTS(SELECT 1 FROM pg_locks l WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted AND objsubid=1
 AND classid::bigint=((hashtextextended('work_target:a1000000-0000-0000-0000-000000000000:single-rpc-lock-probe',0)>>32)&4294967295::bigint)
 AND objid::bigint=(hashtextextended('work_target:a1000000-0000-0000-0000-000000000000:single-rpc-lock-probe',0)&4294967295::bigint)),'somente nova RPC adquiriu e reteve este lock após retorno');
CREATE TEMP TABLE missing AS SELECT pg_temp.fresh_single('missing-intelligence',false) id;
SELECT throws_ok($$SELECT public.acquire_single_item_work_claim((SELECT id FROM missing),1,'a1000000-0000-0000-0000-0000000000d2','probe',300)$$,'55000','work_intelligence_classification_missing','classificação ausente recusa claim');
SELECT public.record_work_intelligence_classification((SELECT id FROM missing),1,0,:'intel'::jsonb);
SELECT public.record_work_intelligence_classification((SELECT id FROM missing),1,1,jsonb_set(:'intel'::jsonb,'{risk}','"unknown"'));
SELECT throws_ok($$SELECT public.acquire_single_item_work_claim((SELECT id FROM missing),1,'a1000000-0000-0000-0000-0000000000d2','probe',300)$$,'55000','work_intelligence_classification_incomplete','nova classificação revoga elegibilidade sem apagar histórico');
-- Revogação entre aquisição e início: preservar claim sem attempt parcial.
SELECT pg_temp.record_test_route((SELECT id FROM probe),'a1000000-0000-0000-0000-0000000000d5');
SELECT public.record_work_intelligence_classification((SELECT id FROM probe),1,1,jsonb_set(:'intel'::jsonb,'{risk}','"unknown"'));
SELECT throws_ok($$SELECT public.start_claimed_work_attempt('a1000000-0000-0000-0000-0000000000d1','a1000000-0000-0000-0000-0000000000d5','local-runner-v1')$$,'55000','work_intelligence_classification_incomplete','revogação após claim recusa início');
SELECT is((SELECT attempt_id FROM public.work_claims WHERE id='a1000000-0000-0000-0000-0000000000d1'),NULL::uuid,'revogação desfaz ligação da attempt');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM probe) AND event_type='execution_started'),0::bigint,'revogação não deixa execution_started');
SELECT public.record_work_intelligence_classification((SELECT id FROM probe),1,2,:'intel'::jsonb);
-- Vencimento próprio permite substituição auditável, sem manutenção alheia.
RESET ROLE;
UPDATE public.work_claims SET acquired_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id='a1000000-0000-0000-0000-0000000000d1';
SET LOCAL ROLE authenticated;
SELECT public.acquire_single_item_work_claim((SELECT id FROM probe),1,'a1000000-0000-0000-0000-0000000000d3','probe',300);
SELECT is((SELECT release_reason FROM public.work_claims WHERE id='a1000000-0000-0000-0000-0000000000d1'),'expired','claim próprio vencido preservado e liberado');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM probe) AND event_type='work_claim_released'),1::bigint,'uma liberação própria auditável');
CREATE TEMP TABLE occupied AS SELECT pg_temp.fresh_single('occupied-no-claim') id;
CREATE TEMP TABLE candidate AS SELECT pg_temp.fresh_single('occupied-no-claim') id;
RESET ROLE;
UPDATE public.work_items SET state='in_progress' WHERE id=(SELECT id FROM occupied);
CREATE TEMP TABLE occupied_before AS SELECT to_jsonb(i) row FROM public.work_items i WHERE id=(SELECT id FROM occupied);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.acquire_single_item_work_claim((SELECT id FROM candidate),1,'a1000000-0000-0000-0000-0000000000d4','probe',300)$$,'55000','work target is busy with a running attempt','execução alheia sem claim recusa');
RESET ROLE;
SELECT is((SELECT to_jsonb(i) FROM public.work_items i WHERE id=(SELECT id FROM occupied)),(SELECT row FROM occupied_before),'execução alheia intacta');
SELECT is((SELECT count(*) FROM public.work_claims WHERE work_item_id IN ((SELECT id FROM occupied),(SELECT id FROM candidate))),0::bigint,'ocupação não cria claims');
-- Mesmo alvo textual, usuários distintos: locks/claims são owner-scoped.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2000000-0000-0000-0000-000000000000',true);
CREATE TEMP TABLE user_two AS SELECT pg_temp.fresh_single('single-rpc-lock-probe') id;
SELECT lives_ok($$SELECT public.acquire_single_item_work_claim((SELECT id FROM user_two),1,'a2000000-0000-0000-0000-0000000000d1','probe-user-two',300)$$,'outro owner adquire mesmo alvo textual');
SELECT is((SELECT count(*) FROM public.work_claims WHERE target_reference='single-rpc-lock-probe' AND released_at IS NULL),1::bigint,'RLS revela somente claim próprio');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.work_claims WHERE target_reference='single-rpc-lock-probe' AND released_at IS NULL),2::bigint,'dois owners coexistem no alvo textual');

-- Consumo de autoridade: somente fatos sintéticos, todos os triggers habilitados.
-- Não é autorização de retomada do produto: o Supervisor continua recusando histórico.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000000',true);
SELECT public.release_work_claim('a1000000-0000-0000-0000-0000000000b2','released_without_attempt');
RESET ROLE;
UPDATE public.work_items SET state='in_progress' WHERE id=(SELECT id FROM item);
SET LOCAL ROLE authenticated;
SELECT public.record_commanded_work_terminal((SELECT id FROM item),1,'a1000000-0000-0000-0000-0000000000c1',
 jsonb_build_object('kind','error','workItemId',(SELECT id FROM item),'attemptId','a1000000-0000-0000-0000-0000000000c1',
 'approvedProposalVersion',1,'origin','executor','sequence',1,'message','falha sintética','handoffReference','proof/synthetic','code','proof_failure','retryable',true));
RESET ROLE;
UPDATE public.work_items SET state='approved' WHERE id=(SELECT id FROM item);
SET LOCAL ROLE authenticated;
SELECT public.block_work_on_budget((SELECT id FROM item));
CREATE TEMP TABLE authority AS SELECT jsonb_build_object('schemaVersion',1,'kind','budget_blocked_attempt_v1',
 'requestId','a1000000-0000-0000-0000-0000000000e0','reason','Autorizo uma única attempt sintética neste teste.',
 'additionalAttempts',1,'expectedBudgetReason','item_attempt_budget_exhausted') value;
SELECT public.authorize_work_resume((SELECT id FROM item),1,(SELECT value FROM authority));
SELECT is((SELECT count(*) FROM public.work_budget_resume_authorizations WHERE work_item_id=(SELECT id FROM item) AND consumed_at IS NULL),1::bigint,'uma autorização disponível');
SELECT public.acquire_single_item_work_claim((SELECT id FROM item),1,'a1000000-0000-0000-0000-0000000000b3','single',300);
SELECT pg_temp.record_test_route((SELECT id FROM item),'a1000000-0000-0000-0000-0000000000c3');
SELECT lives_ok($$SELECT public.start_claimed_work_attempt('a1000000-0000-0000-0000-0000000000b3','a1000000-0000-0000-0000-0000000000c3','local-runner-v1')$$,'uma admissão adicional autorizada');
CREATE TEMP TABLE consumed AS SELECT to_jsonb(a) row FROM public.work_budget_resume_authorizations a WHERE work_item_id=(SELECT id FROM item);
SELECT is((SELECT consumed_attempt_id FROM public.work_budget_resume_authorizations WHERE work_item_id=(SELECT id FROM item)),'a1000000-0000-0000-0000-0000000000c3'::uuid,'consumo ligado à attempt');
SELECT lives_ok($$SELECT public.start_claimed_work_attempt('a1000000-0000-0000-0000-0000000000b3','a1000000-0000-0000-0000-0000000000c3','local-runner-v1')$$,'replay não consome novamente');
SELECT is((SELECT to_jsonb(a) FROM public.work_budget_resume_authorizations a WHERE work_item_id=(SELECT id FROM item)),(SELECT row FROM consumed),'ledger idêntico após replay');
SELECT public.record_commanded_work_terminal((SELECT id FROM item),1,'a1000000-0000-0000-0000-0000000000c3',
 jsonb_build_object('kind','error','workItemId',(SELECT id FROM item),'attemptId','a1000000-0000-0000-0000-0000000000c3',
 'approvedProposalVersion',1,'origin','executor','sequence',1,'message','falha sintética','handoffReference','proof/synthetic','code','proof_failure','retryable',true));
SELECT public.release_work_claim('a1000000-0000-0000-0000-0000000000b3','attempt_finished');
RESET ROLE;
UPDATE public.work_items SET state='approved' WHERE id=(SELECT id FROM item);
SET LOCAL ROLE authenticated;
SELECT public.acquire_single_item_work_claim((SELECT id FROM item),1,'a1000000-0000-0000-0000-0000000000b4','single',300);
SELECT pg_temp.record_test_route((SELECT id FROM item),'a1000000-0000-0000-0000-0000000000c4');
SELECT throws_ok($$SELECT public.start_claimed_work_attempt('a1000000-0000-0000-0000-0000000000b4','a1000000-0000-0000-0000-0000000000c4','local-runner-v1')$$,'P0001','item_attempt_budget_exhausted','token consumido não autoriza outra attempt');
SELECT is((SELECT to_jsonb(a) FROM public.work_budget_resume_authorizations a WHERE work_item_id=(SELECT id FROM item)),(SELECT row FROM consumed),'recusa preserva ledger integral');
SELECT is((SELECT attempt_id FROM public.work_claims WHERE id='a1000000-0000-0000-0000-0000000000b4'),NULL::uuid,'recusa sem associação parcial');
SELECT * FROM finish();
RESET ROLE;
ROLLBACK;
