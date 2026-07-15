BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(22);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
('41000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','f6a@test.invalid','',now(),'{}','{}',now(),now()),
('41000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','f6b@test.invalid','',now(),'{}','{}',now(),now());
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason) VALUES
('41000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','F6');
RESET ROLE;

SELECT has_table('public','conversation_sessions','sessões existem');
SELECT has_table('public','work_contexts','contextos existem');
SELECT has_function('public','archive_current_conversation',ARRAY[]::text[],'archive existe');
SELECT has_function('public','attach_work_context',ARRAY['uuid','integer','jsonb'],'attach existe');
SELECT ok(NOT has_table_privilege('authenticated','public.ai_conversations','DELETE'),'cliente não apaga conversa');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000001',true);
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('42000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','user','Pedido F6');
SELECT is((SELECT count(*) FROM public.conversation_sessions WHERE archived_at IS NULL),1::bigint,'primeira mensagem cria sessão ativa');
SELECT ok((SELECT session_id IS NOT NULL FROM public.ai_conversations WHERE id='42000000-0000-0000-0000-000000000001'),'mensagem recebe sessão');
CREATE TEMP TABLE old_session AS SELECT session_id AS id FROM public.ai_conversations WHERE id='42000000-0000-0000-0000-000000000001';
GRANT SELECT ON old_session TO authenticated;
SELECT throws_ok($$SELECT public.archive_current_conversation()$$,'55000','conversation turn is still active','arquivar durante turno ativo falha');
SELECT lives_ok($$SELECT public.abandon_current_conversation_turn()$$,'abandono encerra o turno ativo');
SELECT lives_ok($$SELECT public.archive_current_conversation()$$,'arquivamento funciona');
SELECT ok((SELECT archived_at IS NOT NULL FROM public.conversation_sessions WHERE id=(SELECT id FROM old_session)),'sessão anterior é arquivada');
SELECT ok((SELECT id <> (SELECT id FROM old_session) FROM public.conversation_sessions WHERE archived_at IS NULL),'nova sessão é distinta');
SELECT is((SELECT count(*) FROM public.ai_conversations),1::bigint,'mensagem antiga permanece');
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('42000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000001','user','Novo contexto');
SELECT ok((SELECT session_id=(SELECT id FROM public.conversation_sessions WHERE archived_at IS NULL) FROM public.ai_conversations WHERE id='42000000-0000-0000-0000-000000000002'),'nova mensagem usa sessão ativa');
SELECT throws_ok($$DELETE FROM public.ai_conversations WHERE id='42000000-0000-0000-0000-000000000001'$$,'42501',NULL,'delete direto falha');

CREATE FUNCTION pg_temp.proposal() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT '{"schema_version":1,"data":{"summary":"F6","objective":"Contexto","included_scope":["refs"],"excluded_scope":[],"expected_effects":["proveniência"],"risks":[]}}'::jsonb
$$;
CREATE TEMP TABLE item AS SELECT id FROM public.create_work_proposal('42000000-0000-0000-0000-000000000002','low','planning','{}',pg_temp.proposal());
GRANT SELECT ON item TO authenticated;
SELECT is((SELECT jsonb_build_array(version,context_references) FROM public.work_contexts WHERE work_item_id=(SELECT id FROM item)),'[1,[{"kind":"message","id":"42000000-0000-0000-0000-000000000002"}]]'::jsonb,'proposta anexa contexto inicial invariável');
SELECT lives_ok($$SELECT public.attach_work_context((SELECT id FROM item),1,'[{"kind":"message","id":"42000000-0000-0000-0000-000000000002"}]')$$,'anexo adicional funciona');
SELECT is((SELECT jsonb_agg(jsonb_build_array(context.version,event.event_type,event.payload->'data'->>'context_version') ORDER BY context.version) FROM public.work_contexts context JOIN public.work_events event ON event.payload->'data'->>'context_id'=context.id::text WHERE context.work_item_id=(SELECT id FROM item)),'[[1,"context_attached","1"],[2,"context_attached","2"]]'::jsonb,'contextos e eventos preservam versões');
SELECT lives_ok($$SELECT public.attach_work_context((SELECT id FROM item),1,'[{"kind":"document","id":"docs/planos/001-modo-construcao-mvp.md"}]')$$,'terceira versão funciona');
SELECT is((SELECT max(version) FROM public.work_contexts WHERE work_item_id=(SELECT id FROM item)),3,'versão incrementa');
SELECT throws_ok($$SELECT public.attach_work_context((SELECT id FROM item),1,'[]')$$,'22023','invalid context references','contexto vazio falha');

SELECT set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000002',true);
SELECT is((SELECT count(*) FROM public.work_contexts),0::bigint,'outro usuário não vê contextos');

SELECT * FROM finish();
ROLLBACK;
