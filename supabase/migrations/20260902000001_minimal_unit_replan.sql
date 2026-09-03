-- Plano 007: operação HUMANA distinta de retry/decompose. Diagnóstico atestado
-- pelo usuário + evidência host correlacionada. Mesmo escopo; no máximo o saldo
-- do predecessor, uma transferência e nenhum descendente de replan automático.
CREATE TABLE public.work_replans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  predecessor_id uuid NOT NULL UNIQUE REFERENCES public.work_items(id),
  failure_event_id uuid NOT NULL UNIQUE REFERENCES public.work_events(id),
  gate_event_id uuid NOT NULL REFERENCES public.work_events(id),
  git_event_id uuid NOT NULL REFERENCES public.work_events(id),
  source_attempt_id uuid NOT NULL,
  diagnosis jsonb NOT NULL,
  strategy jsonb NOT NULL,
  successor_id uuid NOT NULL UNIQUE REFERENCES public.work_items(id),
  lineage_id uuid NOT NULL REFERENCES public.work_recovery_lineage(id),
  predecessor_attempts_used integer NOT NULL,
  predecessor_max_attempts integer NOT NULL,
  allocated_attempts integer NOT NULL CHECK (allocated_attempts > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (predecessor_attempts_used + allocated_attempts <= predecessor_max_attempts)
);
ALTER TABLE public.work_replans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_replans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_replans TO authenticated;
CREATE POLICY work_replans_read_own ON public.work_replans FOR SELECT TO authenticated USING (user_id=auth.uid());

CREATE FUNCTION private.replan_strategy(p_diagnosis jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE c jsonb; v_strategy jsonb;
BEGIN
  IF jsonb_typeof(p_diagnosis) IS DISTINCT FROM 'object'
    OR (p_diagnosis - ARRAY['schemaVersion','finding','evidenceReference','corrections']) <> '{}'::jsonb
    OR p_diagnosis->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR p_diagnosis->>'finding' IS DISTINCT FROM 'test_code_incorrect'
    OR coalesce(p_diagnosis->>'evidenceReference','') !~ '^docs/registros/[A-Za-z0-9_-]+\.md$'
    OR jsonb_typeof(p_diagnosis->'corrections') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'diagnosis_invalid' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_diagnosis->'corrections') NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'diagnosis_invalid' USING ERRCODE='22023';
  END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(p_diagnosis->'corrections') LOOP
    IF jsonb_typeof(c) IS DISTINCT FROM 'object'
      OR (c - ARRAY['kind','symbols','instruction']) <> '{}'::jsonb
      OR coalesce(c->>'kind','') NOT IN ('resolve_imports','respect_api_types','assert_public_boundary')
      OR jsonb_typeof(c->'instruction') IS DISTINCT FROM 'string'
      OR length(btrim(c->>'instruction')) < 10 OR length(c->>'instruction') > 600
      OR jsonb_typeof(c->'symbols') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'diagnosis_invalid' USING ERRCODE='22023';
    END IF;
    IF jsonb_array_length(c->'symbols') NOT BETWEEN 1 AND 12 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(c->'symbols') s WHERE jsonb_typeof(s) <> 'string'
      OR (s #>> '{}') !~ '^[A-Za-z_$][A-Za-z0-9_$]{0,79}$')
      OR (SELECT count(DISTINCT s) FROM jsonb_array_elements(c->'symbols') s) <> jsonb_array_length(c->'symbols') THEN
      RAISE EXCEPTION 'diagnosis_invalid' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'kind') FROM jsonb_array_elements(p_diagnosis->'corrections'))
    <> jsonb_array_length(p_diagnosis->'corrections') THEN
    RAISE EXCEPTION 'diagnosis_invalid' USING ERRCODE='22023';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('kind',corr->>'kind','symbols',
    (SELECT jsonb_agg(s ORDER BY s COLLATE "C") FROM jsonb_array_elements_text(corr->'symbols') s)) ORDER BY (corr->>'kind') COLLATE "C")
    INTO v_strategy FROM jsonb_array_elements(p_diagnosis->'corrections') corr;
  RETURN v_strategy;
END; $$;
REVOKE ALL ON FUNCTION private.replan_strategy(jsonb) FROM PUBLIC;

CREATE FUNCTION public.replan_failed_work(
  p_work_item_id uuid, p_expected_proposal_version integer, p_failure_event_id uuid, p_diagnosis jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  u uuid := auth.uid(); i public.work_items; f public.work_events;
  g public.work_events; h public.work_events; existing public.work_replans;
  a uuid; strategy jsonb; spec jsonb; proposal jsonb; checkpoint jsonb;
  instructions text; used integer; maximum integer; remaining integer;
  sequence integer; envelope jsonb; request_id uuid := gen_random_uuid();
BEGIN
  IF u IS NULL OR NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist WHERE user_id=u) THEN
    RAISE EXCEPTION 'authentication_or_allowlist_required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO i FROM public.work_items WHERE id=p_work_item_id AND user_id=u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work_item_not_found' USING ERRCODE='P0002'; END IF;
  strategy := private.replan_strategy(p_diagnosis);
  SELECT * INTO existing FROM public.work_replans WHERE predecessor_id=i.id;
  IF FOUND THEN
    IF existing.failure_event_id IS DISTINCT FROM p_failure_event_id OR i.proposal_version IS DISTINCT FROM p_expected_proposal_version
      OR existing.diagnosis IS DISTINCT FROM p_diagnosis THEN
      RAISE EXCEPTION 'duplicate_replan' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('successorWorkItemId',existing.successor_id,'lineageId',existing.lineage_id,
      'replanId',existing.id,'strategy',existing.strategy,'allocatedAttempts',existing.allocated_attempts,'replayed',true);
  END IF;
  IF i.state <> 'failed' OR i.proposal_version IS DISTINCT FROM p_expected_proposal_version THEN
    RAISE EXCEPTION 'predecessor_not_current_failed' USING ERRCODE='55000';
  END IF;
  -- Nenhum descendente de replan recebe orçamento novo por esta operação.
  IF EXISTS (WITH RECURSIVE ancestors(id) AS (
      SELECT i.id UNION SELECT l.original_work_item_id FROM public.work_recovery_lineage l JOIN ancestors a ON l.successor_work_item_id=a.id
    ) SELECT 1 FROM ancestors JOIN public.work_replans r ON r.successor_id=ancestors.id)
    OR EXISTS (SELECT 1 FROM public.work_recovery_lineage WHERE original_work_item_id=i.id) THEN
    RAISE EXCEPTION 'replan_lineage_already_allocated' USING ERRCODE='55000';
  END IF;
  IF i.capability <> 'programming' OR i.impact_level <> 'low'
    OR jsonb_typeof(i.proposal->'data'->'included_scope') IS DISTINCT FROM 'array'
    OR jsonb_array_length(i.proposal->'data'->'included_scope') <> 1
    OR (i.proposal->'data'->'included_scope'->>0) !~ '^[A-Za-z0-9_/-]+\.(test|spec)\.[ct]sx?$'
    OR (i.proposal->'data'->'included_scope'->>0) ~ '(^/|\.\.)' THEN
    RAISE EXCEPTION 'not_minimal_test_unit' USING ERRCODE='55000';
  END IF;
  SELECT * INTO f FROM public.work_events WHERE work_item_id=i.id
    AND event_type IN ('execution_failed','result_submitted','work_cancelled','attempt_abandoned') ORDER BY seq DESC LIMIT 1;
  IF f.id IS DISTINCT FROM p_failure_event_id OR f.event_type <> 'execution_failed'
    OR f.proposal_version <> i.proposal_version OR f.payload->'data'->'retryable' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'failure_not_nonretryable' USING ERRCODE='55000';
  END IF;
  a := (f.payload->'data'->>'attempt_id')::uuid;
  IF a IS NULL OR NOT EXISTS(SELECT 1 FROM public.work_events WHERE work_item_id=i.id AND event_type='execution_started'
    AND proposal_version=i.proposal_version AND payload->'data'->>'attempt_id'=a::text) THEN
    RAISE EXCEPTION 'attempt_missing' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM public.work_claims WHERE work_item_id=i.id AND released_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.work_events s WHERE s.work_item_id=i.id AND s.event_type='execution_started'
      AND NOT EXISTS(SELECT 1 FROM public.work_events t WHERE t.work_item_id=i.id AND t.seq>s.seq
        AND t.event_type IN ('execution_failed','work_cancelled','attempt_abandoned','result_submitted')
        AND t.payload->'data'->>'attempt_id'=s.payload->'data'->>'attempt_id')) THEN
    RAISE EXCEPTION 'execution_active' USING ERRCODE='55000';
  END IF;
  SELECT * INTO g FROM public.work_events WHERE work_item_id=i.id AND proposal_version=i.proposal_version
    AND event_type='host_observed_gate_evidence_recorded' AND author='system' AND payload->'data'->>'origin'='host'
    AND payload->'data'->>'attempt_id'=a::text ORDER BY seq DESC LIMIT 1;
  SELECT * INTO h FROM public.work_events WHERE work_item_id=i.id AND proposal_version=i.proposal_version
    AND event_type='host_observed_evidence_recorded' AND author='system' AND payload->'data'->>'origin'='host'
    AND payload->'data'->>'attempt_id'=a::text ORDER BY seq DESC LIMIT 1;
  IF g.id IS NULL OR h.id IS NULL
    OR g.payload#>>'{data,evidence,attemptId}' IS DISTINCT FROM a::text
    OR h.payload#>>'{data,evidence,attemptId}' IS DISTINCT FROM a::text
    OR g.payload#>>'{data,evidence,workItemId}' IS DISTINCT FROM i.id::text
    OR h.payload#>>'{data,evidence,workItemId}' IS DISTINCT FROM i.id::text
    OR g.payload#>'{data,evidence,gates,-1,outcome}' IS DISTINCT FROM '"failed"'::jsonb
    OR g.payload#>'{data,evidence,gates,-1,timedOut}' IS DISTINCT FROM 'false'::jsonb
    OR g.payload#>'{data,evidence,gates,-1,cancelled}' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'deterministic_gate_evidence_missing' USING ERRCODE='55000';
  END IF;
  IF coalesce(h.payload#>'{data,evidence,observedChangedFilesSinceStart}',h.payload#>'{data,evidence,observedChangedFiles}')
    IS DISTINCT FROM i.proposal#>'{data,included_scope}' THEN
    RAISE EXCEPTION 'scope_evidence_mismatch' USING ERRCODE='55000';
  END IF;
  spec := i.intent->'execution_spec';
  IF jsonb_typeof(spec) IS DISTINCT FROM 'object'
    OR spec->>'coder_backend' IS DISTINCT FROM 'ollama'
    OR spec->'permissions' IS DISTINCT FROM '["workspace_read","workspace_write_isolated"]'::jsonb
    OR spec->>'executor' IS DISTINCT FROM 'worktree'
    OR spec#>>'{target,kind}' IS DISTINCT FROM 'project'
    OR jsonb_typeof(spec->'validation_criteria') IS DISTINCT FROM 'array'
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(spec->'validation_criteria') v WHERE length(v->>'command')>0)
    OR spec::text ~* '(financial_authorization|paid_compute|auto.?provision)' THEN
    RAISE EXCEPTION 'execution_envelope_unsupported' USING ERRCODE='55000';
  END IF;
  IF spec->'replan_strategy' = strategy THEN RAISE EXCEPTION 'no_semantic_progress' USING ERRCODE='55000'; END IF;
  -- Orçamento TRANSFERIDO do saldo: não se multiplicam as três attempts do pai.
  maximum := (spec#>>'{limits,max_attempts}')::integer;
  SELECT count(DISTINCT payload->'data'->>'attempt_id') INTO used FROM public.work_events
    WHERE work_item_id=i.id AND event_type='execution_started' AND proposal_version=i.proposal_version;
  remaining := maximum-used;
  IF maximum IS NULL OR maximum NOT BETWEEN 1 AND 3 OR used<1 OR remaining<1 THEN
    RAISE EXCEPTION 'replan_budget_exhausted' USING ERRCODE='55000';
  END IF;
  checkpoint := jsonb_build_object('base_sha',h.payload#>>'{data,evidence,baseSha}',
    'commit_sha',h.payload#>>'{data,evidence,observedCommitSha}','branch','anima-work/'||a::text);
  IF coalesce(checkpoint->>'base_sha','') !~ '^[0-9a-f]{40}$' OR coalesce(checkpoint->>'commit_sha','') !~ '^[0-9a-f]{40}$'
    OR checkpoint->>'base_sha'=checkpoint->>'commit_sha' THEN
    RAISE EXCEPTION 'checkpoint_invalid' USING ERRCODE='55000';
  END IF;
  SELECT string_agg(c->>'kind'||' ('||(SELECT string_agg(s,', ' ORDER BY s COLLATE "C") FROM jsonb_array_elements_text(c->'symbols') s)
    ||'): '||btrim(c->>'instruction'),E'\n' ORDER BY (c->>'kind') COLLATE "C") INTO instructions
    FROM jsonb_array_elements(p_diagnosis->'corrections') c;
  spec := jsonb_set(spec,'{limits,max_attempts}',to_jsonb(remaining)) || jsonb_build_object(
    'base_sha',checkpoint->>'base_sha','resume_from_checkpoint',checkpoint,'replan_strategy',strategy);
  proposal := jsonb_set(i.proposal,'{data,summary}',to_jsonb('Replanejamento diagnosticado: corrigir provas da unidade mínima'::text));
  proposal := jsonb_set(proposal,'{data,objective}',to_jsonb(
    'Corrigir os testes da unidade mínima retomando o checkpoint '||(checkpoint->>'commit_sha')||E'.\n'
    ||'Diagnóstico humano: testes incorretos; implementação validada deve permanecer intacta.\n'
    ||instructions||E'\nObjetivo e aceite originais preservados: '||(i.proposal#>>'{data,objective}')));
  SELECT coalesce(max(recovery_sequence),0)+1 INTO sequence FROM public.work_recovery_lineage WHERE original_work_item_id=i.id;
  envelope := private.record_recovery_successor(u,i.id,sequence,i.impact_level,i.capability,
    jsonb_build_object('execution_spec',spec),proposal,'replan: failure='||f.id||'; diagnosis='||(p_diagnosis->>'evidenceReference'),request_id);
  INSERT INTO public.work_replans(user_id,predecessor_id,failure_event_id,gate_event_id,git_event_id,source_attempt_id,
    diagnosis,strategy,successor_id,lineage_id,predecessor_attempts_used,predecessor_max_attempts,allocated_attempts)
  VALUES(u,i.id,f.id,g.id,h.id,a,p_diagnosis,strategy,(envelope->>'successorWorkItemId')::uuid,
    (envelope->>'lineageId')::uuid,used,maximum,remaining) RETURNING * INTO existing;
  RETURN envelope || jsonb_build_object('replanId',existing.id,'strategy',strategy,'allocatedAttempts',remaining);
END; $$;
REVOKE ALL ON FUNCTION public.replan_failed_work(uuid,integer,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replan_failed_work(uuid,integer,uuid,jsonb) TO authenticated;
