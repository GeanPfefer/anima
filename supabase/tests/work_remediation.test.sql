BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(31);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
('61000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rem-a@test.invalid','',now(),'{}','{}',now(),now()),
('61000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rem-b@test.invalid','',now(),'{}','{}',now(),now()),
('61000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rem-off@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations (id,user_id,role,content) VALUES
('62000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','user','Pedido remediação'),
('62000000-0000-0000-0000-000000000002','61000000-0000-0000-0000-000000000001','user','Segundo pedido'),
('62000000-0000-0000-0000-000000000003','61000000-0000-0000-0000-000000000002','user','Pedido de B');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason) VALUES
('61000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','remediação'),
('61000000-0000-0000-0000-000000000002','61000000-0000-0000-0000-000000000002','remediação');
RESET ROLE;

SELECT has_function('public','request_work_proposal_revision',ARRAY['uuid','integer','text','jsonb','jsonb'],'revisão de proposta existe');
SELECT has_function('public','review_work_result_versioned',ARRAY['uuid','integer','uuid','work_review_decision','jsonb'],'revisão versionada de resultado existe');
SELECT has_function('public','set_work_focus',ARRAY['uuid'],'foco existe');
SELECT has_function('public','abandon_current_conversation_turn',ARRAY[]::text[],'abandono de turno existe');
SELECT has_table('public','work_focus','work_focus existe');
SELECT ok(has_table_privilege('authenticated','public.work_focus','SELECT'),'authenticated lê foco');
SELECT ok(NOT has_table_privilege('authenticated','public.work_focus','INSERT'),'authenticated não insere foco');
SELECT ok(NOT has_table_privilege('authenticated','public.work_focus','UPDATE'),'authenticated não atualiza foco');
SELECT ok(NOT has_table_privilege('authenticated','public.work_focus','DELETE'),'authenticated não apaga foco');

CREATE TEMP TABLE items(label text PRIMARY KEY,id uuid NOT NULL);
GRANT ALL ON items TO authenticated;
CREATE FUNCTION pg_temp.proposal(label text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT jsonb_build_object('schema_version',1,'data',jsonb_build_object('summary',label,'objective','remediar','included_scope',jsonb_build_array('db'),'excluded_scope',jsonb_build_array('ui'),'expected_effects',jsonb_build_array('prova'),'risks',jsonb_build_array('nenhum')))
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','61000000-0000-0000-0000-000000000001',true);

-- Turno de conversa: mensagem do usuário abre, resposta do Anima encerra.
SELECT ok((SELECT active_turn_started_at IS NOT NULL FROM public.conversation_sessions WHERE user_id='61000000-0000-0000-0000-000000000001' AND archived_at IS NULL),'mensagem do usuário abre turno');
INSERT INTO public.ai_conversations(user_id,role,content) VALUES('61000000-0000-0000-0000-000000000001','assistant','Resposta');
SELECT ok((SELECT active_turn_started_at IS NULL FROM public.conversation_sessions WHERE user_id='61000000-0000-0000-0000-000000000001' AND archived_at IS NULL),'resposta do Anima encerra o turno');

-- Revisão de proposta: pedido e nova versão são atômicos e coerentes.
INSERT INTO items SELECT 'alvo',id FROM public.create_work_proposal('62000000-0000-0000-0000-000000000001','significant','programming','{"kind":"build"}',pg_temp.proposal('v1'));
SELECT lives_ok($$SELECT public.request_work_proposal_revision((SELECT id FROM items WHERE label='alvo'),1,'Reduzir escopo','{"kind":"build","revision_feedback":"Reduzir escopo"}',pg_temp.proposal('v2'))$$,'revisão coerente funciona');
SELECT is((SELECT jsonb_build_array(state,proposal_version) FROM public.work_items WHERE id=(SELECT id FROM items WHERE label='alvo')),'["proposed",2]'::jsonb,'revisão mantém proposto e incrementa versão');
SELECT is((SELECT jsonb_agg(jsonb_build_array(event_type,author,proposal_version) ORDER BY seq) FROM public.work_events WHERE work_item_id=(SELECT id FROM items WHERE label='alvo')),'[["work_proposed","anima",1],["context_attached","anima",1],["proposal_changes_requested","user",1],["proposal_revised","anima",2]]'::jsonb,'revisão registra pedido e nova proposta atomicamente');
SELECT is((SELECT jsonb_build_array(payload->'data'->>'requested_changes',payload->'data'->>'reviewed_proposal_version') FROM public.work_events WHERE work_item_id=(SELECT id FROM items WHERE label='alvo') AND event_type='proposal_changes_requested'),'["Reduzir escopo","1"]'::jsonb,'pedido de correção referencia a versão revisada');
SELECT throws_ok($$SELECT public.request_work_proposal_revision((SELECT id FROM items WHERE label='alvo'),1,'de novo','{}',pg_temp.proposal('v3'))$$,'55000','work item state or proposal version changed','revisão stale falha');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM items WHERE label='alvo')),4::bigint,'revisão stale não persiste parcial');
SELECT throws_ok($$SELECT public.request_work_proposal_revision((SELECT id FROM items WHERE label='alvo'),2,'   ','{}',pg_temp.proposal('v3'))$$,'22023','invalid proposal revision input','correção vazia falha');
SELECT set_config('request.jwt.claim.sub','61000000-0000-0000-0000-000000000002',true);
SELECT throws_ok($$SELECT public.request_work_proposal_revision((SELECT id FROM items WHERE label='alvo'),2,'meu palpite','{}',pg_temp.proposal('vx'))$$,'P0002','work item not found','revisão alheia falha');
SELECT set_config('request.jwt.claim.sub','61000000-0000-0000-0000-000000000001',true);

-- Revisão de resultado exige a versão exata do resultado apresentado.
DO $$DECLARE v_id uuid; BEGIN SELECT id INTO v_id FROM items WHERE label='alvo'; PERFORM public.resolve_approval(v_id,2,'approve','{}'); PERFORM public.start_work(v_id,2); PERFORM public.submit_work_result(v_id,2,'{"summary":"pronto","result_references":["docs/prova.md"]}'); END$$;
SELECT throws_ok($$SELECT public.review_work_result_versioned((SELECT id FROM items WHERE label='alvo'),2,gen_random_uuid(),'accept','{}')$$,'55000','reviewed result changed','revisar resultado divergente falha');
SELECT lives_ok($$SELECT public.review_work_result_versioned((SELECT id FROM items WHERE label='alvo'),2,(SELECT id FROM public.work_events WHERE work_item_id=(SELECT id FROM items WHERE label='alvo') AND event_type='result_submitted' ORDER BY seq DESC LIMIT 1),'accept','{}')$$,'aceite versionado funciona');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM items WHERE label='alvo')),'completed','aceite conclui o trabalho');

-- Foco: um por usuário, sem duplicação, nunca em item terminal.
INSERT INTO items SELECT 'foco1',id FROM public.create_work_proposal('62000000-0000-0000-0000-000000000002','low','planning','{}',pg_temp.proposal('foco1'));
INSERT INTO items SELECT 'foco2',id FROM public.create_work_proposal('62000000-0000-0000-0000-000000000001','low','planning','{}',pg_temp.proposal('foco2'));
SELECT lives_ok($$SELECT public.set_work_focus((SELECT id FROM items WHERE label='foco1'))$$,'foco definido');
SELECT is((SELECT work_item_id FROM public.work_focus),(SELECT id FROM items WHERE label='foco1'),'foco aponta para o item escolhido');
SELECT lives_ok($$SELECT public.set_work_focus((SELECT id FROM items WHERE label='foco2'))$$,'troca de foco funciona');
SELECT is((SELECT jsonb_build_array(count(*),bool_and(work_item_id=(SELECT id FROM items WHERE label='foco2'))) FROM public.work_focus),'[1,true]'::jsonb,'troca substitui sem duplicar');
SELECT throws_ok($$SELECT public.set_work_focus((SELECT id FROM items WHERE label='alvo'))$$,'22023','terminal work item cannot receive focus','item terminal não recebe foco');
SELECT set_config('request.jwt.claim.sub','61000000-0000-0000-0000-000000000003',true);
SELECT throws_ok($$SELECT public.set_work_focus((SELECT id FROM items WHERE label='foco2'))$$,'42501','work orchestration is not enabled','foco exige allowlist');
SELECT set_config('request.jwt.claim.sub','61000000-0000-0000-0000-000000000002',true);
SELECT throws_ok($$SELECT public.set_work_focus((SELECT id FROM items WHERE label='foco2'))$$,'P0002','work item not found','foco alheio falha');

-- Estado terminal remove o foco automaticamente.
INSERT INTO items SELECT 'foco-b',id FROM public.create_work_proposal('62000000-0000-0000-0000-000000000003','low','planning','{}',pg_temp.proposal('foco-b'));
SELECT lives_ok($$SELECT public.set_work_focus((SELECT id FROM items WHERE label='foco-b'))$$,'B define foco próprio');
DO $$BEGIN PERFORM public.resolve_approval((SELECT id FROM items WHERE label='foco-b'),1,'reject','{}'); END$$;
SELECT is((SELECT count(*) FROM public.work_focus),0::bigint,'estado terminal limpa o foco');

SELECT * FROM finish();
ROLLBACK;
