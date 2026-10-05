CREATE OR REPLACE FUNCTION public.authorize_candidate_recovery(
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
  scope_files jsonb;
  scope_basis jsonb;
  resume jsonb;
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
      WHERE g->>'label' = p_authorization #>> '{gate,label}' AND regexp_replace(g->>'command', '^npm\.cmd(?= |$)', 'npm')
          = regexp_replace(p_authorization #>> '{gate,command}', '^npm\.cmd(?= |$)', 'npm')
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

  -- Checkpoint exige delta host-observado explícito, sem fallback ao cumulativo.
  resume := i.intent #> '{execution_spec,resume_from_checkpoint}';
  IF (i.intent->'execution_spec') ? 'resume_from_checkpoint' THEN
    IF jsonb_typeof(resume) IS DISTINCT FROM 'object'
      OR jsonb_typeof(resume->'commit_sha') IS DISTINCT FROM 'string'
      OR coalesce(resume->>'commit_sha', '') !~ '^[0-9a-f]{40}$'
      OR resume->>'commit_sha' = p_authorization->>'candidateCommitSha'
      THEN RAISE EXCEPTION 'checkpoint_not_ancestor' USING ERRCODE = '55000'; END IF;
    scope_files := hev.payload #> '{data,evidence,observedChangedFilesSinceStart}';
    IF jsonb_typeof(scope_files) IS DISTINCT FROM 'array'
      THEN RAISE EXCEPTION 'checkpoint_delta_evidence_missing' USING ERRCODE = '55000'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(scope_files) x WHERE jsonb_typeof(x) <> 'string')
      THEN RAISE EXCEPTION 'checkpoint_delta_evidence_missing' USING ERRCODE = '55000'; END IF;
    IF jsonb_typeof(hev.payload #> '{data,evidence,observedChangedFiles}') IS DISTINCT FROM 'array'
      THEN RAISE EXCEPTION 'checkpoint_delta_evidence_inconsistent' USING ERRCODE = '55000'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(hev.payload #> '{data,evidence,observedChangedFiles}') x
        WHERE jsonb_typeof(x) <> 'string')
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(scope_files) x
        WHERE NOT ((hev.payload #> '{data,evidence,observedChangedFiles}') ? (x #>> '{}')))
      THEN RAISE EXCEPTION 'checkpoint_delta_evidence_inconsistent' USING ERRCODE = '55000'; END IF;
    scope := i.proposal #> '{data,included_scope}';
    IF jsonb_typeof(scope) IS DISTINCT FROM 'array'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(scope_files) x WHERE NOT (scope ? (x #>> '{}')))
      OR NOT (scope ? (p_authorization #>> '{location,path}'))
      THEN RAISE EXCEPTION 'scope_evidence_mismatch' USING ERRCODE = '55000'; END IF;
    scope_basis := jsonb_build_object('kind', 'checkpoint', 'start_sha', resume->>'commit_sha');
  ELSE
    -- Nenhum arquivo fora do escopo aprovado; o local do defeito está no escopo.
    scope := i.proposal #> '{data,included_scope}';
    IF jsonb_typeof(scope) IS DISTINCT FROM 'array'
      OR jsonb_typeof(hev.payload #> '{data,evidence,observedChangedFiles}') IS DISTINCT FROM 'array'
      OR jsonb_array_length(hev.payload #> '{data,evidence,observedChangedFiles}') < 1
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(hev.payload #> '{data,evidence,observedChangedFiles}') x
        WHERE jsonb_typeof(x) <> 'string' OR NOT (scope ? (x #>> '{}')))
      OR NOT (scope ? (p_authorization #>> '{location,path}'))
      THEN RAISE EXCEPTION 'scope_evidence_mismatch' USING ERRCODE = '55000'; END IF;
    scope_files := hev.payload #> '{data,evidence,observedChangedFiles}';
    scope_basis := jsonb_build_object('kind', 'base', 'start_sha', hev.payload #>> '{data,evidence,baseSha}');
  END IF;
  scope_basis := scope_basis || jsonb_build_object('files',
    (SELECT coalesce(jsonb_agg(file ORDER BY file), '[]'::jsonb)
      FROM (SELECT DISTINCT value AS file FROM jsonb_array_elements_text(scope_files)) validated));

  spec := i.intent -> 'execution_spec';
  IF jsonb_typeof(spec) IS DISTINCT FROM 'object' OR spec ? 'candidate_recovery'
    OR spec->>'executor' IS DISTINCT FROM 'worktree'
    OR spec->>'coder_backend' IS NULL OR spec->>'coder_backend' NOT IN ('codex-cli','claude-code')
    OR spec->'permissions' IS DISTINCT FROM '["workspace_read","workspace_write_isolated"]'::jsonb
    OR jsonb_typeof(spec->'validation_criteria') IS DISTINCT FROM 'array'
    OR spec::text ~* '(financial_authorization|paid_compute|auto.?provision)'
    THEN RAISE EXCEPTION 'execution_envelope_unsupported' USING ERRCODE = '55000'; END IF;

  checkpoint := jsonb_build_object('base_sha', hev.payload #>> '{data,evidence,baseSha}',
    'commit_sha', p_authorization->>'candidateCommitSha', 'branch', 'anima-work/' || a::text);
  -- Orçamento PRÓPRIO e explícito (nunca saldo do predecessor); validation_criteria preservados.
  spec := jsonb_set(spec, '{limits,max_attempts}', '1'::jsonb)
    || jsonb_build_object('base_sha', checkpoint->>'base_sha', 'resume_from_checkpoint', checkpoint,
      'candidate_recovery', jsonb_build_object('authorization', p_authorization, 'predecessor_id', i.id,
        'failure_event_id', f.id, 'source_attempt_id', a, 'scope_basis', scope_basis));

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
