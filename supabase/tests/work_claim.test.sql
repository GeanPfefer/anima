-- AUTO-02 — claim exclusivo e expiração provados na fonte de verdade.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(31);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('91000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','claim@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000000','user','supervisione'),
('91000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000000','user','segundo item'),
('91000000-0000-0000-0000-000000000003','91000000-0000-0000-0000-000000000000','user','terceiro item');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('91000000-0000-0000-0000-000000000000');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000000',true);

CREATE TEMP TABLE item AS SELECT (public.create_work_proposal('91000000-0000-0000-0000-000000000001','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":["workspace_read"],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}',
  '{"schema_version":1,"data":{"summary":"x","objective":"corrigir","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}')).id;
SELECT public.resolve_approval((SELECT id FROM item),1,'approve','{}');

-- Item ainda não aprovado, usado para provar que inelegível não é reivindicável.
CREATE TEMP TABLE pending AS SELECT (public.create_work_proposal('91000000-0000-0000-0000-000000000002','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}',
  '{"schema_version":1,"data":{"summary":"y","objective":"outro","included_scope":["b.py"],"excluded_scope":["deploy"],"expected_effects":["ok"],"risks":[]}}')).id;

-- ---------- aquisição ----------
SELECT is((public.acquire_work_claim((SELECT id FROM item),1,'91000000-0000-0000-0000-0000000000a1','supervisor-1',300)).owner_instance_id,
  'supervisor-1','claim concedido ao primeiro supervisor');
SELECT is((SELECT state FROM public.work_items WHERE id=(SELECT id FROM item)),'approved',
  'claim não é execução: o item permanece aprovado');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='work_claimed'),1::bigint,
  'aquisição registrada uma única vez em work_events');
SELECT is((SELECT payload->'data'->>'owner_instance_id' FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='work_claimed'),
  'supervisor-1','o evento correlaciona a posse');
SELECT is((SELECT attempt_id FROM public.work_claims WHERE id='91000000-0000-0000-0000-0000000000a1'),NULL::uuid,
  'claim nasce sem tentativa associada');

-- ---------- exclusividade sob disputa ----------
SELECT throws_ok($$SELECT public.acquire_work_claim((SELECT id FROM item),1,'91000000-0000-0000-0000-0000000000a2','supervisor-2',300)$$,
  '55000','work item is held by an active claim','segundo supervisor é recusado');
SELECT is((SELECT count(*) FROM public.work_claims WHERE work_item_id=(SELECT id FROM item)),1::bigint,
  'somente um claim foi concedido');
SELECT throws_ok($$INSERT INTO public.work_claims(id,work_item_id,user_id,approved_proposal_version,owner_instance_id,expires_at)
  SELECT '91000000-0000-0000-0000-0000000000a3',(SELECT id FROM item),'91000000-0000-0000-0000-000000000000',1,'burlador',now()+interval '5 min'$$,
  '42501','permission denied for table work_claims','a exclusividade não depende da aplicação: cliente não escreve na tabela');

-- ---------- replay ----------
SELECT is((public.acquire_work_claim((SELECT id FROM item),1,'91000000-0000-0000-0000-0000000000a1','supervisor-1',300)).id,
  '91000000-0000-0000-0000-0000000000a1'::uuid,'replay do mesmo comando devolve o mesmo claim');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='work_claimed'),1::bigint,
  'replay não duplica evento');
SELECT throws_ok($$SELECT public.acquire_work_claim((SELECT id FROM item),1,'91000000-0000-0000-0000-0000000000a1','supervisor-9',300)$$,
  '55000','claim identity conflict','mesmo claim com outra posse falha fechado');

-- ---------- inelegibilidade e checkpoint humano ----------
SELECT throws_ok($$SELECT public.acquire_work_claim((SELECT id FROM pending),1,'91000000-0000-0000-0000-0000000000b1','supervisor-1',300)$$,
  '55000','work item is not eligible for an autonomous claim','item aguardando decisão humana é ignorado');
SELECT throws_ok($$SELECT public.acquire_work_claim((SELECT id FROM item),2,'91000000-0000-0000-0000-0000000000b2','supervisor-1',300)$$,
  '55000','work item is not eligible for an autonomous claim','versão divergente falha fechado');
SELECT throws_ok($$SELECT public.acquire_work_claim((SELECT id FROM item),1,'91000000-0000-0000-0000-0000000000b3','   ',300)$$,
  '22023','invalid claim request','posse ambígua falha fechado');
SELECT throws_ok($$SELECT public.acquire_work_claim((SELECT id FROM item),1,'91000000-0000-0000-0000-0000000000b4','supervisor-1',0)$$,
  '22023','invalid claim request','validade não positiva falha fechado');

-- ---------- uma tentativa por claim ----------
SELECT is((public.start_claimed_work_attempt('91000000-0000-0000-0000-0000000000a1','91000000-0000-0000-0000-0000000000c1','local-runner-v1')).state,
  'in_progress','a tentativa só começa em passo separado do claim');
SELECT is((SELECT attempt_id FROM public.work_claims WHERE id='91000000-0000-0000-0000-0000000000a1'),
  '91000000-0000-0000-0000-0000000000c1'::uuid,'claim e tentativa correlacionados');
SELECT is((SELECT payload->'data'->>'claim_id' FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='execution_started'),
  '91000000-0000-0000-0000-0000000000a1','o evento de execução aponta o claim');
SELECT is((SELECT payload->'data'->>'reason' FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='work_started'),
  'supervised_execution','início supervisionado é distinguível do comandado');
SELECT lives_ok($$SELECT public.start_claimed_work_attempt('91000000-0000-0000-0000-0000000000a1','91000000-0000-0000-0000-0000000000c1','local-runner-v1')$$,
  'reentregar a mesma tentativa é idempotente');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM item) AND event_type='execution_started'),1::bigint,
  'a tentativa foi iniciada uma única vez');
SELECT throws_ok($$SELECT public.start_claimed_work_attempt('91000000-0000-0000-0000-0000000000a1','91000000-0000-0000-0000-0000000000c2','local-runner-v1')$$,
  '55000','claim already started another attempt','um claim não inicia uma segunda tentativa');

-- ---------- liberação auditável ----------
SELECT throws_ok($$SELECT public.release_work_claim('91000000-0000-0000-0000-0000000000a1','released_without_attempt')$$,
  '22023','an attempt was started under this claim','razão de liberação incoerente é recusada');
SELECT is((public.release_work_claim('91000000-0000-0000-0000-0000000000a1','attempt_finished')).release_reason,
  'attempt_finished','liberação registra a razão');
SELECT lives_ok($$SELECT public.release_work_claim('91000000-0000-0000-0000-0000000000a1','attempt_finished')$$,
  'liberação repetida é idempotente');
SELECT throws_ok($$SELECT public.release_work_claim('91000000-0000-0000-0000-0000000000a1','expired')$$,
  '55000','claim already released with a different reason','liberação não reescreve o histórico');
SELECT is((SELECT count(*) FROM public.work_claims WHERE id='91000000-0000-0000-0000-0000000000a1' AND acquired_at IS NOT NULL),1::bigint,
  'o claim liberado permanece auditável');

-- ---------- expiração e retomada ----------
CREATE TEMP TABLE resumed AS SELECT (public.create_work_proposal('91000000-0000-0000-0000-000000000003','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}}',
  '{"schema_version":1,"data":{"summary":"z","objective":"retomar","included_scope":["c.py"],"excluded_scope":["deploy"],"expected_effects":["ok"],"risks":[]}}')).id;
SELECT public.resolve_approval((SELECT id FROM resumed),1,'approve','{}');
SELECT public.acquire_work_claim((SELECT id FROM resumed),1,'91000000-0000-0000-0000-0000000000d1','supervisor-morto',60);
-- Simula o abandono: a instância morreu e o lease venceu.
SET LOCAL ROLE service_role;
UPDATE public.work_claims SET acquired_at=now()-interval '2 hours', expires_at=now()-interval '1 hour'
WHERE id='91000000-0000-0000-0000-0000000000d1';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000000',true);
SELECT throws_ok($$SELECT public.acquire_work_claim((SELECT id FROM resumed),1,'91000000-0000-0000-0000-0000000000d1','supervisor-morto',60)$$,
  '55000','claim expired','retomar com o mesmo claim expirado exige substituição explícita');
SELECT is((public.acquire_work_claim((SELECT id FROM resumed),1,'91000000-0000-0000-0000-0000000000d2','supervisor-novo',300)).owner_instance_id,
  'supervisor-novo','claim expirado é recuperável por outra instância');
SELECT is((SELECT release_reason FROM public.work_claims WHERE id='91000000-0000-0000-0000-0000000000d1'),'expired',
  'o claim abandonado é liberado com razão, não apagado');
SELECT is((SELECT payload->'data'->>'superseded_claim_id' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM resumed) AND event_type='work_claimed' AND payload->'data'->>'claim_id'='91000000-0000-0000-0000-0000000000d2'),
  '91000000-0000-0000-0000-0000000000d1','a substituição fica correlacionada no log');

SELECT * FROM finish();
RESET ROLE;
ROLLBACK;
