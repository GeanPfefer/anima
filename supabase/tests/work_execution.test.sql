BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(23);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
('81000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','exec-a@test.invalid','',now(),'{}','{}',now(),now()),
('81000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','exec-b@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations (id,user_id,role,content) VALUES
('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','user','Pedido execução'),
('82000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000001','user','Pedido execução 2'),
('82000000-0000-0000-0000-000000000003','81000000-0000-0000-0000-000000000001','user','Pedido execução 3');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason) VALUES
('81000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','execução'),
('81000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000002','execução');
RESET ROLE;

SELECT has_function('public','start_work_execution',ARRAY['uuid','integer','uuid','text'],'início de execução existe');
SELECT has_function('public','finish_work_execution',ARRAY['uuid','integer','uuid','jsonb'],'término de execução existe');

CREATE TEMP TABLE items(label text PRIMARY KEY,id uuid NOT NULL);
GRANT ALL ON items TO authenticated;
CREATE FUNCTION pg_temp.proposal(label text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT jsonb_build_object('schema_version',1,'data',jsonb_build_object('summary',label,'objective','executar','included_scope',jsonb_build_array('db'),'excluded_scope',jsonb_build_array('ui'),'expected_effects',jsonb_build_array('prova'),'risks',jsonb_build_array('nenhum')))
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
INSERT INTO items SELECT 'alvo',id FROM public.create_work_proposal('82000000-0000-0000-0000-000000000001','significant','programming','{}',pg_temp.proposal('alvo'));

-- Início exige item em execução (in_progress) na versão observada.
SELECT throws_ok($$SELECT public.start_work_execution((SELECT id FROM items WHERE label='alvo'),1,'83000000-0000-0000-0000-000000000001','fake')$$,'55000','work item state or proposal version changed','início fora de in_progress falha');
DO $$DECLARE v_id uuid; BEGIN SELECT id INTO v_id FROM items WHERE label='alvo'; PERFORM public.resolve_approval(v_id,1,'approve','{}'); PERFORM public.start_work(v_id,1); END$$;
SELECT lives_ok($$SELECT public.start_work_execution((SELECT id FROM items WHERE label='alvo'),1,'83000000-0000-0000-0000-000000000001','fake')$$,'início persiste');
SELECT is((SELECT jsonb_build_array(event_type,author,proposal_version,payload->'data'->>'executor_id') FROM public.work_events WHERE work_item_id=(SELECT id FROM items WHERE label='alvo') AND event_type='execution_started'),'["execution_started","anima",1,"fake"]'::jsonb,'início correlaciona executor, versão e item');
SELECT lives_ok($$SELECT public.start_work_execution((SELECT id FROM items WHERE label='alvo'),1,'83000000-0000-0000-0000-000000000001','fake')$$,'início repetido é idempotente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM items WHERE label='alvo') AND event_type='execution_started'),1::bigint,'início repetido não duplica evento');
SELECT throws_ok($$SELECT public.start_work_execution((SELECT id FROM items WHERE label='alvo'),1,'83000000-0000-0000-0000-000000000099','fake')$$,'55000','another execution is still open','segunda execução concorrente falha');

-- Término malformado ou divergente é rejeitado.
SELECT throws_ok($$SELECT public.finish_work_execution((SELECT id FROM items WHERE label='alvo'),1,'83000000-0000-0000-0000-000000000001','{"kind":"succeeded","executor_id":"fake","attempts":1}')$$,'22023','invalid execution outcome','sucesso sem resumo falha');
SELECT throws_ok($$SELECT public.finish_work_execution((SELECT id FROM items WHERE label='alvo'),1,'83000000-0000-0000-0000-000000000001','{"kind":"succeeded","executor_id":"outro","attempts":1,"summary":"x","result_references":[]}')$$,'22023','executor does not match execution','executor divergente falha');
SELECT throws_ok($$SELECT public.finish_work_execution((SELECT id FROM items WHERE label='alvo'),1,'83000000-0000-0000-0000-000000000077','{"kind":"failed","executor_id":"fake","attempts":1,"message":"x"}')$$,'P0002','execution not found','término sem início falha');

-- Sucesso leva a revisão com resultado assinado pelo executor; o aceite continua humano.
SELECT lives_ok($$SELECT public.finish_work_execution((SELECT id FROM items WHERE label='alvo'),1,'83000000-0000-0000-0000-000000000001','{"kind":"succeeded","executor_id":"fake","attempts":1,"summary":"entregue","result_references":["local:x"]}')$$,'sucesso persiste');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM items WHERE label='alvo')),'review','sucesso leva a revisão, não a conclusão');
SELECT is((SELECT jsonb_build_array(author,payload->'data'->>'summary',payload->'data'->>'execution_id') FROM public.work_events WHERE work_item_id=(SELECT id FROM items WHERE label='alvo') AND event_type='result_submitted'),'["executor","entregue","83000000-0000-0000-0000-000000000001"]'::jsonb,'resultado persistido correlaciona execução');
SELECT lives_ok($$SELECT public.finish_work_execution((SELECT id FROM items WHERE label='alvo'),1,'83000000-0000-0000-0000-000000000001','{"kind":"succeeded","executor_id":"fake","attempts":1,"summary":"entregue","result_references":["local:x"]}')$$,'término repetido idêntico é idempotente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM items WHERE label='alvo') AND event_type='result_submitted'),1::bigint,'término repetido não duplica resultado');
SELECT throws_ok($$SELECT public.finish_work_execution((SELECT id FROM items WHERE label='alvo'),1,'83000000-0000-0000-0000-000000000001','{"kind":"failed","executor_id":"fake","attempts":1,"message":"tardio"}')$$,'55000','execution already finished with a different outcome','desfecho divergente tardio falha');

-- Timeout e cancelamento persistem desfechos terminais tipados.
INSERT INTO items SELECT 'timeout',id FROM public.create_work_proposal('82000000-0000-0000-0000-000000000002','low','planning','{}',pg_temp.proposal('timeout'));
DO $$DECLARE v_id uuid; BEGIN SELECT id INTO v_id FROM items WHERE label='timeout'; PERFORM public.resolve_approval(v_id,1,'approve','{}'); PERFORM public.start_work(v_id,1); PERFORM public.start_work_execution(v_id,1,'83000000-0000-0000-0000-000000000002','fake'); END$$;
SELECT lives_ok($$SELECT public.finish_work_execution((SELECT id FROM items WHERE label='timeout'),1,'83000000-0000-0000-0000-000000000002','{"kind":"timed_out","executor_id":"fake","attempts":2,"terminated_cleanly":false}')$$,'timeout persiste');
SELECT is((SELECT jsonb_build_array(i.state,e.author,e.payload->'data'->>'reason',e.payload->'data'->>'terminated_cleanly') FROM public.work_items i JOIN public.work_events e ON e.work_item_id=i.id AND e.event_type='execution_failed' WHERE i.id=(SELECT id FROM items WHERE label='timeout')),'["failed","executor","timed_out","false"]'::jsonb,'timeout registra encerramento sujo e estado failed');
SELECT throws_ok($$SELECT public.finish_work_execution((SELECT id FROM items WHERE label='timeout'),1,'83000000-0000-0000-0000-000000000002','{"kind":"succeeded","executor_id":"fake","attempts":2,"summary":"tardio","result_references":[]}')$$,'55000','execution already finished with a different outcome','resultado tardio não sobrescreve timeout');

INSERT INTO items SELECT 'cancel',id FROM public.create_work_proposal('82000000-0000-0000-0000-000000000003','low','planning','{}',pg_temp.proposal('cancel'));
DO $$DECLARE v_id uuid; BEGIN SELECT id INTO v_id FROM items WHERE label='cancel'; PERFORM public.resolve_approval(v_id,1,'approve','{}'); PERFORM public.start_work(v_id,1); PERFORM public.start_work_execution(v_id,1,'83000000-0000-0000-0000-000000000003','fake'); END$$;
SELECT lives_ok($$SELECT public.finish_work_execution((SELECT id FROM items WHERE label='cancel'),1,'83000000-0000-0000-0000-000000000003','{"kind":"cancelled","executor_id":"fake","attempts":1,"terminated_cleanly":true}')$$,'cancelamento persiste');
SELECT is((SELECT jsonb_build_array(i.state,e.event_type,e.payload->'data'->>'reason') FROM public.work_items i JOIN public.work_events e ON e.work_item_id=i.id AND e.event_type='work_cancelled' WHERE i.id=(SELECT id FROM items WHERE label='cancel')),'["cancelled","work_cancelled","execution_cancelled"]'::jsonb,'cancelamento encerra o item com proveniência');

-- Outro usuário não enxerga nem encerra execuções alheias.
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000002',true);
SELECT throws_ok($$SELECT public.finish_work_execution((SELECT id FROM items WHERE label='cancel'),1,'83000000-0000-0000-0000-000000000003','{"kind":"cancelled","executor_id":"fake","attempts":1,"terminated_cleanly":true}')$$,'P0002','work item not found','término alheio falha');

SELECT * FROM finish();
ROLLBACK;
