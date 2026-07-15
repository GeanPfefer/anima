BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
('71000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','evid@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations (id,user_id,role,content) VALUES
('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','user','Pedido evidência');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason) VALUES
('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','evidência');
RESET ROLE;

CREATE FUNCTION pg_temp.proposal() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT '{"schema_version":1,"data":{"summary":"evidência","objective":"provar","included_scope":["db"],"excluded_scope":[],"expected_effects":["prova"],"risks":["nenhum"]}}'::jsonb
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
CREATE TEMP TABLE item AS SELECT id FROM public.create_work_proposal('72000000-0000-0000-0000-000000000001','low','planning','{}',pg_temp.proposal());
GRANT SELECT ON item TO authenticated;
DO $$DECLARE v_id uuid; BEGIN SELECT id INTO v_id FROM item; PERFORM public.resolve_approval(v_id,1,'approve','{}'); PERFORM public.start_work(v_id,1); END$$;

-- Forma fechada: campos desconhecidos e evidências malformadas são rejeitados.
SELECT throws_ok($$SELECT public.submit_work_result((SELECT id FROM item),1,'{"summary":"x","result_references":[],"veredicto_livre":"tudo certo"}')$$,'22023','unexpected result field','campo desconhecido falha');
SELECT throws_ok($$SELECT public.submit_work_result((SELECT id FROM item),1,'{"summary":"x","result_references":[],"validations":"rodei tudo"}')$$,'22023','invalid result validations','validações em texto livre falham');
SELECT throws_ok($$SELECT public.submit_work_result((SELECT id FROM item),1,'{"summary":"x","result_references":[],"validations":[{"label":"npm test","outcome":"acho que passou"}]}')$$,'22023','invalid result validations','outcome fora do vocabulário falha');
SELECT throws_ok($$SELECT public.submit_work_result((SELECT id FROM item),1,'{"summary":"x","result_references":[],"validations":[{"label":"npm test","outcome":"passed","nota":"extra"}]}')$$,'22023','invalid result validations','chave extra na validação falha');
SELECT throws_ok($$SELECT public.submit_work_result((SELECT id FROM item),1,'{"summary":"x","result_references":[],"limitations":[""]}')$$,'22023','invalid result limitations','limitação vazia falha');
SELECT lives_ok($$SELECT public.submit_work_result((SELECT id FROM item),1,'{"summary":"pronto","result_references":["docs/prova.md"],"validations":[{"label":"npm test","outcome":"passed"},{"label":"revisão manual","outcome":"declared"}],"limitations":["sem e2e"]}')$$,'resultado com evidências tipadas funciona');
SELECT is((SELECT payload->'data'->'validations' FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='result_submitted'),'[{"label":"npm test","outcome":"passed"},{"label":"revisão manual","outcome":"declared"}]'::jsonb,'validações persistem como registradas');
SELECT is((SELECT payload->'data'->'limitations' FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='result_submitted'),'["sem e2e"]'::jsonb,'limitações persistem como registradas');

SELECT * FROM finish();
ROLLBACK;
