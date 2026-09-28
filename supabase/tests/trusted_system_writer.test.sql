-- Trusted System Writer V0 — fronteira HUMAN WRITER × TRUSTED SYSTEM WRITER com papéis REAIS.
-- `author=system` é fronteira de confiança, não rótulo de payload.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(33);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('9c000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tsw-human@test.invalid','',now(),'{}','{}',now(),now()),
('9c000000-0000-0000-0000-0000000000ee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tsw-other@test.invalid','',now(),'{}','{}',now(),now()),
('9c000000-0000-0000-0000-00000000aaaa','00000000-0000-0000-0000-000000000000','authenticated','anima_system_writer','tsw-writer@test.invalid','',now(),'{}','{}',now(),now()),
('9c000000-0000-0000-0000-00000000bbbb','00000000-0000-0000-0000-000000000000','authenticated','anima_system_writer','tsw-writer2@test.invalid','',now(),'{}','{}',now(),now()),
('9c000000-0000-0000-0000-00000000cccc','00000000-0000-0000-0000-000000000000','authenticated','anima_system_writer','tsw-writer3@test.invalid','',now(),'{}','{}',now(),now()),
('9c000000-0000-0000-0000-00000000dddd','00000000-0000-0000-0000-000000000000','authenticated','anima_system_writer','tsw-writer4@test.invalid','',now(),'{}','{}',now(),now());
INSERT INTO public.ai_conversations(id,user_id,role,content) VALUES('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-000000000000','user','a');
SET LOCAL ROLE service_role;
INSERT INTO private.work_orchestration_allowlist(user_id) VALUES('9c000000-0000-0000-0000-000000000000'),('9c000000-0000-0000-0000-0000000000ee');
RESET ROLE;
-- Provisionamento do operador: writers dedicados registrados para UM dono.
INSERT INTO private.trusted_system_writers(writer_user_id,owner_user_id) VALUES('9c000000-0000-0000-0000-00000000aaaa','9c000000-0000-0000-0000-000000000000'),('9c000000-0000-0000-0000-00000000dddd','9c000000-0000-0000-0000-0000000000ee');
INSERT INTO private.trusted_system_writers(writer_user_id,owner_user_id,revoked_at) VALUES('9c000000-0000-0000-0000-00000000cccc','9c000000-0000-0000-0000-000000000000',now());

-- Só no teste (revertido no ROLLBACK): o usuário de teste precisa poder assumir o papel.
GRANT anima_system_writer TO postgres;
GRANT USAGE ON SCHEMA extensions TO anima_system_writer;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO anima_system_writer;
CREATE TEMP TABLE ids(k text PRIMARY KEY, v text);
GRANT ALL ON ids TO authenticated, anon, anima_system_writer;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT v::uuid FROM ids WHERE k=p $$;
CREATE FUNCTION pg_temp.hoe(
  p_item uuid, p_attempt uuid,
  p_path text DEFAULT 'packages/core/src/a.ts',
  p_commit text DEFAULT 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  p_base text DEFAULT 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  p_at text DEFAULT '2026-08-15T10:00:00Z',
  p_version integer DEFAULT 1)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'schemaVersion',1,
    'workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',p_version,
    'baseSha',p_base,'observedCommitSha',p_commit,
    'observedChangedFiles',jsonb_build_array(p_path),
    'observedChangedFilesSinceStart',jsonb_build_array(p_path),
    'observedDiffSummary',jsonb_build_object(
      'filesChanged',1,'insertions',3,'deletions',1,
      'files',jsonb_build_array(jsonb_build_object('path',p_path,'insertions',3,'deletions',1))),
    'observedAt',p_at,
    'coverage',jsonb_build_object('git',true,'gates',false));
$$;
CREATE FUNCTION pg_temp.hge(p_item uuid, p_attempt uuid, p_exit integer DEFAULT 0, p_outcome text DEFAULT NULL,
  p_at text DEFAULT '2026-08-16T10:00:00Z', p_label text DEFAULT 'unit')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('schemaVersion',1,'workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',1,
    'gates',jsonb_build_array(jsonb_build_object('label',p_label,'command','npm test','exitCode',p_exit,'durationMs',100,'timedOut',false,'cancelled',false,
      'outcome',coalesce(p_outcome, CASE WHEN p_exit=0 THEN 'passed' ELSE 'failed' END))),
    'observedAt',p_at,'coverage',jsonb_build_object('gates',true));
$$;
CREATE FUNCTION pg_temp.hce(p_item uuid, p_attempt uuid, p_duration integer DEFAULT 84000,
  p_outcome text DEFAULT 'succeeded', p_at text DEFAULT '2026-08-17T10:00:00Z', p_backend text DEFAULT 'ollama-coder')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('schemaVersion',1,'workItemId',p_item,'attemptId',p_attempt,'approvedProposalVersion',1,
    'backendId',p_backend,'durationMs',p_duration,'outcome',p_outcome,'observedAt',p_at,'transcripts','[{"schemaVersion":1,"call":0,"previousCall":null,"gateFingerprint":null,"diffFingerprint":null,"termination":"ollama_ambiguous_replacement","truncated":false,"entries":[{"step":1,"round":0,"phase":"read","path":"src/a.ts","operation":"read","operationStep":null,"readRefs":[],"anchorReadRefs":[],"readHash":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","expectedHash":null,"fingerprint":"2367956d2d282920bf34b21e806edd81ab4db0a25cc75f370f4861dd39a5292e","normalizedFingerprint":"2367956d2d282920bf34b21e806edd81ab4db0a25cc75f370f4861dd39a5292e","length":8,"structure":"xx xxxxx","lines":[1],"clipped":false,"rawMatchCount":null,"matchCount":null,"result":"served"},{"step":2,"round":1,"phase":"edit","path":"src/a.ts","operation":"replace_exact","operationStep":null,"readRefs":[1],"anchorReadRefs":[],"readHash":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","expectedHash":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","fingerprint":"5ad38304b535c2987dbd24657c1a11b884984ff600d9f389deb0d4e634fee792","normalizedFingerprint":"5ad38304b535c2987dbd24657c1a11b884984ff600d9f389deb0d4e634fee792","length":6,"structure":"xxxxxx","lines":[],"clipped":false,"rawMatchCount":0,"matchCount":0,"result":"invalid_anchor"},{"step":3,"round":1,"phase":"application","path":"src/a.ts","operation":"replace_exact","operationStep":2,"readRefs":[1],"anchorReadRefs":[],"readHash":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","expectedHash":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","fingerprint":"5ad38304b535c2987dbd24657c1a11b884984ff600d9f389deb0d4e634fee792","normalizedFingerprint":"5ad38304b535c2987dbd24657c1a11b884984ff600d9f389deb0d4e634fee792","length":6,"structure":"xxxxxx","lines":[],"clipped":false,"rawMatchCount":0,"matchCount":0,"result":"batch_failed"}]}]'::jsonb);
$$;
CREATE FUNCTION pg_temp.opinion(p_verdict text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('schemaVersion',1,'workItemId',pg_temp.id('A'),'attemptId',pg_temp.id('att'),'approvedProposalVersion',1,
    'verifierVersion','work-verifier-v3','verdict',p_verdict,'restsOnAttestedEvidence',false,
    'summary',jsonb_build_object('violations',0,'gaps',0,'checks',1,'attested',0,'independent',1),'findings','[]'::jsonb,
    'evidenceBasis',jsonb_build_object('resultEventId',pg_temp.id('res'),'observedEventId',pg_temp.id('git'),'observedGateEventId',pg_temp.id('gate'),
      'coverage',jsonb_build_object('git',true,'gates',true)));
$$;
CREATE FUNCTION pg_temp.receipt() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('kind','integration_effect',
    'operationKey','integration-effect:auth-1:'||pg_temp.id('res')||':https://github.com/example/anima:refs/heads/dev:'||repeat('c',40)||':aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:merge_no_ff',
    'authorizationId','auth-1','workItemId',pg_temp.id('A'),'proposalVersion',1,'attemptId',pg_temp.id('att'),
    'acceptedResultEventId',pg_temp.id('res'),'resultCommitSha','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','repositoryId','https://github.com/example/anima',
    'targetRef','refs/heads/dev','mode','merge_no_ff','previousTargetSha',repeat('c',40),
    'resultingTargetSha',repeat('d',40),'mergeCommitSha',repeat('d',40),'mergeParents',jsonb_build_array(repeat('c',40),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    'observed',true,'disposition','effected');
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon, anima_system_writer;

-- Item do lane com Verifier obrigatório, até o resultado candidato (sessão humana/executor).
RESET ROLE; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9c000000-0000-0000-0000-000000000000',true), set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','9c000000-0000-0000-0000-000000000000')::text,true);
INSERT INTO ids SELECT 'A',(public.create_work_proposal('9c000000-0000-0000-0000-0000000000a1','low','programming',
  '{"execution_spec":{"schema_version":1,"target":{"kind":"project","reference":"tsw-a"},"permissions":["workspace_read","workspace_write_isolated"],"validation_criteria":[{"label":"tests"}],"limits":{"max_attempts":1},"verifier_requirement":"required_fail_closed"}}',
  '{"schema_version":1,"data":{"summary":"x","objective":"o","included_scope":["src/a.ts"],"excluded_scope":["z"],"expected_effects":["e"],"risks":[]}}')).id::text;
INSERT INTO ids VALUES('att','9c000000-0000-0000-0000-00000000a0a0');
SELECT public.resolve_approval(pg_temp.id('A'),1,'approve','{}');
SELECT public.start_commanded_work_attempt(pg_temp.id('A'),1,pg_temp.id('att'),'worktree-v1');
-- 11. candidato persistido.
SELECT public.record_commanded_work_terminal(pg_temp.id('A'),1,pg_temp.id('att'),jsonb_build_object('kind','result','workItemId',pg_temp.id('A'),
  'attemptId',pg_temp.id('att'),'approvedProposalVersion',1,'origin','executor','sequence',1,'summary','feito','resultReferences','[]'::jsonb,
  'validations','[]'::jsonb,'limitations','[]'::jsonb,'handoffReference','worktree:tsw-a:anima-work/x',
  'worktreeHandoff',jsonb_build_object('commitSha','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','attemptId',pg_temp.id('att'),'workItemId',pg_temp.id('A'),'approvedProposalVersion',1)));
RESET ROLE;
INSERT INTO ids SELECT 'res', id::text FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type='result_submitted';
SELECT is((SELECT state::text FROM public.work_items WHERE id=pg_temp.id('A')),'in_progress','11. candidato persistido (in_progress)');
-- 1–5. Sessão HUMANA não grava nenhum fato de sistema (GRANT revogado de authenticated).
RESET ROLE; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9c000000-0000-0000-0000-000000000000',true), set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','9c000000-0000-0000-0000-000000000000')::text,true);

SELECT throws_ok($$SELECT public.record_host_observed_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hoe(pg_temp.id('A'),pg_temp.id('att')) - 'observedChangedFilesSinceStart')$$,'42501',NULL,'1. humano não grava git');
SELECT throws_ok($$SELECT public.record_host_observed_gate_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hge(pg_temp.id('A'),pg_temp.id('att')))$$,'42501',NULL,'2. humano não grava gate');
SELECT throws_ok($$SELECT public.record_host_observed_coder_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hce(pg_temp.id('A'),pg_temp.id('att')))$$,'42501',NULL,'3. humano não grava coder');
SELECT throws_ok($$SELECT public.record_verifier_opinion(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.opinion('verified'))$$,'42501',NULL,'4. humano não grava opinion');
SELECT throws_ok($$SELECT public.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt())$$,'42501',NULL,'5. humano não grava receipt');
-- anon: nada.
RESET ROLE; SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{"role":"anon"}',true);

SELECT throws_ok($$SELECT public.record_host_observed_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hoe(pg_temp.id('A'),pg_temp.id('att')) - 'observedChangedFilesSinceStart')$$,'42501',NULL,'anon não grava git');
SELECT throws_ok($$SELECT public.record_host_observed_gate_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hge(pg_temp.id('A'),pg_temp.id('att')))$$,'42501',NULL,'anon não grava gate');
SELECT throws_ok($$SELECT public.record_host_observed_coder_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hce(pg_temp.id('A'),pg_temp.id('att')))$$,'42501',NULL,'anon não grava coder');
SELECT throws_ok($$SELECT public.record_verifier_opinion(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.opinion('verified'))$$,'42501',NULL,'anon não grava opinion');
SELECT throws_ok($$SELECT public.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt())$$,'42501',NULL,'anon não grava receipt');
-- Defesa em profundidade: mesmo com GRANT acidental, sessão humana é recusada pela função.
RESET ROLE;
GRANT EXECUTE ON FUNCTION public.record_verifier_opinion(uuid,integer,uuid,jsonb) TO authenticated;
RESET ROLE; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9c000000-0000-0000-0000-000000000000',true), set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','9c000000-0000-0000-0000-000000000000')::text,true);

SELECT throws_ok($$SELECT public.record_verifier_opinion(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.opinion('verified'))$$,'42501','trusted system writer required','GRANT acidental: humano ainda recusado pela função');
RESET ROLE;
REVOKE EXECUTE ON FUNCTION public.record_verifier_opinion(uuid,integer,uuid,jsonb) FROM authenticated;

-- Papel de writer sem o claim role do JWT, writer não registrado, revogado, ou de outro dono: recusados.
RESET ROLE; SET LOCAL ROLE anima_system_writer;
SELECT set_config('request.jwt.claim.sub','9c000000-0000-0000-0000-00000000aaaa',true), set_config('request.jwt.claims',jsonb_build_object('sub','9c000000-0000-0000-0000-00000000aaaa')::text,true);

SELECT throws_ok($$SELECT public.record_host_observed_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hoe(pg_temp.id('A'),pg_temp.id('att')) - 'observedChangedFilesSinceStart')$$,'42501','trusted system writer required','sem claim role=anima_system_writer ⇒ recusado');
RESET ROLE; SET LOCAL ROLE anima_system_writer;
SELECT set_config('request.jwt.claim.sub','9c000000-0000-0000-0000-00000000bbbb',true), set_config('request.jwt.claims',jsonb_build_object('role','anima_system_writer','sub','9c000000-0000-0000-0000-00000000bbbb')::text,true);

SELECT throws_ok($$SELECT public.record_host_observed_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hoe(pg_temp.id('A'),pg_temp.id('att')) - 'observedChangedFilesSinceStart')$$,'42501','trusted system writer required','writer não registrado ⇒ recusado');
RESET ROLE; SET LOCAL ROLE anima_system_writer;
SELECT set_config('request.jwt.claim.sub','9c000000-0000-0000-0000-00000000cccc',true), set_config('request.jwt.claims',jsonb_build_object('role','anima_system_writer','sub','9c000000-0000-0000-0000-00000000cccc')::text,true);

SELECT throws_ok($$SELECT public.record_host_observed_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hoe(pg_temp.id('A'),pg_temp.id('att')) - 'observedChangedFilesSinceStart')$$,'42501','trusted system writer required','writer revogado ⇒ recusado');
RESET ROLE; SET LOCAL ROLE anima_system_writer;
SELECT set_config('request.jwt.claim.sub','9c000000-0000-0000-0000-00000000dddd',true), set_config('request.jwt.claims',jsonb_build_object('role','anima_system_writer','sub','9c000000-0000-0000-0000-00000000dddd')::text,true);

SELECT throws_ok($$SELECT public.record_host_observed_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hoe(pg_temp.id('A'),pg_temp.id('att')) - 'observedChangedFilesSinceStart')$$,'P0002',NULL,'writer de outro dono não inventa item alheio');
-- 6–8/12. Writer registrado grava a evidência do host com todas as correlações.
RESET ROLE; SET LOCAL ROLE anima_system_writer;
SELECT set_config('request.jwt.claim.sub','9c000000-0000-0000-0000-00000000aaaa',true), set_config('request.jwt.claims',jsonb_build_object('role','anima_system_writer','sub','9c000000-0000-0000-0000-00000000aaaa')::text,true);

SELECT is((public.record_host_observed_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hoe(pg_temp.id('A'),pg_temp.id('att')) - 'observedChangedFilesSinceStart'))->>'action','recorded','6. writer grava evidência git');
SELECT is((public.record_host_observed_gate_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hge(pg_temp.id('A'),pg_temp.id('att'))))->>'action','recorded','7. writer grava evidência de gate');
SELECT is((public.record_host_observed_coder_evidence(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.hce(pg_temp.id('A'),pg_temp.id('att'))))->>'action','recorded','8. writer grava evidência do coder');
SELECT throws_ok($$SELECT count(*) FROM public.work_items$$,'42501',NULL,'writer não lê tabelas (menor privilégio)');
SELECT throws_ok($$SELECT public.review_work_result_versioned(pg_temp.id('A'),1,pg_temp.id('res'),'accept','{}')$$,'42501',NULL,'16. writer NÃO executa aceite');
SELECT throws_ok($$SELECT public.authorize_integration_effect(pg_temp.id('A'),1,pg_temp.id('res'),'auth-x','https://github.com/example/anima','refs/heads/dev',repeat('c',40),'merge_no_ff')$$,'42501',NULL,'writer NÃO autoriza integração (ato humano)');
RESET ROLE;
INSERT INTO ids SELECT 'git', id::text FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type='host_observed_evidence_recorded';
INSERT INTO ids SELECT 'gate', id::text FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type='host_observed_gate_evidence_recorded';

SELECT is((SELECT author::text FROM public.work_events WHERE id=pg_temp.id('git')),'system','author=system só pela fronteira do writer');
-- 9/13/14. Parecer verified via writer libera o candidato para review (atômico).
RESET ROLE; SET LOCAL ROLE anima_system_writer;
SELECT set_config('request.jwt.claim.sub','9c000000-0000-0000-0000-00000000aaaa',true), set_config('request.jwt.claims',jsonb_build_object('role','anima_system_writer','sub','9c000000-0000-0000-0000-00000000aaaa')::text,true);

SELECT is((public.record_verifier_opinion(pg_temp.id('A'),1,pg_temp.id('att'),pg_temp.opinion('verified')))->>'released_for_review','true','9/13/14. writer grava parecer; verified libera review');
-- 15. Aceite HUMANO funciona.
RESET ROLE; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9c000000-0000-0000-0000-000000000000',true), set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','9c000000-0000-0000-0000-000000000000')::text,true);

SELECT is((SELECT state::text FROM public.work_items WHERE id=pg_temp.id('A')),'review','14. item em review');
SELECT is((public.review_work_result_versioned(pg_temp.id('A'),1,pg_temp.id('res'),'accept','{}')).state,'completed','15. aceite humano funciona');
-- 17–22. Integração: autorização humana; receipt só pelo writer.

SELECT is((public.authorize_integration_effect(pg_temp.id('A'),1,pg_temp.id('res'),'auth-1','https://github.com/example/anima','refs/heads/dev',repeat('c',40),'merge_no_ff'))->>'action','recorded','17. autorização humana funciona');
SELECT throws_ok($$SELECT public.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt())$$,'42501',NULL,'18/22. humano não grava receipt (nem um receipt coerente e falso)');
RESET ROLE; SET LOCAL ROLE anima_system_writer;
SELECT set_config('request.jwt.claim.sub','9c000000-0000-0000-0000-00000000aaaa',true), set_config('request.jwt.claims',jsonb_build_object('role','anima_system_writer','sub','9c000000-0000-0000-0000-00000000aaaa')::text,true);

SELECT is((public.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt()))->>'action','recorded','20. writer grava o receipt');
SELECT is((public.record_integration_completed(pg_temp.id('A'),1,'auth-1',pg_temp.receipt()))->>'action','replayed','24. replay idempotente pelo writer');
RESET ROLE;

SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type='integration_completed'),'system','receipt com author=system');
SELECT is((SELECT author::text FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type='integration_effect_authorized'),'user','autorização continua humana');
SELECT is((SELECT count(*) FROM public.work_events WHERE work_item_id=pg_temp.id('A') AND event_type IN ('result_accepted','work_approved') AND author='system'),0::bigint,'writer nunca produziu decisão humana');

SELECT * FROM finish();
RESET ROLE;
ROLLBACK;
