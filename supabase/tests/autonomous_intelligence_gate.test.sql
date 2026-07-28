-- INTEL-01: gate de classificação exclusivamente no caminho autônomo.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(25);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('82000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000',
'authenticated','authenticated','intel-gate@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
SELECT ('82000000-0000-0000-0000-00000000001'||n)::uuid,
  '82000000-0000-0000-0000-000000000001','user','gate '||n
FROM generate_series(1,3) n;
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id)
VALUES('82000000-0000-0000-0000-000000000001');
RESET ROLE;

\set prop '{"schema_version":1,"data":{"summary":"s","objective":"corrigir","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["testes verdes"],"risks":[]}}'
\set spec '{"schema_version":1,"target":{"kind":"project","reference":"intel-gate"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}'

CREATE FUNCTION pg_temp.classification(p_risk text, p_complexity text DEFAULT 'bounded')
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'schemaVersion',1,'complexity',p_complexity,'risk',p_risk,
    'reversibility','reversible','planClarity','clear','urgency','normal',
    'provenance',jsonb_build_object(
      'kind','human_confirmed','classifiedAt','2026-07-28T14:00:00Z',
      'classifierId','user:opaque-gate'));
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000001',true);
CREATE TEMP TABLE auto_item AS SELECT (public.create_work_proposal(
  '82000000-0000-0000-0000-000000000011','low','programming',
  jsonb_build_object('execution_spec',:'spec'::jsonb),:'prop'::jsonb)).id;
CREATE TEMP TABLE command_item AS SELECT (public.create_work_proposal(
  '82000000-0000-0000-0000-000000000012','low','programming',
  jsonb_build_object('execution_spec',(:'spec'::jsonb ||
    '{"target":{"kind":"project","reference":"manual-gate"}}')),:'prop'::jsonb)).id;
CREATE TEMP TABLE version_item AS SELECT (public.create_work_proposal(
  '82000000-0000-0000-0000-000000000013','low','programming',
  jsonb_build_object('execution_spec',(:'spec'::jsonb ||
    '{"target":{"kind":"project","reference":"version-gate"}}')),:'prop'::jsonb)).id;
GRANT SELECT ON auto_item, command_item, version_item TO service_role;
SELECT public.resolve_approval((SELECT id FROM auto_item),1,'approve','{}');
SELECT public.resolve_approval((SELECT id FROM command_item),1,'approve','{}');
SELECT public.resolve_approval((SELECT id FROM version_item),1,'approve','{}');

SET LOCAL ROLE service_role;
SELECT is(private.autonomous_intelligence_eligibility((SELECT id FROM auto_item),1)->>'reason',
  'work_intelligence_classification_missing','ausência tem razão tipada');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000001',true);
SELECT is((SELECT count(*) FROM public.autonomous_work_queue()
  WHERE work_item_id=(SELECT id FROM auto_item)),0::bigint,'item sem classificação não entra na fila');
SELECT throws_ok($$SELECT public.acquire_work_claim((SELECT id FROM auto_item),1,
  '82000000-0000-0000-0000-0000000000c1','supervisor',300)$$,
  '55000','work_intelligence_classification_missing','claim recusa classificação ausente');
SELECT is((SELECT count(*) FROM public.work_claims WHERE work_item_id=(SELECT id FROM auto_item)),
  0::bigint,'nenhum claim é criado quando falta classificação');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM auto_item)
  AND event_type='execution_started'),0::bigint,'nenhuma tentativa autônoma é iniciada');

SELECT public.start_commanded_work_attempt((SELECT id FROM command_item),1,
  '82000000-0000-0000-0000-0000000000a1','manual-executor');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM command_item)),
  'in_progress','INT-04 comandado continua funcionando sem classificação');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM command_item)
  AND event_type='execution_started'),1::bigint,'caminho comandado inicia exatamente uma tentativa');

SELECT is((public.record_work_intelligence_classification(
  (SELECT id FROM auto_item),1,0,pg_temp.classification('unknown','unknown')))
  ->>'classification_revision','1','classificação incompleta é persistida');
SET LOCAL ROLE service_role;
SELECT is(private.autonomous_intelligence_eligibility((SELECT id FROM auto_item),1)->>'reason',
  'work_intelligence_classification_incomplete','unknown tem razão incomplete');
SELECT is(private.autonomous_intelligence_eligibility((SELECT id FROM auto_item),1)->'unknown_axes',
  '["complexity","risk"]'::jsonb,'unknownAxes preserva ordem determinística');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000001',true);
SELECT is((SELECT count(*) FROM public.autonomous_work_queue()
  WHERE work_item_id=(SELECT id FROM auto_item)),0::bigint,'classificação incompleta não entra na fila');
SELECT throws_ok($$SELECT public.acquire_work_claim((SELECT id FROM auto_item),1,
  '82000000-0000-0000-0000-0000000000c2','supervisor',300)$$,
  '55000','work_intelligence_classification_incomplete','claim recusa classificação incompleta');

SELECT is((public.record_work_intelligence_classification(
  (SELECT id FROM auto_item),1,1,pg_temp.classification('low')))
  ->>'classification_revision','2','reclassificação completa avança revisão');
SELECT is((SELECT count(*) FROM public.autonomous_work_queue()
  WHERE work_item_id=(SELECT id FROM auto_item)),1::bigint,'classificação completa restaura fila');
SELECT lives_ok($$SELECT public.acquire_work_claim((SELECT id FROM auto_item),1,
  '82000000-0000-0000-0000-0000000000c3','supervisor',300)$$,
  'classificação completa permite claim');

-- Reclassificação entre claim e início: o segundo gate fecha essa corrida.
SELECT is((public.record_work_intelligence_classification(
  (SELECT id FROM auto_item),1,2,pg_temp.classification('unknown')))
  ->>'classification_revision','3','reclassificação incompleta volta a bloquear');
SELECT throws_ok($$SELECT public.start_claimed_work_attempt(
  '82000000-0000-0000-0000-0000000000c3',
  '82000000-0000-0000-0000-0000000000a3','executor')$$,
  '55000','work_intelligence_classification_incomplete',
  'início sob claim recusa reclassificação incompleta');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM auto_item)
  AND event_type='execution_started'),0::bigint,'corrida fechada não cria tentativa');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM auto_item)
  AND event_type='work_intelligence_classified'),3::bigint,'histórico append-only preserva as três revisões');

SELECT public.record_work_intelligence_classification(
  (SELECT id FROM version_item),1,0,pg_temp.classification('low'));
SELECT is((SELECT count(*) FROM public.autonomous_work_queue()
  WHERE work_item_id=(SELECT id FROM version_item)),1::bigint,'versão 1 completa é elegível');
SET LOCAL ROLE service_role;
UPDATE public.work_items SET proposal_version=2,state='proposed' WHERE id=(SELECT id FROM version_item);
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
VALUES((SELECT id FROM version_item),'proposal_revised','anima',2,
  jsonb_build_object('schema_version',1,'data',jsonb_build_object('proposal',:'prop'::jsonb)));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000001',true);
SELECT public.resolve_approval((SELECT id FROM version_item),2,'approve','{}');
SET LOCAL ROLE service_role;
SELECT is(private.autonomous_intelligence_eligibility((SELECT id FROM version_item),2)->>'reason',
  'work_intelligence_classification_missing','nova versão aprovada invalida classificação anterior');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000001',true);
SELECT is((SELECT count(*) FROM public.autonomous_work_queue()
  WHERE work_item_id=(SELECT id FROM version_item)),0::bigint,'nova versão fica fora da fila');
SELECT is((public.record_work_intelligence_classification(
  (SELECT id FROM version_item),2,0,pg_temp.classification('moderate')))
  ->>'classification_revision','1','nova versão recebe cadeia própria');
SELECT is((SELECT count(*) FROM public.autonomous_work_queue()
  WHERE work_item_id=(SELECT id FROM version_item)),1::bigint,'nova classificação completa restaura elegibilidade');
SELECT is((SELECT count(*) FROM public.work_events
  WHERE event_type::text ~ '(provider|model|effort|routing)'),0::bigint,
  'nenhum evento de provedor, modelo, esforço ou roteamento é criado');

SELECT * FROM finish();
ROLLBACK;
