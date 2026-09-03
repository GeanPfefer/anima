BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(22);
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
VALUES('71000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','replan@test.invalid','',now(),now()),
('71000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other-replan@test.invalid','',now(),now());
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason)
SELECT id,id,'replan test' FROM auth.users WHERE id IN ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002');
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','user','test');
SELECT set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);

CREATE FUNCTION pg_temp.diagnosis() RETURNS jsonb LANGUAGE sql AS $$
 SELECT '{"schemaVersion":1,"finding":"test_code_incorrect","evidenceReference":"docs/registros/diagnosis.md","corrections":[{"kind":"resolve_imports","symbols":["parse","serialize"],"instruction":"Importar os símbolos da API pública antes de chamar."}]}'::jsonb;
$$;
CREATE FUNCTION pg_temp.fixture(options jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE id uuid := gen_random_uuid(); a uuid; f uuid; n integer; p jsonb; spec jsonb; v integer:=coalesce((options->>'used')::integer,2);
BEGIN
 p := '{"schema_version":1,"data":{"summary":"testes","objective":"Provar o codec existente","included_scope":["packages/core/src/codec.test.ts"],"excluded_scope":["packages/core/src/codec.ts"],"expected_effects":["gate passa","escopo preservado"],"risks":["não alterar implementação"]}}';
 IF options ? 'scope' THEN p:=jsonb_set(p,'{data,included_scope}',options->'scope'); END IF;
 spec := '{"schema_version":1,"target":{"kind":"project","reference":"anima"},"executor":"worktree","coder_backend":"ollama","model":"local-model","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"teste","command":"npm test","covers":["gate passa"]},{"label":"scope","proof":"scope","covers":["escopo preservado"]}],"limits":{"max_attempts":3,"max_duration_minutes":30}}';
 IF options ? 'strategy' THEN spec:=spec||jsonb_build_object('replan_strategy',options->'strategy'); END IF;
 INSERT INTO public.work_items(id,user_id,source_message_id,state,impact_level,capability,original_request,intent,proposal,proposal_version)
 VALUES(id,'71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',coalesce(options->>'state','failed')::public.work_state,'low','programming','tests',jsonb_build_object('execution_spec',spec),p,1);
 FOR n IN 1..v LOOP
  a:=gen_random_uuid(); f:=gen_random_uuid();
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(id,'execution_started','anima',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',a)));
  INSERT INTO public.work_events(id,work_item_id,event_type,author,proposal_version,payload) VALUES(f,id,'execution_failed','executor',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',a,'retryable',coalesce((options->>'retryable')::boolean,false),'reason','execution_failed','executor_signal',jsonb_build_object('code','execution_failed'))));
 END LOOP;
 IF NOT coalesce((options->>'no_evidence')::boolean,false) THEN
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(id,'host_observed_gate_evidence_recorded','system',1,
   jsonb_build_object('schema_version',1,'data',jsonb_build_object('origin','host','attempt_id',a,'evidence',jsonb_build_object('attemptId',a,'workItemId',id,'gates',jsonb_build_array(jsonb_build_object('label','teste','command','npm test','outcome','failed','exitCode',1,'timedOut',coalesce((options->>'timeout')::boolean,false),'cancelled',false))))));
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(id,'host_observed_evidence_recorded','system',1,
   jsonb_build_object('schema_version',1,'data',jsonb_build_object('origin','host','attempt_id',a,'evidence',jsonb_build_object('attemptId',a,'workItemId',id,'baseSha',repeat('a',40),'observedCommitSha',repeat('b',40),'observedChangedFilesSinceStart',coalesce(options->'changed','["packages/core/src/codec.test.ts"]'::jsonb)))));
 END IF;
 RETURN id;
END; $$;
CREATE FUNCTION pg_temp.run(wid uuid, d jsonb DEFAULT pg_temp.diagnosis()) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.replan_failed_work(wid,1,(SELECT e.id FROM public.work_events e WHERE e.work_item_id=wid AND event_type='execution_failed' ORDER BY seq DESC LIMIT 1),d);
$$;
CREATE TEMP TABLE cases(name text,id uuid);
INSERT INTO cases VALUES('valid',pg_temp.fixture()),('retryable',pg_temp.fixture('{"retryable":true}')),
('wide',pg_temp.fixture('{"scope":["a.test.ts","b.test.ts"]}')),('active',pg_temp.fixture('{"state":"in_progress"}')),
('missing',pg_temp.fixture('{"no_evidence":true}')),('timeout',pg_temp.fixture('{"timeout":true}')),
('budget',pg_temp.fixture('{"used":3}')),('scope',pg_temp.fixture('{"changed":["packages/core/src/codec.ts"]}')),
('equivalent',pg_temp.fixture(jsonb_build_object('strategy',private.replan_strategy(pg_temp.diagnosis()))));
SELECT lives_ok($$SELECT pg_temp.run(id) FROM cases WHERE name='valid'$$,'A/B unidade mínima e plano novo permitidos');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT successor_id FROM public.work_replans WHERE predecessor_id=(SELECT id FROM cases WHERE name='valid'))),'proposed','não aprova implicitamente');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM cases WHERE name='valid')),'failed','predecessor preservado');
SELECT is((SELECT allocated_attempts FROM public.work_replans WHERE predecessor_id=(SELECT id FROM cases WHERE name='valid')),1,'saldo transferido 3-2=1');
SELECT is((SELECT intent#>>'{execution_spec,limits,max_attempts}' FROM public.work_items WHERE id=(SELECT successor_id FROM public.work_replans WHERE predecessor_id=(SELECT id FROM cases WHERE name='valid'))),'1','budget próprio limitado ao saldo');
SELECT is((SELECT count(*)::integer FROM public.work_events WHERE work_item_id=(SELECT id FROM cases WHERE name='valid') AND event_type='execution_started'),2,'attempts históricas preservadas');
SELECT ok((SELECT r.failure_event_id=f.id AND r.lineage_id=l.id AND l.original_work_item_id=r.predecessor_id AND l.successor_work_item_id=r.successor_id FROM public.work_replans r JOIN public.work_events f ON f.id=r.failure_event_id JOIN public.work_recovery_lineage l ON l.id=r.lineage_id WHERE r.predecessor_id=(SELECT id FROM cases WHERE name='valid')),'lineage e falha correlacionadas');
SELECT is((SELECT pg_temp.run(id)->>'replayed' FROM cases WHERE name='valid'),'true','replay');
SELECT is((SELECT count(*)::integer FROM public.work_replans),1,'replay não duplica');
SELECT throws_ok($$SELECT pg_temp.run(id,jsonb_set(pg_temp.diagnosis(),'{corrections,0,instruction}','"Texto cosmeticamente diferente apenas."')) FROM cases WHERE name='valid'$$,'55000','duplicate_replan','cosmética não cria novo filho');
SELECT throws_ok($$SELECT pg_temp.run(id) FROM cases WHERE name='equivalent'$$,'55000','no_semantic_progress','C estratégia equivalente recusada');
SELECT throws_ok($$SELECT pg_temp.run(id) FROM cases WHERE name='retryable'$$,'55000','failure_not_nonretryable','D não substitui retry');
SELECT throws_ok($$SELECT pg_temp.run(id) FROM cases WHERE name='wide'$$,'55000','not_minimal_test_unit','E unidade decomponível recusada');
SELECT throws_ok($$SELECT pg_temp.run(id,'{}') FROM cases WHERE name='missing'$$,'22023','diagnosis_invalid','F diagnóstico ausente');
SELECT throws_ok($$SELECT pg_temp.run(id) FROM cases WHERE name='missing'$$,'55000','deterministic_gate_evidence_missing','F evidência ausente');
SELECT throws_ok($$SELECT pg_temp.run(id) FROM cases WHERE name='active'$$,'55000','predecessor_not_current_failed','H predecessor não terminal');
SELECT throws_ok($$SELECT pg_temp.run(id) FROM cases WHERE name='budget'$$,'55000','replan_budget_exhausted','J não reseta orçamento');
SELECT throws_ok($$SELECT pg_temp.run(id) FROM cases WHERE name='scope'$$,'55000','scope_evidence_mismatch','não oculta violação');
SELECT throws_ok($$SELECT pg_temp.run(id) FROM cases WHERE name='timeout'$$,'55000','deterministic_gate_evidence_missing','timeout não é falha determinística');
SELECT ok((SELECT p.proposal#>'{data,included_scope}'=s.proposal#>'{data,included_scope}' AND p.intent#>'{execution_spec,validation_criteria}'=s.intent#>'{execution_spec,validation_criteria}' FROM public.work_replans r JOIN public.work_items p ON p.id=r.predecessor_id JOIN public.work_items s ON s.id=r.successor_id),'escopo e gates/covers intactos');
SELECT set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
SELECT throws_ok($$SELECT pg_temp.run(id) FROM cases WHERE name='valid'$$,'P0002','work_item_not_found','owner alheio recusado');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.work_replans),0,'RLS não expõe diagnóstico alheio');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
