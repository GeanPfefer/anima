BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(14);

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- user1: dono, na allowlist.  user2: autenticado, SEM allowlist (autoridade).
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
  ('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','wd1@test.invalid','',now(),'{}','{}',now(),now()),
  ('a2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','wd2@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
  ('c1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','user','fixture withdraw');
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason) VALUES
  ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','withdraw pgTAP');

-- Itens do user1: approved (retirável), in_progress (executando), proposed.
INSERT INTO public.work_items(id,user_id,source_message_id,state,impact_level,capability,original_request,intent,proposal,proposal_version) VALUES
  ('b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','approved','low','programming','fixture',
    '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":[],"validation_criteria":[{"label":"test","command":"npm test"}],"limits":{"max_attempts":2}}}'::jsonb,
    '{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["x"],"excluded_scope":["y"],"expected_effects":["e"],"risks":[]}}'::jsonb,2),
  ('b2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','in_progress','low','programming','fixture',
    '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":[],"validation_criteria":[{"label":"test","command":"npm test"}],"limits":{"max_attempts":2}}}'::jsonb,
    '{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["x"],"excluded_scope":["y"],"expected_effects":["e"],"risks":[]}}'::jsonb,2),
  ('b3000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','proposed','low','programming','fixture',
    '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":[],"validation_criteria":[{"label":"test","command":"npm test"}],"limits":{"max_attempts":2}}}'::jsonb,
    '{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["x"],"excluded_scope":["y"],"expected_effects":["e"],"risks":[]}}'::jsonb,1),
  ('b4000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','approved','low','programming','fixture',
    '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":[],"validation_criteria":[{"label":"test","command":"npm test"}],"limits":{"max_attempts":2}}}'::jsonb,
    '{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["x"],"excluded_scope":["y"],"expected_effects":["e"],"risks":[]}}'::jsonb,2);
-- Histórico append-only do item approved (a decisão de aprovação permanece consultável).
INSERT INTO public.work_events(id,work_item_id,event_type,author,proposal_version,payload) VALUES
  ('e1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','work_approved','user',2,'{"schema_version":1,"data":{"decision":"approve","decided_proposal_version":2}}');

-- ── Contrato ──────────────────────────────────────────────────────────────────
SELECT has_function('public','withdraw_approved_work',ARRAY['uuid','integer','text'],'RPC de retirada existe');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);

-- CASO A — approved + nenhuma execução ⇒ retirada permitida.
SELECT is((public.withdraw_approved_work('b1000000-0000-4000-8000-000000000001',2,'plano obsoleto antes da execução após evolução do contrato de verificação')).state::text,'cancelled','CASO A: approved retirável vira cancelled');
SELECT is((SELECT count(*)::text FROM public.work_events WHERE work_item_id='b1000000-0000-4000-8000-000000000001' AND event_type='work_cancelled' AND payload->'data'->>'withdrawn_before_execution'='true'),'1','CASO A: evento work_cancelled de retirada registrado');
SELECT is((SELECT payload->'data'->>'withdrawn_from_state' FROM public.work_events WHERE work_item_id='b1000000-0000-4000-8000-000000000001' AND event_type='work_cancelled'),'approved','CASO A: estado anterior preservado na evidência');
SELECT isnt((SELECT payload->'data'->>'reason' FROM public.work_events WHERE work_item_id='b1000000-0000-4000-8000-000000000001' AND event_type='work_cancelled'),NULL,'CASO A: reason preservado');

-- CASO H — lineage/história: a decisão de aprovação permanece consultável (append-only).
SELECT is((SELECT count(*)::text FROM public.work_events WHERE work_item_id='b1000000-0000-4000-8000-000000000001' AND event_type='work_approved'),'1','CASO H: histórico da aprovação intacto');

-- CASO E — idempotência: repetir a retirada devolve o mesmo item sem duplicar efeito.
SELECT is((public.withdraw_approved_work('b1000000-0000-4000-8000-000000000001',2,'repetição')).state::text,'cancelled','CASO E: replay devolve cancelled');
SELECT is((SELECT count(*)::text FROM public.work_events WHERE work_item_id='b1000000-0000-4000-8000-000000000001' AND event_type='work_cancelled'),'1','CASO E: replay não duplica evento');

-- CASO B — já executando (in_progress) ⇒ retirada negada (não é plano não iniciado).
SELECT throws_ok($$SELECT public.withdraw_approved_work('b2000000-0000-4000-8000-000000000002',2,'x')$$,'55000',NULL,'CASO B: in_progress não é retirável');

-- CASO C — proposed ⇒ retirada negada (proposta usa reject, não esta via).
SELECT throws_ok($$SELECT public.withdraw_approved_work('b3000000-0000-4000-8000-000000000003',1,'x')$$,'55000',NULL,'CASO C: proposed não é retirável por esta via');

-- Conflito de versão / motivo vazio ⇒ negado (item b4 approved criado nas fixtures).
SELECT throws_ok($$SELECT public.withdraw_approved_work('b4000000-0000-4000-8000-000000000004',999,'x')$$,'55000',NULL,'versão divergente negada');
SELECT throws_ok($$SELECT public.withdraw_approved_work('b4000000-0000-4000-8000-000000000004',2,'   ')$$,'22023',NULL,'motivo vazio negado');
SELECT is((SELECT state::text FROM public.work_items WHERE id='b4000000-0000-4000-8000-000000000004'),'approved','negativas não mudam o estado');

-- CASO F — ator sem allowlist ⇒ negado (autoridade), antes de qualquer efeito.
SELECT set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000002',true);
SELECT throws_ok($$SELECT public.withdraw_approved_work('b4000000-0000-4000-8000-000000000004',2,'x')$$,'42501',NULL,'CASO F: sem allowlist negado');

SELECT * FROM finish();
ROLLBACK;
