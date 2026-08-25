BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);

INSERT INTO auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
VALUES(
  'a1000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','manual-release@test.invalid','',now(),
  '{}','{}',now(),now()
);

INSERT INTO public.ai_conversations(id,user_id,role,content)
VALUES(
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'user','fixture manual release'
);

INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason)
VALUES(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'manual release pgTAP'
);

INSERT INTO public.work_items(
  id,user_id,source_message_id,state,impact_level,capability,
  original_request,intent,proposal,proposal_version
)
VALUES(
  'a3000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'approved','low','programming','fixture',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"anima"},"executor":"worktree","coder_backend":"ollama","model":"fixture","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"test","command":"npm test"}],"limits":{"max_attempts":3,"max_duration_minutes":30}}}'::jsonb,
  '{"schema_version":1,"data":{"summary":"fixture","objective":"fixture","included_scope":["x"],"excluded_scope":[],"expected_effects":["x"],"risks":[]}}'::jsonb,
  3
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000001',
  true
);

SELECT has_function(
  'public','release_manual_work',ARRAY['uuid','integer'],
  'RPC de liberacao manual existe'
);

SELECT is(
  (public.start_work(
    'a3000000-0000-4000-8000-000000000001',3
  )).state::text,
  'in_progress',
  'start manual coloca item em in_progress'
);

SELECT is(
  (
    SELECT count(*)::text
    FROM public.work_events
    WHERE work_item_id='a3000000-0000-4000-8000-000000000001'
      AND event_type='execution_started'
  ),
  '0',
  'start manual nao cria attempt'
);

SELECT is(
  (public.release_manual_work(
    'a3000000-0000-4000-8000-000000000001',3
  )).state::text,
  'approved',
  'liberacao devolve item a approved'
);

SELECT is(
  (
    SELECT count(*)::text
    FROM public.work_events
    WHERE work_item_id='a3000000-0000-4000-8000-000000000001'
      AND event_type='manual_work_released'
  ),
  '1',
  'liberacao persiste um fato append-only explicito'
);

SELECT is(
  (
    SELECT payload->'data'->>'reason'
    FROM public.work_events
    WHERE work_item_id='a3000000-0000-4000-8000-000000000001'
      AND event_type='manual_work_released'
    ORDER BY seq DESC
    LIMIT 1
  ),
  'manual_cycle_released',
  'fato declara apenas liberacao do ciclo manual'
);

SELECT is(
  (
    SELECT count(*)::text
    FROM public.work_events
    WHERE work_item_id='a3000000-0000-4000-8000-000000000001'
      AND event_type IN ('result_submitted','execution_failed','attempt_abandoned')
  ),
  '0',
  'recuperacao nao inventa resultado falha ou abandono'
);

SELECT is(
  (
    SELECT count(*)::text
    FROM public.work_events
    WHERE work_item_id='a3000000-0000-4000-8000-000000000001'
      AND event_type='work_started'
  ),
  '1',
  'historico do start manual permanece preservado'
);

SELECT throws_ok(
  $$SELECT public.release_manual_work(
    'a3000000-0000-4000-8000-000000000001',3
  )$$,
  '55000',
  'work item is not in manual progress',
  'nao fabrica segundo release depois que item voltou a approved'
);

SELECT is(
  (
    SELECT count(*)::text
    FROM public.work_events
    WHERE work_item_id='a3000000-0000-4000-8000-000000000001'
      AND event_type='manual_work_released'
  ),
  '1',
  'tentativa repetida nao duplica fato'
);

SELECT * FROM finish();
ROLLBACK;
