BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(16);

-- Fixtures: U1 dono; U2 estranho. ORIG falho com 1 attempt; DEP depende de ORIG.
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
 ('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','u1@test.invalid','',now(),'{}','{}',now(),now()),
 ('a1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','u2@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','user','fixture lineage');
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason) VALUES('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','lineage pgTAP');

INSERT INTO public.work_items(id,user_id,source_message_id,state,impact_level,capability,original_request,intent,proposal,proposal_version) VALUES
 ('a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','failed','significant','programming','orig',
  '{"execution_spec":{}}','{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["a"],"excluded_scope":["b"],"expected_effects":["e"],"risks":["r"]}}',2),
 ('a3000000-0000-4000-8000-000000000009','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','approved','significant','programming','dep',
  '{"execution_spec":{"depends_on_work_item_ids":["a3000000-0000-4000-8000-000000000001"]}}','{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["a"],"excluded_scope":["b"],"expected_effects":["e"],"risks":["r"]}}',1);
-- Uma attempt historica no ORIG (budget 1/2), para provar que a lineage nao reseta.
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
 ('a3000000-0000-4000-8000-000000000001','execution_started','anima',2,'{"schema_version":1,"data":{"attempt_id":"a5000000-0000-4000-8000-000000000001"}}');

-- Helpers de proposta/intent validos.
CREATE TEMP TABLE _p(intent jsonb, proposal jsonb);
INSERT INTO _p VALUES('{"execution_spec":{}}','{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["a"],"excluded_scope":["b"],"expected_effects":["e"],"risks":["r"]}}');

SELECT has_table('public','work_recovery_lineage','tabela de lineage existe');
SELECT has_function('public','propose_recovery_successor','wrapper autenticado existe');

-- Cria Successor 1 (seq 1). Sucessor nasce `proposed`.
SELECT is((private.record_recovery_successor('a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',1,'significant','programming',intent,proposal,'r1','a4000000-0000-4000-8000-000000000001'))->>'state','proposed','sucessor nasce proposed') FROM _p;
-- Aponta ao original por ID.
SELECT is((SELECT original_work_item_id::text FROM public.work_recovery_lineage WHERE recovery_sequence=1 AND original_work_item_id='a3000000-0000-4000-8000-000000000001'),'a3000000-0000-4000-8000-000000000001','lineage aponta ao original por ID');
-- Original permanece failed.
SELECT is((SELECT state::text FROM public.work_items WHERE id='a3000000-0000-4000-8000-000000000001'),'failed','original permanece failed');
-- DEP com sucessor `proposed` NAO tem dependencia satisfeita.
SELECT is(private.autonomous_work_dependencies_satisfied('a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000009','{"execution_spec":{"depends_on_work_item_ids":["a3000000-0000-4000-8000-000000000001"]}}'::jsonb),false,'sucessor proposed nao satisfaz dependencia');
-- Mesmo com o sucessor `completed`, a dependencia do DEP no ORIGINAL NAO e satisfeita.
UPDATE public.work_items SET state='completed' WHERE id=(SELECT successor_work_item_id FROM public.work_recovery_lineage WHERE recovery_sequence=1 AND original_work_item_id='a3000000-0000-4000-8000-000000000001');
SELECT is(private.autonomous_work_dependencies_satisfied('a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000009','{"execution_spec":{"depends_on_work_item_ids":["a3000000-0000-4000-8000-000000000001"]}}'::jsonb),false,'sucessor completed NAO satisfaz o predecessor automaticamente');
-- Multiplos sucessores na mesma lineage (seq 2).
SELECT is((private.record_recovery_successor('a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',2,'significant','programming',intent,proposal,'r2','a4000000-0000-4000-8000-000000000002'))->>'recoverySequence','2','segundo sucessor na mesma lineage') FROM _p;
SELECT is((SELECT count(*)::text FROM public.work_recovery_lineage WHERE original_work_item_id='a3000000-0000-4000-8000-000000000001'),'2','1..N sucessores por original');
-- Outro usuario nao vincula sucessor a um original que nao e seu (owner-scoped).
SELECT throws_ok($$SELECT private.record_recovery_successor('a1000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001',3,'significant','programming','{"execution_spec":{}}','{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["a"],"excluded_scope":["b"],"expected_effects":["e"],"risks":["r"]}}','r','a4000000-0000-4000-8000-000000000003')$$,'P0002','original work item not found','usuario estranho nao cria lineage no original alheio');
-- A lineage nao reseta o budget: ORIG segue com 1 execution_started (attempt historica intacta).
SELECT is((SELECT count(*)::text FROM public.work_events WHERE work_item_id='a3000000-0000-4000-8000-000000000001' AND event_type='execution_started'),'1','lineage nao reseta attempts do original');
-- Idempotencia: replay da mesma key devolve o mesmo sucessor, sem nova linha.
SELECT is((private.record_recovery_successor('a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',1,'significant','programming',intent,proposal,'r1','a4000000-0000-4000-8000-000000000001'))->>'replayed','true','replay idempotente') FROM _p;
SELECT is((SELECT count(*)::text FROM public.work_recovery_lineage WHERE original_work_item_id='a3000000-0000-4000-8000-000000000001'),'2','replay nao duplica lineage');
SELECT throws_ok($$SELECT private.record_recovery_successor('a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',1,'significant','programming','{"execution_spec":{}}','{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["a"],"excluded_scope":["b"],"expected_effects":["e"],"risks":["r"]}}','razao divergente','a4000000-0000-4000-8000-000000000001')$$,'22023','recovery successor idempotency conflict','mesma chave com razao divergente falha fechado');
SELECT throws_ok($$SELECT private.record_recovery_successor('a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',1,'low','programming','{"execution_spec":{}}','{"schema_version":1,"data":{"summary":"s","objective":"o","included_scope":["a"],"excluded_scope":["b"],"expected_effects":["e"],"risks":["r"]}}','r1','a4000000-0000-4000-8000-000000000001')$$,'22023','recovery successor idempotency conflict','mesma chave com envelope divergente falha fechado');
-- Nenhuma autorizacao financeira criada por este fluxo.
SELECT is((SELECT count(*)::text FROM public.work_events e JOIN public.work_items i ON i.id=e.work_item_id WHERE i.user_id='a1000000-0000-4000-8000-000000000001' AND e.payload->'data'->>'authority' IN ('financial_authorization','paid_compute')),'0','zero autorizacao financeira');

SELECT * FROM finish();
ROLLBACK;
