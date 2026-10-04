-- ============================================================
-- Recuperação governada de CANDIDATO com defeito real (ato humano)
-- ============================================================
--
-- Lacuna: um item `failed` cujo coder produziu um candidato commitado que reprovou num
-- gate por defeito REAL do código não tinha caminho honesto: retry exige `retryable`,
-- replan só aceita testes de unidade mínima e a recovery de harness exige causa de harness.
--
-- Este ato HUMANO cria exatamente UM sucessor `proposed` na MESMA lineage, com a MESMA
-- proposta e o MESMO escopo, `resume_from_checkpoint` apontando para o candidato anterior
-- e orçamento PRÓPRIO de 1 attempt. NÃO é retry; NÃO aprova, NÃO define preferência de
-- compute, NÃO cria authority/reserva e NÃO executa. Os gates rodam todos de novo.

CREATE TABLE public.work_candidate_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  predecessor_id uuid NOT NULL UNIQUE REFERENCES public.work_items(id) ON DELETE CASCADE,
  failure_event_id uuid NOT NULL,
  source_attempt_id uuid NOT NULL,
  candidate_commit_sha text NOT NULL CHECK (candidate_commit_sha ~ '^[0-9a-f]{40}$'),
  authority jsonb NOT NULL,
  successor_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  lineage_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id)
);
ALTER TABLE public.work_candidate_recoveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuário lê suas recuperações de candidato" ON public.work_candidate_recoveries
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON TABLE public.work_candidate_recoveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.work_candidate_recoveries TO authenticated;

-- Espelho exato de `readCandidateRecoveryAuthorization` (packages/core).
CREATE FUNCTION private.validate_candidate_recovery_authorization(p jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE c jsonb; g jsonb; l jsonb; kinds text[] := ARRAY[]::text[]; k text;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p)) <> 13
    OR NOT (p ?& ARRAY['schemaVersion','kind','requestId','reason','finding','candidateCommitSha','sourceAttemptId','gate',
      'location','observedError','evidenceReference','corrections','additionalAttempts'])
    OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR p->>'kind' IS DISTINCT FROM 'production_candidate_incorrect_v1'
    OR p->>'finding' IS DISTINCT FROM 'production_candidate_incorrect'
    OR p->'additionalAttempts' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(p->'requestId') IS DISTINCT FROM 'string'
    OR p->>'requestId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(p->'sourceAttemptId') IS DISTINCT FROM 'string'
    OR p->>'sourceAttemptId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(p->'candidateCommitSha') IS DISTINCT FROM 'string'
    OR p->>'candidateCommitSha' !~ '^[0-9a-f]{40}$'
    OR jsonb_typeof(p->'reason') IS DISTINCT FROM 'string'
    OR length(btrim(p->>'reason')) < 10 OR length(p->>'reason') > 500
    OR jsonb_typeof(p->'observedError') IS DISTINCT FROM 'string'
    OR length(btrim(p->>'observedError')) < 10 OR length(p->>'observedError') > 400
    OR jsonb_typeof(p->'evidenceReference') IS DISTINCT FROM 'string'
    OR p->>'evidenceReference' !~ '^docs/registros/[A-Za-z0-9_-]+\.md$'
    OR jsonb_typeof(p->'gate') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p->'location') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p->'corrections') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p->'corrections') < 1 OR jsonb_array_length(p->'corrections') > 3
  THEN RAISE EXCEPTION 'invalid candidate recovery authorization' USING ERRCODE = '22023'; END IF;

  g := p->'gate';
  IF (SELECT count(*) FROM jsonb_object_keys(g)) <> 3 OR NOT (g ?& ARRAY['label','command','exitCode'])
    OR jsonb_typeof(g->'label') IS DISTINCT FROM 'string' OR length(btrim(g->>'label')) < 1 OR length(g->>'label') > 200
    OR jsonb_typeof(g->'command') IS DISTINCT FROM 'string' OR length(btrim(g->>'command')) < 1 OR length(g->>'command') > 500
    OR jsonb_typeof(g->'exitCode') IS DISTINCT FROM 'number' OR (g->>'exitCode') !~ '^-?[0-9]+$'
  THEN RAISE EXCEPTION 'invalid candidate recovery authorization' USING ERRCODE = '22023'; END IF;

  l := p->'location';
  IF NOT (l ? 'path') OR (SELECT count(*) FROM jsonb_object_keys(l) key WHERE key NOT IN ('path','line')) > 0
    OR jsonb_typeof(l->'path') IS DISTINCT FROM 'string'
    OR length(l->>'path') < 1 OR length(l->>'path') > 300
    OR l->>'path' ~ '(^/|^[A-Za-z]:|\\|(^|/)\.{1,2}(/|$)|//|/$)'
    OR (l ? 'line' AND (jsonb_typeof(l->'line') IS DISTINCT FROM 'number' OR (l->>'line') !~ '^[0-9]+$'
      OR (l->>'line')::numeric < 1 OR (l->>'line')::numeric > 1000000))
  THEN RAISE EXCEPTION 'invalid candidate recovery authorization' USING ERRCODE = '22023'; END IF;

  FOR c IN SELECT value FROM jsonb_array_elements(p->'corrections') LOOP
    IF jsonb_typeof(c) IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(c)) <> 2 OR NOT (c ?& ARRAY['kind','instruction'])
      OR jsonb_typeof(c->'kind') IS DISTINCT FROM 'string'
      OR c->>'kind' NOT IN ('type_error','test_failure','build_error','behavior_gap')
      OR jsonb_typeof(c->'instruction') IS DISTINCT FROM 'string'
      OR length(btrim(c->>'instruction')) < 10 OR length(c->>'instruction') > 600
    THEN RAISE EXCEPTION 'invalid candidate recovery authorization' USING ERRCODE = '22023'; END IF;
    k := c->>'kind';
    IF k = ANY (kinds) THEN RAISE EXCEPTION 'invalid candidate recovery authorization' USING ERRCODE = '22023'; END IF;
    kinds := kinds || k;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.validate_candidate_recovery_authorization(jsonb) FROM PUBLIC;

CREATE FUNCTION public.authorize_candidate_recovery(
  p_work_item_id uuid,
  p_expected_proposal_version integer,
  p_failure_event_id uuid,
  p_authorization jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  u uuid := auth.uid();
  i public.work_items;
  old public.work_candidate_recoveries;
  f public.work_events;
  cev public.work_events;
  gev public.work_events;
  hev public.work_events;
  a uuid;
  used integer;
  maximum integer;
  spec jsonb;
  checkpoint jsonb;
  envelope jsonb;
  seq integer;
  scope jsonb;
  grant_id uuid := gen_random_uuid();
BEGIN
  IF u IS NULL OR NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist WHERE user_id = u)
    THEN RAISE EXCEPTION 'authentication_or_allowlist_required' USING ERRCODE = '42501'; END IF;
  PERFORM private.validate_candidate_recovery_authorization(p_authorization);

  SELECT * INTO i FROM public.work_items WHERE id = p_work_item_id AND user_id = u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work_item_not_found' USING ERRCODE = 'P0002'; END IF;

  -- Idempotência: o mesmo pedido (ou o mesmo predecessor) devolve o sucessor já criado.
  SELECT * INTO old FROM public.work_candidate_recoveries
    WHERE predecessor_id = i.id OR (user_id = u AND request_id = (p_authorization->>'requestId')::uuid);
  IF FOUND THEN
    IF old.predecessor_id <> i.id OR old.failure_event_id IS DISTINCT FROM p_failure_event_id
      OR old.authority IS DISTINCT FROM p_authorization
    THEN RAISE EXCEPTION 'candidate_recovery_conflict' USING ERRCODE = '55000'; END IF;
    RETURN jsonb_build_object('recoveryId', old.id, 'successorWorkItemId', old.successor_id,
      'lineageId', old.lineage_id, 'sourceAttemptId', old.source_attempt_id,
      'checkpointCommitSha', old.candidate_commit_sha, 'replayed', true);
  END IF;

  IF i.state <> 'failed' OR i.proposal_version IS DISTINCT FROM p_expected_proposal_version
    THEN RAISE EXCEPTION 'predecessor_not_current_failed' USING ERRCODE = '55000'; END IF;

  -- Nenhum descendente de lineage já alocado para este item.
  IF EXISTS (SELECT 1 FROM public.work_recovery_lineage WHERE original_work_item_id = i.id)
    THEN RAISE EXCEPTION 'recovery_already_allocated' USING ERRCODE = '55000'; END IF;

  SELECT * INTO f FROM public.work_events
    WHERE work_item_id = i.id AND event_type IN ('execution_failed','result_submitted','work_cancelled','attempt_abandoned')
    ORDER BY seq DESC LIMIT 1;
  IF f.id IS DISTINCT FROM p_failure_event_id OR f.event_type <> 'execution_failed'
    OR f.proposal_version <> i.proposal_version
    THEN RAISE EXCEPTION 'failure_event_not_current' USING ERRCODE = '55000'; END IF;
  a := (f.payload #>> '{data,attempt_id}')::uuid;
  IF a IS NULL OR a IS DISTINCT FROM (p_authorization->>'sourceAttemptId')::uuid
    OR NOT EXISTS (SELECT 1 FROM public.work_events WHERE work_item_id = i.id
      AND event_type = 'execution_started' AND proposal_version = i.proposal_version
      AND payload #>> '{data,attempt_id}' = a::text)
    THEN RAISE EXCEPTION 'attempt_missing' USING ERRCODE = '55000'; END IF;

  IF EXISTS (SELECT 1 FROM public.work_claims WHERE work_item_id = i.id AND released_at IS NULL)
    THEN RAISE EXCEPTION 'execution_active' USING ERRCODE = '55000'; END IF;

  -- `retryable` pode ser true OU false, mas o orçamento precisa estar ESGOTADO:
  -- com tentativas restantes o caminho canônico é `work retry`.
  SELECT count(DISTINCT payload #>> '{data,attempt_id}') INTO used FROM public.work_events
    WHERE work_item_id = i.id AND event_type = 'execution_started' AND proposal_version = i.proposal_version;
  maximum := (i.intent #>> '{execution_spec,limits,max_attempts}')::integer;
  IF maximum IS NULL OR used < maximum THEN RAISE EXCEPTION 'budget_not_exhausted' USING ERRCODE = '55000'; END IF;

  -- Evidência do HOST (nunca do coder) da MESMA attempt.
  SELECT * INTO cev FROM public.work_events WHERE work_item_id = i.id AND proposal_version = i.proposal_version
    AND author = 'system' AND event_type = 'host_observed_coder_evidence_recorded'
    AND payload #>> '{data,origin}' = 'host' AND payload #>> '{data,evidence,attemptId}' = a::text
    ORDER BY seq DESC LIMIT 1;
  IF cev.id IS NULL OR cev.payload #>> '{data,evidence,outcome}' IS DISTINCT FROM 'succeeded'
    THEN RAISE EXCEPTION 'host_coder_evidence_missing' USING ERRCODE = '55000'; END IF;

  SELECT * INTO gev FROM public.work_events WHERE work_item_id = i.id AND proposal_version = i.proposal_version
    AND author = 'system' AND event_type = 'host_observed_gate_evidence_recorded'
    AND payload #>> '{data,origin}' = 'host' AND payload #>> '{data,evidence,attemptId}' = a::text
    ORDER BY seq DESC LIMIT 1;
  IF gev.id IS NULL
    OR jsonb_typeof(gev.payload #> '{data,evidence,gates}') IS DISTINCT FROM 'array'
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(gev.payload #> '{data,evidence,gates}') g
      WHERE g->>'label' = p_authorization #>> '{gate,label}' AND g->>'command' = p_authorization #>> '{gate,command}'
        AND g->'outcome' = '"failed"'::jsonb AND g->'timedOut' = 'false'::jsonb AND g->'cancelled' = 'false'::jsonb
        AND g->'exitCode' = p_authorization #> '{gate,exitCode}')
    THEN RAISE EXCEPTION 'gate_evidence_mismatch' USING ERRCODE = '55000'; END IF;

  SELECT * INTO hev FROM public.work_events WHERE work_item_id = i.id AND proposal_version = i.proposal_version
    AND author = 'system' AND event_type = 'host_observed_evidence_recorded'
    AND payload #>> '{data,origin}' = 'host' AND payload #>> '{data,evidence,attemptId}' = a::text
    ORDER BY seq DESC LIMIT 1;
  IF hev.id IS NULL
    OR hev.payload #>> '{data,evidence,observedCommitSha}' IS DISTINCT FROM p_authorization->>'candidateCommitSha'
    OR coalesce(hev.payload #>> '{data,evidence,baseSha}', '') !~ '^[0-9a-f]{40}$'
    OR hev.payload #>> '{data,evidence,baseSha}' = hev.payload #>> '{data,evidence,observedCommitSha}'
    THEN RAISE EXCEPTION 'git_evidence_mismatch' USING ERRCODE = '55000'; END IF;

  -- Nenhum arquivo fora do escopo aprovado; o local do defeito está no escopo.
  scope := i.proposal #> '{data,included_scope}';
  IF jsonb_typeof(scope) IS DISTINCT FROM 'array'
    OR jsonb_typeof(hev.payload #> '{data,evidence,observedChangedFiles}') IS DISTINCT FROM 'array'
    OR jsonb_array_length(hev.payload #> '{data,evidence,observedChangedFiles}') < 1
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(hev.payload #> '{data,evidence,observedChangedFiles}') x
      WHERE jsonb_typeof(x) <> 'string' OR NOT (scope ? (x #>> '{}')))
    OR NOT (scope ? (p_authorization #>> '{location,path}'))
    THEN RAISE EXCEPTION 'scope_evidence_mismatch' USING ERRCODE = '55000'; END IF;

  spec := i.intent -> 'execution_spec';
  IF jsonb_typeof(spec) IS DISTINCT FROM 'object' OR spec ? 'candidate_recovery'
    OR spec->>'executor' IS DISTINCT FROM 'worktree'
    OR spec->>'coder_backend' IS NULL OR spec->>'coder_backend' NOT IN ('codex-cli','claude-code')
    OR spec->'permissions' IS DISTINCT FROM '["workspace_read","workspace_write_isolated"]'::jsonb
    OR jsonb_typeof(spec->'validation_criteria') IS DISTINCT FROM 'array'
    OR spec::text ~* '(financial_authorization|paid_compute|auto.?provision|paid)'
    THEN RAISE EXCEPTION 'execution_envelope_unsupported' USING ERRCODE = '55000'; END IF;

  checkpoint := jsonb_build_object('base_sha', hev.payload #>> '{data,evidence,baseSha}',
    'commit_sha', p_authorization->>'candidateCommitSha', 'branch', 'anima-work/' || a::text);
  -- Orçamento PRÓPRIO e explícito (nunca saldo do predecessor); validation_criteria preservados.
  spec := jsonb_set(spec, '{limits,max_attempts}', '1'::jsonb)
    || jsonb_build_object('base_sha', checkpoint->>'base_sha', 'resume_from_checkpoint', checkpoint,
      'candidate_recovery', jsonb_build_object('authorization', p_authorization, 'predecessor_id', i.id,
        'failure_event_id', f.id, 'source_attempt_id', a));

  SELECT coalesce(max(recovery_sequence), 0) + 1 INTO seq FROM public.work_recovery_lineage
    WHERE original_work_item_id = i.id;
  envelope := private.record_recovery_successor(u, i.id, seq, i.impact_level, i.capability,
    jsonb_set(i.intent, '{execution_spec}', spec), i.proposal,
    'candidate_recovery: failure=' || f.id || '; attempt=' || a || '; request=' || (p_authorization->>'requestId'),
    (p_authorization->>'requestId')::uuid);

  INSERT INTO public.work_candidate_recoveries(id, user_id, request_id, predecessor_id, failure_event_id,
    source_attempt_id, candidate_commit_sha, authority, successor_id, lineage_id)
  VALUES (grant_id, u, (p_authorization->>'requestId')::uuid, i.id, f.id, a, p_authorization->>'candidateCommitSha',
    p_authorization, (envelope->>'successorWorkItemId')::uuid, (envelope->>'lineageId')::uuid);

  RETURN jsonb_build_object('recoveryId', grant_id, 'successorWorkItemId', envelope->>'successorWorkItemId',
    'lineageId', envelope->>'lineageId', 'sourceAttemptId', a,
    'checkpointCommitSha', p_authorization->>'candidateCommitSha', 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.authorize_candidate_recovery(uuid,integer,uuid,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.authorize_candidate_recovery(uuid,integer,uuid,jsonb) TO authenticated;

COMMENT ON FUNCTION public.authorize_candidate_recovery(uuid,integer,uuid,jsonb) IS
  'Ato humano: após candidato com defeito real reprovado em gate, materializa exatamente um sucessor proposed na mesma lineage, com a mesma proposta/escopo, resume_from_checkpoint no candidato e max_attempts=1. Não é retry; não aprova, não define compute, não cria authority/reserva, não executa.';
