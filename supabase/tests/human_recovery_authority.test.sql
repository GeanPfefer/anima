-- Autoridade humana de retomada após esgotamento do saldo transferido.
-- Distinta de retry (exige saldo) e de replan (exige falha não-retryable):
-- concede EXATAMENTE +1 tentativa, sob teto agregado explícito, append-only,
-- successor nasce proposed, sem descendente automático e sem resetar consumo.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(32);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
VALUES('73000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','resume@test.invalid','',now(),now()),
('73000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other-resume@test.invalid','',now(),now());
INSERT INTO private.work_orchestration_allowlist(user_id,enabled_by,reason)
SELECT id,id,'resume test' FROM auth.users WHERE id IN ('73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002');
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES
('74000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','user','test');
SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',true);

-- Autorização humana canônica; requestId fixo permite exercitar replay.
CREATE FUNCTION pg_temp.auth(options jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
   'schemaVersion',1,
   'requestId',coalesce(options->>'requestId',gen_random_uuid()::text),
   'reason',coalesce(options->>'reason','Retomada humana limitada apos revisar a nova evidencia.'),
   'additionalAttempts',1,
   'aggregateCeiling',coalesce((options->>'ceiling')::int,4),
   'diagnosis',jsonb_build_object(
     'reference','docs/registros/2026-09-02-recovery-budget-transferido-esgotado.md',
     'priorApiAssumption','exports_absent','correctedApiAssumption','exports_present',
     'apiPath',coalesce(options->>'apiPath','packages/core/src/codec.ts'),
     'exports',coalesce(options->'exports','["parse","serialize"]'::jsonb),
     'syntaxFailure','unbalanced_block','anchorFailure','no_match_cause_unproven'),
   'planRevision','inspect_existing_exports_and_current_reads_v1',
   'compute',jsonb_build_object('placement',coalesce(options->>'placement','local'),
     'preferred',coalesce(options->>'preferred','local-model'),'fallback','qwen2.5-coder:14b',
     'paid',coalesce((options->>'paid')::boolean,false)));
$$;
CREATE FUNCTION pg_temp.valid_auth() RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.auth('{"requestId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}');
$$;

-- Monta um replan-successor FAILED com saldo esgotado (1/1), a raiz do envelope
-- (correction FAILED 2/3) e o ledger work_replans que os liga. Retorna o successor.
CREATE FUNCTION pg_temp.fixture(options jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  u uuid:='73000000-0000-4000-8000-000000000001'; conv uuid:='74000000-0000-4000-8000-000000000001';
  root uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); lin uuid:=gen_random_uuid();
  rfail uuid:=gen_random_uuid(); raux uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid(); att uuid; n int;
  root_started int:=coalesce((options->>'root_started')::int,2);
  i_max int:=coalesce((options->>'i_max')::int,1);
  root_max int:=coalesce((options->>'root_max')::int,3);
  pred_max int:=coalesce((options->>'pred_max')::int,3);
  pred_used int:=coalesce((options->>'pred_used')::int,2);
  alloc int:=coalesce((options->>'alloc')::int,1);
  ispec jsonb; iprop jsonb; rspec jsonb; rprop jsonb;
BEGIN
  rspec:=jsonb_build_object('schema_version',1,'target',jsonb_build_object('kind','project','reference','anima'),
    'executor','worktree','coder_backend','ollama','model','local-model','base_sha',repeat('a',40),
    'permissions','["workspace_read","workspace_write_isolated"]'::jsonb,
    'validation_criteria','[{"label":"t","command":"npm test","covers":["x"]}]'::jsonb,
    'limits',jsonb_build_object('max_attempts',root_max,'max_duration_minutes',30));
  rprop:=jsonb_build_object('schema_version',1,'data',jsonb_build_object('summary','root','objective','root obj',
    'included_scope','["packages/core/src/codec.test.ts"]'::jsonb,'excluded_scope','["packages/core/src/codec.ts"]'::jsonb,
    'expected_effects','["x"]'::jsonb,'risks','["y"]'::jsonb));
  INSERT INTO public.work_items(id,user_id,source_message_id,state,impact_level,capability,original_request,intent,proposal,proposal_version)
  VALUES(root,u,conv,'failed','low','programming','req',jsonb_build_object('execution_spec',rspec),rprop,1);
  FOR n IN 1..root_started LOOP
    att:=gen_random_uuid();
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(root,'execution_started','anima',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',att)));
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(root,'execution_failed','executor',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',att,'retryable',false,'reason','x')));
  END LOOP;
  INSERT INTO public.work_events(id,work_item_id,event_type,author,proposal_version,payload) VALUES(rfail,root,'checkpoint_recorded','anima',1,'{"schema_version":1,"data":{}}');
  INSERT INTO public.work_events(id,work_item_id,event_type,author,proposal_version,payload) VALUES(raux,root,'checkpoint_recorded','anima',1,'{"schema_version":1,"data":{}}');

  ispec:=jsonb_build_object('schema_version',1,'target',jsonb_build_object('kind','project','reference','anima'),
    'executor','worktree','coder_backend','ollama','model',coalesce(options->>'model','local-model'),'base_sha',repeat('a',40),
    'permissions','["workspace_read","workspace_write_isolated"]'::jsonb,
    'validation_criteria','[{"label":"t","command":"npm test","covers":["x"]}]'::jsonb,
    'limits',jsonb_build_object('max_attempts',i_max,'max_duration_minutes',30));
  IF coalesce((options->>'has_resume')::boolean,false) THEN ispec:=ispec||jsonb_build_object('human_resume',jsonb_build_object('x',1)); END IF;
  iprop:=jsonb_build_object('schema_version',1,'data',jsonb_build_object('summary','replan','objective','provar codec',
    'included_scope',coalesce(options->'included','["packages/core/src/codec.test.ts"]'::jsonb),
    'excluded_scope',coalesce(options->'excluded','["packages/core/src/codec.ts"]'::jsonb),
    'expected_effects','["gate passa"]'::jsonb,'risks','["nao alterar impl"]'::jsonb));
  INSERT INTO public.work_items(id,user_id,source_message_id,state,impact_level,capability,original_request,intent,proposal,proposal_version)
  VALUES(i,u,conv,coalesce(options->>'i_state','failed')::public.work_state,'low','programming','req',jsonb_build_object('execution_spec',ispec),iprop,1);
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(i,'execution_started','anima',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',a)));
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(i,'execution_failed','executor',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('attempt_id',a,'retryable',coalesce((options->>'retryable')::boolean,true),'reason','ambiguous')));
  IF NOT coalesce((options->>'no_evidence')::boolean,false) THEN
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(i,'host_observed_gate_evidence_recorded','system',1,
     jsonb_build_object('schema_version',1,'data',jsonb_build_object('origin','host','attempt_id',a,'evidence',jsonb_build_object('attemptId',a,'workItemId',i,'gates',jsonb_build_array(jsonb_build_object('label','t','command','npm test','outcome','failed','exitCode',1,'timedOut',false,'cancelled',false))))));
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(i,'host_observed_evidence_recorded','system',1,
     jsonb_build_object('schema_version',1,'data',jsonb_build_object('origin','host','attempt_id',a,'evidence',jsonb_build_object('attemptId',a,'workItemId',i,'baseSha',repeat('c',40),'observedCommitSha',repeat('d',40),
       'observedChangedFilesSinceStart',coalesce(options->'included','["packages/core/src/codec.test.ts"]'::jsonb)))));
  END IF;

  INSERT INTO public.work_recovery_lineage(id,user_id,original_work_item_id,successor_work_item_id,recovery_sequence,recovery_reason,satisfies_original_objective,idempotency_key)
  VALUES(lin,u,root,i,1,'replan seed',false,gen_random_uuid());
  INSERT INTO public.work_replans(user_id,predecessor_id,failure_event_id,gate_event_id,git_event_id,source_attempt_id,diagnosis,strategy,successor_id,lineage_id,predecessor_attempts_used,predecessor_max_attempts,allocated_attempts)
  VALUES(u,root,rfail,raux,raux,gen_random_uuid(),'{"seed":1}','{"seed":1}',i,lin,pred_used,pred_max,alloc);
  RETURN i;
END; $$;

CREATE FUNCTION pg_temp.run(wid uuid, a jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.authorize_work_resume(wid,1,
   (SELECT e.id FROM public.work_events e WHERE e.work_item_id=wid AND e.event_type='execution_failed' ORDER BY e.seq DESC LIMIT 1), a);
$$;

CREATE TEMP TABLE cases(name text, id uuid);
INSERT INTO cases VALUES
 ('valid',pg_temp.fixture()),
 ('budget',pg_temp.fixture('{"i_max":2}')),
 ('nonretryable',pg_temp.fixture('{"retryable":false}')),
 ('no_evidence',pg_temp.fixture('{"no_evidence":true}')),
 ('apipath_free',pg_temp.fixture('{"excluded":["packages/core/src/zzz.ts"]}')),
 ('model_mismatch',pg_temp.fixture('{"model":"other-model"}')),
 ('inprogress',pg_temp.fixture('{"i_state":"in_progress"}')),
 ('ceiling',pg_temp.fixture()),
 ('owner',pg_temp.fixture());

-- C: budget esgotado + grant humana + plano corrigido => nova unidade proposta com +1.
SELECT lives_ok($$SELECT pg_temp.run(id,pg_temp.valid_auth()) FROM cases WHERE name='valid'$$,'C concede +1 sob autoridade humana');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT successor_id FROM public.work_resume_authorizations WHERE predecessor_id=(SELECT id FROM cases WHERE name='valid'))),'proposed','nova unidade nasce proposed');
SELECT is((SELECT state::text FROM public.work_items WHERE id=(SELECT id FROM cases WHERE name='valid')),'failed','predecessor permanece failed');
SELECT is((SELECT intent#>>'{execution_spec,limits,max_attempts}' FROM public.work_items WHERE id=(SELECT successor_id FROM public.work_resume_authorizations WHERE predecessor_id=(SELECT id FROM cases WHERE name='valid'))),'1','exatamente +1 attempt no successor');
SELECT is((SELECT previous_consumed FROM public.work_resume_authorizations WHERE predecessor_id=(SELECT id FROM cases WHERE name='valid')),3,'L consumo anterior 3 registrado');
SELECT is((SELECT previous_authorized FROM public.work_resume_authorizations WHERE predecessor_id=(SELECT id FROM cases WHERE name='valid')),3,'teto anterior 3 preservado');
SELECT is((SELECT aggregate_ceiling FROM public.work_resume_authorizations WHERE predecessor_id=(SELECT id FROM cases WHERE name='valid')),4,'teto agregado 4');
SELECT is((SELECT additional_attempts FROM public.work_resume_authorizations WHERE predecessor_id=(SELECT id FROM cases WHERE name='valid')),1,'delta explicito de 1');
SELECT ok((SELECT (intent#>'{execution_spec}') ? 'human_resume' FROM public.work_items WHERE id=(SELECT successor_id FROM public.work_resume_authorizations WHERE predecessor_id=(SELECT id FROM cases WHERE name='valid'))),'autoridade embutida no spec do successor');
SELECT is((SELECT intent#>>'{execution_spec,resume_from_checkpoint,base_sha}' FROM public.work_items WHERE id=(SELECT successor_id FROM public.work_resume_authorizations WHERE predecessor_id=(SELECT id FROM cases WHERE name='valid'))),repeat('c',40),'retoma do checkpoint host-observed');
SELECT ok((SELECT proposal#>>'{data,objective}' LIKE '%nova autoridade humana%' FROM public.work_items WHERE id=(SELECT successor_id FROM public.work_resume_authorizations WHERE predecessor_id=(SELECT id FROM cases WHERE name='valid'))),'D plano materialmente revisado');
SELECT ok((SELECT s.proposal#>'{data,included_scope}'=p.proposal#>'{data,included_scope}' FROM public.work_resume_authorizations g JOIN public.work_items p ON p.id=g.predecessor_id JOIN public.work_items s ON s.id=g.successor_id WHERE g.predecessor_id=(SELECT id FROM cases WHERE name='valid')),'mesmo escopo minimo');
SELECT ok((SELECT proposal#>'{data,excluded_scope}' @> '["packages/core/src/codec.ts"]'::jsonb FROM public.work_items WHERE id=(SELECT successor_id FROM public.work_resume_authorizations WHERE predecessor_id=(SELECT id FROM cases WHERE name='valid'))),'impl excluida preservada');
SELECT ok((SELECT l.original_work_item_id=g.predecessor_id AND l.successor_work_item_id=g.successor_id FROM public.work_resume_authorizations g JOIN public.work_recovery_lineage l ON l.id=g.lineage_id WHERE g.predecessor_id=(SELECT id FROM cases WHERE name='valid')),'K lineage predecessor->successor');
SELECT is((SELECT count(*)::int FROM public.work_events WHERE work_item_id=(SELECT id FROM cases WHERE name='valid') AND event_type='execution_started'),1,'E attempts do predecessor nao resetadas');
SELECT is((SELECT count(*)::int FROM public.work_events e JOIN public.work_replans r ON r.predecessor_id=e.work_item_id WHERE r.successor_id=(SELECT id FROM cases WHERE name='valid') AND e.event_type='execution_started'),2,'attempts da raiz preservadas');

-- F: replay da mesma autoridade retorna a mesma unidade sem duplicar.
SELECT is((SELECT pg_temp.run(id,pg_temp.valid_auth())->>'replayed' FROM cases WHERE name='valid'),'true','F replay idempotente');
SELECT is((SELECT count(*)::int FROM public.work_resume_authorizations WHERE predecessor_id=(SELECT id FROM cases WHERE name='valid')),1,'replay nao duplica concessao');
SELECT is((SELECT count(*)::int FROM public.work_recovery_lineage WHERE original_work_item_id=(SELECT id FROM cases WHERE name='valid')),1,'replay nao duplica successor');

-- J/E: nem nova requestId nem descendente automatico renovam autoridade.
SELECT throws_ok($$SELECT pg_temp.run(id,pg_temp.auth('{"requestId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}')) FROM cases WHERE name='valid'$$,'55000','authorization_conflict','segunda concessao no mesmo predecessor recusada');
SELECT throws_ok($$INSERT INTO public.work_recovery_lineage(user_id,original_work_item_id,successor_work_item_id,recovery_sequence,recovery_reason,satisfies_original_objective,idempotency_key)
 SELECT '73000000-0000-4000-8000-000000000001',g.successor_id,c.id,1,'x',false,gen_random_uuid()
 FROM public.work_resume_authorizations g, cases c WHERE g.predecessor_id=(SELECT id FROM cases WHERE name='valid') AND c.name='budget'$$,
 '55000','human_resume_no_further_recovery','J successor humano nao gera descendente');

-- A: retryable com saldo disponivel => nao e este caminho.
SELECT throws_ok($$SELECT pg_temp.run(id,pg_temp.auth()) FROM cases WHERE name='budget'$$,'55000','budget_not_exhausted','A com saldo use retry, nao esta operacao');
-- B: autorizacao ausente/malformada => bloqueado.
SELECT throws_ok($$SELECT pg_temp.run(id,'{}'::jsonb) FROM cases WHERE name='valid'$$,'22023','authorization_invalid','B autorizacao invalida recusada');
-- G: teto agregado incompativel => recusado.
SELECT throws_ok($$SELECT pg_temp.run(id,pg_temp.auth('{"ceiling":3}')) FROM cases WHERE name='ceiling'$$,'55000','aggregate_ceiling_mismatch','G teto agregado deve ser consumo+1');
-- H: compute pago/cloud fora do envelope => recusado na validacao.
SELECT throws_ok($$SELECT pg_temp.run(id,pg_temp.auth('{"paid":true}')) FROM cases WHERE name='valid'$$,'22023','authorization_invalid','H compute pago recusado');
-- Distincao de replan: falha retryable e requisito, nao substituto de replan.
SELECT throws_ok($$SELECT pg_temp.run(id,pg_temp.auth()) FROM cases WHERE name='nonretryable'$$,'55000','retryable_failure_required','falha nao-retryable nao usa esta operacao');
-- Escopo: impl deve estar excluida e diagnosticada.
SELECT throws_ok($$SELECT pg_temp.run(id,pg_temp.auth()) FROM cases WHERE name='apipath_free'$$,'55000','execution_envelope_unsupported','apiPath fora do excluded recusado');
-- Modelo: preferido deve casar com o spec.
SELECT throws_ok($$SELECT pg_temp.run(id,pg_temp.auth()) FROM cases WHERE name='model_mismatch'$$,'55000','execution_envelope_unsupported','modelo divergente recusado');
-- Predecessor deve ser terminal failed.
SELECT throws_ok($$SELECT pg_temp.run(id,pg_temp.auth()) FROM cases WHERE name='inprogress'$$,'55000','predecessor_not_current_failed','predecessor nao terminal recusado');
-- Evidencia host obrigatoria para derivar checkpoint/escopo.
SELECT throws_ok($$SELECT pg_temp.run(id,pg_temp.auth()) FROM cases WHERE name='no_evidence'$$,'55000','host_evidence_missing_or_scope_changed','sem evidencia host recusado');

-- I: ator sem posse do item recusado.
SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000002',true);
SELECT throws_ok($$SELECT pg_temp.run(id,pg_temp.valid_auth()) FROM cases WHERE name='owner'$$,'P0002','work_item_not_found','I dono alheio recusado');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.work_resume_authorizations),0,'RLS nao expoe concessao alheia');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
