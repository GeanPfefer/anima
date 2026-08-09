-- Prova determinística e AUTOPROVÁVEL da persistência da decisão de integração
-- (ADR-002): a SEGUNDA aprovação humana sobre um resultado JÁ ACEITO.
--
-- Leva dois itens a `completed` pelo caminho REAL (terminal do executor +
-- review_work_result_versioned) e exercita `decide_integration` em todos os
-- ramos: autorizar, replay idempotente, conflito na mesma decisão, "já decidido",
-- resultado divergente, guarda de item não-aceito, recusa e isolamento por conta.
--
-- Preserva a fronteira ratificada: `completed` != `integrated`. Registrar a
-- decisão NÃO muda o estado do item, NÃO integra, NÃO publica e não existe caminho
-- para `integrated` sem efeito externo (etapa do publisher, adiante). Contas
-- descartáveis `@test.invalid`, nunca a conta pessoal; tudo em BEGIN/ROLLBACK.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir helpers/routing.inc
SELECT plan(37);

-- ── Duas contas descartáveis (dona + intrusa p/ isolamento) ──
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
  ('d1000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','integration-decision-owner@test.invalid','',now(),'{}','{}',now(),now()),
  ('d1000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','integration-decision-intruder@test.invalid','',now(),'{}','{}',now(),now());
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason) VALUES
  ('d1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','ADR-002 prova autoprovável'),
  ('d1000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000002','ADR-002 prova autoprovável (isolamento)');
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
  ('d1000000-0000-0000-0000-0000000000c1','d1000000-0000-0000-0000-000000000001','user','Anima, prepare um resultado autônomo para eu autorizar a integração.'),
  ('d1000000-0000-0000-0000-0000000000c2','d1000000-0000-0000-0000-000000000001','user','Anima, prepare um resultado autônomo para eu recusar a integração.');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000001',true);

-- ════════════ ITEM A — levar a `completed` e AUTORIZAR a integração ════════════
SELECT lives_ok($$SELECT public.create_work_proposal(
  'd1000000-0000-0000-0000-0000000000c1','low','programming',
  '{"schema_version":1,"mode":"construction","execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"adr002-decide-authorize"},"permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"Autorizar integração de um resultado aceito"}],"limits":{"max_attempts":3,"max_duration_minutes":5}}}',
  '{"schema_version":1,"data":{"summary":"Resultado autônomo (autorizar integração)","objective":"Provar a segunda aprovação humana da integração","included_scope":["adr002-decide-authorize"],"excluded_scope":["publisher real"],"expected_effects":["decisão de integração registrada sem efeito externo"],"risks":["nenhum: cenário determinístico local"]}}'
)$$,'a proposta do item A é criada pela RPC real');
SELECT set_config('anima.item_a',(SELECT id::text FROM public.work_items WHERE source_message_id='d1000000-0000-0000-0000-0000000000c1'),true);
SELECT lives_ok($$SELECT public.resolve_approval(current_setting('anima.item_a')::uuid,1,'approve','{}')$$,'aprovação real do item A');
SELECT lives_ok($$SELECT public.record_work_intelligence_classification(current_setting('anima.item_a')::uuid,1,0,
  '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-08-09T12:00:00Z","classifierId":"adr002-decide-proof"}}')$$,
  'classificação vigente aplicada ao item A');
SELECT lives_ok($$SELECT public.acquire_work_claim(current_setting('anima.item_a')::uuid,1,'d1000000-0000-0000-0000-0000000000a1','supervisor-proof',360)$$,'claim real do item A');
SELECT pg_temp.record_test_route(current_setting('anima.item_a')::uuid,'d1000000-0000-0000-0000-0000000000b1','local-runner-v1');
SELECT lives_ok($$SELECT public.start_claimed_work_attempt('d1000000-0000-0000-0000-0000000000a1','d1000000-0000-0000-0000-0000000000b1','local-runner-v1')$$,'tentativa autônoma do item A iniciada');
SELECT lives_ok($$SELECT public.record_commanded_work_terminal(current_setting('anima.item_a')::uuid,1,'d1000000-0000-0000-0000-0000000000b1',
  jsonb_build_object('kind','result','workItemId',current_setting('anima.item_a'),'attemptId','d1000000-0000-0000-0000-0000000000b1','approvedProposalVersion',1,'origin','executor','sequence',1,
    'summary','O runner autônomo produziu e validou um resultado para revisão.',
    'resultReferences','["runner-bundle:adr002-authorize"]'::jsonb,
    'validations','[{"label":"npm test","outcome":"passed"}]'::jsonb,
    'limitations','["Cenário determinístico local."]'::jsonb,
    'handoffReference','worktree:adr002-decide-authorize:anima-work/d1000000-0000-0000-0000-0000000000b1'))$$,'o terminal autônomo persiste o resultado do item A');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_a')::uuid),'review','o resultado autônomo leva o item A a revisão');
SELECT set_config('anima.result_a',(SELECT id::text FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='result_submitted' ORDER BY seq DESC LIMIT 1),true);

-- Antes do aceite (item em `review`, não `completed`): decidir integração é recusado.
SELECT throws_ok($$SELECT public.decide_integration(current_setting('anima.item_a')::uuid,1,current_setting('anima.result_a')::uuid,'authorize'::public.work_integration_decision,'dec-a-1')$$,
  '55000','work item state or proposal version changed','não se decide integração de um resultado que ainda não foi aceito');

SELECT lives_ok($$SELECT public.review_work_result_versioned(current_setting('anima.item_a')::uuid,1,current_setting('anima.result_a')::uuid,'accept','{}')$$,'aceite versionado do resultado do item A');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_a')::uuid),'completed','aceitar conclui o trabalho (completed)');

-- A decisão referencia o resultado EXATO: um id divergente é recusado (55000).
SELECT throws_ok($$SELECT public.decide_integration(current_setting('anima.item_a')::uuid,1,'00000000-0000-0000-0000-0000000000ff','authorize'::public.work_integration_decision,'dec-a-1')$$,
  '55000','accepted result changed','decisão sobre um resultado aceito divergente é recusada');

-- Autorização real.
SELECT lives_ok($$SELECT public.decide_integration(current_setting('anima.item_a')::uuid,1,current_setting('anima.result_a')::uuid,'authorize'::public.work_integration_decision,'dec-a-1')$$,
  'a autorização da integração é registrada pela RPC real');
SELECT is((SELECT count(*)::int FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='integration_decided'),1,'exatamente uma decisão de integração é registrada');
SELECT is((SELECT payload->'data'->>'decision' FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='integration_decided'),'authorize','a decisão registrada é authorize');
-- Contrato payload↔projeção: o evento persiste exatamente os campos que
-- projectIntegrationBoundary lê (correlação INT-02 derivada do servidor).
SELECT is((SELECT payload->'data'->>'accepted_result_event_id' FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='integration_decided'),current_setting('anima.result_a'),'a decisão aponta para o resultado aceito exato');
SELECT is((SELECT payload->'data'->>'decision_id' FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='integration_decided'),'dec-a-1','a decisão persiste o decision_id (idempotência + projeção)');
SELECT is((SELECT payload->'data'->>'attempt_id' FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='integration_decided'),'d1000000-0000-0000-0000-0000000000b1','a decisão persiste a tentativa derivada do servidor (correlação INT-02)');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_a')::uuid),'completed','autorizar a integração NÃO muda o estado do item (completed != integrated)');
SELECT is((SELECT event_type::text FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid ORDER BY seq DESC LIMIT 1),'integration_decided','nada é integrado automaticamente: não há evento integrated');

-- Replay idêntico: idempotente, sem novo evento.
SELECT lives_ok($$SELECT public.decide_integration(current_setting('anima.item_a')::uuid,1,current_setting('anima.result_a')::uuid,'authorize'::public.work_integration_decision,'dec-a-1')$$,
  'a mesma autorização reentregue é idempotente');
SELECT is((SELECT count(*)::int FROM public.work_events WHERE work_item_id=current_setting('anima.item_a')::uuid AND event_type='integration_decided'),1,'o replay não cria um segundo evento');

-- Mesmo decision_id, decisão diferente: conflito fail-closed.
SELECT throws_ok($$SELECT public.decide_integration(current_setting('anima.item_a')::uuid,1,current_setting('anima.result_a')::uuid,'refuse'::public.work_integration_decision,'dec-a-1')$$,
  '55000','integration decision conflict','a mesma decisão reemitida com desfecho divergente falha fechada');
-- Decisão diferente por outro id: uma decisão por resultado aceito.
SELECT throws_ok($$SELECT public.decide_integration(current_setting('anima.item_a')::uuid,1,current_setting('anima.result_a')::uuid,'refuse'::public.work_integration_decision,'dec-a-2')$$,
  '55000','integration already decided','um resultado aceito admite exatamente uma decisão de integração');

-- ════════════ ITEM B — levar a `completed` e RECUSAR a integração ════════════
SELECT lives_ok($$SELECT public.create_work_proposal(
  'd1000000-0000-0000-0000-0000000000c2','low','programming',
  '{"schema_version":1,"mode":"construction","execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"adr002-decide-refuse"},"permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"Recusar integração de um resultado aceito"}],"limits":{"max_attempts":3,"max_duration_minutes":5}}}',
  '{"schema_version":1,"data":{"summary":"Resultado autônomo (recusar integração)","objective":"Provar a recusa da integração de um resultado aceito","included_scope":["adr002-decide-refuse"],"excluded_scope":["publisher real"],"expected_effects":["integração recusada sem efeito externo"],"risks":["nenhum: cenário determinístico local"]}}'
)$$,'a proposta do item B é criada pela RPC real');
SELECT set_config('anima.item_b',(SELECT id::text FROM public.work_items WHERE source_message_id='d1000000-0000-0000-0000-0000000000c2'),true);
SELECT lives_ok($$SELECT public.resolve_approval(current_setting('anima.item_b')::uuid,1,'approve','{}')$$,'aprovação real do item B');
SELECT lives_ok($$SELECT public.record_work_intelligence_classification(current_setting('anima.item_b')::uuid,1,0,
  '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-08-09T12:00:00Z","classifierId":"adr002-decide-proof"}}')$$,
  'classificação vigente aplicada ao item B');
SELECT lives_ok($$SELECT public.acquire_work_claim(current_setting('anima.item_b')::uuid,1,'d1000000-0000-0000-0000-0000000000a2','supervisor-proof',360)$$,'claim real do item B');
SELECT pg_temp.record_test_route(current_setting('anima.item_b')::uuid,'d1000000-0000-0000-0000-0000000000b2','local-runner-v1');
SELECT lives_ok($$SELECT public.start_claimed_work_attempt('d1000000-0000-0000-0000-0000000000a2','d1000000-0000-0000-0000-0000000000b2','local-runner-v1')$$,'tentativa autônoma do item B iniciada');
SELECT lives_ok($$SELECT public.record_commanded_work_terminal(current_setting('anima.item_b')::uuid,1,'d1000000-0000-0000-0000-0000000000b2',
  jsonb_build_object('kind','result','workItemId',current_setting('anima.item_b'),'attemptId','d1000000-0000-0000-0000-0000000000b2','approvedProposalVersion',1,'origin','executor','sequence',1,
    'summary','O runner autônomo produziu um resultado para revisão.',
    'resultReferences','["runner-bundle:adr002-refuse"]'::jsonb,
    'validations','[{"label":"npm test","outcome":"passed"}]'::jsonb,
    'limitations','["Cenário determinístico local."]'::jsonb,
    'handoffReference','worktree:adr002-decide-refuse:anima-work/d1000000-0000-0000-0000-0000000000b2'))$$,'o terminal autônomo persiste o resultado do item B');
SELECT set_config('anima.result_b',(SELECT id::text FROM public.work_events WHERE work_item_id=current_setting('anima.item_b')::uuid AND event_type='result_submitted' ORDER BY seq DESC LIMIT 1),true);
SELECT lives_ok($$SELECT public.review_work_result_versioned(current_setting('anima.item_b')::uuid,1,current_setting('anima.result_b')::uuid,'accept','{}')$$,'aceite versionado do resultado do item B');
SELECT lives_ok($$SELECT public.decide_integration(current_setting('anima.item_b')::uuid,1,current_setting('anima.result_b')::uuid,'refuse'::public.work_integration_decision,'dec-b-1')$$,
  'a recusa da integração é registrada pela RPC real');
SELECT is((SELECT payload->'data'->>'decision' FROM public.work_events WHERE work_item_id=current_setting('anima.item_b')::uuid AND event_type='integration_decided'),'refuse','a decisão registrada do item B é refuse');
SELECT is((SELECT state::text FROM public.work_items WHERE id=current_setting('anima.item_b')::uuid),'completed','recusar a integração também NÃO muda o estado do item');

-- ════════════ Isolamento por conta ════════════
SELECT set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000002',true);
SELECT throws_ok($$SELECT public.decide_integration(current_setting('anima.item_a')::uuid,1,current_setting('anima.result_a')::uuid,'authorize'::public.work_integration_decision,'intruder-1')$$,
  'P0002','work item not found','conta intrusa não decide a integração de outra conta');

-- ════════════ Guardas de conta descartável ════════════
RESET ROLE;
SELECT ok((SELECT bool_and(email LIKE '%@test.invalid') FROM auth.users WHERE id IN ('d1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000002')),'a prova só usou contas descartáveis @test.invalid');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE user_id='d1000000-0000-0000-0000-000000000001'),2,'todo o estado criado pertence à conta descartável dona');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE user_id='d1000000-0000-0000-0000-000000000002'),0,'a conta intrusa não criou nem alterou nenhum item');

SELECT * FROM finish();
ROLLBACK;
