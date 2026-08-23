-- Auto-aprovação autônoma: honestidade de autoria (system, nunca user), guarda canônica,
-- idempotência, integração com a fila existente (author-agnóstica) e fronteiras de acesso.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(17);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('a4000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','autoapprove@test.invalid','',now(),'{}','{}',now(),now()),
('a4000000-0000-0000-0000-0000000000ff','00000000-0000-0000-0000-000000000000','authenticated','authenticated','naoallow@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
SELECT ('a4000000-0000-0000-0000-00000000000'||n)::uuid,'a4000000-0000-0000-0000-000000000000','user','pedido '||n
FROM generate_series(1,6) AS n;
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('a4000000-0000-0000-0000-000000000000');
RESET ROLE;

\set spec '{"schema_version":1,"target":{"kind":"project","reference":"anima"},"executor":"worktree","coder_backend":"ollama","base_sha":"abc123","permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"t","command":"npm test"}],"limits":{"max_attempts":3,"max_duration_minutes":30}}'
\set prov '{"kind":"canonical_backlog","sourceId":"FIX-01","document":"docs/x.md","heading":"FIX-01","canonicalObjective":"obj","planningGeneration":1,"materializationReason":"selected_ready"}'
\set provbad '{"kind":"canonical_backlog","sourceId":"FIX-01","document":"docs/x.md","heading":"FIX-01","canonicalObjective":"obj","planningGeneration":1,"materializationReason":"hand_written"}'
\set prov5 '{"kind":"canonical_backlog","sourceId":"FIX-05","document":"docs/x.md","heading":"FIX-05","canonicalObjective":"obj","planningGeneration":1,"materializationReason":"selected_ready"}'
\set prop '{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["docs/x.md"],"excluded_scope":["deploy"],"expected_effects":["e"],"risks":[]}}'
\set env '{"envelope_version":1,"authority":"autonomous_policy","source_id":"FIX-01","checks":["state_proposed","governor_permit"]}'
\set intel '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-28T12:00:00Z","classifierId":"test"}}'

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a4000000-0000-0000-0000-000000000000',true);

-- Item local canônico proposto.
CREATE TEMP TABLE i1 AS SELECT (public.create_work_proposal('a4000000-0000-0000-0000-000000000001','low','programming',
  jsonb_build_object('execution_spec',:'spec'::jsonb,'canonical_provenance',:'prov'::jsonb),:'prop'::jsonb)).id;

-- 1. Auto-aprovação bem-sucedida.
SELECT is((public.auto_approve_autonomous_work((SELECT id FROM i1),1,:'env'::jsonb))->>'action','approved',
  'auto_approve devolve action=approved');
-- 2. O item transita para approved.
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i1)),'approved',
  'o item fica approved');
-- 3. HONESTIDADE: existe exatamente UM work_approved e o autor é `system`.
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='work_approved' AND author='system'),1::bigint,
  'a aprovação é gravada com author=system');
-- 4. HONESTIDADE: NENHUMA aprovação com author=user foi forjada.
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='work_approved' AND author='user'),0::bigint,
  'nenhuma aprovação humana (author=user) é forjada');
-- 5. authority=autonomous_policy no payload.
SELECT is((SELECT payload->'data'->>'authority' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='work_approved'),'autonomous_policy',
  'authority=autonomous_policy é gravada');
-- 6. O envelope avaliado pelo host é gravado (auditabilidade).
SELECT is((SELECT payload->'data'->'authorization' FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='work_approved'),:'env'::jsonb,
  'o envelope da decisão é gravado no payload');

-- 7. Idempotência: replay não aprova de novo.
SELECT is((public.auto_approve_autonomous_work((SELECT id FROM i1),1,:'env'::jsonb))->>'action','replayed',
  'chamada repetida é replay idempotente');
-- 8. Ainda exatamente UM work_approved após replay.
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i1) AND event_type='work_approved'),1::bigint,
  'o replay não cria segunda aprovação');

-- 9. Elegibilidade de execução (shape) — service_role para o predicado privado.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT ok(private.is_autonomously_eligible('approved',:'prop'::jsonb,jsonb_build_object('execution_spec',:'spec'::jsonb)),
  'o item auto-aprovado tem shape elegível para execução');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a4000000-0000-0000-0000-000000000000',true);

-- 10. Integração com a fila EXISTENTE (author-agnóstica): classificado, entra na fila.
SELECT public.record_work_intelligence_classification((SELECT id FROM i1),1,0,:'intel'::jsonb);
SELECT is((SELECT count(*) FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM i1)),1::bigint,
  'o item auto-aprovado (system) entra na fila autônoma como qualquer aprovado');

-- 11. Item SEM proveniência canônica é recusado (fail-closed 42501).
CREATE TEMP TABLE i2 AS SELECT (public.create_work_proposal('a4000000-0000-0000-0000-000000000002','low','programming',
  jsonb_build_object('execution_spec',:'spec'::jsonb),:'prop'::jsonb)).id;
SELECT throws_ok('SELECT public.auto_approve_autonomous_work('''||(SELECT id FROM i2)||''',1,'''||:'env'||'''::jsonb)','42501',NULL,
  'item sem proveniência canônica é recusado');

-- 12. Razão de materialização não ratificada é recusada (42501).
CREATE TEMP TABLE i3 AS SELECT (public.create_work_proposal('a4000000-0000-0000-0000-000000000003','low','programming',
  jsonb_build_object('execution_spec',:'spec'::jsonb,'canonical_provenance',:'provbad'::jsonb),:'prop'::jsonb)).id;
SELECT throws_ok('SELECT public.auto_approve_autonomous_work('''||(SELECT id FROM i3)||''',1,'''||:'env'||'''::jsonb)','42501',NULL,
  'razão de materialização não ratificada é recusada');

-- 13. Envelope com autoridade errada é recusado (22023).
CREATE TEMP TABLE i4 AS SELECT (public.create_work_proposal('a4000000-0000-0000-0000-000000000004','low','programming',
  jsonb_build_object('execution_spec',:'spec'::jsonb,'canonical_provenance',:'prov'::jsonb),:'prop'::jsonb)).id;
SELECT throws_ok('SELECT public.auto_approve_autonomous_work('''||(SELECT id FROM i4)||''',1,''{"envelope_version":1,"authority":"user","source_id":"FIX-01"}''::jsonb)','22023',NULL,
  'envelope sem authority=autonomous_policy é recusado');

-- 14. Envelope cujo source_id não bate com o item é recusado (55000).
CREATE TEMP TABLE i5 AS SELECT (public.create_work_proposal('a4000000-0000-0000-0000-000000000005','low','programming',
  jsonb_build_object('execution_spec',:'spec'::jsonb,'canonical_provenance',:'prov5'::jsonb),:'prop'::jsonb)).id;
SELECT throws_ok('SELECT public.auto_approve_autonomous_work('''||(SELECT id FROM i5)||''',1,'''||:'env'||'''::jsonb)','55000',NULL,
  'envelope com source_id divergente é recusado');

-- 15. Item já aprovado por HUMANO (author=user) não pode ser re-autorizado como system (55000).
CREATE TEMP TABLE i6 AS SELECT (public.create_work_proposal('a4000000-0000-0000-0000-000000000006','low','programming',
  jsonb_build_object('execution_spec',:'spec'::jsonb,'canonical_provenance',:'prov'::jsonb),:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i6),1,'approve','{}');
SELECT throws_ok('SELECT public.auto_approve_autonomous_work('''||(SELECT id FROM i6)||''',1,'''||:'env'||'''::jsonb)','55000',NULL,
  'item já aprovado por humano não é re-autorizado como system');

-- 16. Fronteira: usuário não-allowlisted é recusado (42501).
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a4000000-0000-0000-0000-0000000000ff',true);
SELECT throws_ok('SELECT public.auto_approve_autonomous_work('''||(SELECT id FROM i1)||''',1,'''||:'env'||'''::jsonb)','42501',NULL,
  'usuário não habilitado é recusado');

-- 17. Fronteira: anon é recusado (42501) — a autenticação falha antes de tocar o item.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok('SELECT public.auto_approve_autonomous_work(''a4000000-0000-0000-0000-000000000001''::uuid,1,''{"envelope_version":1,"authority":"autonomous_policy","source_id":"FIX-01"}''::jsonb)','42501',NULL,
  'sem autenticação a auto-aprovação é recusada');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
