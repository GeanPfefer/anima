-- INTEL-01: persistência append-only, reclassificação auditável e projeção
-- corrente estritamente vinculada à versão atual aprovada.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(30);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('81000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','intel-a@test.invalid','',now(),'{}','{}',now(),now()),
('81000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','intel-b@test.invalid','',now(),'{}','{}',now(),now()),
('81000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','intel-off@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('81000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-000000000001','user','classificar A'),
('81000000-0000-0000-0000-000000000012','81000000-0000-0000-0000-000000000001','user','classificar pendente'),
('81000000-0000-0000-0000-000000000013','81000000-0000-0000-0000-000000000002','user','classificar B');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES
('81000000-0000-0000-0000-000000000001'),
('81000000-0000-0000-0000-000000000002');
RESET ROLE;

CREATE FUNCTION pg_temp.proposal(p_summary text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'summary',p_summary,'objective','provar INTEL-01',
    'included_scope',jsonb_build_array('packages/core'),
    'excluded_scope',jsonb_build_array('routing'),
    'expected_effects',jsonb_build_array('classificação auditável'),
    'risks','[]'::jsonb));
$$;
CREATE FUNCTION pg_temp.human_classification(p_risk text DEFAULT 'low', p_complexity text DEFAULT 'bounded')
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'schemaVersion',1,'complexity',p_complexity,'risk',p_risk,
    'reversibility','reversible','planClarity','clear','urgency','normal',
    'provenance',jsonb_build_object(
      'kind','human_confirmed','classifiedAt','2026-07-28T12:00:00Z',
      'classifierId','user:opaque-1'));
$$;
CREATE FUNCTION pg_temp.system_classification(p_risk text DEFAULT 'high')
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'schemaVersion',1,'complexity','complex','risk',p_risk,
    'reversibility','conditionally_reversible','planClarity','partial',
    'urgency','time_sensitive',
    'provenance',jsonb_build_object(
      'kind','system_assessed','classifiedAt','2026-07-28T12:10:00Z',
      'classifierId','classifier:opaque-7','policyVersion','intel-policy-v1'));
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
CREATE TEMP TABLE main_item AS
  SELECT (public.create_work_proposal(
    '81000000-0000-0000-0000-000000000011','low','programming','{}',
    pg_temp.proposal('principal'))).id;
CREATE TEMP TABLE pending_item AS
  SELECT (public.create_work_proposal(
    '81000000-0000-0000-0000-000000000012','low','planning','{}',
    pg_temp.proposal('pendente'))).id;
SELECT public.resolve_approval((SELECT id FROM main_item),1,'approve','{}');
GRANT SELECT ON main_item TO service_role;

SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000002',true);
CREATE TEMP TABLE other_item AS
  SELECT (public.create_work_proposal(
    '81000000-0000-0000-0000-000000000013','low','programming','{}',
    pg_temp.proposal('outro usuário'))).id;
SELECT public.resolve_approval((SELECT id FROM other_item),1,'approve','{}');

SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);

SELECT throws_ok(
  $$SELECT public.record_work_intelligence_classification(
    (SELECT id FROM other_item),1,0,pg_temp.human_classification())$$,
  'P0002',NULL,'registro recusa item de outro usuário');
SELECT throws_ok(
  $$SELECT public.record_work_intelligence_classification(
    (SELECT id FROM pending_item),1,0,pg_temp.human_classification())$$,
  '55000',NULL,'registro recusa proposta ainda não aprovada');
SELECT throws_ok(
  $$SELECT public.record_work_intelligence_classification(
    (SELECT id FROM main_item),2,0,pg_temp.human_classification())$$,
  '55000',NULL,'registro recusa versão esperada divergente');

CREATE TEMP TABLE first_record AS
  SELECT public.record_work_intelligence_classification(
    (SELECT id FROM main_item),1,0,pg_temp.human_classification()) AS result;
SELECT is(result->>'action','recorded','primeira classificação é registrada') FROM first_record;
SELECT is(result->>'classification_revision','1','primeira classificação recebe revisão 1') FROM first_record;
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM main_item)
  AND event_type='work_intelligence_classified'),1::bigint,'primeiro fato gera um evento');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM main_item)),
  'approved','classificar não altera o estado aprovado');
SELECT is(public.current_work_intelligence_classification((SELECT id FROM main_item))
  #>>'{classification,provenance,kind}','human_confirmed','projeção expõe proveniência humana');

CREATE TEMP TABLE second_record AS
  SELECT public.record_work_intelligence_classification(
    (SELECT id FROM main_item),1,1,pg_temp.system_classification()) AS result;
SELECT is(result->>'action','recorded','reclassificação cria novo fato') FROM second_record;
SELECT is(result->>'classification_revision','2','reclassificação avança a revisão') FROM second_record;
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM main_item)
  AND event_type='work_intelligence_classified'),2::bigint,'reclassificação preserva os dois eventos');
SELECT ok(EXISTS(SELECT 1 FROM public.work_events WHERE id=
  ((SELECT result FROM first_record)->>'event_id')::uuid),
  'evento supersedido continua presente');
SELECT is((SELECT payload#>>'{data,supersedes_event_id}' FROM public.work_events WHERE id=
  ((SELECT result FROM second_record)->>'event_id')::uuid),
  (SELECT result->>'event_id' FROM first_record),'novo evento referencia o anterior');
SELECT is(public.current_work_intelligence_classification((SELECT id FROM main_item))
  #>>'{classification,provenance,kind}','system_assessed','projeção escolhe a reclassificação');
SELECT is(public.current_work_intelligence_classification((SELECT id FROM main_item))
  #>>'{classification,provenance,policyVersion}','intel-policy-v1','política do sistema é auditável');

SELECT is((public.record_work_intelligence_classification(
  (SELECT id FROM main_item),1,1,pg_temp.system_classification()))->>'action',
  'replayed','reentrega idêntica é replay');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM main_item)
  AND event_type='work_intelligence_classified'),2::bigint,'replay não cria evento');
SELECT throws_ok(
  $$SELECT public.record_work_intelligence_classification(
    (SELECT id FROM main_item),1,1,pg_temp.system_classification('critical'))$$,
  '55000',NULL,'revisão esperada obsoleta e conteúdo diferente falha fechado');

SELECT is((public.record_work_intelligence_classification(
  (SELECT id FROM main_item),1,2,pg_temp.human_classification('unknown','unknown')))
  ->>'classification_revision','3','unknown é persistido como valor contratual válido');
SELECT is(public.current_work_intelligence_classification((SELECT id FROM main_item))
  #>>'{classification,risk}','unknown','projeção preserva unknown literalmente');
SELECT throws_ok(
  $$SELECT public.record_work_intelligence_classification(
    (SELECT id FROM main_item),1,3,
    jsonb_set(pg_temp.system_classification(),'{provenance}',jsonb_build_object(
      'kind','system_assessed','classifiedAt','2026-07-28T12:10:00Z',
      'classifierId','classifier:opaque-7')))$$,
  '22023',NULL,'proveniência do sistema sem policyVersion é recusada');
SELECT throws_ok(
  $$SELECT public.record_work_intelligence_classification(
    (SELECT id FROM main_item),1,3,
    jsonb_set(pg_temp.human_classification(),'{provenance,policyVersion}','"indevida"'))$$,
  '22023',NULL,'proveniência humana com campo de política é recusada');
SELECT throws_ok(
  $$SELECT public.record_work_intelligence_classification(
    (SELECT id FROM main_item),1,3,
    pg_temp.human_classification() || '{"provider":"externo"}'::jsonb)$$,
  '22023',NULL,'campo externo no payload de classificação é recusado');

-- Simula a revisão canônica: a versão 2 existe, mas ainda não foi aprovada.
SET LOCAL ROLE service_role;
UPDATE public.work_items SET proposal_version=2,state='proposed'
WHERE id=(SELECT id FROM main_item);
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
VALUES((SELECT id FROM main_item),'proposal_revised','anima',2,
  jsonb_build_object('schema_version',1,'data',jsonb_build_object('proposal',pg_temp.proposal('v2'))));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);

SELECT is(public.current_work_intelligence_classification((SELECT id FROM main_item)),NULL,
  'nova versão proposta invalida imediatamente a classificação anterior');
SELECT public.resolve_approval((SELECT id FROM main_item),2,'approve','{}');
SELECT is(public.current_work_intelligence_classification((SELECT id FROM main_item)),NULL,
  'aprovar nova versão não reutiliza classificação antiga');
SELECT is((public.record_work_intelligence_classification(
  (SELECT id FROM main_item),2,0,pg_temp.human_classification('moderate','routine')))
  ->>'classification_revision','1','nova versão inicia cadeia própria na revisão 1');
SELECT is(public.current_work_intelligence_classification((SELECT id FROM main_item))
  #>>'{approved_proposal_version}','2','projeção corrente fica correlacionada à versão 2');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM main_item)
  AND event_type='work_intelligence_classified'),4::bigint,
  'histórico mantém três fatos da versão 1 e um da versão 2');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM main_item)
  AND event_type IN ('execution_started','work_claimed')),0::bigint,
  'classificação não inicia tentativa nem seleciona executor');

SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000003',true);
SELECT throws_ok(
  $$SELECT public.current_work_intelligence_classification((SELECT id FROM main_item))$$,
  '42501',NULL,'leitura recusa usuário fora da allowlist');

SELECT * FROM finish();
ROLLBACK;
