-- Prova determinística e AUTOPROVÁVEL do UX-03 — cartão de resultado autônomo.
--
-- O UX-02 provou a decisão necessária e parou o item A em `review`. O UX-03 é o
-- passo seguinte: revisar o RESULTADO produzido por uma tentativa AUTÔNOMA.
--
-- Diferente das provas do ciclo MANUAL (que chegam a `review` por
-- `submit_work_result`), esta prova leva o item a `review` pelo terminal REAL do
-- executor (`record_commanded_work_terminal`, origin='executor'), que é o mesmo
-- caminho do laço supervisionado e da execução comandada. Depois exercita o
-- fluxo de revisão existente — `review_work_result_versioned` — nos dois ramos
-- canônicos do UX-03: ACEITAR e PEDIR ALTERAÇÕES, sob contas descartáveis
-- `@test.invalid`, nunca a conta pessoal, e desfaz tudo (BEGIN/ROLLBACK).
--
-- Preserva a decisão ratificada: `completed` = resultado aceito, NUNCA integração
-- (nada é integrado automaticamente após o aceite). A ligação frase→alvo e a
-- projeção do cartão (incl. a referência de handoff exigida pelo UX-03) vivem no
-- TS (`presentation.test.ts`, `WorkProposalCard.test.tsx`); aqui a fidelidade é
-- do fluxo do BANCO com o resultado de origem autônoma.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir helpers/routing.inc
SELECT plan(41);

-- ── Duas contas descartáveis programáticas (dona + intrusa p/ isolamento) ──
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
  ('7b000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ux03-proof-selfprovision@test.invalid','',now(),'{}','{}',now(),now()),
  ('7b000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ux03-proof-intruder@test.invalid','',now(),'{}','{}',now(),now());
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason) VALUES
  ('7b000000-0000-0000-0000-000000000001','7b000000-0000-0000-0000-000000000001','UX-03 prova autoprovável'),
  ('7b000000-0000-0000-0000-000000000002','7b000000-0000-0000-0000-000000000002','UX-03 prova autoprovável (isolamento)');
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
  ('7b000000-0000-0000-0000-0000000000c1','7b000000-0000-0000-0000-000000000001','user','Anima, prepare o resultado autônomo do UX-03 para eu aceitar.'),
  ('7b000000-0000-0000-0000-0000000000c2','7b000000-0000-0000-0000-000000000001','user','Anima, prepare o resultado autônomo do UX-03 para eu pedir alterações.');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7b000000-0000-0000-0000-000000000001',true);

-- ══════════════════ RAMO A — ACEITAR o resultado autônomo ══════════════════
SELECT lives_ok($$SELECT public.create_work_proposal(
  '7b000000-0000-0000-0000-0000000000c1','low','programming',
  '{"schema_version":1,"mode":"construction","execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"ux03-deterministic-result-accept"},"permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"Aceitar somente o resultado exato apresentado"}],"limits":{"max_attempts":3,"max_duration_minutes":5}}}',
  '{"schema_version":1,"data":{"summary":"Resultado autônomo do UX-03 (aceitar)","objective":"Provar a revisão e o aceite de um resultado produzido por tentativa autônoma","included_scope":["ux03-deterministic-result-accept"],"excluded_scope":["qualquer integração externa"],"expected_effects":["resultado aceito e trabalho concluído sem integração"],"risks":["nenhum: cenário determinístico local"]}}'
)$$,'a proposta do ramo A é criada pela RPC real');
SELECT set_config('anima.item_a',(SELECT id::text FROM public.work_items WHERE source_message_id='7b000000-0000-0000-0000-0000000000c1'),true);
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_a')::uuid),'proposed','item A nasce proposto');

SELECT lives_ok($$SELECT public.resolve_approval(current_setting('anima.item_a')::uuid,1,'approve','{}')$$,'aprovação real do item A');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_a')::uuid),'approved','item A fica aprovado');
SELECT is((SELECT count(*)::int FROM public.select_autonomous_work(current_setting('anima.item_a')::uuid,1)),0,'sem classificação o item NÃO é selecionável');

SELECT lives_ok($$SELECT public.record_work_intelligence_classification(current_setting('anima.item_a')::uuid,1,0,
  '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-31T12:00:00Z","classifierId":"ux03-deterministic-proof"}}')$$,
  'classificação vigente aplicada ao item A');
SELECT is((SELECT count(*)::int FROM public.select_autonomous_work(current_setting('anima.item_a')::uuid,1)),1,'classificado, o item A é selecionável');

SELECT lives_ok($$SELECT public.acquire_work_claim(current_setting('anima.item_a')::uuid,1,'7b000000-0000-0000-0000-0000000000a1','supervisor-proof',360)$$,'claim real do item A');
SELECT pg_temp.record_test_route(current_setting('anima.item_a')::uuid,'7b000000-0000-0000-0000-0000000000b1','local-runner-v1');
SELECT lives_ok($$SELECT public.start_claimed_work_attempt('7b000000-0000-0000-0000-0000000000a1','7b000000-0000-0000-0000-0000000000b1','local-runner-v1')$$,'tentativa autônoma do item A iniciada');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_a')::uuid),'in_progress','item A entra em execução');

-- Terminal REAL do executor (origin='executor'): produz o resultado autônomo.
SELECT lives_ok($$SELECT public.record_commanded_work_terminal(current_setting('anima.item_a')::uuid,1,'7b000000-0000-0000-0000-0000000000b1',
  jsonb_build_object('kind','result','workItemId',current_setting('anima.item_a'),'attemptId','7b000000-0000-0000-0000-0000000000b1','approvedProposalVersion',1,'origin','executor','sequence',1,
    'summary','O runner autônomo produziu e validou um resultado para revisão.',
    'resultReferences','["runner-evidence:ux03-accept","runner-bundle:ux03-accept"]'::jsonb,
    'validations','[{"label":"npm test","outcome":"passed"}]'::jsonb,
    'limitations','["Cenário determinístico local; nenhuma decisão foi produzida livremente por modelo."]'::jsonb,
    'handoffReference','ux03-proof:accept-bundle'))$$,'o terminal autônomo persiste o resultado (origin=executor)');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_a')::uuid),'review','o resultado autônomo leva o item A a revisão');
SELECT is((SELECT payload->'data'->>'handoff_reference' FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='result_submitted'),'ux03-proof:accept-bundle','a referência de handoff exigida pelo UX-03 é persistida');
SELECT is((SELECT payload->'data'->>'origin' FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='result_submitted'),'executor','o resultado tem origem autônoma (executor)');
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='result_submitted'),'executor','autoria do resultado é o executor');
SELECT set_config('anima.result_a',(SELECT id::text FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='result_submitted' ORDER BY seq DESC LIMIT 1),true);

-- A decisão referencia o resultado EXATO: um id divergente é recusado (55000).
SELECT throws_ok($$SELECT public.review_work_result_versioned(current_setting('anima.item_a')::uuid,1,'00000000-0000-0000-0000-0000000000ff','accept','{}')$$,
  '55000','reviewed result changed','aceite com evento de resultado divergente é recusado');
SELECT lives_ok($$SELECT public.review_work_result_versioned(current_setting('anima.item_a')::uuid,1,current_setting('anima.result_a')::uuid,'accept','{}')$$,
  'o aceite versionado do resultado autônomo é aplicado pela RPC real');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_a')::uuid),'completed','aceitar conclui o trabalho');
SELECT is((SELECT payload->'data'->>'accepted_result_event_id' FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='result_accepted'),current_setting('anima.result_a'),'o aceite aponta para o evento de resultado exato');
SELECT is((SELECT count(*)::int FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='result_accepted'),1,'exatamente um aceite é registrado');
SELECT is((SELECT event_type::text FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid ORDER BY seq DESC LIMIT 1),'result_accepted','nada é integrado automaticamente após o aceite (completed != integrated)');
SELECT throws_ok($$SELECT public.review_work_result_versioned(current_setting('anima.item_a')::uuid,1,current_setting('anima.result_a')::uuid,'accept','{}')$$,
  '55000','work item state or proposal version changed','um segundo aceite sobre item concluído é recusado');

-- ══════════════════ RAMO B — PEDIR ALTERAÇÕES no resultado autônomo ══════════════════
SELECT lives_ok($$SELECT public.create_work_proposal(
  '7b000000-0000-0000-0000-0000000000c2','low','programming',
  '{"schema_version":1,"mode":"construction","execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"ux03-deterministic-result-changes"},"permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"Pedir alterações exige texto"}],"limits":{"max_attempts":3,"max_duration_minutes":5}}}',
  '{"schema_version":1,"data":{"summary":"Resultado autônomo do UX-03 (pedir alterações)","objective":"Provar o pedido de alterações sobre um resultado autônomo, mantendo o item aberto","included_scope":["ux03-deterministic-result-changes"],"excluded_scope":["qualquer integração externa"],"expected_effects":["novo ciclo elegível sem perder histórico"],"risks":["nenhum: cenário determinístico local"]}}'
)$$,'a proposta do ramo B é criada pela RPC real');
SELECT set_config('anima.item_b',(SELECT id::text FROM public.work_items WHERE source_message_id='7b000000-0000-0000-0000-0000000000c2'),true);
SELECT lives_ok($$SELECT public.resolve_approval(current_setting('anima.item_b')::uuid,1,'approve','{}')$$,'aprovação real do item B');
SELECT lives_ok($$SELECT public.record_work_intelligence_classification(current_setting('anima.item_b')::uuid,1,0,
  '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-31T12:00:00Z","classifierId":"ux03-deterministic-proof"}}')$$,
  'classificação vigente aplicada ao item B');
SELECT lives_ok($$SELECT public.acquire_work_claim(current_setting('anima.item_b')::uuid,1,'7b000000-0000-0000-0000-0000000000a2','supervisor-proof',360)$$,'claim real do item B');
SELECT pg_temp.record_test_route(current_setting('anima.item_b')::uuid,'7b000000-0000-0000-0000-0000000000b2','local-runner-v1');
SELECT lives_ok($$SELECT public.start_claimed_work_attempt('7b000000-0000-0000-0000-0000000000a2','7b000000-0000-0000-0000-0000000000b2','local-runner-v1')$$,'tentativa autônoma do item B iniciada');
SELECT lives_ok($$SELECT public.record_commanded_work_terminal(current_setting('anima.item_b')::uuid,1,'7b000000-0000-0000-0000-0000000000b2',
  jsonb_build_object('kind','result','workItemId',current_setting('anima.item_b'),'attemptId','7b000000-0000-0000-0000-0000000000b2','approvedProposalVersion',1,'origin','executor','sequence',1,
    'summary','O runner autônomo produziu um resultado que ainda precisa de ajustes.',
    'resultReferences','["runner-bundle:ux03-changes"]'::jsonb,
    'validations','[{"label":"npm test","outcome":"passed"}]'::jsonb,
    'limitations','["Cenário determinístico local."]'::jsonb,
    'handoffReference','ux03-proof:changes-bundle'))$$,'o terminal autônomo do item B persiste o resultado');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_b')::uuid),'review','o resultado autônomo leva o item B a revisão');
SELECT set_config('anima.result_b',(SELECT id::text FROM public.work_events WHERE work_item_id=current_setting('anima.item_b')::uuid AND event_type='result_submitted' ORDER BY seq DESC LIMIT 1),true);

-- Pedir alterações exige justificativa textual (contrato de changes_requested).
SELECT throws_ok($$SELECT public.review_work_result_versioned(current_setting('anima.item_b')::uuid,1,current_setting('anima.result_b')::uuid,'request_changes','{}')$$,
  '22023','requested_changes is required','pedir alterações sem texto é recusado');
SELECT lives_ok($$SELECT public.review_work_result_versioned(current_setting('anima.item_b')::uuid,1,current_setting('anima.result_b')::uuid,'request_changes',
  '{"requested_changes":"Trate o caso de erro observado antes de reenviar."}')$$,'pedir alterações versionado é aplicado pela RPC real');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_b')::uuid),'changes_requested','pedir alterações reabre o item, sem concluir');
SELECT is((SELECT payload->'data'->>'requested_changes' FROM public.work_events WHERE work_item_id=current_setting('anima.item_b')::uuid AND event_type='changes_requested'),'Trate o caso de erro observado antes de reenviar.','o texto de alterações exato é preservado');
SELECT is((SELECT payload->'data'->>'reviewed_result_event_id' FROM public.work_events WHERE work_item_id=current_setting('anima.item_b')::uuid AND event_type='changes_requested'),current_setting('anima.result_b'),'o pedido referencia o resultado exato revisado');
SELECT is((SELECT count(*)::int FROM public.work_events WHERE work_item_id=current_setting('anima.item_b')::uuid AND event_type='result_submitted'),1,'o resultado original permanece no histórico (nada é perdido)');
SELECT throws_ok($$SELECT public.review_work_result_versioned(current_setting('anima.item_b')::uuid,1,current_setting('anima.result_b')::uuid,'accept','{}')$$,
  '55000','work item state or proposal version changed','uma segunda decisão sobre item fora de revisão é recusada');

-- ══════════════════ Isolamento por usuário ══════════════════
-- A conta intrusa (allowlisted, plenamente habilitada) não pode revisar o
-- resultado de outra conta: a RPC nem encontra o item (RLS por user_id).
SELECT set_config('request.jwt.claim.sub','7b000000-0000-0000-0000-000000000002',true);
SELECT throws_ok($$SELECT public.review_work_result_versioned(current_setting('anima.item_a')::uuid,1,current_setting('anima.result_a')::uuid,'accept','{}')$$,
  'P0002','work item not found','conta intrusa não decide sobre o resultado aceito de outra conta');
SELECT throws_ok($$SELECT public.review_work_result_versioned(current_setting('anima.item_b')::uuid,1,current_setting('anima.result_b')::uuid,'request_changes','{"requested_changes":"x"}')$$,
  'P0002','work item not found','conta intrusa não decide sobre o resultado em alterações de outra conta');

-- ══════════════════ Guardas de conta descartável ══════════════════
RESET ROLE;
SELECT ok((SELECT bool_and(email LIKE '%@test.invalid') FROM auth.users WHERE id IN ('7b000000-0000-0000-0000-000000000001','7b000000-0000-0000-0000-000000000002')),'a prova só usou contas descartáveis @test.invalid');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE user_id='7b000000-0000-0000-0000-000000000001'),2,'todo o estado criado pertence à conta descartável dona (nenhuma conta pessoal)');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE user_id='7b000000-0000-0000-0000-000000000002'),0,'a conta intrusa não criou nem alterou nenhum item');

SELECT * FROM finish();
ROLLBACK;
