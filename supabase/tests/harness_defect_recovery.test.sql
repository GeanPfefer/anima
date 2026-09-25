BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(17);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('96000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','harness-recovery@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content)
VALUES('96000000-0000-0000-0000-000000000011','96000000-0000-0000-0000-000000000001','user','rota de readiness');
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('96000000-0000-0000-0000-000000000001');

-- Fatos de uma attempt paga que falhou no harness (orçamento 1/1 esgotado).
CREATE FUNCTION pg_temp.failed_item(p_id uuid, p_max integer, p_retryable boolean, p_evidence boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.work_items(id,user_id,source_message_id,state,impact_level,capability,original_request,intent,proposal,proposal_version)
  VALUES(p_id,'96000000-0000-0000-0000-000000000001','96000000-0000-0000-0000-000000000011','failed','structural','programming','rota',
    jsonb_build_object('execution_spec',jsonb_build_object('schema_version',1,'executor','worktree','coder_backend','ollama',
      'target',jsonb_build_object('kind','project','reference','anima'),'limits',jsonb_build_object('max_attempts',p_max,'max_duration_minutes',30),
      'validation_criteria',jsonb_build_array(jsonb_build_object('label','teste','command','npm test')))),
    '{"schema_version":1,"data":{"summary":"rota","objective":"criar rota","included_scope":["apps/web/app/api/x/route.ts","apps/web/app/api/x/route.test.ts"],"excluded_scope":["db"],"expected_effects":["ok"],"risks":["r"]}}',3);
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
    (p_id,'execution_started','anima',3,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id','96000000-0000-0000-0000-0000000000a1'))),
    (p_id,'execution_failed','executor',3,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id','96000000-0000-0000-0000-0000000000a1','retryable',p_retryable,'reason','execution_failed')));
  IF p_evidence THEN
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
      (p_id,'host_observed_coder_evidence_recorded','system',3,jsonb_build_object('schema_version',1,'data',jsonb_build_object('origin','host',
        'evidence',jsonb_build_object('attemptId','96000000-0000-0000-0000-0000000000a1','workItemId',p_id,'outcome','failed'))));
  END IF;
END $$;
SELECT pg_temp.failed_item('96000000-0000-0000-0000-0000000000f1',1,true,true);
SELECT pg_temp.failed_item('96000000-0000-0000-0000-0000000000f2',2,true,true);   -- orçamento restante
SELECT pg_temp.failed_item('96000000-0000-0000-0000-0000000000f3',1,true,false);  -- sem evidência de coder
CREATE TEMP TABLE failure AS SELECT work_item_id, id FROM public.work_events WHERE event_type='execution_failed'
  AND work_item_id IN ('96000000-0000-0000-0000-0000000000f1','96000000-0000-0000-0000-0000000000f2','96000000-0000-0000-0000-0000000000f3');
GRANT SELECT ON failure TO authenticated;

CREATE FUNCTION pg_temp.auth(p_request text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object(
  'schemaVersion',1,'kind','harness_defect_fixed_v1','requestId',p_request,'reason','Defeito de harness corrigido: diff de arquivo novo',
  'failureClass','harness','fixCommits',jsonb_build_array(repeat('a',40)),'evidenceReference','docs/registros/2026-09-25g-x.md','additionalAttempts',1) $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE r1 AS SELECT public.authorize_harness_fix_recovery('96000000-0000-0000-0000-0000000000f1',3,
  (SELECT id FROM failure WHERE work_item_id='96000000-0000-0000-0000-0000000000f1'),pg_temp.auth('96000000-0000-0000-0000-0000000000b1')) AS v;
SELECT is((SELECT v->>'replayed' FROM r1),'false','materializa o sucessor');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),'proposed','sucessor nasce proposed (sem aprovação)');
SELECT is((SELECT proposal FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),
  (SELECT proposal FROM public.work_items WHERE id='96000000-0000-0000-0000-0000000000f1'),'proposta idêntica: escopo funcional preservado');
SELECT is((SELECT intent#>>'{execution_spec,limits,max_attempts}' FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),'1','uma tentativa');
SELECT is((SELECT intent#>>'{execution_spec,harness_recovery,source_attempt_id}' FROM public.work_items WHERE id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),
  '96000000-0000-0000-0000-0000000000a1','proveniência da attempt falha no spec');
SELECT is((SELECT jsonb_build_array(original_work_item_id,recovery_sequence) FROM public.work_recovery_lineage WHERE successor_work_item_id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1)),
  jsonb_build_array('96000000-0000-0000-0000-0000000000f1'::uuid,1),'lineage original→sucessor seq 1');
SELECT is((SELECT state::text FROM public.work_items WHERE id='96000000-0000-0000-0000-0000000000f1'),'failed','original permanece failed (evidência preservada)');
SELECT is((public.authorize_harness_fix_recovery('96000000-0000-0000-0000-0000000000f1',3,
  (SELECT id FROM failure WHERE work_item_id='96000000-0000-0000-0000-0000000000f1'),pg_temp.auth('96000000-0000-0000-0000-0000000000b1')))->>'replayed','true','mesmo pedido é replay');
SELECT is((SELECT count(*) FROM public.work_recovery_lineage WHERE original_work_item_id='96000000-0000-0000-0000-0000000000f1'),1::bigint,'replay não cria segundo sucessor');
SELECT throws_ok($$SELECT public.authorize_harness_fix_recovery('96000000-0000-0000-0000-0000000000f1',3,
  (SELECT id FROM failure WHERE work_item_id='96000000-0000-0000-0000-0000000000f1'),pg_temp.auth('96000000-0000-0000-0000-0000000000b2'))$$,
  '55000','harness_recovery_conflict','outro pedido para o mesmo item falho é recusado');
SELECT throws_ok($$SELECT public.authorize_harness_fix_recovery('96000000-0000-0000-0000-0000000000f2',3,
  (SELECT id FROM failure WHERE work_item_id='96000000-0000-0000-0000-0000000000f2'),pg_temp.auth('96000000-0000-0000-0000-0000000000b3'))$$,
  '55000','budget_not_exhausted','com tentativas restantes o caminho é o retry governado');
SELECT throws_ok($$SELECT public.authorize_harness_fix_recovery('96000000-0000-0000-0000-0000000000f3',3,
  (SELECT id FROM failure WHERE work_item_id='96000000-0000-0000-0000-0000000000f3'),pg_temp.auth('96000000-0000-0000-0000-0000000000b4'))$$,
  '55000','host_coder_evidence_missing','sem evidência host-observada do coder é recusado');
SELECT throws_ok($$SELECT public.authorize_harness_fix_recovery('96000000-0000-0000-0000-0000000000f3',3,
  '96000000-0000-0000-0000-00000000dead',pg_temp.auth('96000000-0000-0000-0000-0000000000b5'))$$,
  '55000','retryable_failure_required','evento de falha diferente do último é recusado');
SELECT throws_ok($$SELECT public.authorize_harness_fix_recovery('96000000-0000-0000-0000-0000000000f3',3,
  (SELECT id FROM failure WHERE work_item_id='96000000-0000-0000-0000-0000000000f3'),pg_temp.auth('96000000-0000-0000-0000-0000000000b6')||'{"failureClass":"model"}')$$,
  '22023','invalid harness recovery authorization','só falha classificada como harness');
SELECT throws_ok($$SELECT public.authorize_harness_fix_recovery('96000000-0000-0000-0000-0000000000f3',3,
  (SELECT id FROM failure WHERE work_item_id='96000000-0000-0000-0000-0000000000f3'),pg_temp.auth('96000000-0000-0000-0000-0000000000b7')||'{"fixCommits":["abc"]}')$$,
  '22023','invalid harness recovery authorization','commit do fix precisa ser SHA completo');
SELECT is((SELECT count(*) FROM public.paid_compute_authorizations WHERE work_item_id IN (SELECT (v->>'successorWorkItemId')::uuid FROM r1)),0::bigint,'nenhuma authority paga criada');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=(SELECT (v->>'successorWorkItemId')::uuid FROM r1) AND event_type IN ('work_approved','compute_preference_recorded','execution_started')),
  0::bigint,'sem aprovação, preferência ou execução automáticas');

SELECT * FROM finish();
ROLLBACK;
