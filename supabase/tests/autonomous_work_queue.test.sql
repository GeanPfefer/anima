-- SUP-01 — a fila é projeção da fonte de verdade, não estado paralelo.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(28);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('93000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fila@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
SELECT ('93000000-0000-0000-0000-00000000000'||n)::uuid,'93000000-0000-0000-0000-000000000000','user','pedido '||n
FROM generate_series(1,6) AS n;
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('93000000-0000-0000-0000-000000000000');
RESET ROLE;

-- ---------- régua de elegibilidade em SQL espelhando o core ----------
\set spec '{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}'
\set prop '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'
\set intel '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-28T12:00:00Z","classifierId":"test"}}'
SET LOCAL ROLE service_role;
SELECT ok(private.is_autonomously_eligible('approved',:'prop'::jsonb,jsonb_build_object('execution_spec',:'spec'::jsonb)),
  'item aprovado e completo é elegível');
SELECT ok(NOT private.is_autonomously_eligible('proposed',:'prop'::jsonb,jsonb_build_object('execution_spec',:'spec'::jsonb)),
  'item não aprovado não é elegível');
SELECT ok(NOT private.is_autonomously_eligible('approved',:'prop'::jsonb,'{}'::jsonb),
  'sem especificação de execução não é elegível');
SELECT ok(NOT private.is_autonomously_eligible('approved',(:'prop'::jsonb || '{"data":{"summary":"s","objective":"corrigir","included_scope":[],"excluded_scope":["deploy"],"expected_effects":["ok"],"risks":[]}}'::jsonb),jsonb_build_object('execution_spec',:'spec'::jsonb)),
  'escopo incluído vazio não é elegível');
SELECT ok(NOT private.is_autonomously_eligible('approved',:'prop'::jsonb,jsonb_build_object('execution_spec',(:'spec'::jsonb || '{"validation_criteria":[]}'::jsonb))),
  'sem critério de validação não é elegível');
SELECT ok(NOT private.is_autonomously_eligible('approved',:'prop'::jsonb,jsonb_build_object('execution_spec',(:'spec'::jsonb || '{"limits":{"max_attempts":0}}'::jsonb))),
  'limite não positivo não é elegível');
SELECT ok(NOT private.is_autonomously_eligible('approved',:'prop'::jsonb,jsonb_build_object('execution_spec',(:'spec'::jsonb || '{"limits":{}}'::jsonb))),
  'nenhum limite declarado não é elegível');
SELECT ok(private.is_autonomously_eligible('approved',:'prop'::jsonb,jsonb_build_object('execution_spec',(:'spec'::jsonb || '{"limits":{"max_duration_minutes":30}}'::jsonb))),
  'limite apenas de tempo é suficiente');
SELECT ok(NOT private.is_autonomously_eligible('approved',:'prop'::jsonb,jsonb_build_object('execution_spec',(:'spec'::jsonb || '{"permissions":["  "]}'::jsonb))),
  'permissão em branco não é elegível');
SELECT ok(NOT private.is_autonomously_eligible('approved',:'prop'::jsonb,jsonb_build_object('execution_spec',(:'spec'::jsonb || '{"target":{"kind":"planeta","reference":"x"}}'::jsonb))),
  'alvo de tipo desconhecido não é elegível');
-- Entrada malformada falha fechada em vez de levantar exceção.
SELECT ok(NOT private.is_autonomously_eligible('approved',:'prop'::jsonb,'{"execution_spec":"tudo liberado"}'::jsonb),
  'especificação escalar falha fechada');
SELECT ok(NOT private.is_autonomously_eligible('approved',:'prop'::jsonb,jsonb_build_object('execution_spec',(:'spec'::jsonb || '{"validation_criteria":"tests"}'::jsonb))),
  'critérios escalares falham fechado sem erro');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000000',true);

-- ---------- projeção e ordenação ----------
SELECT is((SELECT count(*) FROM public.autonomous_work_queue()),0::bigint,'fila vazia quando nada foi aprovado');

CREATE TEMP TABLE i1 AS SELECT (public.create_work_proposal('93000000-0000-0000-0000-000000000001','low','programming',
  jsonb_build_object('execution_spec',:'spec'::jsonb),:'prop'::jsonb)).id;
CREATE TEMP TABLE i2 AS SELECT (public.create_work_proposal('93000000-0000-0000-0000-000000000002','low','programming',
  jsonb_build_object('execution_spec',(:'spec'::jsonb || '{"target":{"kind":"project","reference":"outro"}}'::jsonb)),:'prop'::jsonb)).id;
CREATE TEMP TABLE i3 AS SELECT (public.create_work_proposal('93000000-0000-0000-0000-000000000003','low','research',
  jsonb_build_object('execution_spec',:'spec'::jsonb),:'prop'::jsonb)).id;

-- Aprovação fora da ordem de criação: a fila segue a aprovação, não a criação.
SELECT public.resolve_approval((SELECT id FROM i3),1,'approve','{}');
SELECT public.resolve_approval((SELECT id FROM i1),1,'approve','{}');
SELECT public.resolve_approval((SELECT id FROM i2),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i1),1,0,:'intel'::jsonb);
SELECT public.record_work_intelligence_classification((SELECT id FROM i2),1,0,:'intel'::jsonb);
SELECT public.record_work_intelligence_classification((SELECT id FROM i3),1,0,:'intel'::jsonb);

SELECT is((SELECT count(*) FROM public.autonomous_work_queue()),3::bigint,'os três itens aprovados entram na fila');
SELECT is((SELECT array_agg(work_item_id ORDER BY queue_position) FROM public.autonomous_work_queue()),
  ARRAY[(SELECT id FROM i3),(SELECT id FROM i1),(SELECT id FROM i2)],
  'ordem FIFO pela aprovação, não pela criação');
SELECT is((SELECT array_agg(queue_position ORDER BY queue_position) FROM public.autonomous_work_queue()),
  ARRAY[1::bigint,2::bigint,3::bigint],'posições contíguas a partir de 1');
SELECT is((SELECT target_reference FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM i2)),
  'outro','o alvo declarado é projetado');
SELECT is((SELECT capability::text FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM i3)),
  'research','a capacidade é projetada');

-- ---------- posse retira e devolve o item ----------
SELECT public.acquire_work_claim((SELECT id FROM i3),1,'93000000-0000-0000-0000-0000000000a1','supervisor-1',300);
SELECT is((SELECT array_agg(work_item_id ORDER BY queue_position) FROM public.autonomous_work_queue()),
  ARRAY[(SELECT id FROM i1),(SELECT id FROM i2)],'item com claim ativo sai da fila');
SET LOCAL ROLE service_role;
UPDATE public.work_claims SET acquired_at=now()-interval '2 hours', expires_at=now()-interval '1 hour'
WHERE id='93000000-0000-0000-0000-0000000000a1';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000000',true);
SELECT is((SELECT array_agg(work_item_id ORDER BY queue_position) FROM public.autonomous_work_queue()),
  ARRAY[(SELECT id FROM i3),(SELECT id FROM i1),(SELECT id FROM i2)],
  'claim expirado devolve o item à fila na posição original');
SELECT public.release_work_claim('93000000-0000-0000-0000-0000000000a1','released_without_attempt');
SELECT is((SELECT count(*) FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM i3)),1::bigint,
  'claim liberado não retém o item');

-- ---------- o item sai da fila sozinho ao deixar de ser elegível ----------
SELECT public.acquire_work_claim((SELECT id FROM i1),1,'93000000-0000-0000-0000-0000000000a2','supervisor-1',300);
SELECT public.start_claimed_work_attempt('93000000-0000-0000-0000-0000000000a2','93000000-0000-0000-0000-0000000000c1','local-runner-v1');
SELECT is((SELECT count(*) FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM i1)),0::bigint,
  'item em execução sai da fila sem intervenção');

-- ---------- a posição segue a aprovação vigente ----------
CREATE TEMP TABLE i4 AS SELECT (public.create_work_proposal('93000000-0000-0000-0000-000000000004','low','programming',
  jsonb_build_object('execution_spec',:'spec'::jsonb),:'prop'::jsonb)).id;
SELECT is((SELECT count(*) FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM i4)),0::bigint,
  'proposta ainda não aprovada não entra na fila');
SELECT public.revise_work_proposal((SELECT id FROM i4),1,jsonb_build_object('execution_spec',:'spec'::jsonb),:'prop'::jsonb);
SELECT is((SELECT count(*) FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM i4)),0::bigint,
  'proposta revisada sem aprovação continua fora da fila');
SELECT public.resolve_approval((SELECT id FROM i4),2,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i4),2,0,:'intel'::jsonb);
SELECT is((SELECT approved_proposal_version FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM i4)),2,
  'a fila referencia a versão aprovada vigente');
SELECT is((SELECT work_item_id FROM public.autonomous_work_queue() ORDER BY queue_position DESC LIMIT 1),(SELECT id FROM i4),
  'a aprovação mais recente ocupa o fim da fila');

-- ---------- a fila é derivada, não armazenada ----------
SELECT is((SELECT count(*) FROM pg_tables WHERE schemaname IN ('public','private') AND tablename LIKE '%queue%'),0::bigint,
  'nenhuma tabela de fila existe: a projeção não tem estado próprio');

-- ---------- fronteira de acesso ----------
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.autonomous_work_queue()$$,'42501',NULL,'sem autenticação a fila é recusada');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
