BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(86);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@test.invalid','',now(),'{}','{}',now(),now()),
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@test.invalid','',now(),'{}','{}',now(),now()),
('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','off@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations (id,user_id,role,content) VALUES
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','user','Pedido A'),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','user','Pedido B'),
('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','assistant','Resposta A'),
('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','user','Pedido fora');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason) VALUES
('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','pgTAP'),
('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','pgTAP');
RESET ROLE;

CREATE TEMP TABLE test_items(label text PRIMARY KEY,id uuid NOT NULL);
GRANT ALL ON test_items TO authenticated;
CREATE FUNCTION pg_temp.proposal(label text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT jsonb_build_object('schema_version',1,'data',jsonb_build_object('summary',label,'objective','testar','included_scope',jsonb_build_array('db'),'excluded_scope',jsonb_build_array('ui'),'expected_effects',jsonb_build_array('prova'),'risks',jsonb_build_array('nenhum')))
$$;

SELECT has_table('public','work_items','work_items existe');
SELECT has_table('public','work_events','work_events existe');
SELECT has_table('private','work_orchestration_allowlist','allowlist existe');
SELECT has_table('private','work_state_transitions','matriz existe');
SELECT has_function('public','create_work_proposal',ARRAY['uuid','work_impact_level','work_capability','jsonb','jsonb'],'create existe');
SELECT has_function('public','revise_work_proposal',ARRAY['uuid','integer','jsonb','jsonb'],'revise existe');
SELECT has_function('public','resolve_approval',ARRAY['uuid','integer','work_approval_decision','jsonb'],'resolve existe');
SELECT has_function('public','start_work',ARRAY['uuid','integer'],'start existe');
SELECT has_function('public','submit_work_result',ARRAY['uuid','integer','jsonb'],'submit existe');
SELECT has_function('public','review_work_result',ARRAY['uuid','integer','work_review_decision','jsonb'],'review existe');

SELECT ok(has_table_privilege('authenticated','public.work_items','SELECT'),'authenticated lê itens');
SELECT ok(NOT has_table_privilege('authenticated','public.work_items','INSERT'),'authenticated não insere itens');
SELECT ok(NOT has_table_privilege('authenticated','public.work_items','UPDATE'),'authenticated não atualiza itens');
SELECT ok(NOT has_table_privilege('authenticated','public.work_items','DELETE'),'authenticated não apaga itens');
SELECT ok(has_table_privilege('authenticated','public.work_events','SELECT'),'authenticated lê eventos');
SELECT ok(NOT has_table_privilege('authenticated','public.work_events','INSERT'),'authenticated não insere eventos');
SELECT ok(NOT has_table_privilege('authenticated','public.work_events','UPDATE'),'authenticated não atualiza eventos');
SELECT ok(NOT has_table_privilege('authenticated','public.work_events','DELETE'),'authenticated não apaga eventos');
SELECT ok(NOT has_table_privilege('anon','public.work_items','SELECT'),'anon não lê itens');
SELECT ok(NOT has_table_privilege('anon','public.work_events','SELECT'),'anon não lê eventos');
SELECT ok(NOT has_schema_privilege('authenticated','private','USAGE'),'authenticated não usa private');
SELECT ok(has_schema_privilege('service_role','private','USAGE'),'service_role usa private');
SELECT ok(has_table_privilege('service_role','private.work_orchestration_allowlist','INSERT'),'service_role administra allowlist');
SELECT ok(has_function_privilege('authenticated','public.create_work_proposal(uuid,work_impact_level,work_capability,jsonb,jsonb)','EXECUTE'),'authenticated executa RPC');
SELECT ok(NOT has_function_privilege('anon','public.create_work_proposal(uuid,work_impact_level,work_capability,jsonb,jsonb)','EXECUTE'),'anon não executa RPC');

SELECT ok(NOT has_function_privilege('authenticated','public.review_work_result(uuid,integer,work_review_decision,jsonb)','EXECUTE'),'authenticated só revisa pela variante versionada');
SELECT ok(NOT has_function_privilege('anon','public.review_work_result(uuid,integer,work_review_decision,jsonb)','EXECUTE'),'anon não revisa resultado');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
SELECT throws_ok($$SELECT public.create_work_proposal('20000000-0000-0000-0000-000000000004','low','planning','{}',pg_temp.proposal('off'))$$,'42501','work orchestration is not enabled','fora da allowlist falha');
SELECT throws_ok($$INSERT INTO public.work_items(user_id,source_message_id,impact_level,capability,original_request,intent,proposal) VALUES('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004','low','planning','x','{}',pg_temp.proposal('x'))$$,'42501',NULL,'insert item direto falha');
SELECT throws_ok($$UPDATE public.work_items SET state='completed'$$,'42501',NULL,'update item direto falha');
SELECT throws_ok($$DELETE FROM public.work_items$$,'42501',NULL,'delete item direto falha');
SELECT throws_ok($$INSERT INTO public.work_events(work_item_id,event_type,author,payload) VALUES(gen_random_uuid(),'work_started','user','{"schema_version":1,"data":{}}')$$,'42501',NULL,'insert evento direto falha');
SELECT throws_ok($$UPDATE public.work_events SET author='system'$$,'42501',NULL,'update evento direto falha');
SELECT throws_ok($$DELETE FROM public.work_events$$,'42501',NULL,'delete evento direto falha');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$INSERT INTO public.work_items(user_id,source_message_id,impact_level,capability,original_request,intent,proposal) VALUES('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004','low','planning','x','{}',pg_temp.proposal('x'))$$,'42501',NULL,'anon não insere item');
SELECT throws_ok($$UPDATE public.work_items SET state='completed'$$,'42501',NULL,'anon não atualiza item');
SELECT throws_ok($$DELETE FROM public.work_items$$,'42501',NULL,'anon não apaga item');
SELECT throws_ok($$INSERT INTO public.work_events(work_item_id,event_type,author,payload) VALUES(gen_random_uuid(),'work_started','user','{"schema_version":1,"data":{}}')$$,'42501',NULL,'anon não insere evento');
SELECT throws_ok($$UPDATE public.work_events SET author='system'$$,'42501',NULL,'anon não atualiza evento');
SELECT throws_ok($$DELETE FROM public.work_events$$,'42501',NULL,'anon não apaga evento');
RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
INSERT INTO test_items SELECT 'base',id FROM public.create_work_proposal('20000000-0000-0000-0000-000000000001','structural','programming','{"goal":"x"}',pg_temp.proposal('base'));
SELECT is((SELECT jsonb_build_array(state,user_id,original_request,proposal_version) FROM public.work_items WHERE id=(SELECT id FROM test_items WHERE label='base')),'["proposed","10000000-0000-0000-0000-000000000001","Pedido A",1]'::jsonb,'criação deriva projeção');
SELECT is((SELECT jsonb_agg(jsonb_build_array(event_type,author,proposal_version) ORDER BY seq) FROM public.work_events WHERE work_item_id=(SELECT id FROM test_items WHERE label='base')),'[["work_proposed","anima",1],["context_attached","anima",1]]'::jsonb,'criação deriva evento e contexto inicial');
SELECT throws_ok($$SELECT public.create_work_proposal('29999999-0000-0000-0000-000000000099','low','planning','{}',pg_temp.proposal('x'))$$,'42501','source message not found or not eligible','mensagem inexistente falha');
SELECT throws_ok($$SELECT public.create_work_proposal('20000000-0000-0000-0000-000000000002','low','planning','{}',pg_temp.proposal('x'))$$,'42501','source message not found or not eligible','mensagem alheia falha');
SELECT throws_ok($$SELECT public.create_work_proposal('20000000-0000-0000-0000-000000000003','low','planning','{}',pg_temp.proposal('x'))$$,'42501','source message not found or not eligible','role assistant falha');

SELECT lives_ok($$SELECT public.revise_work_proposal((SELECT id FROM test_items WHERE label='base'),1,'{"goal":"y"}',pg_temp.proposal('rev'))$$,'revisão funciona');
SELECT is((SELECT proposal_version FROM public.work_items WHERE id=(SELECT id FROM test_items WHERE label='base')),2,'revisão incrementa versão');
SELECT is((SELECT jsonb_build_array(event_type,author,proposal_version) FROM public.work_events WHERE work_item_id=(SELECT id FROM test_items WHERE label='base') AND event_type='proposal_revised'),'["proposal_revised","anima",2]'::jsonb,'revisão deriva evento e versão');
SELECT throws_ok($$SELECT public.revise_work_proposal((SELECT id FROM test_items WHERE label='base'),1,'{}',pg_temp.proposal('stale'))$$,'55000','work item state or proposal version changed','versão stale falha');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM test_items WHERE label='base')),3::bigint,'stale não cria evento');

INSERT INTO test_items SELECT c.label,w.id FROM (VALUES('approve'),('reject'),('changes'),('defer')) c(label) CROSS JOIN LATERAL public.create_work_proposal('20000000-0000-0000-0000-000000000001','significant','architecture',jsonb_build_object('case',c.label),pg_temp.proposal(c.label)) w;
SELECT lives_ok($$SELECT public.resolve_approval((SELECT id FROM test_items WHERE label='approve'),1,'approve','{}')$$,'approve funciona');
SELECT is((SELECT jsonb_build_array(i.state,e.event_type,e.author,e.proposal_version) FROM public.work_items i JOIN public.work_events e ON e.work_item_id=i.id WHERE i.id=(SELECT id FROM test_items WHERE label='approve') AND e.event_type='work_approved'),'["approved","work_approved","user",1]'::jsonb,'approve consistente');
SELECT lives_ok($$SELECT public.resolve_approval((SELECT id FROM test_items WHERE label='reject'),1,'reject','{}')$$,'reject funciona');
SELECT is((SELECT jsonb_build_array(i.state,e.event_type) FROM public.work_items i JOIN public.work_events e ON e.work_item_id=i.id WHERE i.id=(SELECT id FROM test_items WHERE label='reject') AND e.event_type='work_rejected'),'["rejected","work_rejected"]'::jsonb,'reject consistente');
SELECT lives_ok($$SELECT public.resolve_approval((SELECT id FROM test_items WHERE label='changes'),1,'request_changes','{"requested_changes":"detalhar"}')$$,'request_changes funciona');
SELECT is((SELECT jsonb_build_array(i.state,e.event_type) FROM public.work_items i JOIN public.work_events e ON e.work_item_id=i.id WHERE i.id=(SELECT id FROM test_items WHERE label='changes') AND e.event_type='proposal_changes_requested'),'["proposed","proposal_changes_requested"]'::jsonb,'request_changes consistente');
SELECT lives_ok($$SELECT public.resolve_approval((SELECT id FROM test_items WHERE label='defer'),1,'defer','{"reason":"depois"}')$$,'defer funciona');
SELECT is((SELECT jsonb_build_array(i.state,e.event_type) FROM public.work_items i JOIN public.work_events e ON e.work_item_id=i.id WHERE i.id=(SELECT id FROM test_items WHERE label='defer') AND e.event_type='work_deferred'),'["proposed","work_deferred"]'::jsonb,'defer consistente');
SELECT throws_ok($$SELECT public.resolve_approval((SELECT id FROM test_items WHERE label='defer'),1,'invented'::public.work_approval_decision,'{}')$$,'22P02',NULL,'decisão inválida falha no enum');
SELECT throws_ok($$SELECT public.resolve_approval((SELECT id FROM test_items WHERE label='approve'),1,'approve','{}')$$,'55000','work item state or proposal version changed','aprovação repetida falha');

SELECT lives_ok($$SELECT public.start_work((SELECT id FROM test_items WHERE label='approve'),1)$$,'start em approved funciona');
SELECT is((SELECT jsonb_build_array(i.state,e.event_type) FROM public.work_items i JOIN public.work_events e ON e.work_item_id=i.id WHERE i.id=(SELECT id FROM test_items WHERE label='approve') AND e.event_type='work_started'),'["in_progress","work_started"]'::jsonb,'start consistente');
SELECT throws_ok($$SELECT public.start_work((SELECT id FROM test_items WHERE label='defer'),1)$$,'22023','transition not allowed','start em proposed falha');
SELECT throws_ok($$SELECT public.submit_work_result((SELECT id FROM test_items WHERE label='defer'),1,'{"summary":"x","result_references":[]}')$$,'22023','transition not allowed','submit fora de in_progress falha');
SELECT lives_ok($$SELECT public.submit_work_result((SELECT id FROM test_items WHERE label='approve'),1,'{"summary":"feito","result_references":["commit:abc"]}')$$,'submit válido funciona');
SELECT is((SELECT jsonb_build_array(i.state,e.event_type,e.author,e.proposal_version) FROM public.work_items i JOIN public.work_events e ON e.work_item_id=i.id WHERE i.id=(SELECT id FROM test_items WHERE label='approve') AND e.event_type='result_submitted'),'["review","result_submitted","user",1]'::jsonb,'submit consistente');
SELECT lives_ok($$SELECT public.review_work_result_versioned((SELECT id FROM test_items WHERE label='approve'),1,(SELECT id FROM public.work_events WHERE work_item_id=(SELECT id FROM test_items WHERE label='approve') AND event_type='result_submitted' ORDER BY seq DESC LIMIT 1),'request_changes','{"requested_changes":"ajustar evidência"}')$$,'pedido de correção funciona');
SELECT is((SELECT jsonb_build_array(i.state,e.event_type,e.payload->'data'->>'requested_changes') FROM public.work_items i JOIN public.work_events e ON e.work_item_id=i.id WHERE i.id=(SELECT id FROM test_items WHERE label='approve') AND e.event_type='changes_requested'),'["changes_requested","changes_requested","ajustar evidência"]'::jsonb,'correção preserva decisão');
SELECT lives_ok($$SELECT public.start_work((SELECT id FROM test_items WHERE label='approve'),1)$$,'trabalho com correção é retomado');
SELECT lives_ok($$SELECT public.submit_work_result((SELECT id FROM test_items WHERE label='approve'),1,'{"summary":"feito novamente","result_references":["commit:def"]}')$$,'novo resultado preserva o ciclo');
SELECT lives_ok($$SELECT public.review_work_result_versioned((SELECT id FROM test_items WHERE label='approve'),1,(SELECT id FROM public.work_events WHERE work_item_id=(SELECT id FROM test_items WHERE label='approve') AND event_type='result_submitted' ORDER BY seq DESC LIMIT 1),'accept','{}')$$,'aceite funciona');
SELECT is((SELECT jsonb_build_array(i.state,e.event_type,e.payload->'data'?'accepted_result_event_id') FROM public.work_items i JOIN public.work_events e ON e.work_item_id=i.id WHERE i.id=(SELECT id FROM test_items WHERE label='approve') AND e.event_type='result_accepted'),'["completed","result_accepted",true]'::jsonb,'aceite conclui e referencia resultado');
SELECT throws_ok($$SELECT public.review_work_result_versioned((SELECT id FROM test_items WHERE label='approve'),1,(SELECT id FROM public.work_events WHERE work_item_id=(SELECT id FROM test_items WHERE label='approve') AND event_type='result_submitted' ORDER BY seq DESC LIMIT 1),'accept','{}')$$,'55000','work item state or proposal version changed','aceite repetido falha');

-- Estados de retomada previstos na matriz são comprovados separadamente.
INSERT INTO test_items SELECT c.label,w.id FROM (VALUES('blocked'),('changes-state')) c(label) CROSS JOIN LATERAL public.create_work_proposal('20000000-0000-0000-0000-000000000001','low','planning',jsonb_build_object('case',c.label),pg_temp.proposal(c.label)) w;
DO $$DECLARE v_id uuid; BEGIN FOR v_id IN SELECT id FROM test_items WHERE label IN ('blocked','changes-state') LOOP PERFORM public.resolve_approval(v_id,1,'approve','{}'); END LOOP; END$$;
RESET ROLE;
UPDATE public.work_items SET state='blocked' WHERE id=(SELECT id FROM test_items WHERE label='blocked');
UPDATE public.work_items SET state='changes_requested' WHERE id=(SELECT id FROM test_items WHERE label='changes-state');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT lives_ok($$SELECT public.start_work((SELECT id FROM test_items WHERE label='blocked'),1)$$,'start funciona em blocked');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM test_items WHERE label='blocked')),'in_progress','blocked avança para in_progress');
SELECT lives_ok($$SELECT public.start_work((SELECT id FROM test_items WHERE label='changes-state'),1)$$,'start funciona em changes_requested');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM test_items WHERE label='changes-state')),'in_progress','changes_requested avança para in_progress');

SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
INSERT INTO test_items SELECT 'user-b',id FROM public.create_work_proposal('20000000-0000-0000-0000-000000000002','low','organization','{}',pg_temp.proposal('b'));
SELECT is((SELECT count(*) FROM public.work_items),1::bigint,'B vê apenas seu item');
SELECT is((SELECT count(*) FROM public.work_events),2::bigint,'B vê apenas seus eventos');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT ok(NOT EXISTS(SELECT 1 FROM public.work_items WHERE id=(SELECT id FROM test_items WHERE label='user-b')),'A não vê item de B');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.work_events WHERE work_item_id=(SELECT id FROM test_items WHERE label='user-b')),'A não vê evento de B');

RESET ROLE;
CREATE FUNCTION pg_temp.fail_event() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'controlled event failure'; END$$;
CREATE TRIGGER test_fail_event BEFORE INSERT ON public.work_events FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_event();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT throws_ok($$SELECT public.create_work_proposal('20000000-0000-0000-0000-000000000001','low','planning','{"rollback":true}',pg_temp.proposal('rollback'))$$,'P0001','controlled event failure','falha de evento aborta criação');
RESET ROLE; DROP TRIGGER test_fail_event ON public.work_events;
SELECT is((SELECT count(*) FROM public.work_items WHERE intent @> '{"rollback":true}'),0::bigint,'criação reverte integralmente');
CREATE TRIGGER test_fail_event BEFORE INSERT ON public.work_events FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_event();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT throws_ok($$SELECT public.resolve_approval((SELECT id FROM test_items WHERE label='defer'),1,'approve','{}')$$,'P0001','controlled event failure','falha de evento aborta atualização');
RESET ROLE; DROP TRIGGER test_fail_event ON public.work_events;
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM test_items WHERE label='defer')),'proposed','projeção reverte integralmente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM test_items WHERE label='defer')),3::bigint,'log não recebe parcial');

SELECT * FROM finish();
ROLLBACK;
