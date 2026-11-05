BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(15);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
('71000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cf-a@test.invalid','',now(),'{}','{}',now(),now()),
('71000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cf-b@test.invalid','',now(),'{}','{}',now(),now()),
('71000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cf-off@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations (id,user_id,role,content) VALUES
('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','user','Pedido A'),
('72000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000002','user','Pedido B');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason) VALUES
('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','clear focus'),
('71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000002','clear focus');
RESET ROLE;

CREATE TEMP TABLE items(label text PRIMARY KEY,id uuid NOT NULL);
GRANT ALL ON items TO authenticated;
CREATE FUNCTION pg_temp.proposal(label text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT jsonb_build_object('schema_version',1,'data',jsonb_build_object('summary',label,'objective','foco','included_scope',jsonb_build_array('db'),'excluded_scope',jsonb_build_array('ui'),'expected_effects',jsonb_build_array('prova'),'risks',jsonb_build_array('nenhum')))
$$;

SELECT has_function('public','clear_work_focus',ARRAY[]::text[],'clear_work_focus existe');
SELECT ok(has_function_privilege('authenticated','public.clear_work_focus()','EXECUTE'),'authenticated executa');
SELECT ok(NOT has_function_privilege('anon','public.clear_work_focus()','EXECUTE'),'anon não executa');
SELECT ok(NOT has_table_privilege('authenticated','public.work_focus','DELETE'),'authenticated segue sem DELETE direto na tabela');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
INSERT INTO items SELECT 'a',id FROM public.create_work_proposal('72000000-0000-0000-0000-000000000001','significant','programming','{"kind":"build"}',pg_temp.proposal('A'));
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
INSERT INTO items SELECT 'b',id FROM public.create_work_proposal('72000000-0000-0000-0000-000000000002','significant','programming','{"kind":"build"}',pg_temp.proposal('B'));
SELECT public.set_work_focus((SELECT id FROM items WHERE label='b'));
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.set_work_focus((SELECT id FROM items WHERE label='a'));
RESET ROLE;

CREATE TEMP TABLE before_state AS SELECT
  (SELECT count(*) FROM public.work_events) events,
  (SELECT count(*) FROM public.work_contexts) contexts,
  (SELECT md5(string_agg(i::text,'' ORDER BY id)) FROM public.work_items i) items_md5;
GRANT SELECT ON before_state TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT is((SELECT count(*) FROM public.work_focus),1::bigint,'A enxerga somente o próprio foco');
SELECT is(public.clear_work_focus(),true,'A limpa o próprio foco');
SELECT is((SELECT count(*) FROM public.work_focus),0::bigint,'A fica sem foco');
SELECT is(public.clear_work_focus(),false,'segunda limpeza é idempotente (false, sem erro)');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.work_focus WHERE user_id='71000000-0000-0000-0000-000000000002'),1::bigint,'foco de B intacto (isolamento)');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT throws_ok($$SELECT public.clear_work_focus()$$,'42501','work orchestration is not enabled','usuário fora da allowlist é recusado');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($$SELECT public.clear_work_focus()$$,'42501','authentication required','sem autenticação é recusado');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.work_focus WHERE user_id='71000000-0000-0000-0000-000000000002'),1::bigint,'recusas não afetam o foco de B');

SELECT is((SELECT count(*) FROM public.work_events),(SELECT events FROM before_state),'ledger append-only: work_events inalterado');
SELECT is((SELECT count(*) FROM public.work_contexts),(SELECT contexts FROM before_state),'work_contexts inalterado');
SELECT is((SELECT md5(string_agg(i::text,'' ORDER BY id)) FROM public.work_items i),(SELECT items_md5 FROM before_state),'work_items inalterados (estado, versão, updated_at)');

SELECT * FROM finish();
ROLLBACK;
