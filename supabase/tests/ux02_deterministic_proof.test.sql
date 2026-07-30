-- Prova determinística e AUTOPROVÁVEL do UX-02.
--
-- Diferente de `work_decisions.test.sql` (que insere item, classificação, claim,
-- execução e checkpoint crus para exercitar só as RPCs de decisão), esta prova
-- provisiona TODO o estado sozinha, pelo caminho real, sob uma conta descartável
-- `@test.invalid` — nunca a conta pessoal — e desfaz tudo (BEGIN/ROLLBACK), de
-- modo que cada execução parte de estado próprio e reproduzível:
--
--   1. `create_work_proposal` recebe a intenção/proposta EQUIVALENTE à que a
--      frase determinística produz. Atenção: esta prova NÃO invoca
--      `configureUx02DeterministicProof` — o reconhecimento da frase e a forma
--      exata do `execution_spec` são provados em TS
--      (`execution-environment.test.ts`), que é a fonte da verdade que este JSON
--      reproduz. Aqui a fidelidade é do fluxo do BANCO, não do gatilho da frase;
--   2. `resolve_approval` aprova;
--   3. antes de classificar, `select_autonomous_work` NÃO oferece o item — a
--      lacuna exata que deixou o item original preso: sem classificação;
--   4. `record_work_intelligence_classification` aplica a classificação vigente;
--   5. `select_autonomous_work` passa a oferecer o item — provando que a forma do
--      `execution_spec` da prova satisfaz o espelho SQL de elegibilidade e o gate
--      INTEL-01;
--   6. claim, roteamento, tentativa e checkpoint reais levam ao
--      `decision_required`, e a resposta humana retoma (item A) ou encerra (item B).
--
-- A ligação entre o alvo `ux02-deterministic-decision` e o cartão vive no
-- adaptador TS (`local-runner.test.ts`); o gatilho da frase e a elegibilidade
-- do `execution_spec` produzido vivem em `execution-environment.test.ts`.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
-- Declara a rota da tentativa preparada, como as demais provas de laço.
\ir helpers/routing.inc
SELECT plan(36);

-- ── Usuário descartável programático + allowlist (provisionamento próprio) ──
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('7a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ux02-proof-selfprovision@test.invalid','',now(),'{}','{}',now(),now());
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason)
VALUES('7a000000-0000-0000-0000-000000000001','7a000000-0000-0000-0000-000000000001','UX-02 prova autoprovável');
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
  ('7a000000-0000-0000-0000-0000000000c1','7a000000-0000-0000-0000-000000000001','user','Anima, prepare a prova determinística do UX-02 para eu revisar antes de executar.'),
  ('7a000000-0000-0000-0000-0000000000c2','7a000000-0000-0000-0000-000000000001','user','Anima, prepare a prova determinística do UX-02 para eu revisar antes de executar.');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7a000000-0000-0000-0000-000000000001',true);

-- ══════════════════ RAMO A — retomar do checkpoint ══════════════════
SELECT lives_ok($$SELECT public.create_work_proposal(
  '7a000000-0000-0000-0000-0000000000c1',
  'low','programming',
  '{"schema_version":1,"mode":"construction","execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"ux02-deterministic-decision"},"permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"Retomar somente do checkpoint persistido"}],"limits":{"max_attempts":3,"max_duration_minutes":5}}}',
  '{"schema_version":1,"data":{"summary":"Prova determinística do UX-02","objective":"Provar a interrupção por decisão necessária e a retomada pelo checkpoint persistido","included_scope":["ux02-deterministic-decision"],"excluded_scope":["qualquer alteração fora do cenário determinístico fechado"],"expected_effects":["cartão de decisão necessária projetado exclusivamente do estado persistido"],"risks":["nenhum: cenário determinístico local, sem chamada a modelo"]}}'
)$$,'a proposta do ramo A é criada pela RPC real');
SELECT set_config('anima.item_a',(SELECT id::text FROM public.work_items WHERE source_message_id='7a000000-0000-0000-0000-0000000000c1'),true);
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_a')::uuid),'proposed','item A nasce proposto');

SELECT lives_ok($$SELECT public.resolve_approval(current_setting('anima.item_a')::uuid,1,'approve','{}')$$,'aprovação real do item A');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_a')::uuid),'approved','item A fica aprovado');

SELECT is((SELECT count(*)::int FROM public.select_autonomous_work(current_setting('anima.item_a')::uuid,1)),0,'sem classificação o item NÃO é selecionável (lacuna original)');

SELECT lives_ok($$SELECT public.record_work_intelligence_classification(current_setting('anima.item_a')::uuid,1,0,
  '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-29T12:00:00Z","classifierId":"ux02-deterministic-proof"}}')$$,
  'classificação vigente é aplicada pela RPC real');
SELECT is((SELECT public.current_work_intelligence_classification(current_setting('anima.item_a')::uuid)->'classification'->>'complexity'),'bounded','classificação corrente reconstruída');

SELECT is((SELECT count(*)::int FROM public.select_autonomous_work(current_setting('anima.item_a')::uuid,1)),1,'classificado, o item passa a ser selecionável');
SELECT is((SELECT target_reference FROM public.select_autonomous_work(current_setting('anima.item_a')::uuid,1)),'ux02-deterministic-decision','a fila oferece o alvo determinístico');

SELECT lives_ok($$SELECT public.acquire_work_claim(current_setting('anima.item_a')::uuid,1,'7a000000-0000-0000-0000-0000000000a1','supervisor-proof',360)$$,'claim real adquirido (passa o gate de inteligência)');
SELECT pg_temp.record_test_route(current_setting('anima.item_a')::uuid,'7a000000-0000-0000-0000-0000000000b1','local-runner-v1');
SELECT lives_ok($$SELECT public.start_claimed_work_attempt('7a000000-0000-0000-0000-0000000000a1','7a000000-0000-0000-0000-0000000000b1','local-runner-v1')$$,'tentativa iniciada sob claim');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_a')::uuid),'in_progress','item A entra em execução');

SELECT lives_ok($$SELECT public.record_work_checkpoint(current_setting('anima.item_a')::uuid,1,'7a000000-0000-0000-0000-0000000000b1',
  jsonb_build_object('kind','checkpoint','workItemId',current_setting('anima.item_a'),'attemptId','7a000000-0000-0000-0000-0000000000b1','approvedProposalVersion',1,'origin','executor','sequence',2,
    'checkpoint','{"schemaVersion":1,"handoffReference":"ux02-proof:checkpoint-1","completedSteps":["Cenário determinístico iniciado"],"remainingSteps":["Concluir a etapa após autorização humana"],"nextStep":"Retomar a execução usando a alternativa persistida","decisions":[],"risks":["A continuação exige decisão humana explícita"],"touchedResources":["ux02-deterministic-decision"],"validations":[{"label":"Checkpoint determinístico criado","outcome":"passed"}],"failures":[],"evidenceReferences":["ux02-proof:checkpoint-1"]}'::jsonb))$$,
  'checkpoint determinístico persistido pela RPC real');

SELECT lives_ok($$SELECT public.record_work_decision_required(current_setting('anima.item_a')::uuid,1,'7a000000-0000-0000-0000-0000000000b1',
  jsonb_build_object('kind','decision_required','workItemId',current_setting('anima.item_a'),'attemptId','7a000000-0000-0000-0000-0000000000b1','approvedProposalVersion',1,'origin','executor','sequence',3,
    'reason','architectural_decision','explanation','O cenário determinístico chegou ao checkpoint conhecido. Deseja continuar dali ou encerrar o trabalho?',
    'options','[{"id":"continuar","label":"Continuar do checkpoint","effect":"resume"},{"id":"encerrar","label":"Encerrar o trabalho","effect":"cancel"}]'::jsonb))$$,
  'decisão necessária é persistida a partir do checkpoint');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_a')::uuid),'blocked','item A bloqueia aguardando decisão');
SELECT is((SELECT payload->'data'->>'reason' FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='input_requested'),'architectural_decision','razão exata preservada');
SELECT is((SELECT payload->'data'->'options'->0->>'id' FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='input_requested'),'continuar','alternativa exata preservada');

SELECT lives_ok($$SELECT public.respond_to_work_decision(current_setting('anima.item_a')::uuid,1,
  (SELECT id FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='input_requested'),'continuar')$$,'a resposta "continuar" retoma');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_a')::uuid),'approved','retomar devolve o item à fila aprovada');
SELECT is(public.human_decision_resumption_source(current_setting('anima.item_a')::uuid)->>'kind','human_decision_checkpoint','backend reconstrói a fonte de retomada');

SELECT pg_temp.record_test_route(current_setting('anima.item_a')::uuid,'7a000000-0000-0000-0000-0000000000b2','local-runner-v1');
SELECT lives_ok($$SELECT public.begin_human_decision_resumed_attempt(current_setting('anima.item_a')::uuid,1,
  (SELECT id FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='input_requested'),
  (SELECT id FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='input_provided'),
  '7a000000-0000-0000-0000-0000000000a2','7a000000-0000-0000-0000-0000000000b2','supervisor-resumed',360,'local-runner-v1')$$,
  'a retomada abre nova tentativa pelo checkpoint');
SELECT lives_ok($$SELECT public.record_commanded_work_terminal(current_setting('anima.item_a')::uuid,1,'7a000000-0000-0000-0000-0000000000b2',
  jsonb_build_object('kind','result','workItemId',current_setting('anima.item_a'),'attemptId','7a000000-0000-0000-0000-0000000000b2','approvedProposalVersion',1,'origin','executor','sequence',2,
    'summary','O cenário determinístico retomou do checkpoint persistido e concluiu a etapa autorizada.',
    'resultReferences','["ux02-proof:resumed-from-checkpoint"]'::jsonb,
    'validations','[{"label":"Retomada consumiu o checkpoint persistido","outcome":"passed"}]'::jsonb,
    'limitations','["Cenário determinístico local; nenhuma decisão foi produzida livremente por modelo."]'::jsonb,
    'handoffReference','ux02-proof:completed'))$$,'a tentativa retomada persiste o resultado real');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_a')::uuid),'review','a retomada conclui em revisão, sem integrar automaticamente');

-- ══════════════════ RAMO B — encerrar o trabalho ══════════════════
-- Alvo distinto: o claim da retomada do ramo A ainda ocupa o alvo determinístico.
-- No banco a referência é opaca; a ligação com o adaptador é provada no ramo A.
SELECT lives_ok($$SELECT public.create_work_proposal(
  '7a000000-0000-0000-0000-0000000000c2',
  'low','programming',
  '{"schema_version":1,"mode":"construction","execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"ux02-deterministic-decision-cancel"},"permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"Encerrar somente por decisão humana"}],"limits":{"max_attempts":3,"max_duration_minutes":5}}}',
  '{"schema_version":1,"data":{"summary":"Prova determinística do UX-02 (encerrar)","objective":"Provar o encerramento por decisão humana a partir do checkpoint","included_scope":["ux02-deterministic-decision-cancel"],"excluded_scope":["qualquer alteração fora do cenário determinístico fechado"],"expected_effects":["item encerrado por decisão humana explícita"],"risks":["nenhum: cenário determinístico local"]}}'
)$$,'a proposta do ramo B é criada pela RPC real');
SELECT set_config('anima.item_b',(SELECT id::text FROM public.work_items WHERE source_message_id='7a000000-0000-0000-0000-0000000000c2'),true);
SELECT lives_ok($$SELECT public.resolve_approval(current_setting('anima.item_b')::uuid,1,'approve','{}')$$,'aprovação real do item B');
SELECT lives_ok($$SELECT public.record_work_intelligence_classification(current_setting('anima.item_b')::uuid,1,0,
  '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-29T12:00:00Z","classifierId":"ux02-deterministic-proof"}}')$$,
  'classificação vigente aplicada ao item B');
SELECT is((SELECT count(*)::int FROM public.select_autonomous_work(current_setting('anima.item_b')::uuid,1)),1,'item B classificado é selecionável');
SELECT lives_ok($$SELECT public.acquire_work_claim(current_setting('anima.item_b')::uuid,1,'7a000000-0000-0000-0000-0000000000a3','supervisor-proof',360)$$,'claim real do item B');
SELECT pg_temp.record_test_route(current_setting('anima.item_b')::uuid,'7a000000-0000-0000-0000-0000000000b3','local-runner-v1');
SELECT lives_ok($$SELECT public.start_claimed_work_attempt('7a000000-0000-0000-0000-0000000000a3','7a000000-0000-0000-0000-0000000000b3','local-runner-v1')$$,'tentativa do item B iniciada');
SELECT lives_ok($$SELECT public.record_work_checkpoint(current_setting('anima.item_b')::uuid,1,'7a000000-0000-0000-0000-0000000000b3',
  jsonb_build_object('kind','checkpoint','workItemId',current_setting('anima.item_b'),'attemptId','7a000000-0000-0000-0000-0000000000b3','approvedProposalVersion',1,'origin','executor','sequence',2,
    'checkpoint','{"schemaVersion":1,"handoffReference":"ux02-proof:checkpoint-1","completedSteps":["Cenário determinístico iniciado"],"remainingSteps":["Concluir a etapa após autorização humana"],"nextStep":"Retomar a execução usando a alternativa persistida","decisions":[],"risks":["A continuação exige decisão humana explícita"],"touchedResources":["ux02-deterministic-decision-cancel"],"validations":[{"label":"Checkpoint determinístico criado","outcome":"passed"}],"failures":[],"evidenceReferences":["ux02-proof:checkpoint-1"]}'::jsonb))$$,
  'checkpoint do item B persistido');
SELECT lives_ok($$SELECT public.record_work_decision_required(current_setting('anima.item_b')::uuid,1,'7a000000-0000-0000-0000-0000000000b3',
  jsonb_build_object('kind','decision_required','workItemId',current_setting('anima.item_b'),'attemptId','7a000000-0000-0000-0000-0000000000b3','approvedProposalVersion',1,'origin','executor','sequence',3,
    'reason','architectural_decision','explanation','O cenário determinístico chegou ao checkpoint conhecido. Deseja continuar dali ou encerrar o trabalho?',
    'options','[{"id":"continuar","label":"Continuar do checkpoint","effect":"resume"},{"id":"encerrar","label":"Encerrar o trabalho","effect":"cancel"}]'::jsonb))$$,
  'decisão necessária do item B é persistida');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_b')::uuid),'blocked','item B bloqueia aguardando decisão');
SELECT lives_ok($$SELECT public.respond_to_work_decision(current_setting('anima.item_b')::uuid,1,
  (SELECT id FROM public.work_events WHERE work_item_id=current_setting('anima.item_b')::uuid AND event_type='input_requested'),'encerrar')$$,'a resposta "encerrar" cancela');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_b')::uuid),'cancelled','encerrar leva o item a cancelado');

-- ══════════════════ Guardas de conta descartável ══════════════════
-- Superusuário do teste só para inspecionar auth.users e o total por usuário.
RESET ROLE;
SELECT ok((SELECT email LIKE '%@test.invalid' FROM auth.users WHERE id='7a000000-0000-0000-0000-000000000001'),'a prova só usou uma conta descartável @test.invalid');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE user_id='7a000000-0000-0000-0000-000000000001'),2,'todo o estado criado pertence à conta descartável (nenhuma conta pessoal)');

SELECT * FROM finish();
ROLLBACK;
