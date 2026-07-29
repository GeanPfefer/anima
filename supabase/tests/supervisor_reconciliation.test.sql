-- SUP-04 — reconciliação e retomada segura do Supervisor V0.
--
-- O que estas asserções provam, em uma frase: a reconciliação decide por fato
-- persistido, nunca por ausência. Cada bloco isola uma combinação real de
-- estado sobrevivente e verifica tanto o que ela faz quanto o que ela se
-- recusa a fazer.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir helpers/routing.inc
SELECT plan(65);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('89000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sup04@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
SELECT ('89000000-0000-0000-0000-0000000000'||lpad(n::text,2,'0'))::uuid,'89000000-0000-0000-0000-000000000000','user','pedido '||n
FROM generate_series(1,14) AS n;
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('89000000-0000-0000-0000-000000000000');
RESET ROLE;

\set prop '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'
\set intel '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-28T12:00:00Z","classifierId":"test"}}'

-- Alvos distintos por cenário: o SUP-05 recusaria dois inícios no mesmo alvo, e
-- aqui vários itens precisam ficar simultaneamente em execução.
\set t1 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"t1"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set t2 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"t2"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set t3 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"t3"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set t4 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"t4"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set t5 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"t5"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
-- Limite de duração declarado: é ele que delimita a tentativa comandada.
\set t6 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"t6"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1,"max_duration_minutes":600}}}'
\set t7 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"t7"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1,"max_duration_minutes":5}}}'
\set t8 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"t8"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set t9 '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"t9"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set ta '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"ta"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','89000000-0000-0000-0000-000000000000',true);

-- ============================================================
-- (1) Reconciliação sem inconsistências não altera nada
-- ============================================================

CREATE TEMP TABLE i1 AS SELECT (public.create_work_proposal('89000000-0000-0000-0000-000000000001','low','programming',:'t1'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i1),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i1),1,0,:'intel'::jsonb);
CREATE TEMP TABLE eventos_antes AS SELECT count(*) AS total FROM public.work_events;

SELECT is((SELECT count(*) FROM public.reconcile_supervised_work()),0::bigint,
  'sem trabalho em voo, a reconciliação não encontra nada e não relata nada');
SELECT is((SELECT count(*) FROM public.work_events),(SELECT total FROM eventos_antes),
  'reconciliação vazia não escreve evento algum');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i1)),'approved',
  'item aprovado e parado permanece exatamente como estava');

-- ============================================================
-- (2) Claim válido não é tomado nem liberado
-- ============================================================

CREATE TEMP TABLE i2 AS SELECT (public.create_work_proposal('89000000-0000-0000-0000-000000000002','low','programming',:'t2'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i2),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i2),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i2),1,'89000000-0000-0000-0000-0000000000c2','supervisor-2',3600);

SELECT is((SELECT finding FROM public.reconcile_supervised_work() WHERE work_item_id=(SELECT id FROM i2)),
  'claim_active','posse ainda válida é reconhecida como ativa');
SELECT is((SELECT action FROM public.reconcile_supervised_work() WHERE work_item_id=(SELECT id FROM i2)),
  'none','posse ainda válida não sofre ação alguma');
SELECT is((SELECT released_at FROM public.work_claims WHERE id='89000000-0000-0000-0000-0000000000c2'),NULL,
  'a reconciliação não libera claim válido');
SELECT is((SELECT owner_instance_id FROM public.work_claims WHERE id='89000000-0000-0000-0000-0000000000c2'),'supervisor-2',
  'a reconciliação não rouba posse de outro executor');

-- ============================================================
-- (3) Item in_progress com tentativa ainda válida permanece protegido
-- ============================================================

CREATE TEMP TABLE i3 AS SELECT (public.create_work_proposal('89000000-0000-0000-0000-000000000003','low','programming',:'t3'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i3),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i3),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i3),1,'89000000-0000-0000-0000-0000000000c3','supervisor-3',3600);
SELECT pg_temp.record_test_route((SELECT id FROM i3),'89000000-0000-0000-0000-0000000000e3','local-runner-v1');
SELECT public.start_claimed_work_attempt('89000000-0000-0000-0000-0000000000c3','89000000-0000-0000-0000-0000000000e3','local-runner-v1');

SELECT is((SELECT count(*) FROM public.reconcile_supervised_work()
  WHERE work_item_id=(SELECT id FROM i3) AND finding='attempt_within_declared_bounds'),1::bigint,
  'tentativa dentro do lease é reconhecida como possivelmente viva');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i3)),'in_progress',
  'execução em curso não é interrompida pela reconciliação');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i3)
  AND event_type='attempt_abandoned'),0::bigint,
  'nenhuma tentativa viva é abandonada');

-- ============================================================
-- (4) Claim expirado é recolhido com razão declarada, sem apagar nada
-- ============================================================

CREATE TEMP TABLE i4 AS SELECT (public.create_work_proposal('89000000-0000-0000-0000-000000000004','low','programming',:'t4'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i4),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i4),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i4),1,'89000000-0000-0000-0000-0000000000c4','supervisor-4',3600);
SET LOCAL ROLE service_role;
UPDATE public.work_claims SET acquired_at=now()-interval '2 hours', expires_at=now()-interval '1 hour'
WHERE id='89000000-0000-0000-0000-0000000000c4';
SET LOCAL ROLE authenticated;

SELECT is((SELECT finding FROM public.reconcile_supervised_work() WHERE work_item_id=(SELECT id FROM i4)),
  'claim_expired','lease vencido é identificado como expirado');
SELECT is((SELECT release_reason FROM public.work_claims WHERE id='89000000-0000-0000-0000-0000000000c4'),
  'expired','o recolhimento usa a mesma razão declarada de acquire_work_claim');
SELECT is((SELECT owner_instance_id FROM public.work_claims WHERE id='89000000-0000-0000-0000-0000000000c4'),
  'supervisor-4','a linha do claim anterior permanece auditável, não é apagada');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i4)
  AND event_type='work_claim_released' AND payload->'data'->>'reason'='expired'),1::bigint,
  'o recolhimento deixa evento append-only com a razão');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i4)),'approved',
  'recolher posse vencida não muda o estado de um item que nunca começou');

-- ============================================================
-- (5) Tentativa supervisionada órfã: lease excedido, sem desfecho
-- ============================================================

CREATE TEMP TABLE i5 AS SELECT (public.create_work_proposal('89000000-0000-0000-0000-000000000005','low','programming',:'t5'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i5),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i5),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i5),1,'89000000-0000-0000-0000-0000000000c5','supervisor-5',3600);
SELECT pg_temp.record_test_route((SELECT id FROM i5),'89000000-0000-0000-0000-0000000000e5','local-runner-v1');
SELECT public.start_claimed_work_attempt('89000000-0000-0000-0000-0000000000c5','89000000-0000-0000-0000-0000000000e5','local-runner-v1');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i5)),'in_progress',
  'a tentativa supervisionada começou e travou o item');
SET LOCAL ROLE service_role;
UPDATE public.work_claims SET acquired_at=now()-interval '2 hours', expires_at=now()-interval '1 hour'
WHERE id='89000000-0000-0000-0000-0000000000c5';
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.reconcile_supervised_work()
  WHERE work_item_id=(SELECT id FROM i5) AND finding='attempt_abandoned'),1::bigint,
  'tentativa que excedeu o lease é abandonada, não concluída');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i5)),'approved',
  'o item volta a aprovado: elegibilidade restaurada, sem afirmar desfecho');
SELECT is((SELECT payload->'data'->>'reason' FROM public.work_events WHERE work_item_id=(SELECT id FROM i5)
  AND event_type='attempt_abandoned'),'lease_expired',
  'a razão do abandono é tipada e aponta o limite excedido');
SELECT is((SELECT payload->'data'->>'origin' FROM public.work_events WHERE work_item_id=(SELECT id FROM i5)
  AND event_type='attempt_abandoned'),'supervised',
  'a origem supervisionada fica registrada');
SELECT is((SELECT release_reason FROM public.work_claims WHERE id='89000000-0000-0000-0000-0000000000c5'),
  'expired','a posse vencida da órfã é recolhida com razão declarada');
-- Nada de sucesso nem fracasso foi afirmado.
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i5)
  AND event_type IN ('result_submitted','execution_failed','result_accepted')),0::bigint,
  'abandonar não afirma resultado, falha nem aceite');
-- Histórico intacto.
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i5)
  AND event_type='execution_started'),1::bigint,
  'o início da tentativa abandonada continua no log; nada é apagado');

-- ============================================================
-- (6) Um limite excedido não basta: exige-se TODOS os declarados
-- ============================================================

CREATE TEMP TABLE i6 AS SELECT (public.create_work_proposal('89000000-0000-0000-0000-000000000006','low','programming',:'t6'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i6),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i6),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM i6),1,'89000000-0000-0000-0000-0000000000c6','supervisor-6',3600);
SELECT pg_temp.record_test_route((SELECT id FROM i6),'89000000-0000-0000-0000-0000000000e6','local-runner-v1');
SELECT public.start_claimed_work_attempt('89000000-0000-0000-0000-0000000000c6','89000000-0000-0000-0000-0000000000e6','local-runner-v1');
SET LOCAL ROLE service_role;
UPDATE public.work_claims SET acquired_at=now()-interval '2 hours', expires_at=now()-interval '1 hour'
WHERE id='89000000-0000-0000-0000-0000000000c6';
SET LOCAL ROLE authenticated;

-- O lease venceu, mas a duração declarada (600 min) ainda não. A execução pode
-- legitimamente seguir viva: recolher a posse é seguro, abandonar não é.
SELECT is((SELECT count(*) FROM public.reconcile_supervised_work()
  WHERE work_item_id=(SELECT id FROM i6) AND finding='claim_expired'),1::bigint,
  'o lease vencido é recolhido mesmo quando a tentativa continua protegida');
SELECT is((SELECT count(*) FROM public.reconcile_supervised_work()
  WHERE work_item_id=(SELECT id FROM i6) AND finding='attempt_within_declared_bounds'),1::bigint,
  'com a duração declarada ainda dentro do limite, a tentativa não é abandonada');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i6)),'in_progress',
  'lease vencido sozinho não devolve o item à fila');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i6)
  AND event_type='attempt_abandoned'),0::bigint,
  'nenhum abandono é escrito enquanto um limite declarado não venceu');

-- ============================================================
-- (7) Tentativa comandada órfã: o limite é o declarado na proposta aprovada
-- ============================================================

CREATE TEMP TABLE i7 AS SELECT (public.create_work_proposal('89000000-0000-0000-0000-000000000007','low','programming',:'t7'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i7),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i7),1,0,:'intel'::jsonb);
SELECT public.start_commanded_work_attempt((SELECT id FROM i7),1,'89000000-0000-0000-0000-0000000000e7','local-runner-v1');
-- O processo morreu aqui: nenhum claim existe, e o único limite persistido é o
-- max_duration_minutes de 5 declarado na proposta aprovada.
SET LOCAL ROLE service_role;
-- Sob service_role as tabelas temporárias do papel anterior não são visíveis;
-- o alvo, único por cenário, identifica o item sem depender delas.
UPDATE public.work_events SET created_at=now()-interval '2 hours'
WHERE event_type='execution_started' AND work_item_id IN (
  SELECT id FROM public.work_items WHERE user_id='89000000-0000-0000-0000-000000000000'
    AND intent#>>'{execution_spec,target,reference}'='t7');
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.reconcile_supervised_work()
  WHERE work_item_id=(SELECT id FROM i7) AND finding='attempt_abandoned'),1::bigint,
  'tentativa comandada que excedeu a duração declarada é abandonada');
SELECT is((SELECT payload->'data'->>'reason' FROM public.work_events WHERE work_item_id=(SELECT id FROM i7)
  AND event_type='attempt_abandoned'),'duration_limit_exceeded',
  'a razão aponta o limite da proposta aprovada, não um relógio arbitrário');
SELECT is((SELECT payload->'data'->>'origin' FROM public.work_events WHERE work_item_id=(SELECT id FROM i7)
  AND event_type='attempt_abandoned'),'commanded',
  'a origem comandada fica registrada');
SELECT is((SELECT payload->'data'->>'claim_id' FROM public.work_events WHERE work_item_id=(SELECT id FROM i7)
  AND event_type='attempt_abandoned'),NULL,
  'a tentativa comandada é abandonada sem inventar posse que nunca existiu');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i7)),'approved',
  'o item comandado volta a aprovado, com o alvo liberado');

-- ============================================================
-- (8) Sem limite declarado não há fato: relata e não toca
-- ============================================================

CREATE TEMP TABLE i8 AS SELECT (public.create_work_proposal('89000000-0000-0000-0000-000000000008','low','programming',:'t8'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i8),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i8),1,0,:'intel'::jsonb);
SELECT public.start_commanded_work_attempt((SELECT id FROM i8),1,'89000000-0000-0000-0000-0000000000e8','local-runner-v1');
SET LOCAL ROLE service_role;
UPDATE public.work_events SET created_at=now()-interval '30 days'
WHERE event_type='execution_started' AND work_item_id IN (
  SELECT id FROM public.work_items WHERE user_id='89000000-0000-0000-0000-000000000000'
    AND intent#>>'{execution_spec,target,reference}'='t8');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE eventos_i8 AS SELECT count(*) AS total FROM public.work_events WHERE work_item_id=(SELECT id FROM i8);

SELECT is((SELECT finding FROM public.reconcile_supervised_work() WHERE work_item_id=(SELECT id FROM i8)),
  'attempt_without_declared_bound','sem lease e sem duração declarada, nada delimita a tentativa');
SELECT is((SELECT action FROM public.reconcile_supervised_work() WHERE work_item_id=(SELECT id FROM i8)),
  'requires_human','o caso sai para decisão humana em vez de virar conclusão inventada');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i8)),'in_progress',
  'sem fato que sustente transição, o estado permanece intocado por mais antigo que seja');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i8)),
  (SELECT total FROM eventos_i8),'relatar não escreve evento');

-- ============================================================
-- (9) Evento final já persistido é materializado sem duplicar
-- ============================================================

CREATE TEMP TABLE i9 AS SELECT (public.create_work_proposal('89000000-0000-0000-0000-000000000009','low','programming',:'t9'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM i9),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM i9),1,0,:'intel'::jsonb);
SELECT public.start_commanded_work_attempt((SELECT id FROM i9),1,'89000000-0000-0000-0000-0000000000e9','local-runner-v1');
SELECT public.record_commanded_work_terminal((SELECT id FROM i9),1,'89000000-0000-0000-0000-0000000000e9',
  jsonb_build_object('kind','result','workItemId',(SELECT id FROM i9),'attemptId','89000000-0000-0000-0000-0000000000e9',
    'approvedProposalVersion',1,'origin','executor','sequence',1,'summary','feito',
    'resultReferences',jsonb_build_array('runner-evidence:x.json'),
    'validations',jsonb_build_array(jsonb_build_object('label','tests','outcome','passed')),
    'limitations',jsonb_build_array('não aplicado'),
    'handoffReference','local-runner:t9:x.zip:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
-- Simula o estado derivado que não acompanhou o evento já gravado.
SET LOCAL ROLE service_role;
UPDATE public.work_items SET state='in_progress'
WHERE user_id='89000000-0000-0000-0000-000000000000'
  AND intent#>>'{execution_spec,target,reference}'='t9';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE eventos_i9 AS SELECT count(*) AS total FROM public.work_events WHERE work_item_id=(SELECT id FROM i9);

SELECT is((SELECT finding FROM public.reconcile_supervised_work() WHERE work_item_id=(SELECT id FROM i9)),
  'terminal_not_materialized','desfecho já persistido cujo estado não acompanhou é identificado');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i9)),'review',
  'o estado derivado é reaplicado a partir da matriz normativa');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i9)
  AND event_type='result_submitted'),1::bigint,
  'o evento final não é duplicado: ele já existia');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i9)),
  (SELECT total FROM eventos_i9),'materializar estado derivado não escreve evento novo');

-- ============================================================
-- (10) Posse aberta cuja tentativa já terminou: liberação por fato, não por relógio
-- ============================================================

CREATE TEMP TABLE ia AS SELECT (public.create_work_proposal('89000000-0000-0000-0000-000000000010','low','programming',:'ta'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM ia),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM ia),1,0,:'intel'::jsonb);
SELECT public.acquire_work_claim((SELECT id FROM ia),1,'89000000-0000-0000-0000-0000000000ca','supervisor-a',3600);
SELECT pg_temp.record_test_route((SELECT id FROM ia),'89000000-0000-0000-0000-0000000000ea','local-runner-v1');
SELECT public.start_claimed_work_attempt('89000000-0000-0000-0000-0000000000ca','89000000-0000-0000-0000-0000000000ea','local-runner-v1');
SELECT public.record_commanded_work_terminal((SELECT id FROM ia),1,'89000000-0000-0000-0000-0000000000ea',
  jsonb_build_object('kind','result','workItemId',(SELECT id FROM ia),'attemptId','89000000-0000-0000-0000-0000000000ea',
    'approvedProposalVersion',1,'origin','executor','sequence',1,'summary','feito',
    'resultReferences',jsonb_build_array('runner-evidence:y.json'),
    'validations',jsonb_build_array(jsonb_build_object('label','tests','outcome','passed')),
    'limitations',jsonb_build_array('não aplicado'),
    'handoffReference','local-runner:ta:y.zip:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'));
-- O processo morreu entre gravar o terminal e liberar a posse. O lease AINDA
-- está ativo: se a liberação viesse do relógio, nada aconteceria aqui.
SELECT ok((SELECT expires_at > now() FROM public.work_claims WHERE id='89000000-0000-0000-0000-0000000000ca'),
  'o lease desta posse ainda está ativo quando a reconciliação roda');

SELECT is((SELECT finding FROM public.reconcile_supervised_work() WHERE work_item_id=(SELECT id FROM ia)),
  'claim_open_after_terminal','posse aberta sobre tentativa já encerrada é identificada pelo evento, não pelo tempo');
SELECT is((SELECT release_reason FROM public.work_claims WHERE id='89000000-0000-0000-0000-0000000000ca'),
  'attempt_finished','a razão da liberação descreve o que de fato aconteceu');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM ia)),'review',
  'liberar a posse não mexe no item, que segue aguardando revisão humana');

-- ============================================================
-- (11) Idempotência: reconciliação repetida não muda mais nada
-- ============================================================

CREATE TEMP TABLE antes_eventos AS SELECT count(*) AS total FROM public.work_events;
CREATE TEMP TABLE antes_estados AS SELECT id, state, updated_at FROM public.work_items
  WHERE user_id='89000000-0000-0000-0000-000000000000';
CREATE TEMP TABLE antes_claims AS SELECT id, released_at, release_reason FROM public.work_claims
  WHERE user_id='89000000-0000-0000-0000-000000000000';
CREATE TEMP TABLE segunda AS SELECT * FROM public.reconcile_supervised_work();

SELECT is((SELECT count(*) FROM segunda WHERE action IN ('state_materialized','claim_released','attempt_abandoned')),0::bigint,
  'a segunda reconciliação não toma nenhuma ação mutante');
SELECT is((SELECT count(*) FROM public.work_events),(SELECT total FROM antes_eventos),
  'a segunda reconciliação não cria evento algum');
SELECT is((SELECT count(*) FROM public.work_items i JOIN antes_estados a ON a.id=i.id
  WHERE i.state IS DISTINCT FROM a.state),0::bigint,
  'nenhum estado de item muda na segunda passada');
SELECT is((SELECT count(*) FROM public.work_claims c JOIN antes_claims a ON a.id=c.id
  WHERE c.released_at IS DISTINCT FROM a.released_at OR c.release_reason IS DISTINCT FROM a.release_reason),0::bigint,
  'nenhuma posse muda na segunda passada');
-- Terceira passada: a estabilidade não depende de ter rodado duas vezes.
SELECT is((SELECT count(*) FROM public.reconcile_supervised_work()
  WHERE action IN ('state_materialized','claim_released','attempt_abandoned')),0::bigint,
  'a reconciliação converge: passadas seguintes são inertes');

-- ============================================================
-- (12) Nada é aceito, autorizado ou integrado
-- ============================================================

SELECT is((SELECT count(*) FROM public.work_events e JOIN public.work_items i ON i.id=e.work_item_id
  WHERE i.user_id='89000000-0000-0000-0000-000000000000' AND e.event_type='result_accepted'),0::bigint,
  'a reconciliação nunca emite aceite de resultado');
SELECT is((SELECT count(*) FROM public.work_items WHERE user_id='89000000-0000-0000-0000-000000000000'
  AND state='completed'),0::bigint,
  'nenhum item é concluído pela reconciliação');
SELECT is((SELECT count(*) FROM public.work_events e JOIN public.work_items i ON i.id=e.work_item_id
  WHERE i.user_id='89000000-0000-0000-0000-000000000000' AND e.author='system'
    AND e.event_type NOT IN ('work_routing_decided','work_claimed','work_claim_released','attempt_abandoned')),0::bigint,
  'o vocabulário que a reconciliação escreve é fechado: roteamento, posse e abandono, nada mais');

-- ============================================================
-- (13) Sinal tardio de tentativa abandonada é recusado
-- ============================================================

-- O executor de i7 sobreviveu ao abandono e entrega agora. Ressuscitar a
-- tentativa antiga é exatamente o duplo processamento que o SUP-04 impede.
SELECT throws_ok($$SELECT public.record_commanded_work_terminal((SELECT id FROM i7),1,'89000000-0000-0000-0000-0000000000e7',
  jsonb_build_object('kind','result','workItemId',(SELECT id FROM i7),'attemptId','89000000-0000-0000-0000-0000000000e7',
    'approvedProposalVersion',1,'origin','executor','sequence',1,'summary','tarde demais',
    'resultReferences',jsonb_build_array('runner-evidence:z.json'),
    'validations',jsonb_build_array(jsonb_build_object('label','tests','outcome','passed')),
    'limitations',jsonb_build_array('não aplicado'),
    'handoffReference','local-runner:t7:z.zip:sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'))$$,
  '55000','attempt was abandoned by reconciliation',
  'sinal tardio de tentativa abandonada é recusado com erro tipado');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM i7)),'approved',
  'a recusa do sinal tardio é inerte: o item não é movido');

-- Replay legítimo do INT-04 continua idempotente onde não houve abandono.
SELECT lives_ok($$SELECT public.record_commanded_work_terminal((SELECT id FROM i9),1,'89000000-0000-0000-0000-0000000000e9',
  jsonb_build_object('kind','result','workItemId',(SELECT id FROM i9),'attemptId','89000000-0000-0000-0000-0000000000e9',
    'approvedProposalVersion',1,'origin','executor','sequence',1,'summary','feito',
    'resultReferences',jsonb_build_array('runner-evidence:x.json'),
    'validations',jsonb_build_array(jsonb_build_object('label','tests','outcome','passed')),
    'limitations',jsonb_build_array('não aplicado'),
    'handoffReference','local-runner:t9:x.zip:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'))$$,
  'o replay idempotente do terminal do INT-04 permanece intacto');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i9)
  AND event_type='result_submitted'),1::bigint,
  'o replay legítimo continua sem duplicar o evento');

-- ============================================================
-- (14) Elegibilidade restaurada, sem atropelar a exclusividade de alvo
-- ============================================================

-- O item abandonado volta à fila por ser derivada: nada precisou ser reenfileirado.
SELECT is((SELECT count(*) FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM i5)),1::bigint,
  'o item cuja tentativa foi abandonada volta a aparecer na fila derivada');
SELECT is((SELECT target_occupied FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM i5)),false,
  'com o alvo vago, o item retomável fica de fato disponível');

-- Item novo no alvo de i3, que segue em execução sob posse válida.
CREATE TEMP TABLE ib AS SELECT (public.create_work_proposal('89000000-0000-0000-0000-000000000011','low','programming',:'t3'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM ib),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM ib),1,0,:'intel'::jsonb);
SELECT is((SELECT target_occupied FROM public.autonomous_work_queue() WHERE work_item_id=(SELECT id FROM ib)),true,
  'a reconciliação não torna elegível um item cujo alvo continua ocupado');
SELECT isnt((SELECT work_item_id FROM public.next_autonomous_work()),(SELECT id FROM ib),
  'o item de alvo ocupado não é escolhido para execução');

-- A exclusividade do SUP-05 continua valendo sobre o alvo ainda ocupado.
SELECT throws_ok($$SELECT public.start_commanded_work_attempt((SELECT id FROM ib),1,'89000000-0000-0000-0000-0000000000eb','local-runner-v1')$$,
  '55000','work target is busy with a running attempt',
  'o contrato do SUP-05 permanece intacto depois da reconciliação');

-- Retomada real do alvo liberado: o item abandonado aceita uma tentativa NOVA,
-- com claim novo, exatamente como o AUTO-05 exige. A reconciliação não fez isso
-- sozinha — foi preciso alguém pedir.
SELECT is((public.acquire_work_claim((SELECT id FROM i5),1,'89000000-0000-0000-0000-0000000000d5','supervisor-5b',3600)).target_reference,
  't5','o alvo do item reconciliado está livre para uma posse nova');
SELECT pg_temp.record_test_route((SELECT id FROM i5),'89000000-0000-0000-0000-0000000000f5','local-runner-v1');
SELECT is((public.start_claimed_work_attempt('89000000-0000-0000-0000-0000000000d5','89000000-0000-0000-0000-0000000000f5','local-runner-v1')).state,
  'in_progress','a retomada acontece com claim novo e tentativa nova, nunca reaproveitando as anteriores');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM i5)
  AND event_type='execution_started'),2::bigint,
  'as duas tentativas coexistem no log append-only: a abandonada e a nova');

-- ============================================================
-- (15) Fronteira de acesso
-- ============================================================

RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.reconcile_supervised_work()$$,'42501',NULL,
  'sem autenticação a reconciliação é recusada');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','89000000-0000-0000-0000-000000000000',true);

SELECT * FROM finish();
RESET ROLE;
ROLLBACK;
