-- ============================================================
-- Recuperação governada após DEFEITO DE HARNESS já corrigido
-- ============================================================
--
-- Lacuna: uma unidade `failed` com `max_attempts` esgotado cuja causa foi o próprio
-- harness do ANIMA (não o modelo nem o plano) não tinha caminho canônico honesto:
--   * retry governado ⇒ bloqueado (attempt_budget_exhausted);
--   * replan ⇒ só aceita `test_code_incorrect` (seria diagnóstico falso);
--   * authorize_work_resume ⇒ envelope de um incidente específico (escopo = 1 teste,
--     backend ollama, checkpoint com evidência de gate);
--   * decomposição ⇒ exige checkpoint durável (a attempt falhou antes de commitar).
--
-- Este ato HUMANO materializa exatamente UM sucessor `proposed` com a MESMA proposta
-- (escopo funcional preservado) e `max_attempts = 1`, ligado por lineage, registrando a
-- autoridade (commits do fix + registro de evidência). NÃO aprova, NÃO define
-- preferência de compute, NÃO cria authority/reserva e NÃO executa.

CREATE TABLE public.work_harness_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  predecessor_id uuid NOT NULL UNIQUE REFERENCES public.work_items(id) ON DELETE CASCADE,
  failure_event_id uuid NOT NULL,
  source_attempt_id uuid NOT NULL,
  authority jsonb NOT NULL,
  successor_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  lineage_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id)
);
ALTER TABLE public.work_harness_recoveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuário lê suas recuperações de harness" ON public.work_harness_recoveries
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON TABLE public.work_harness_recoveries FROM anon, authenticated;
GRANT SELECT ON TABLE public.work_harness_recoveries TO authenticated;

CREATE FUNCTION private.validate_harness_recovery_authorization(p jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE c jsonb;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p)) <> 8
    OR NOT (p ?& ARRAY['schemaVersion','kind','requestId','reason','failureClass','fixCommits','evidenceReference','additionalAttempts'])
    OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR p->>'kind' IS DISTINCT FROM 'harness_defect_fixed_v1'
    OR p->>'failureClass' IS DISTINCT FROM 'harness'
    OR p->'additionalAttempts' IS DISTINCT FROM '1'::jsonb
    OR coalesce(p->>'requestId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(p->'reason') IS DISTINCT FROM 'string'
    OR length(btrim(p->>'reason')) < 10 OR length(p->>'reason') > 500
    OR coalesce(p->>'evidenceReference','') !~ '^docs/registros/[A-Za-z0-9_-]+\.md$'
    OR jsonb_typeof(p->'fixCommits') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p->'fixCommits') < 1 OR jsonb_array_length(p->'fixCommits') > 4
  THEN RAISE EXCEPTION 'invalid harness recovery authorization' USING ERRCODE = '22023'; END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(p->'fixCommits') LOOP
    IF jsonb_typeof(c) IS DISTINCT FROM 'string' OR (c #>> '{}') !~ '^[0-9a-f]{40}$' THEN
      RAISE EXCEPTION 'invalid harness recovery authorization' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(p->'fixCommits')) <> jsonb_array_length(p->'fixCommits') THEN
    RAISE EXCEPTION 'invalid harness recovery authorization' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.validate_harness_recovery_authorization(jsonb) FROM PUBLIC;

CREATE FUNCTION public.authorize_harness_fix_recovery(
  p_work_item_id uuid,
  p_expected_proposal_version integer,
  p_failure_event_id uuid,
  p_authorization jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  u uuid := auth.uid();
  i public.work_items;
  old public.work_harness_recoveries;
  f public.work_events;
  a uuid;
  used integer;
  maximum integer;
  spec jsonb;
  envelope jsonb;
  seq integer;
  grant_id uuid := gen_random_uuid();
BEGIN
  IF u IS NULL OR NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist WHERE user_id = u)
    THEN RAISE EXCEPTION 'authentication_or_allowlist_required' USING ERRCODE = '42501'; END IF;
  PERFORM private.validate_harness_recovery_authorization(p_authorization);

  SELECT * INTO i FROM public.work_items WHERE id = p_work_item_id AND user_id = u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work_item_not_found' USING ERRCODE = 'P0002'; END IF;

  -- Idempotência: o mesmo pedido (ou o mesmo predecessor) devolve o sucessor já criado.
  SELECT * INTO old FROM public.work_harness_recoveries
    WHERE predecessor_id = i.id OR (user_id = u AND request_id = (p_authorization->>'requestId')::uuid);
  IF FOUND THEN
    IF old.predecessor_id <> i.id OR old.failure_event_id IS DISTINCT FROM p_failure_event_id
      OR old.authority IS DISTINCT FROM p_authorization
    THEN RAISE EXCEPTION 'harness_recovery_conflict' USING ERRCODE = '55000'; END IF;
    RETURN jsonb_build_object('recoveryId', old.id, 'successorWorkItemId', old.successor_id,
      'lineageId', old.lineage_id, 'sourceAttemptId', old.source_attempt_id, 'replayed', true);
  END IF;

  IF i.state <> 'failed' OR i.proposal_version IS DISTINCT FROM p_expected_proposal_version
    THEN RAISE EXCEPTION 'predecessor_not_current_failed' USING ERRCODE = '55000'; END IF;

  -- Exatamente UM sucessor por item falho (nenhum outro caminho de recovery já usado).
  IF EXISTS (SELECT 1 FROM public.work_recovery_lineage WHERE original_work_item_id = i.id)
    THEN RAISE EXCEPTION 'recovery_already_allocated' USING ERRCODE = '55000'; END IF;

  SELECT * INTO f FROM public.work_events
    WHERE work_item_id = i.id AND event_type IN ('execution_failed','result_submitted','work_cancelled','attempt_abandoned')
    ORDER BY seq DESC LIMIT 1;
  IF f.id IS DISTINCT FROM p_failure_event_id OR f.event_type <> 'execution_failed'
    OR f.proposal_version <> i.proposal_version OR f.payload #> '{data,retryable}' IS DISTINCT FROM 'true'::jsonb
    THEN RAISE EXCEPTION 'retryable_failure_required' USING ERRCODE = '55000'; END IF;
  a := (f.payload #>> '{data,attempt_id}')::uuid;
  IF a IS NULL OR NOT EXISTS (SELECT 1 FROM public.work_events WHERE work_item_id = i.id
      AND event_type = 'execution_started' AND payload #>> '{data,attempt_id}' = a::text)
    THEN RAISE EXCEPTION 'attempt_missing' USING ERRCODE = '55000'; END IF;
  -- A attempt precisa ter evidência de coder observada pelo HOST (a falha é fato do harness).
  IF NOT EXISTS (SELECT 1 FROM public.work_events WHERE work_item_id = i.id AND author = 'system'
      AND event_type = 'host_observed_coder_evidence_recorded'
      AND payload #>> '{data,evidence,attemptId}' = a::text AND payload #>> '{data,evidence,outcome}' = 'failed')
    THEN RAISE EXCEPTION 'host_coder_evidence_missing' USING ERRCODE = '55000'; END IF;

  IF EXISTS (SELECT 1 FROM public.work_claims WHERE work_item_id = i.id AND released_at IS NULL)
    THEN RAISE EXCEPTION 'execution_active' USING ERRCODE = '55000'; END IF;

  -- Só para orçamento ESGOTADO: com tentativas restantes o caminho é o retry governado.
  SELECT count(DISTINCT payload #>> '{data,attempt_id}') INTO used FROM public.work_events
    WHERE work_item_id = i.id AND event_type = 'execution_started';
  maximum := (i.intent #>> '{execution_spec,limits,max_attempts}')::integer;
  IF maximum IS NULL OR used < maximum THEN RAISE EXCEPTION 'budget_not_exhausted' USING ERRCODE = '55000'; END IF;

  spec := i.intent -> 'execution_spec';
  IF jsonb_typeof(spec) IS DISTINCT FROM 'object' OR spec ? 'harness_recovery'
    THEN RAISE EXCEPTION 'execution_envelope_unsupported' USING ERRCODE = '55000'; END IF;
  spec := jsonb_set(spec, '{limits,max_attempts}', '1'::jsonb)
    || jsonb_build_object('harness_recovery', jsonb_build_object(
      'authorization', p_authorization, 'predecessor_id', i.id,
      'failure_event_id', f.id, 'source_attempt_id', a));

  SELECT coalesce(max(recovery_sequence), 0) + 1 INTO seq FROM public.work_recovery_lineage
    WHERE original_work_item_id = i.id;
  envelope := private.record_recovery_successor(u, i.id, seq, i.impact_level, i.capability,
    jsonb_set(i.intent, '{execution_spec}', spec), i.proposal,
    'harness_defect_recovery: failure=' || f.id || '; attempt=' || a || '; request=' || (p_authorization->>'requestId'),
    (p_authorization->>'requestId')::uuid);

  INSERT INTO public.work_harness_recoveries(id, user_id, request_id, predecessor_id, failure_event_id,
    source_attempt_id, authority, successor_id, lineage_id)
  VALUES (grant_id, u, (p_authorization->>'requestId')::uuid, i.id, f.id, a, p_authorization,
    (envelope->>'successorWorkItemId')::uuid, (envelope->>'lineageId')::uuid);

  RETURN jsonb_build_object('recoveryId', grant_id, 'successorWorkItemId', envelope->>'successorWorkItemId',
    'lineageId', envelope->>'lineageId', 'sourceAttemptId', a, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.authorize_harness_fix_recovery(uuid,integer,uuid,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.authorize_harness_fix_recovery(uuid,integer,uuid,jsonb) TO authenticated;

COMMENT ON FUNCTION public.authorize_harness_fix_recovery(uuid,integer,uuid,jsonb) IS
  'Ato humano: após defeito de HARNESS corrigido, materializa exatamente um sucessor proposed com a mesma proposta e max_attempts=1, ligado por lineage. Não aprova, não define preferência de compute, não cria authority/reserva, não executa.';
