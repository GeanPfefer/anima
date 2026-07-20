-- SUP-03 — no máximo um trabalho ativo por alvo, garantido pelo banco.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(31);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('96000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','alvo@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
SELECT ('96000000-0000-0000-0000-00000000000'||n)::uuid,'96000000-0000-0000-0000-000000000000','user','pedido '||n
FROM generate_series(1,9) AS n;
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('96000000-0000-0000-0000-000000000000');
RESET ROLE;

\set prop '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'
\set anima '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set outro '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"outro"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set workspace_anima '{"execution_spec":{"schema_version":1,"target":{"kind":"workspace","reference":"anima"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000000',true);

-- Dois itens no MESMO alvo, um item em alvo diferente.
CREATE TEMP TABLE a1 AS SELECT (public.create_work_proposal('96000000-0000-0000-0000-000000000001','low','programming',:'anima'::jsonb,:'prop'::jsonb)).id;
CREATE TEMP TABLE a2 AS SELECT (public.create_work_proposal('96000000-0000-0000-0000-000000000002','low','programming',:'anima'::jsonb,:'prop'::jsonb)).id;
CREATE TEMP TABLE b1 AS SELECT (public.create_work_proposal('96000000-0000-0000-0000-000000000003','low','programming',:'outro'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM a1),1,'approve','{}');
SELECT public.resolve_approval((SELECT id FROM a2),1,'approve','{}');
SELECT public.resolve_approval((SELECT id FROM b1),1,'approve','{}');

-- ---------- (1) dois itens elegíveis no mesmo alvo ----------
SELECT is((SELECT count(*) FROM public.autonomous_work_queue()),3::bigint,'três itens elegíveis aguardam');
SELECT is((SELECT count(*) FROM public.autonomous_work_queue() WHERE target_occupied),0::bigint,
  'nenhum alvo ocupado antes de qualquer posse');

-- ---------- (2) somente um obtém posse ativa sobre o alvo ----------
SELECT is((public.acquire_work_claim((SELECT id FROM a1),1,'96000000-0000-0000-0000-0000000000c1','supervisor-1',300)).target_reference,
  'anima','o alvo é derivado no servidor e gravado no claim');
SELECT throws_ok($$SELECT public.acquire_work_claim((SELECT id FROM a2),1,'96000000-0000-0000-0000-0000000000c2','supervisor-2',300)$$,
  '55000','work target is held by an active claim','segundo item do mesmo alvo é recusado');
SELECT is((SELECT count(*) FROM public.work_claims WHERE target_reference='anima' AND released_at IS NULL),1::bigint,
  'somente um claim aberto por alvo');
SELECT is((SELECT target_occupied FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM a2)),true,
  'o item que espera continua na fila, marcado como alvo ocupado');
SELECT is((SELECT count(*) FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM a2)),1::bigint,
  'esperar não descarta o item da fila');

-- Exclusividade por item e por alvo são invariantes distintas.
SELECT is((SELECT count(*) FROM pg_indexes WHERE tablename='work_claims'
  AND indexname IN ('work_claims_single_open_per_item_idx','work_claims_single_open_per_target_idx')),2::bigint,
  'exclusividade por item e por alvo são índices independentes');

-- ---------- (3) alvos diferentes progridem em paralelo ----------
SELECT is((SELECT target_occupied FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM b1)),false,
  'alvo diferente permanece livre');
-- A seleção pula o mais antigo cujo alvo está ocupado, sem reordenar a fila.
SELECT is((SELECT work_item_id FROM public.next_autonomous_work()),(SELECT id FROM b1),
  'a seleção pula o item de alvo ocupado e escolhe o alvo livre');
SELECT is((SELECT skipped_occupied_targets FROM public.next_autonomous_work()),1::bigint,
  'a razão informa quantos foram pulados por alvo ocupado');
SELECT is((public.acquire_work_claim((SELECT id FROM b1),1,'96000000-0000-0000-0000-0000000000c3','supervisor-3',300)).owner_instance_id,
  'supervisor-3','item em alvo diferente adquire posse em paralelo');
SELECT is((SELECT count(*) FROM public.work_claims WHERE released_at IS NULL AND user_id='96000000-0000-0000-0000-000000000000'),2::bigint,
  'dois claims ativos coexistem em alvos distintos');

-- ---------- (7) replay do vencedor ----------
SELECT is((public.acquire_work_claim((SELECT id FROM a1),1,'96000000-0000-0000-0000-0000000000c1','supervisor-1',300)).id,
  '96000000-0000-0000-0000-0000000000c1'::uuid,'replay do vencedor devolve o mesmo claim');
SELECT is((SELECT count(*) FROM public.work_events WHERE event_type='work_claimed'
  AND payload->'data'->>'claim_id'='96000000-0000-0000-0000-0000000000c1'),1::bigint,'replay não duplica evento');

-- ---------- todo alvo ocupado: aguardar não é fila vazia ----------
SELECT is((SELECT count(*) FROM public.next_autonomous_work()),0::bigint,
  'com todo alvo ocupado nada é selecionado');
SELECT is((SELECT count(*) FROM public.autonomous_work_queue() WHERE target_occupied),1::bigint,
  'mas a fila continua mostrando quem espera — não é fila vazia');

-- ---------- (5) claim liberado libera o alvo ----------
SELECT public.release_work_claim('96000000-0000-0000-0000-0000000000c1','released_without_attempt');
SELECT is((SELECT target_occupied FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM a2)),false,
  'claim liberado devolve o alvo');
SELECT is((public.acquire_work_claim((SELECT id FROM a2),1,'96000000-0000-0000-0000-0000000000c4','supervisor-2',300)).target_reference,
  'anima','o alvo liberado pode ser reivindicado por outro item');

-- ---------- (4) claim expirado libera o alvo, de forma auditável ----------
SET LOCAL ROLE service_role;
UPDATE public.work_claims SET acquired_at=now()-interval '2 hours', expires_at=now()-interval '1 hour'
WHERE id='96000000-0000-0000-0000-0000000000c4';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000000',true);
SELECT is((SELECT target_occupied FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM a1)),false,
  'claim expirado não bloqueia o alvo permanentemente');
SELECT is((public.acquire_work_claim((SELECT id FROM a1),1,'96000000-0000-0000-0000-0000000000c5','supervisor-1',300)).target_reference,
  'anima','outro item reivindica o alvo cujo claim expirou');
SELECT is((SELECT release_reason FROM public.work_claims WHERE id='96000000-0000-0000-0000-0000000000c4'),'expired',
  'o claim expirado de outro item é liberado com razão, não apagado');
SELECT is((SELECT count(*) FROM public.work_events WHERE event_type='work_claim_released'
  AND payload->'data'->>'claim_id'='96000000-0000-0000-0000-0000000000c4'),1::bigint,
  'a liberação por expiração fica registrada no log append-only');

-- ---------- execução em curso ocupa o alvo mesmo sem claim (INT-04) ----------
SELECT public.release_work_claim('96000000-0000-0000-0000-0000000000c5','released_without_attempt');
CREATE TEMP TABLE cmd AS SELECT (public.create_work_proposal('96000000-0000-0000-0000-000000000004','low','programming',:'anima'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM cmd),1,'approve','{}');
SELECT public.start_commanded_work_attempt((SELECT id FROM cmd),1,'96000000-0000-0000-0000-0000000000e1','local-runner-v1');
SELECT throws_ok($$SELECT public.acquire_work_claim((SELECT id FROM a1),1,'96000000-0000-0000-0000-0000000000c6','supervisor-1',300)$$,
  '55000','work target is busy with a running attempt','execução comandada sem claim ocupa o alvo');
SELECT is((SELECT target_occupied FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM a1)),true,
  'a fila reflete a ocupação por execução em curso');

-- ---------- (6) item aguardando humano não bloqueia o alvo ----------
SELECT public.record_commanded_work_terminal((SELECT id FROM cmd),1,'96000000-0000-0000-0000-0000000000e1',
  jsonb_build_object('kind','result','workItemId',(SELECT id FROM cmd),'attemptId','96000000-0000-0000-0000-0000000000e1',
    'approvedProposalVersion',1,'origin','executor','sequence',1,'summary','feito',
    'resultReferences',jsonb_build_array('runner-evidence:x.json'),
    'validations',jsonb_build_array(jsonb_build_object('label','tests','outcome','passed')),
    'limitations',jsonb_build_array('não aplicado'),
    'handoffReference','local-runner:anima:x.zip:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM cmd)),'review','o item comandado aguarda revisão humana');
SELECT is((SELECT target_occupied FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM a1)),false,
  'item em revisão aguarda humano e não bloqueia novos trabalhos no alvo');

-- ---------- (9) alvo ausente ou malformado falha fechado ----------
CREATE TEMP TABLE semalvo AS SELECT (public.create_work_proposal('96000000-0000-0000-0000-000000000005','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"   "},"permissions":[],"validation_criteria":[{"label":"t"}],"limits":{"max_attempts":1}}}'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM semalvo),1,'approve','{}');
SELECT throws_ok($$SELECT public.acquire_work_claim((SELECT id FROM semalvo),1,'96000000-0000-0000-0000-0000000000c7','supervisor-1',300)$$,
  '22023','execution target missing','alvo em branco falha fechado na aquisição');
SELECT is((SELECT count(*) FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM semalvo)),0::bigint,
  'item de alvo ilegível nunca entra na fila');

-- ---------- (10) nenhuma tentativa ou efeito externo criado pela posse ----------
SELECT is((SELECT count(*) FROM public.work_claims WHERE user_id='96000000-0000-0000-0000-000000000000' AND attempt_id IS NOT NULL),0::bigint,
  'nenhuma tentativa foi vinculada apenas por adquirir posse');
SELECT is((SELECT count(*) FROM public.work_items WHERE user_id='96000000-0000-0000-0000-000000000000' AND state='in_progress'),0::bigint,
  'nenhum item entrou em execução pela seleção ou pelo claim');

SELECT * FROM finish();
RESET ROLE;
ROLLBACK;
