BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);

-- INTEL-04 v2 — orçamento consciente de custo (local vs externo/pago).
-- Regressões explícitas da decisão ratificada: execução LOCAL não é barrada pela
-- quota de custo (6/24h); execução EXTERNA continua barrada; anti-loop por item
-- e a separação local×externo são provados. A classe vem do contrato tipado
-- `execution_spec.coder_backend`.

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  label||'@test.invalid','',now(),'{}','{}',now(),now()
FROM (VALUES
  ('8a000000-0000-0000-0000-000000000001'::uuid,'local-user'),
  ('8a000000-0000-0000-0000-000000000002'::uuid,'ext-user'),
  ('8a000000-0000-0000-0000-000000000003'::uuid,'loop-user')
) u(id,label);
INSERT INTO public.ai_conversations(id,user_id,role,content)
SELECT ('8a000000-0000-0000-0000-0000000001'||lpad(n::text,2,'0'))::uuid, uid, 'user', 'm'
FROM (VALUES
  ('8a000000-0000-0000-0000-000000000001'::uuid,1),('8a000000-0000-0000-0000-000000000001'::uuid,2),
  ('8a000000-0000-0000-0000-000000000001'::uuid,3),('8a000000-0000-0000-0000-000000000001'::uuid,4),
  ('8a000000-0000-0000-0000-000000000002'::uuid,5),('8a000000-0000-0000-0000-000000000002'::uuid,6),
  ('8a000000-0000-0000-0000-000000000002'::uuid,7),('8a000000-0000-0000-0000-000000000002'::uuid,8),
  ('8a000000-0000-0000-0000-000000000003'::uuid,9)
) c(uid,n);
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES
  ('8a000000-0000-0000-0000-000000000001'),('8a000000-0000-0000-0000-000000000002'),('8a000000-0000-0000-0000-000000000003');
RESET ROLE;

CREATE TEMP TABLE lx_items(label text PRIMARY KEY,id uuid NOT NULL);
GRANT ALL ON lx_items TO authenticated,service_role;
CREATE FUNCTION pg_temp.proposal(label text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('schema_version',1,'data',jsonb_build_object('summary',label,'objective','o',
    'included_scope',jsonb_build_array('a'),'excluded_scope',jsonb_build_array('deploy'),
    'expected_effects',jsonb_build_array('p'),'risks',jsonb_build_array())) $$;
CREATE FUNCTION pg_temp.intent(target text, backend text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('execution_spec',jsonb_build_object('schema_version',1,
    'target',jsonb_build_object('kind','project','reference',target),'coder_backend',backend,
    'permissions',jsonb_build_array(),'validation_criteria',jsonb_build_array(jsonb_build_object('label','t')),
    'limits',jsonb_build_object('max_attempts',10,'max_duration_minutes',120))) $$;
-- Insere N tentativas (execution_started+failed) no item, > 60 min atrás (fora da
-- reserva interativa), com a guarda de orçamento SUSPENSA só para o setup sintético.
CREATE FUNCTION pg_temp.attempts(v_item uuid, n integer, seed integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i integer; a uuid; BEGIN
  FOR i IN 1..n LOOP
    a:=('8a000000-0000-0000-0000-'||lpad((seed*100+i)::text,12,'0'))::uuid;
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at)
    VALUES(v_item,'execution_started','anima',1,jsonb_build_object('schema_version',1,'data',
      jsonb_build_object('attempt_id',a,'claim_id',gen_random_uuid())),now()-interval '3 hours'+i*interval '1 minute');
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at)
    VALUES(v_item,'execution_failed','executor',1,jsonb_build_object('schema_version',1,'data',
      jsonb_build_object('attempt_id',a)),now()-interval '3 hours'+i*interval '1 minute'+interval '1 second');
  END LOOP; END $$;

-- Itens por usuário/classe.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','8a000000-0000-0000-0000-000000000001',true);
INSERT INTO lx_items SELECT 'l-helper-a',id FROM public.create_work_proposal('8a000000-0000-0000-0000-000000000101','low','programming',pg_temp.intent('l-a','ollama'),pg_temp.proposal('l-a'));
INSERT INTO lx_items SELECT 'l-helper-b',id FROM public.create_work_proposal('8a000000-0000-0000-0000-000000000102','low','programming',pg_temp.intent('l-b','ollama'),pg_temp.proposal('l-b'));
INSERT INTO lx_items SELECT 'l-target',id FROM public.create_work_proposal('8a000000-0000-0000-0000-000000000103','low','programming',pg_temp.intent('l-t','ollama'),pg_temp.proposal('l-t'));
INSERT INTO lx_items SELECT 'l-ext',id FROM public.create_work_proposal('8a000000-0000-0000-0000-000000000104','low','programming',pg_temp.intent('l-e','openai'),pg_temp.proposal('l-e'));
SELECT public.resolve_approval(id,1,'approve','{}') FROM lx_items WHERE label IN ('l-target','l-ext');
SELECT set_config('request.jwt.claim.sub','8a000000-0000-0000-0000-000000000002',true);
INSERT INTO lx_items SELECT 'x-helper-a',id FROM public.create_work_proposal('8a000000-0000-0000-0000-000000000105','low','programming',pg_temp.intent('x-a','openai'),pg_temp.proposal('x-a'));
INSERT INTO lx_items SELECT 'x-helper-b',id FROM public.create_work_proposal('8a000000-0000-0000-0000-000000000106','low','programming',pg_temp.intent('x-b','openai'),pg_temp.proposal('x-b'));
INSERT INTO lx_items SELECT 'x-target',id FROM public.create_work_proposal('8a000000-0000-0000-0000-000000000107','low','programming',pg_temp.intent('x-t','openai'),pg_temp.proposal('x-t'));
INSERT INTO lx_items SELECT 'x-local',id FROM public.create_work_proposal('8a000000-0000-0000-0000-000000000108','low','programming',pg_temp.intent('x-l','ollama'),pg_temp.proposal('x-l'));
SELECT public.resolve_approval(id,1,'approve','{}') FROM lx_items WHERE label IN ('x-target','x-local');
SELECT set_config('request.jwt.claim.sub','8a000000-0000-0000-0000-000000000003',true);
INSERT INTO lx_items SELECT 'loop',id FROM public.create_work_proposal('8a000000-0000-0000-0000-000000000109','low','programming',pg_temp.intent('loop','ollama'),pg_temp.proposal('loop'));
SELECT public.resolve_approval((SELECT id FROM lx_items WHERE label='loop'),1,'approve','{}');
RESET ROLE;

ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_routing_on_attempt;
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_work_budget_before_start;
SET LOCAL ROLE service_role;
-- User local: 6 tentativas LOCAIS (3+3). User external: 6 tentativas EXTERNAS (3+3).
-- User loop: 3 tentativas LOCAIS no MESMO item.
SELECT pg_temp.attempts((SELECT id FROM lx_items WHERE label='l-helper-a'),3,1);
SELECT pg_temp.attempts((SELECT id FROM lx_items WHERE label='l-helper-b'),3,2);
SELECT pg_temp.attempts((SELECT id FROM lx_items WHERE label='x-helper-a'),3,3);
SELECT pg_temp.attempts((SELECT id FROM lx_items WHERE label='x-helper-b'),3,4);
SELECT pg_temp.attempts((SELECT id FROM lx_items WHERE label='loop'),3,5);
RESET ROLE;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_routing_on_attempt;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_work_budget_before_start;

-- ---------- LOCAL: 6 tentativas locais NÃO barram execução local ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','8a000000-0000-0000-0000-000000000001',true);
SELECT is(public.autonomous_work_budget_status((SELECT id FROM lx_items WHERE label='l-target'))->>'admitted',
  'true','LOCAL com 6 tentativas locais em 24h continua admitido (sem quota de custo)');
SELECT is(public.autonomous_work_budget_status((SELECT id FROM lx_items WHERE label='l-target'))->>'reason',
  NULL,'LOCAL não recebe user_attempt_budget_exhausted');
SELECT is(public.autonomous_work_budget_status((SELECT id FROM lx_items WHERE label='l-target'))->>'costClass',
  'local','item local é classificado como local pelo coder_backend');
SELECT is((public.autonomous_work_budget_status((SELECT id FROM lx_items WHERE label='l-target'))#>>'{usage,userAttempts24Hours}')::integer,
  6,'as 6 tentativas locais são contadas (observabilidade) mas não são quota de custo');
SELECT is((public.autonomous_work_budget_status((SELECT id FROM lx_items WHERE label='l-target'))#>>'{usage,externalAttempts24Hours}')::integer,
  0,'tentativas locais não entram no consumo EXTERNO');
-- Separação: um item EXTERNO deste usuário (0 tentativas externas) é admitido.
SELECT is(public.autonomous_work_budget_status((SELECT id FROM lx_items WHERE label='l-ext'))->>'admitted',
  'true','item EXTERNO admitido quando o usuário não gastou quota externa (as 6 foram locais)');

-- ---------- EXTERNO: 6 tentativas externas barram execução externa ----------
SELECT set_config('request.jwt.claim.sub','8a000000-0000-0000-0000-000000000002',true);
SELECT is(public.autonomous_work_budget_status((SELECT id FROM lx_items WHERE label='x-target'))->>'reason',
  'user_attempt_budget_exhausted','EXTERNO com 6 tentativas externas em 24h continua barrado (quota de custo)');
SELECT is(public.autonomous_work_budget_status((SELECT id FROM lx_items WHERE label='x-target'))->>'costClass',
  'external','item openai é classificado como externo');
SELECT is((public.autonomous_work_budget_status((SELECT id FROM lx_items WHERE label='x-target'))#>>'{usage,externalAttempts24Hours}')::integer,
  6,'consumo externo é contado');
-- Separação: um item LOCAL deste usuário é admitido apesar das 6 tentativas externas.
SELECT is(public.autonomous_work_budget_status((SELECT id FROM lx_items WHERE label='x-local'))->>'admitted',
  'true','item LOCAL admitido apesar de 6 tentativas externas do mesmo usuário');

-- ---------- ANTI-LOOP: item local que estourou o teto por-item continua fail-closed ----------
SELECT set_config('request.jwt.claim.sub','8a000000-0000-0000-0000-000000000003',true);
SELECT is(public.autonomous_work_budget_status((SELECT id FROM lx_items WHERE label='loop'))->>'reason',
  'item_attempt_budget_exhausted','anti-loop por item (3/24h) vale para LOCAL também');
SELECT is(public.autonomous_work_budget_status((SELECT id FROM lx_items WHERE label='loop'))->>'costClass',
  'local','o item em loop é local, mas o anti-loop não depende da classe');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
