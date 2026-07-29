-- INTEL-02: decisão append-only, replay, vigência e enforcement no início.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(20);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('83000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000',
'authenticated','authenticated','routing@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
SELECT ('83000000-0000-0000-0000-00000000001'||n)::uuid,
  '83000000-0000-0000-0000-000000000001','user','route '||n
FROM generate_series(1,4) n;
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id)
VALUES('83000000-0000-0000-0000-000000000001');
RESET ROLE;

\set prop '{"schema_version":1,"data":{"summary":"route","objective":"provar roteamento","included_scope":["a.py"],"excluded_scope":["deploy"],"expected_effects":["teste"],"risks":[]}}'
\set spec '{"schema_version":1,"target":{"kind":"project","reference":"routing-target"},"permissions":[],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1}}'

CREATE FUNCTION pg_temp.classification(p_risk text DEFAULT 'low')
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'schemaVersion',1,'complexity',CASE WHEN p_risk='high' THEN 'complex' ELSE 'routine' END,
    'risk',p_risk,'reversibility','reversible','planClarity','clear','urgency','normal',
    'provenance',jsonb_build_object('kind','human_confirmed',
      'classifiedAt','2026-07-28T19:00:00Z','classifierId','user:routing'));
$$;
CREATE FUNCTION pg_temp.decision(
  p_effort text DEFAULT 'light',
  p_executor text DEFAULT 'local-runner-v1',
  p_model text DEFAULT 'model:local'
)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'schemaVersion',1,'policyVersion','work-routing-v1','capability','programming',
    'requiredEffort',p_effort,
    'selected',jsonb_build_object('routeId','local:configured','executorId',p_executor,
      'providerRef','local-node','modelRef',p_model,'effort',p_effort),
    'factors',jsonb_build_object('complexity',CASE WHEN p_effort='strong' THEN 'complex' ELSE 'routine' END,
      'risk',CASE WHEN p_effort='strong' THEN 'high' ELSE 'low' END,
      'reversibility','reversible','planClarity','clear','urgency','normal',
      'urgencyTieBreakApplied',false),
    'rejectedCandidates','[]'::jsonb);
$$;
CREATE FUNCTION pg_temp.adjust(p_item uuid,p_attempt uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_version integer; v_classification jsonb; v_adjustment jsonb;
BEGIN
  SELECT proposal_version INTO v_version FROM public.work_items WHERE id=p_item;
  v_classification:=(public.current_work_intelligence_classification(p_item))->'classification';
  v_adjustment:=private.expected_work_routing_adjustment(
    p_item,v_version,private.required_work_effort(v_classification));
  RETURN public.record_work_routing_adjustment(p_item,v_version,p_attempt,v_adjustment);
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','83000000-0000-0000-0000-000000000001',true);
CREATE TEMP TABLE routed AS SELECT (public.create_work_proposal(
  '83000000-0000-0000-0000-000000000011','low','programming',
  jsonb_build_object('execution_spec',:'spec'::jsonb),:'prop'::jsonb)).id;
CREATE TEMP TABLE missing AS SELECT (public.create_work_proposal(
  '83000000-0000-0000-0000-000000000012','low','programming',
  jsonb_build_object('execution_spec',(:'spec'::jsonb ||
    '{"target":{"kind":"project","reference":"routing-missing"}}')),:'prop'::jsonb)).id;
CREATE TEMP TABLE obsolete AS SELECT (public.create_work_proposal(
  '83000000-0000-0000-0000-000000000013','low','programming',
  jsonb_build_object('execution_spec',(:'spec'::jsonb ||
    '{"target":{"kind":"project","reference":"routing-obsolete"}}')),:'prop'::jsonb)).id;
CREATE TEMP TABLE commanded AS SELECT (public.create_work_proposal(
  '83000000-0000-0000-0000-000000000014','low','programming',
  jsonb_build_object('execution_spec',(:'spec'::jsonb ||
    '{"target":{"kind":"project","reference":"routing-commanded"}}')),:'prop'::jsonb)).id;
SELECT public.resolve_approval(id,1,'approve','{}') FROM routed;
SELECT public.resolve_approval(id,1,'approve','{}') FROM missing;
SELECT public.resolve_approval(id,1,'approve','{}') FROM obsolete;
SELECT public.resolve_approval(id,1,'approve','{}') FROM commanded;
SELECT public.record_work_intelligence_classification(id,1,0,pg_temp.classification()) FROM routed;
SELECT public.record_work_intelligence_classification(id,1,0,pg_temp.classification()) FROM missing;
SELECT public.record_work_intelligence_classification(id,1,0,pg_temp.classification()) FROM obsolete;

SELECT pg_temp.adjust((SELECT id FROM routed),'83000000-0000-0000-0000-0000000000a1');
CREATE TEMP TABLE first_route AS SELECT public.record_work_routing_decision(
  (SELECT id FROM routed),1,'83000000-0000-0000-0000-0000000000a1',pg_temp.decision()) result;
SELECT is(result->>'action','recorded','decisão é registrada') FROM first_route;
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM routed)
  AND event_type='work_routing_decided'),1::bigint,'registro produz um evento');
SELECT is(public.work_routing_decision('83000000-0000-0000-0000-0000000000a1')
  #>>'{decision,selected,executorId}','local-runner-v1','decisão é consultável por tentativa');
SELECT is(public.work_routing_decision('83000000-0000-0000-0000-0000000000a1')
  #>>'{decision,requiredEffort}','light','esforço exigido é consultável');
SELECT ok((public.work_routing_decision('83000000-0000-0000-0000-0000000000a1')
  ->>'classification_event_id') IS NOT NULL,'decisão referencia a classificação exata');
SELECT is((public.record_work_routing_decision((SELECT id FROM routed),1,
  '83000000-0000-0000-0000-0000000000a1',pg_temp.decision()))->>'action',
  'replayed','reentrega idêntica é replay');
SELECT pg_temp.adjust((SELECT id FROM routed),'83000000-0000-0000-0000-0000000000af');
SELECT throws_ok($$SELECT public.record_work_routing_decision((SELECT id FROM routed),1,
  '83000000-0000-0000-0000-0000000000a1',pg_temp.decision('light','local-runner-v1','model:other'))$$,
  '55000','work routing decision conflict','mesma tentativa com rota divergente é recusada');
SELECT throws_ok($$SELECT public.record_work_routing_decision((SELECT id FROM routed),1,
  '83000000-0000-0000-0000-0000000000af',pg_temp.decision('standard'))$$,
  '55000','work routing effort mismatch','esforço exigido divergente é recusado');

SELECT public.acquire_work_claim((SELECT id FROM missing),1,
  '83000000-0000-0000-0000-0000000000c2','sup',300);
SELECT throws_ok($$SELECT public.start_claimed_work_attempt(
  '83000000-0000-0000-0000-0000000000c2',
  '83000000-0000-0000-0000-0000000000a2','local-runner-v1')$$,
  '55000','work routing decision missing','tentativa sem decisão é recusada');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM missing)),
  'approved','recusa por ausência não inicia o item');

SELECT public.acquire_work_claim((SELECT id FROM routed),1,
  '83000000-0000-0000-0000-0000000000c1','sup',300);
SELECT throws_ok($$SELECT public.start_claimed_work_attempt(
  '83000000-0000-0000-0000-0000000000c1',
  '83000000-0000-0000-0000-0000000000a1','outro-executor')$$,
  '55000','work routing executor mismatch','executor diferente da decisão é recusado');
SELECT lives_ok($$SELECT public.start_claimed_work_attempt(
  '83000000-0000-0000-0000-0000000000c1',
  '83000000-0000-0000-0000-0000000000a1','local-runner-v1')$$,
  'executor selecionado inicia a tentativa');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM routed)),
  'in_progress','início roteado move o item para execução');

SELECT pg_temp.adjust((SELECT id FROM obsolete),'83000000-0000-0000-0000-0000000000a3');
SELECT public.record_work_routing_decision((SELECT id FROM obsolete),1,
  '83000000-0000-0000-0000-0000000000a3',pg_temp.decision());
SELECT public.record_work_intelligence_classification((SELECT id FROM obsolete),1,1,pg_temp.classification('high'));
SELECT public.acquire_work_claim((SELECT id FROM obsolete),1,
  '83000000-0000-0000-0000-0000000000c3','sup',300);
SELECT throws_ok($$SELECT public.start_claimed_work_attempt(
  '83000000-0000-0000-0000-0000000000c3',
  '83000000-0000-0000-0000-0000000000a3','local-runner-v1')$$,
  '55000','work routing decision obsolete','reclassificação invalida decisão anterior');
SELECT throws_ok($$SELECT public.record_work_routing_decision((SELECT id FROM obsolete),1,
  '83000000-0000-0000-0000-0000000000a4',pg_temp.decision())$$,
  '22023','invalid work routing decision','classificação forte recusa decisão light');
SELECT pg_temp.adjust((SELECT id FROM obsolete),'83000000-0000-0000-0000-0000000000a4');
SELECT is((public.record_work_routing_decision((SELECT id FROM obsolete),1,
  '83000000-0000-0000-0000-0000000000a4',pg_temp.decision('strong')))->>'action',
  'recorded','classificação forte aceita decisão strong');

SELECT lives_ok($$SELECT public.start_commanded_work_attempt(
  (SELECT id FROM commanded),1,'83000000-0000-0000-0000-0000000000a5','manual')$$,
  'INT-04 comandado continua fora do gate de roteamento');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT id FROM commanded)
  AND event_type='work_routing_decided'),0::bigint,'caminho comandado não inventa decisão');
SELECT is((SELECT count(*) FROM public.work_events WHERE event_type='work_routing_decided'
  AND author='system'),3::bigint,'decisões são append-only e de autoria sistêmica');

SELECT set_config('request.jwt.claim.sub','83000000-0000-0000-0000-000000000099',true);
SELECT throws_ok($$SELECT public.work_routing_decision(
  '83000000-0000-0000-0000-0000000000a1')$$,
  '42501',NULL,'consulta recusa usuário fora da allowlist');

SELECT * FROM finish();
ROLLBACK;
