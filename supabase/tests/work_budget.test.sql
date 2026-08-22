BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(15);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  label||'@test.invalid','',now(),'{}','{}',now(),now()
FROM (VALUES
  ('83000000-0000-0000-0000-000000000001'::uuid,'attempts'),
  ('83000000-0000-0000-0000-000000000002'::uuid,'global'),
  ('83000000-0000-0000-0000-000000000003'::uuid,'runtime')
) users(id,label);
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('83000000-0000-0000-0000-000000000011','83000000-0000-0000-0000-000000000001','user','item'),
('83000000-0000-0000-0000-000000000012','83000000-0000-0000-0000-000000000002','user','global a'),
('83000000-0000-0000-0000-000000000013','83000000-0000-0000-0000-000000000002','user','global b'),
('83000000-0000-0000-0000-000000000014','83000000-0000-0000-0000-000000000002','user','global c'),
('83000000-0000-0000-0000-000000000015','83000000-0000-0000-0000-000000000003','user','runtime');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES
('83000000-0000-0000-0000-000000000001'),
('83000000-0000-0000-0000-000000000002'),
('83000000-0000-0000-0000-000000000003');
RESET ROLE;

CREATE TEMP TABLE budget_items(label text PRIMARY KEY,id uuid NOT NULL);
GRANT ALL ON budget_items TO authenticated,service_role;
CREATE FUNCTION pg_temp.proposal(label text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'summary',label,'objective','provar orçamento','included_scope',jsonb_build_array('a'),
    'excluded_scope',jsonb_build_array('deploy'),'expected_effects',jsonb_build_array('prova'),
    'risks',jsonb_build_array()))
$$;
CREATE FUNCTION pg_temp.intent(target text, attempts integer DEFAULT 10, backend text DEFAULT 'ollama') RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('execution_spec',jsonb_build_object(
    'schema_version',1,'target',jsonb_build_object('kind','project','reference',target),
    'coder_backend',backend,
    'permissions',jsonb_build_array(),'validation_criteria',jsonb_build_array(jsonb_build_object('label','teste')),
    'limits',jsonb_build_object('max_attempts',attempts,'max_duration_minutes',120)))
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','83000000-0000-0000-0000-000000000001',true);
INSERT INTO budget_items SELECT 'item',id FROM public.create_work_proposal(
  '83000000-0000-0000-0000-000000000011','low','programming',pg_temp.intent('item'),pg_temp.proposal('item'));
SELECT public.resolve_approval((SELECT id FROM budget_items WHERE label='item'),1,'approve','{}');

SELECT set_config('request.jwt.claim.sub','83000000-0000-0000-0000-000000000002',true);
INSERT INTO budget_items
SELECT label,w.id FROM (VALUES
  ('global-a','83000000-0000-0000-0000-000000000012'::uuid),
  ('global-b','83000000-0000-0000-0000-000000000013'::uuid),
  ('global-c','83000000-0000-0000-0000-000000000014'::uuid)
) source(label,message_id)
-- Cenário do teto GLOBAL de custo: itens EXTERNOS (coder_backend openai), pois a
-- quota de custo (6/24h) na política V2 conta e se aplica só a execução externa.
CROSS JOIN LATERAL public.create_work_proposal(
  source.message_id,'low','programming',pg_temp.intent(source.label,10,'openai'),pg_temp.proposal(source.label)) w;
SELECT public.resolve_approval(id,1,'approve','{}') FROM budget_items WHERE label LIKE 'global-%';

SELECT set_config('request.jwt.claim.sub','83000000-0000-0000-0000-000000000003',true);
INSERT INTO budget_items SELECT 'runtime',id FROM public.create_work_proposal(
  '83000000-0000-0000-0000-000000000015','low','programming',pg_temp.intent('runtime'),pg_temp.proposal('runtime'));
SELECT public.resolve_approval((SELECT id FROM budget_items WHERE label='runtime'),1,'approve','{}');
RESET ROLE;

-- As provas abaixo isolam a guarda de orçamento. Classificação e rota têm
-- suítes próprias e bloqueariam os eventos sintéticos usados para deslocar o
-- relógio; somente os dois triggers alheios são suspensos nesta transação.
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_routing_on_attempt;
ALTER TABLE public.work_claims DISABLE TRIGGER enforce_autonomous_intelligence_on_claim;

SET LOCAL ROLE service_role;
-- Três tentativas do mesmo item são permitidas; a quarta é barrada.
DO $$
DECLARE n integer; v_item uuid:=(SELECT id FROM budget_items WHERE label='item'); v_attempt uuid;
BEGIN
  FOR n IN 1..3 LOOP
    v_attempt:=('83000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at)
    VALUES(v_item,'execution_started','anima',1,jsonb_build_object('schema_version',1,'data',
      jsonb_build_object('attempt_id',v_attempt,'claim_id',gen_random_uuid())),now()-interval '2 hours'+n*interval '1 minute');
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at)
    VALUES(v_item,'execution_failed','executor',1,jsonb_build_object('schema_version',1,'data',
      jsonb_build_object('attempt_id',v_attempt)),now()-interval '2 hours'+n*interval '1 minute'+interval '1 second');
  END LOOP;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','83000000-0000-0000-0000-000000000001',true);
SELECT is(public.autonomous_work_budget_status((SELECT id FROM budget_items WHERE label='item'))->>'reason',
  'item_attempt_budget_exhausted','três tentativas em 24h esgotam o orçamento do item');
SELECT is((public.autonomous_work_budget_status((SELECT id FROM budget_items WHERE label='item'))#>>'{usage,itemAttempts24Hours}')::integer,
  3,'consumo por item é consultável');
SELECT ok((public.block_work_on_budget((SELECT id FROM budget_items WHERE label='item')))->>'blocked'='true',
  'orçamento negado na admissão materializa o checkpoint humano');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM budget_items WHERE label='item')),
  'blocked','item esgotado sai da fila em vez de bloquear a cabeça FIFO');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok(format(
  $$INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
    VALUES(%L,'execution_started','anima',1,
      '{"schema_version":1,"data":{"attempt_id":"83000000-0000-0000-0000-000000000099","claim_id":"83000000-0000-0000-0000-000000000199"}}')$$,
  (SELECT id FROM budget_items WHERE label='item')),
  'P0001','item_attempt_budget_exhausted','guarda atômica recusa a quarta tentativa');

-- Seis tentativas distribuídas em dois itens esgotam o teto global.
DO $$
DECLARE v_label text; ignored integer; n integer:=0; v_item uuid; v_attempt uuid;
BEGIN
  FOREACH v_label IN ARRAY ARRAY['global-a','global-b'] LOOP
    SELECT id INTO v_item FROM budget_items WHERE budget_items.label=v_label;
    FOR ignored IN 1..3 LOOP
      n:=n+1; v_attempt:=('84000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
      INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at)
      VALUES(v_item,'execution_started','anima',1,jsonb_build_object('schema_version',1,'data',
        jsonb_build_object('attempt_id',v_attempt,'claim_id',gen_random_uuid())),now()-interval '3 hours'+n*interval '1 minute');
      INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at)
      VALUES(v_item,'execution_failed','executor',1,jsonb_build_object('schema_version',1,'data',
        jsonb_build_object('attempt_id',v_attempt)),now()-interval '3 hours'+n*interval '1 minute'+interval '1 second');
    END LOOP;
  END LOOP;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','83000000-0000-0000-0000-000000000002',true);
SELECT is(public.autonomous_work_budget_status((SELECT id FROM budget_items WHERE label='global-c'))->>'reason',
  'user_attempt_budget_exhausted','seis tentativas EXTERNAS em 24h esgotam o teto global de custo');
SELECT is((public.autonomous_work_budget_status((SELECT id FROM budget_items WHERE label='global-c'))#>>'{usage,externalAttempts24Hours}')::integer,
  6,'consumo EXTERNO é consultável entre itens');
RESET ROLE;

-- Uma tentativa aberta há 46 minutos aciona a reserva depois do checkpoint.
SET LOCAL ROLE service_role;
UPDATE public.work_items SET state='in_progress' WHERE id=(SELECT id FROM budget_items WHERE label='runtime');
INSERT INTO public.work_claims(id,work_item_id,user_id,approved_proposal_version,owner_instance_id,acquired_at,expires_at,attempt_id,target_reference)
VALUES('85000000-0000-0000-0000-000000000001',(SELECT id FROM budget_items WHERE label='runtime'),
  '83000000-0000-0000-0000-000000000003',1,'test',now()-interval '46 minutes',now()+interval '10 minutes',
  '85000000-0000-0000-0000-000000000002','runtime');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at)
VALUES((SELECT id FROM budget_items WHERE label='runtime'),'execution_started','anima',1,
  '{"schema_version":1,"data":{"attempt_id":"85000000-0000-0000-0000-000000000002","claim_id":"85000000-0000-0000-0000-000000000001"}}',
  now()-interval '46 minutes');
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
VALUES((SELECT id FROM budget_items WHERE label='runtime'),'checkpoint_recorded','executor',1,
  '{"schema_version":1,"data":{"attempt_id":"85000000-0000-0000-0000-000000000002","signal_sequence":1}}');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','83000000-0000-0000-0000-000000000003',true);
SELECT is(public.autonomous_work_budget_status((SELECT id FROM budget_items WHERE label='runtime'))->>'reason',
  'interactive_reserve_protected','45 minutos autônomos preservam a reserva interativa');
SELECT ok((public.interrupt_work_on_budget(
  (SELECT id FROM budget_items WHERE label='runtime'),1,'85000000-0000-0000-0000-000000000002'
))->>'interrupted'='true','interrupção ocorre somente depois de checkpoint persistido');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM budget_items WHERE label='runtime')),
  'blocked','item fica aguardando decisão humana');
SELECT is((SELECT payload#>>'{data,budget_reason}' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM budget_items WHERE label='runtime') AND event_type='input_requested'
  ORDER BY seq DESC LIMIT 1),'interactive_reserve_protected','razão tipada fica auditável');
SELECT is((SELECT payload#>>'{data,checkpoint_event_seq}' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM budget_items WHERE label='runtime') AND event_type='work_blocked'
  ORDER BY seq DESC LIMIT 1),(SELECT seq::text FROM public.work_events
  WHERE work_item_id=(SELECT id FROM budget_items WHERE label='runtime') AND event_type='checkpoint_recorded'
  ORDER BY seq DESC LIMIT 1),'bloqueio referencia o último checkpoint');
SELECT is((SELECT release_reason FROM public.work_claims WHERE id='85000000-0000-0000-0000-000000000001'),
  'attempt_finished','claim é liberado sem deixar execução órfã');
SELECT is((SELECT count(*) FROM public.work_events
  WHERE work_item_id=(SELECT id FROM budget_items WHERE label='runtime')
    AND event_type IN ('result_submitted','execution_failed'))::integer,0,'interrupção não inventa resultado');
SELECT is((public.autonomous_work_budget_status((SELECT id FROM budget_items WHERE label='runtime'))#>>'{usage,autonomousRuntimeSeconds60Minutes}')::numeric>=2700,
  true,'tempo da tentativa aberta entra no consumo');

RESET ROLE;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_routing_on_attempt;
ALTER TABLE public.work_claims ENABLE TRIGGER enforce_autonomous_intelligence_on_claim;
SELECT * FROM finish();
ROLLBACK;
