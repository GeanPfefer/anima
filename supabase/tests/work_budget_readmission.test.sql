BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(17);

-- INTEL-04 (coerência V0). Prova viva de que o bloqueio por orçamento é temporal
-- e honesto, e de que o item volta de `blocked` para `approved` quando a janela
-- móvel de 24h libera — sem esperar 24h reais (envelhecemos os timestamps dos
-- eventos sintéticos) e sem falsificar decisão humana nem afrouxar o teto.

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('86000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'readmit@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('86000000-0000-0000-0000-0000000000a1','86000000-0000-0000-0000-000000000001','user','helper'),
('86000000-0000-0000-0000-0000000000a3','86000000-0000-0000-0000-000000000001','user','alvo'),
('86000000-0000-0000-0000-0000000000a4','86000000-0000-0000-0000-000000000001','user','humano'),
('86000000-0000-0000-0000-0000000000a5','86000000-0000-0000-0000-000000000001','user','tentativa');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('86000000-0000-0000-0000-000000000001');
RESET ROLE;

CREATE TEMP TABLE rb_items(label text PRIMARY KEY,id uuid NOT NULL);
GRANT ALL ON rb_items TO authenticated,service_role;
CREATE FUNCTION pg_temp.proposal(label text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'summary',label,'objective','provar re-admissao','included_scope',jsonb_build_array('a'),
    'excluded_scope',jsonb_build_array('deploy'),'expected_effects',jsonb_build_array('prova'),
    'risks',jsonb_build_array()))
$$;
-- Itens EXTERNOS (coder_backend openai): a re-admissão pré-tentativa é provada
-- contra a quota de CUSTO (user_attempt_budget_exhausted 6/24h), que na política V2
-- se aplica só a execução externa. A mecânica de re-admissão independe da razão.
CREATE FUNCTION pg_temp.intent(target text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('execution_spec',jsonb_build_object(
    'schema_version',1,'target',jsonb_build_object('kind','project','reference',target),
    'coder_backend','openai',
    'permissions',jsonb_build_array(),'validation_criteria',jsonb_build_array(jsonb_build_object('label','teste')),
    'limits',jsonb_build_object('max_attempts',3,'max_duration_minutes',120)))
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','86000000-0000-0000-0000-000000000001',true);
INSERT INTO rb_items SELECT 'helper',id FROM public.create_work_proposal(
  '86000000-0000-0000-0000-0000000000a1','low','programming',pg_temp.intent('helper'),pg_temp.proposal('helper'));
INSERT INTO rb_items SELECT 'alvo',id FROM public.create_work_proposal(
  '86000000-0000-0000-0000-0000000000a3','low','programming',pg_temp.intent('alvo'),pg_temp.proposal('alvo'));
INSERT INTO rb_items SELECT 'humano',id FROM public.create_work_proposal(
  '86000000-0000-0000-0000-0000000000a4','low','programming',pg_temp.intent('humano'),pg_temp.proposal('humano'));
INSERT INTO rb_items SELECT 'tentativa',id FROM public.create_work_proposal(
  '86000000-0000-0000-0000-0000000000a5','low','programming',pg_temp.intent('tentativa'),pg_temp.proposal('tentativa'));
SELECT public.resolve_approval(id,1,'approve','{}') FROM rb_items WHERE label IN ('alvo','humano','tentativa');
RESET ROLE;

-- Construção de histórico: gates de admissão e classificação são suspensos SÓ
-- nos inserts sintéticos; as RPCs sob prova recomputam a decisão por conta própria.
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_routing_on_attempt;
ALTER TABLE public.work_events DISABLE TRIGGER enforce_autonomous_work_budget_before_start;

SET LOCAL ROLE service_role;
-- Seis tentativas do usuário (no item auxiliar) dentro das últimas 24h esgotam o
-- teto global de 6/24h. O item 'alvo' permanece com 0 tentativas próprias.
DO $$
DECLARE n integer; v_helper uuid:=(SELECT id FROM rb_items WHERE label='helper'); v_attempt uuid;
BEGIN
  FOR n IN 1..6 LOOP
    v_attempt:=('86000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at)
    VALUES(v_helper,'execution_started','anima',1,jsonb_build_object('schema_version',1,'data',
      jsonb_build_object('attempt_id',v_attempt,'claim_id',gen_random_uuid())),now()-interval '23 hours'+n*interval '1 minute');
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload,created_at)
    VALUES(v_helper,'execution_failed','executor',1,jsonb_build_object('schema_version',1,'data',
      jsonb_build_object('attempt_id',v_attempt)),now()-interval '23 hours'+n*interval '1 minute'+interval '1 second');
  END LOOP;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','86000000-0000-0000-0000-000000000001',true);

-- ---------- Bloqueio honesto (pré-tentativa) ----------
SELECT is(public.autonomous_work_budget_status((SELECT id FROM rb_items WHERE label='alvo'))->>'reason',
  'user_attempt_budget_exhausted','o teto global esgotado bloqueia o item novo');
SELECT ok((public.block_work_on_budget((SELECT id FROM rb_items WHERE label='alvo')))->>'blocked'='true',
  'orçamento negado materializa o bloqueio temporal');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM rb_items WHERE label='alvo')),
  'blocked','o item esgotado sai da fila');
SELECT is((SELECT (position('decisão humana' IN (payload#>>'{data,explanation}'))>0)
  FROM public.work_events WHERE work_item_id=(SELECT id FROM rb_items WHERE label='alvo')
  AND event_type='input_requested' ORDER BY seq DESC LIMIT 1),
  false,'a explicação NÃO afirma exigir decisão humana');
SELECT is((SELECT payload#>>'{data,resolution}' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM rb_items WHERE label='alvo') AND event_type='input_requested'
  ORDER BY seq DESC LIMIT 1),'awaits_budget_window','o pedido é tipado como espera de janela');
SELECT is((SELECT payload#>>'{data,resolution}' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM rb_items WHERE label='alvo') AND event_type='work_blocked'
  ORDER BY seq DESC LIMIT 1),'awaits_budget_window','o bloqueio é tipado como espera de janela');
SELECT is((SELECT payload#>>'{data,attempt_id}' FROM public.work_events
  WHERE work_item_id=(SELECT id FROM rb_items WHERE label='alvo') AND event_type='work_blocked'
  ORDER BY seq DESC LIMIT 1),NULL,'bloqueio pré-tentativa não referencia tentativa');

-- ---------- Ainda esgotado: nada muda (idempotente e seguro) ----------
SELECT is((SELECT count(*) FROM public.readmit_budget_blocked_work())::int,
  0,'enquanto a janela não libera, nenhum item é re-admitido');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM rb_items WHERE label='alvo')),
  'blocked','o item permanece bloqueado enquanto o orçamento não recupera');

-- ---------- Envelhece a janela (sem esperar 24h reais) ----------
SET LOCAL ROLE service_role;
UPDATE public.work_events SET created_at=created_at-interval '30 hours'
 WHERE event_type IN ('execution_started','execution_failed')
   AND work_item_id=(SELECT id FROM rb_items WHERE label='helper');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','86000000-0000-0000-0000-000000000001',true);

-- ---------- Janela liberou: o item volta a `approved` por evento tipado ----------
SELECT is((SELECT string_agg(work_item_id::text,',') FROM public.readmit_budget_blocked_work()),
  (SELECT id::text FROM rb_items WHERE label='alvo'),'a janela liberou re-admite exatamente o item bloqueado por orçamento');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM rb_items WHERE label='alvo')),
  'approved','re-admissão devolve o item a approved');
SELECT ok(EXISTS(SELECT 1 FROM public.work_events
  WHERE work_item_id=(SELECT id FROM rb_items WHERE label='alvo') AND event_type='work_approved'
    AND author='system' AND payload#>>'{data,reason}'='budget_window_recovered'),
  're-admissão é auditável (work_approved system/budget_window_recovered), não decisão humana');

-- ---------- Idempotência: re-executar não re-transiciona ----------
SELECT is((SELECT count(*) FROM public.readmit_budget_blocked_work())::int,
  0,'item já re-admitido não reaparece');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM rb_items WHERE label='alvo')),
  'approved','o item continua approved após re-execução idempotente');

-- ---------- Guardas: só bloqueio de orçamento PRÉ-tentativa é re-admitido ----------
SET LOCAL ROLE service_role;
-- 'humano' = decisão humana de verdade; 'tentativa' = interrupção EM tentativa
-- por orçamento (carrega attempt_id). Nenhum dos dois é re-admitido por aqui.
UPDATE public.work_items SET state='blocked' WHERE id IN
  (SELECT id FROM rb_items WHERE label IN ('humano','tentativa'));
INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
VALUES((SELECT id FROM rb_items WHERE label='humano'),'work_blocked','anima',1,
  jsonb_build_object('schema_version',1,'data',jsonb_build_object('reason','human_input_required'))),
  ((SELECT id FROM rb_items WHERE label='tentativa'),'work_blocked','anima',1,
  jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'reason','interactive_reserve_protected','attempt_id','86000000-0000-0000-0000-0000000000f1')));
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','86000000-0000-0000-0000-000000000001',true);
SELECT is((SELECT count(*) FROM public.readmit_budget_blocked_work())::int,
  0,'nem decisão humana nem interrupção em tentativa são re-admitidas por orçamento');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM rb_items WHERE label='humano')),
  'blocked','bloqueio de decisão humana permanece bloqueado');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM rb_items WHERE label='tentativa')),
  'blocked','interrupção em tentativa (com checkpoint) não é re-admitida por esta via');

RESET ROLE;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_intelligence_on_attempt;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_routing_on_attempt;
ALTER TABLE public.work_events ENABLE TRIGGER enforce_autonomous_work_budget_before_start;
SELECT * FROM finish();
ROLLBACK;
