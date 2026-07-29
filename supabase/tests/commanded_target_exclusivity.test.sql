-- SUP-05 — exclusividade de alvo simétrica: nenhuma execução, comandada ou
-- autônoma, inicia sobre alvo ocupado. As duas direções são provadas aqui.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir helpers/routing.inc
SELECT plan(25);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('98000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sup05@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
SELECT ('98000000-0000-0000-0000-00000000000'||n)::uuid,'98000000-0000-0000-0000-000000000000','user','pedido '||n
FROM generate_series(1,9) AS n;
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('98000000-0000-0000-0000-000000000000');
RESET ROLE;

\set prop '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'
\set intel '{"schemaVersion":1,"complexity":"bounded","risk":"low","reversibility":"reversible","planClarity":"clear","urgency":"normal","provenance":{"kind":"human_confirmed","classifiedAt":"2026-07-28T12:00:00Z","classifierId":"test"}}'
\set anima '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'
\set outro '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"outro"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}'

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000000',true);

CREATE TEMP TABLE a1 AS SELECT (public.create_work_proposal('98000000-0000-0000-0000-000000000001','low','programming',:'anima'::jsonb,:'prop'::jsonb)).id;
CREATE TEMP TABLE a2 AS SELECT (public.create_work_proposal('98000000-0000-0000-0000-000000000002','low','programming',:'anima'::jsonb,:'prop'::jsonb)).id;
CREATE TEMP TABLE a3 AS SELECT (public.create_work_proposal('98000000-0000-0000-0000-000000000003','low','programming',:'anima'::jsonb,:'prop'::jsonb)).id;
CREATE TEMP TABLE b1 AS SELECT (public.create_work_proposal('98000000-0000-0000-0000-000000000004','low','programming',:'outro'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM a1),1,'approve','{}');
SELECT public.resolve_approval((SELECT id FROM a2),1,'approve','{}');
SELECT public.resolve_approval((SELECT id FROM a3),1,'approve','{}');
SELECT public.resolve_approval((SELECT id FROM b1),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM a1),1,0,:'intel'::jsonb);
SELECT public.record_work_intelligence_classification((SELECT id FROM a2),1,0,:'intel'::jsonb);
SELECT public.record_work_intelligence_classification((SELECT id FROM a3),1,0,:'intel'::jsonb);
SELECT public.record_work_intelligence_classification((SELECT id FROM b1),1,0,:'intel'::jsonb);

-- ---------- (1) alvo livre: o caminho comandado segue intacto ----------
SELECT is((public.start_commanded_work_attempt((SELECT id FROM a1),1,'98000000-0000-0000-0000-0000000000e1','local-runner-v1')).state,
  'in_progress','execução comandada com alvo livre inicia normalmente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM a1) AND event_type='execution_started'),1::bigint,
  'exatamente um início registrado');
-- O payload comandado permanece o do INT-04: sem claim_id quando não há claim.
SELECT ok((SELECT NOT payload->'data' ? 'claim_id' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM a1) AND event_type='execution_started'),
  'o payload comandado permanece sem claim_id, byte a byte como no INT-04');
SELECT is((SELECT payload->'data'->>'reason' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM a1) AND event_type='work_started'),'commanded_execution',
  'a razão continua distinguindo o caminho comandado');

-- ---------- (2) comandado bloqueado por OUTRO item in_progress ----------
SELECT throws_ok($$SELECT public.start_commanded_work_attempt((SELECT id FROM a2),1,'98000000-0000-0000-0000-0000000000e2','local-runner-v1')$$,
  '55000','work target is busy with a running attempt',
  'execução comandada é recusada quando outro item já executa no alvo');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM a2)),'approved',
  'o item recusado permanece aprovado, não entra em execução');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM a2)
  AND event_type IN ('work_started','execution_started')),0::bigint,
  'a recusa não deixa evento de início algum');

-- ---------- (3) alvo distinto continua progredindo em paralelo ----------
SELECT is((public.start_commanded_work_attempt((SELECT id FROM b1),1,'98000000-0000-0000-0000-0000000000e4','local-runner-v1')).state,
  'in_progress','alvo distinto não é bloqueado');

-- Encerra as duas execuções para liberar os alvos.
SELECT public.record_commanded_work_terminal((SELECT id FROM a1),1,'98000000-0000-0000-0000-0000000000e1',
  jsonb_build_object('kind','result','workItemId',(SELECT id FROM a1),'attemptId','98000000-0000-0000-0000-0000000000e1',
    'approvedProposalVersion',1,'origin','executor','sequence',1,'summary','feito',
    'resultReferences',jsonb_build_array('runner-evidence:x.json'),
    'validations',jsonb_build_array(jsonb_build_object('label','tests','outcome','passed')),
    'limitations',jsonb_build_array('não aplicado'),
    'handoffReference','local-runner:anima:x.zip:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));

-- ---------- (4) item em revisão NÃO ocupa: o comandado volta a poder iniciar ----------
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM a1)),'review',
  'o item encerrado aguarda revisão humana');
SELECT is((public.start_commanded_work_attempt((SELECT id FROM a2),1,'98000000-0000-0000-0000-0000000000e2','local-runner-v1')).state,
  'in_progress','item em review não bloqueia: aguardar humano não é executar');
SELECT public.record_commanded_work_terminal((SELECT id FROM a2),1,'98000000-0000-0000-0000-0000000000e2',
  jsonb_build_object('kind','error','workItemId',(SELECT id FROM a2),'attemptId','98000000-0000-0000-0000-0000000000e2',
    'approvedProposalVersion',1,'origin','executor','sequence',1,'code','runner_failed','message','falhou','retryable',false,
    'handoffReference','local-runner:anima:y.zip:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'));
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM a2)),'failed','o item falhou e encerrou');

-- ---------- (5) comandado bloqueado por claim autônomo ATIVO ----------
-- Esta é a brecha do SUP-05: o supervisor tem posse do alvo e o usuário comanda.
SELECT is((public.acquire_work_claim((SELECT id FROM a3),1,'98000000-0000-0000-0000-0000000000c1','supervisor-1',300)).target_reference,
  'anima','o supervisor adquire posse autônoma do alvo');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM a3)),'approved',
  'claim não é execução: o item permanece aprovado');
SELECT throws_ok($$SELECT public.start_commanded_work_attempt((SELECT id FROM a1),2,'98000000-0000-0000-0000-0000000000e5','local-runner-v1')$$,
  '55000','work item state or proposal version changed','item já revisado não reinicia por versão');

-- Um item novo e aprovado no alvo sob claim autônomo é o caso canônico.
CREATE TEMP TABLE a4 AS SELECT (public.create_work_proposal('98000000-0000-0000-0000-000000000005','low','programming',:'anima'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM a4),1,'approve','{}');
SELECT public.record_work_intelligence_classification((SELECT id FROM a4),1,0,:'intel'::jsonb);
SELECT throws_ok($$SELECT public.start_commanded_work_attempt((SELECT id FROM a4),1,'98000000-0000-0000-0000-0000000000e6','local-runner-v1')$$,
  '55000','work target is held by an active claim',
  'execução comandada sobre alvo com claim autônomo ativo é recusada com erro tipado');

-- O claim alheio sai intacto: nem roubado, nem liberado, nem vinculado.
SELECT is((SELECT released_at FROM public.work_claims WHERE id='98000000-0000-0000-0000-0000000000c1'),NULL,
  'o caminho comandado não libera o claim alheio');
SELECT is((SELECT owner_instance_id FROM public.work_claims WHERE id='98000000-0000-0000-0000-0000000000c1'),'supervisor-1',
  'o caminho comandado não rouba a posse alheia');
SELECT is((SELECT attempt_id FROM public.work_claims WHERE id='98000000-0000-0000-0000-0000000000c1'),NULL,
  'a tentativa recusada não é vinculada ao claim alheio');
-- A recusa é inerte: o histórico do item comandado fica exatamente onde a
-- aprovação o deixou, sem qualquer marca de execução.
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM a4)
  AND event_type IN ('work_started','execution_started','execution_failed','result_submitted')),0::bigint,
  'a recusa não escreve evento de execução no item comandado');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM a4)),'approved',
  'o item comandado recusado permanece aprovado, disponível para quando o alvo vagar');

-- ---------- (6) simetria: o dono do claim inicia sem bloquear a si mesmo ----------
SELECT pg_temp.record_test_route((SELECT id FROM a3),'98000000-0000-0000-0000-0000000000e7','local-runner-v1');
SELECT is((public.start_claimed_work_attempt('98000000-0000-0000-0000-0000000000c1','98000000-0000-0000-0000-0000000000e7','local-runner-v1')).state,
  'in_progress','o próprio dono do claim inicia: a posse não bloqueia a si mesma');
SELECT is((SELECT payload->'data'->>'claim_id' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM a3) AND event_type='execution_started'),'98000000-0000-0000-0000-0000000000c1',
  'o início supervisionado permanece correlacionado ao claim');

-- ---------- (7) replay continua idempotente sobre alvo agora ocupado ----------
-- O item a3 está in_progress e ocupa o alvo. Reentregar a MESMA tentativa não
-- pode ser confundida com nova ocupação — é replay, e o aceite do SUP-05 exige
-- que continue permitida.
SELECT lives_ok($$SELECT public.start_claimed_work_attempt('98000000-0000-0000-0000-0000000000c1','98000000-0000-0000-0000-0000000000e7','local-runner-v1')$$,
  'replay da mesma tentativa supervisionada permanece idempotente mesmo com o alvo ocupado por ela');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM a3) AND event_type='execution_started'),1::bigint,
  'o replay não duplica o início');

-- ---------- (8) alvo inderivável falha fechado no início comandado ----------
CREATE TEMP TABLE semalvo AS SELECT (public.create_work_proposal('98000000-0000-0000-0000-000000000006','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"   "},"permissions":[],"validation_criteria":[{"label":"t"}],"limits":{"max_attempts":1}}}'::jsonb,:'prop'::jsonb)).id;
SELECT public.resolve_approval((SELECT id FROM semalvo),1,'approve','{}');
SELECT throws_ok($$SELECT public.start_commanded_work_attempt((SELECT id FROM semalvo),1,'98000000-0000-0000-0000-0000000000e8','local-runner-v1')$$,
  '22023','execution target missing',
  'alvo em branco falha fechado no início comandado, como já falhava na aquisição');

SELECT * FROM finish();
RESET ROLE;
ROLLBACK;
