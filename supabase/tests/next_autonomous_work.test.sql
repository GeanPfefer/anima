-- SUP-02 — a seleção é determinística, explicável e não produz efeito.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(14);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('94000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','selecao@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
SELECT ('94000000-0000-0000-0000-00000000000'||n)::uuid,'94000000-0000-0000-0000-000000000000','user','pedido '||n
FROM generate_series(1,3) AS n;
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('94000000-0000-0000-0000-000000000000');
RESET ROLE;

\set spec '{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}'
\set prop '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'
\set intel '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-28T12:00:00Z","classifierId":"test"}}'

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000000',true);

SELECT is((SELECT count(*) FROM public.next_autonomous_work()),0::bigint,'fila vazia não seleciona nada');

CREATE TEMP TABLE i1 AS SELECT (public.create_work_proposal('94000000-0000-0000-0000-000000000001','low','programming',
  jsonb_build_object('execution_spec',(:'spec'::jsonb || '{"target":{"kind":"project","reference":"alvo-1"}}'::jsonb)),:'prop'::jsonb)).id;
CREATE TEMP TABLE i2 AS SELECT (public.create_work_proposal('94000000-0000-0000-0000-000000000002','low','programming',
  jsonb_build_object('execution_spec',(:'spec'::jsonb || '{"target":{"kind":"project","reference":"alvo-2"}}'::jsonb)),:'prop'::jsonb)).id;
CREATE TEMP TABLE i3 AS SELECT (public.create_work_proposal('94000000-0000-0000-0000-000000000003','low','programming',
  jsonb_build_object('execution_spec',(:'spec'::jsonb || '{"target":{"kind":"project","reference":"alvo-3"}}'::jsonb)),:'prop'::jsonb)).id;

-- Aprovação em ordem diferente da criação: a política segue a aprovação.
SELECT public.resolve_approval((SELECT id FROM i2),1,'approve','{}');
SELECT public.resolve_approval((SELECT id FROM i3),1,'approve','{}');
SELECT public.resolve_approval((SELECT id FROM i1),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i1),1,0,:'intel'::jsonb);
SELECT public.record_work_intelligence_classification((SELECT id FROM i2),1,0,:'intel'::jsonb);
SELECT public.record_work_intelligence_classification((SELECT id FROM i3),1,0,:'intel'::jsonb);

SELECT is((SELECT work_item_id FROM public.next_autonomous_work()),(SELECT id FROM i2),
  'seleciona a aprovação mais antiga, não a criação mais antiga');
SELECT is((SELECT selection_policy FROM public.next_autonomous_work()),'oldest_approval_first',
  'a política escolhida é declarada');
SELECT is((SELECT queue_size FROM public.next_autonomous_work()),3::bigint,'o tamanho da fila justifica a escolha');
SELECT is((SELECT runner_up_approval_seq FROM public.next_autonomous_work()),
  (SELECT approval_seq FROM public.autonomous_work_queue() WHERE queue_position=2),
  'a razão aponta o segundo colocado');
SELECT ok((SELECT approval_seq FROM public.next_autonomous_work()) < (SELECT runner_up_approval_seq FROM public.next_autonomous_work()),
  'o selecionado tem aprovação estritamente mais antiga que o segundo');
SELECT is((SELECT work_item_id FROM public.next_autonomous_work()),
  (SELECT work_item_id FROM public.autonomous_work_queue() WHERE queue_position=1),
  'a seleção é a cabeça da fila projetada');

-- ---------- reprodutibilidade e ausência de efeito ----------
CREATE TEMP TABLE eventos_antes AS SELECT count(*) c FROM public.work_events;
SELECT is((SELECT work_item_id FROM public.next_autonomous_work()),(SELECT work_item_id FROM public.next_autonomous_work()),
  'consultas repetidas escolhem o mesmo item');
SELECT is((SELECT count(*) FROM public.work_events),(SELECT c FROM eventos_antes),
  'selecionar não grava evento: é leitura, não decisão com efeito');
SELECT is((SELECT count(*) FROM public.work_claims),0::bigint,'selecionar não cria claim');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i2)),'approved',
  'selecionar não altera o estado do item');

-- ---------- a seleção acompanha a fila ----------
SELECT public.acquire_work_claim((SELECT id FROM i2),1,'94000000-0000-0000-0000-0000000000a1','supervisor-1',300);
SELECT is((SELECT work_item_id FROM public.next_autonomous_work()),(SELECT id FROM i3),
  'item reivindicado sai da seleção e o próximo assume');
SELECT is((SELECT queue_size FROM public.next_autonomous_work()),2::bigint,'o tamanho da fila reflete a posse');

-- ---------- fronteira de acesso ----------
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.next_autonomous_work()$$,'42501',NULL,'sem autenticação a seleção é recusada');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
