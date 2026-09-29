-- Mandated Verifier é monotônico entre revisões de proposta (2026-09-29).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(15);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
('9b000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vrm@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations (id,user_id,role,content) VALUES
('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-000000000001','user','mandatado'),
('9b000000-0000-0000-0000-0000000000b1','9b000000-0000-0000-0000-000000000001','user','advisory');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason) VALUES
('9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001','monotonic');
RESET ROLE;

SELECT has_trigger('public','work_items','work_items_verifier_requirement_monotonic','trigger monotônico existe');

CREATE TEMP TABLE items(label text PRIMARY KEY,id uuid NOT NULL);
GRANT ALL ON items TO authenticated;
CREATE FUNCTION pg_temp.proposal(label text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT jsonb_build_object('schema_version',1,'data',jsonb_build_object('summary',label,'objective','prova','included_scope',jsonb_build_array('apps/web/cli/args.ts'),'excluded_scope',jsonb_build_array('apps/web/lib'),'expected_effects',jsonb_build_array('e1'),'risks',jsonb_build_array('r')))
$$;
CREATE FUNCTION pg_temp.intent(mandated boolean, gate text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT jsonb_build_object('canonical_provenance',jsonb_build_object('kind','canonical_backlog','sourceId','TPC-01'),
  'execution_spec',jsonb_build_object('limits',jsonb_build_object('max_attempts',1,'max_duration_minutes',30),
    'validation_criteria',jsonb_build_array(jsonb_build_object('label','focal','command',gate)))
  || CASE WHEN mandated THEN jsonb_build_object('verifier_requirement','required_fail_closed') ELSE '{}'::jsonb END)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.intent(boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.proposal(text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000001',true);
INSERT INTO items SELECT 'mand',id FROM public.create_work_proposal('9b000000-0000-0000-0000-0000000000a1','low','programming',pg_temp.intent(true,'npm test'),pg_temp.proposal('v1'));
INSERT INTO items SELECT 'adv',id FROM public.create_work_proposal('9b000000-0000-0000-0000-0000000000b1','low','programming',pg_temp.intent(false,'npm test'),pg_temp.proposal('v1'));

-- request_work_proposal_revision (fluxo de correção): remover o mandato é recusado.
SELECT throws_ok($$SELECT public.request_work_proposal_revision((SELECT id FROM items WHERE label='mand'),1,'gate focal',pg_temp.intent(false,'npm test --workspace=apps/web -- cli/args.test.ts'),pg_temp.proposal('v2'))$$,
  '42501','mandated verifier requirement cannot be removed by a proposal revision','correção que remove o mandato é recusada');
-- ...e revisar escopo/gate/limites mantendo o mandato funciona.
SELECT lives_ok($$SELECT public.request_work_proposal_revision((SELECT id FROM items WHERE label='mand'),1,'gate focal',pg_temp.intent(true,'npm test --workspace=apps/web -- cli/args.test.ts'),pg_temp.proposal('v2'))$$,
  'correção que preserva o mandato cria v2');
SELECT is((SELECT proposal_version FROM public.work_items WHERE id=(SELECT id FROM items WHERE label='mand')),2,'item mandatado está em v2');
SELECT is((SELECT intent->'execution_spec'->'validation_criteria'->0->>'command' FROM public.work_items WHERE id=(SELECT id FROM items WHERE label='mand')),
  'npm test --workspace=apps/web -- cli/args.test.ts','gate revisado persistido');
SELECT is((SELECT intent->'canonical_provenance'->>'sourceId' FROM public.work_items WHERE id=(SELECT id FROM items WHERE label='mand')),'TPC-01','proveniência canônica preservada');

-- revise_work_proposal (caminho alternativo, mesmo risco): também recusa rebaixamento.
SELECT throws_ok($$SELECT public.revise_work_proposal((SELECT id FROM items WHERE label='mand'),2,pg_temp.intent(false,'npm test'),pg_temp.proposal('v3'))$$,
  '42501','mandated verifier requirement cannot be removed by a proposal revision','revise_work_proposal que remove o mandato é recusada');
SELECT throws_ok($$SELECT public.revise_work_proposal((SELECT id FROM items WHERE label='mand'),2,jsonb_set(pg_temp.intent(true,'npm test'),'{execution_spec,verifier_requirement}','"advisory"'),pg_temp.proposal('v3'))$$,
  '42501','mandated verifier requirement cannot be removed by a proposal revision','rebaixar explicitamente para advisory é recusado');
SELECT lives_ok($$SELECT public.revise_work_proposal((SELECT id FROM items WHERE label='mand'),2,pg_temp.intent(true,'npm test'),pg_temp.proposal('v3'))$$,
  'revise_work_proposal que preserva o mandato funciona');

-- Item advisory: comportamento anterior intacto; subir para mandatado é permitido.
SELECT lives_ok($$SELECT public.request_work_proposal_revision((SELECT id FROM items WHERE label='adv'),1,'ajuste',pg_temp.intent(false,'npm run build'),pg_temp.proposal('v2'))$$,
  'item advisory revisa sem mandato como antes');
SELECT lives_ok($$SELECT public.revise_work_proposal((SELECT id FROM items WHERE label='adv'),2,pg_temp.intent(true,'npm run build'),pg_temp.proposal('v3'))$$,
  'advisory → mandatado é permitido (fortalecer)');

RESET ROLE;
SELECT ok(private.work_item_requires_verifier((SELECT intent FROM public.work_items WHERE id=(SELECT id FROM items WHERE label='mand'))),
  'work_item_requires_verifier continua true após revisões do item mandatado');
SELECT ok(private.work_item_requires_verifier((SELECT intent FROM public.work_items WHERE id=(SELECT id FROM items WHERE label='adv'))),
  'item fortalecido passa a exigir Verifier');
-- Escrita direta do operador também não remove o mandato (defesa persistente).
SELECT throws_ok($$UPDATE public.work_items SET intent = intent #- '{execution_spec,verifier_requirement}' WHERE id=(SELECT id FROM items WHERE label='mand')$$,
  '42501','mandated verifier requirement cannot be removed by a proposal revision','UPDATE direto que remove o mandato é recusado');
SELECT lives_ok($$UPDATE public.work_items SET intent = jsonb_set(intent,'{execution_spec,limits,max_duration_minutes}','30') WHERE id=(SELECT id FROM items WHERE label='mand')$$,
  'UPDATE de intent que preserva o mandato segue permitido');

SELECT * FROM finish();
ROLLBACK;
