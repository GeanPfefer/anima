-- Pending Verification Human Recovery V0 (2026-09-28) — saída HUMANA de um resultado
-- candidato retido no lane com Verifier obrigatório.
--
-- Mandated Verifier V0.1 (20260928000000) mantém o resultado candidato em `in_progress`
-- até um parecer conclusivo e correlacionado. Um Verifier que fica `inconclusive`,
-- `missing`, com timeout/erro ou `evidence_incomplete` de forma DETERMINÍSTICA deixa o
-- item retido indefinidamente: a reconciliação relata `result_pending_verification` e o
-- Supervisor re-verifica a cada volta. Não havia primitive humana para sair disso:
-- `request_changes` só existe em `review`; `submit_work_result` não resolve;
-- `release_manual_work` não se aplica a candidato terminal.
--
-- Princípio: controle humano ≠ bypass da verificação. O humano pode dizer "pare de
-- tentar verificar; quero retrabalho" (`request_changes`) ou "cancele" (`cancel`).
-- NUNCA "considere verificado":
--   * nenhuma decisão produz `review`, `verifier_opinion_recorded`, `result_accepted`
--     ou integração; só o gate técnico do Verifier libera `review` neste lane;
--   * o evento é do DONO (author=user, auth.uid + allowlist + RLS de posse); o Trusted
--     System Writer não participa — a recuperação funciona sem ele provisionado.
--
-- Reuso (menor delta): eventos JÁ existentes (`changes_requested`, `work_cancelled`) e a
-- matriz normativa. Única linha nova: `in_progress --changes_requested--> changes_requested`
-- (o `in_progress --work_cancelled--> cancelled` já existe). O payload de
-- `changes_requested` repete o shape do review (`requested_changes`,
-- `reviewed_proposal_version`, `reviewed_result_event_id`), então a correção governada
-- por retomada (`record_recovery_successor` aceita `changes_requested`) segue igual.
-- Nenhum sucessor é criado aqui: isso continua sendo outra decisão.
--
-- Invariante persistente: o candidato resolvido por humano é MARCADO
-- (`resolved_result_event_id`) e `private.mandated_result_verdict` passa a devolver
-- `human_resolved` para ele — nunca conclusivo. Logo, mesmo que o item volte a
-- `in_progress`, o trigger `guard_mandated_review_release`, `release_mandated_result` e o
-- aceite versionado recusam liberar/aceitar ESSE candidato. Concorrência: esta RPC e
-- `record_verifier_opinion` tomam `FOR UPDATE` na MESMA linha de `work_items`; quem vence
-- o lock decide, o outro relê estado já mudado (humano depois de `review` ⇒ recusa;
-- Verifier depois da decisão ⇒ parecer fica só como histórico, sem liberar).

INSERT INTO private.work_state_transitions (from_state, event_type, to_state)
VALUES ('in_progress', 'changes_requested', 'changes_requested')
ON CONFLICT DO NOTHING;

-- Marca de resolução humana de um candidato (só gravada pela primitive abaixo).
CREATE OR REPLACE FUNCTION private.pending_verification_resolution(p_work_item_id uuid, p_result_event_id uuid)
RETURNS public.work_events LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT r.* FROM public.work_events r
  WHERE r.work_item_id = p_work_item_id
    AND r.event_type IN ('changes_requested','work_cancelled')
    AND r.author = 'user'
    AND r.payload -> 'data' ->> 'origin' = 'pending_verification_recovery'
    AND r.payload -> 'data' ->> 'resolved_result_event_id' = p_result_event_id::text
  ORDER BY r.seq ASC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.pending_verification_resolution(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Corpo vigente (20260928000000) + `human_resolved`: candidato resolvido por humano nunca
-- tem veredito conclusivo, portanto nunca é liberado para review nem aceito.
CREATE OR REPLACE FUNCTION private.mandated_result_verdict(
  p_work_item_id uuid, p_proposal_version integer, p_result_event_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE
  v_result  public.work_events;
  v_opinion public.work_events;
  v_attempt text;
  v_commit  text;
BEGIN
  IF p_result_event_id IS NULL THEN RETURN 'missing'; END IF;
  SELECT * INTO v_result FROM public.work_events e
  WHERE e.id = p_result_event_id AND e.work_item_id = p_work_item_id
    AND e.event_type = 'result_submitted' AND e.proposal_version = p_proposal_version;
  IF NOT FOUND THEN RETURN 'result_mismatch'; END IF;
  IF p_result_event_id IS DISTINCT FROM private.latest_result_event_id(p_work_item_id) THEN
    RETURN 'result_mismatch';
  END IF;
  -- Pending Verification Human Recovery V0: decisão humana encerra o candidato.
  IF (private.pending_verification_resolution(p_work_item_id, p_result_event_id)).id IS NOT NULL THEN
    RETURN 'human_resolved';
  END IF;
  v_attempt := v_result.payload -> 'data' ->> 'attempt_id';
  v_commit  := v_result.payload #>> '{data,executor_signal,worktreeHandoff,commitSha}';

  SELECT * INTO v_opinion FROM public.work_events o
  WHERE o.work_item_id = p_work_item_id AND o.event_type = 'verifier_opinion_recorded'
    AND o.proposal_version = p_proposal_version
    AND o.payload -> 'data' ->> 'attempt_id' = v_attempt
    AND o.payload -> 'data' ->> 'result_event_id' = p_result_event_id::text
    AND (o.payload -> 'data' ->> 'approved_proposal_version') = p_proposal_version::text
  ORDER BY o.seq DESC LIMIT 1;
  IF NOT FOUND THEN RETURN 'missing'; END IF;

  IF (v_opinion.payload -> 'data' ->> 'observed_event_id') IS NULL
     OR (v_opinion.payload -> 'data' ->> 'observed_gate_event_id') IS NULL THEN
    RETURN 'evidence_incomplete';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_events g
    WHERE g.id = (v_opinion.payload -> 'data' ->> 'observed_gate_event_id')::uuid
      AND g.work_item_id = p_work_item_id AND g.event_type = 'host_observed_gate_evidence_recorded'
      AND g.proposal_version = p_proposal_version AND g.payload -> 'data' ->> 'attempt_id' = v_attempt) THEN
    RETURN 'evidence_incomplete';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_events c
    WHERE c.work_item_id = p_work_item_id AND c.event_type = 'host_observed_coder_evidence_recorded'
      AND c.proposal_version = p_proposal_version AND c.payload -> 'data' ->> 'attempt_id' = v_attempt) THEN
    RETURN 'evidence_incomplete';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_events h
    WHERE h.id = (v_opinion.payload -> 'data' ->> 'observed_event_id')::uuid
      AND h.work_item_id = p_work_item_id AND h.event_type = 'host_observed_evidence_recorded'
      AND h.proposal_version = p_proposal_version AND h.payload -> 'data' ->> 'attempt_id' = v_attempt) THEN
    RETURN 'evidence_incomplete';
  END IF;
  IF v_commit IS NULL OR NOT EXISTS (SELECT 1 FROM public.work_events h
    WHERE h.id = (v_opinion.payload -> 'data' ->> 'observed_event_id')::uuid
      AND h.payload #>> '{data,evidence,observedCommitSha}' = v_commit) THEN
    RETURN 'commit_mismatch';
  END IF;

  RETURN CASE v_opinion.payload -> 'data' ->> 'verdict'
    WHEN 'verified' THEN 'verified'
    WHEN 'rejected' THEN 'rejected'
    ELSE 'inconclusive' END;
END;
$$;

-- ─── Primitive humana ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_pending_verification(
  work_item_id uuid,
  result_event_id uuid,
  decision text,
  decision_context jsonb DEFAULT '{}'::jsonb
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_item     public.work_items;
  v_result   public.work_events;
  v_previous public.work_events;
  v_attempt  text;
  v_current_attempt text;
  v_verdict  text;
  v_event    public.work_event_type;
  v_target   public.work_state;
  v_text     text;
  v_data     jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF result_event_id IS NULL OR decision IS NULL OR decision NOT IN ('request_changes','cancel')
     OR jsonb_typeof(coalesce(decision_context,'{}'::jsonb)) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid pending verification decision' USING ERRCODE='22023';
  END IF;
  decision_context := coalesce(decision_context,'{}'::jsonb);
  IF decision = 'request_changes' THEN
    IF jsonb_typeof(decision_context->'requested_changes') IS DISTINCT FROM 'string'
       OR length(btrim(decision_context->>'requested_changes')) = 0 THEN
      RAISE EXCEPTION 'requested_changes is required' USING ERRCODE='22023';
    END IF;
    v_text := btrim(decision_context->>'requested_changes');
  ELSE
    IF decision_context ? 'reason' AND (jsonb_typeof(decision_context->'reason') IS DISTINCT FROM 'string'
       OR length(btrim(decision_context->>'reason')) = 0) THEN
      RAISE EXCEPTION 'invalid cancellation reason' USING ERRCODE='22023';
    END IF;
    v_text := coalesce(btrim(decision_context->>'reason'), 'pending_verification_cancelled');
  END IF;

  -- Mesmo lock de `record_verifier_opinion`/terminal/review: uma transição vence.
  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  v_event := (CASE decision WHEN 'request_changes' THEN 'changes_requested' ELSE 'work_cancelled' END)::public.work_event_type;

  -- Replay / conflito: o candidato já foi resolvido por humano.
  v_previous := private.pending_verification_resolution(v_item.id, result_event_id);
  IF v_previous.id IS NOT NULL THEN
    IF v_previous.event_type = v_event
       AND coalesce(v_previous.payload->'data'->>'requested_changes', v_previous.payload->'data'->>'reason') = v_text THEN
      RETURN v_item;
    END IF;
    RAISE EXCEPTION 'pending verification already resolved with a different decision' USING ERRCODE='55000';
  END IF;

  IF NOT private.work_item_requires_verifier(v_item.intent) THEN
    RAISE EXCEPTION 'work item has no mandated verifier; use the review path' USING ERRCODE='55000';
  END IF;
  IF v_item.state <> 'in_progress' THEN
    RAISE EXCEPTION 'work item is not holding a pending verification candidate' USING ERRCODE='55000';
  END IF;

  -- Identidade exata do candidato: resultado MAIS RECENTE, da versão vigente, da
  -- tentativa vigente (attempt e versão derivados, nunca escolhidos pelo caller).
  SELECT * INTO v_result FROM public.work_events e
  WHERE e.id = result_event_id AND e.work_item_id = v_item.id AND e.event_type = 'result_submitted';
  IF NOT FOUND OR result_event_id IS DISTINCT FROM private.latest_result_event_id(v_item.id)
     OR v_result.proposal_version <> v_item.proposal_version THEN
    RAISE EXCEPTION 'pending verification candidate changed' USING ERRCODE='55000';
  END IF;
  v_attempt := v_result.payload->'data'->>'attempt_id';
  SELECT e.payload->'data'->>'attempt_id' INTO v_current_attempt FROM public.work_events e
  WHERE e.work_item_id = v_item.id AND e.event_type = 'execution_started' AND e.payload->'data' ? 'attempt_id'
  ORDER BY e.seq DESC LIMIT 1;
  IF v_attempt IS NULL OR v_attempt IS DISTINCT FROM v_current_attempt THEN
    RAISE EXCEPTION 'pending verification candidate changed' USING ERRCODE='55000';
  END IF;

  -- Candidato com veredito conclusivo não está pendente: a liberação é do Verifier.
  v_verdict := private.mandated_result_verdict(v_item.id, v_item.proposal_version, result_event_id);
  IF v_verdict IN ('verified','rejected') THEN
    RAISE EXCEPTION 'candidate has a conclusive verifier opinion; it is not pending' USING ERRCODE='55000';
  END IF;

  SELECT t.to_state INTO v_target FROM private.work_state_transitions t
  WHERE t.from_state = v_item.state AND t.event_type = v_event;
  IF NOT FOUND THEN RAISE EXCEPTION 'transition not allowed' USING ERRCODE='22023'; END IF;
  -- Invariante explícita: esta primitive NUNCA libera review.
  IF v_target NOT IN ('changes_requested','cancelled') THEN
    RAISE EXCEPTION 'pending verification recovery cannot release review' USING ERRCODE='55000';
  END IF;

  v_data := jsonb_build_object(
    'origin','pending_verification_recovery',
    'resolved_result_event_id', result_event_id,
    'attempt_id', v_attempt,
    'approved_proposal_version', v_item.proposal_version,
    'verifier_status', v_verdict);
  IF decision = 'request_changes' THEN
    v_data := v_data || jsonb_build_object('requested_changes', v_text,
      'reviewed_proposal_version', v_item.proposal_version, 'reviewed_result_event_id', result_event_id);
  ELSE
    v_data := v_data || jsonb_build_object('reason', v_text, 'cancelled_from_state', 'in_progress');
  END IF;

  UPDATE public.work_items SET state = v_target, updated_at = now() WHERE id = v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id, event_type, author, proposal_version, payload)
  VALUES (v_item.id, v_event, 'user', v_item.proposal_version,
    jsonb_build_object('schema_version', 1, 'data', v_data));
  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_pending_verification(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_pending_verification(uuid, uuid, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.resolve_pending_verification(uuid, uuid, text, jsonb) IS
  'Pending Verification Human Recovery V0: decisão HUMANA (author=user) sobre o resultado candidato retido do lane com Verifier obrigatório — request_changes (in_progress→changes_requested) ou cancel (in_progress→cancelled). Exige o result_event_id mais recente da versão e attempt vigentes, sem veredito conclusivo. Nunca produz review, parecer, aceite ou integração; marca o candidato como human_resolved. Idempotente por candidato; decisão divergente ⇒ 55000.';

-- ─── Reconciliação: candidato resolvido por humano não é mais "pendente" ─────
-- Corpo vigente (20260928000000) com uma única mudança no bloco (1): `human_resolved`
-- não é relatado nem materializado nem abandonado (nada muda; o Supervisor não o
-- re-verifica). Os demais blocos são idênticos.
CREATE OR REPLACE FUNCTION public.reconcile_supervised_work()
RETURNS TABLE (
  work_item_id uuid,
  attempt_id   uuid,
  claim_id     uuid,
  finding      text,
  action       text,
  item_state   public.work_state,
  detail       jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_user_id           uuid := auth.uid();
  v_now               timestamptz := now();
  v_candidate         uuid;
  v_item              public.work_items;
  v_attempt           uuid;
  v_attempt_started   timestamptz;
  v_terminal          public.work_event_type;
  v_claim             public.work_claims;
  v_lease             public.work_claims;
  v_lease_bound       boolean;
  v_lease_exceeded    boolean;
  v_duration_minutes  integer;
  v_duration_bound    boolean;
  v_duration_exceeded boolean;
  v_target_state      public.work_state;
  v_reason            text;
  v_release_reason    text;
  v_verdict           text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('work_reconciliation:'||v_user_id::text, 0));

  FOR v_candidate IN
    SELECT i.id FROM public.work_items i
    WHERE i.user_id = v_user_id
      AND (i.state = 'in_progress'
           OR EXISTS (SELECT 1 FROM public.work_claims c
                      WHERE c.work_item_id = i.id AND c.released_at IS NULL))
    ORDER BY i.id
  LOOP
    SELECT * INTO v_item FROM public.work_items i
    WHERE i.id = v_candidate AND i.user_id = v_user_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;

    v_attempt := NULL; v_attempt_started := NULL;
    SELECT (e.payload->'data'->>'attempt_id')::uuid, e.created_at
      INTO v_attempt, v_attempt_started
    FROM public.work_events e
    WHERE e.work_item_id = v_item.id AND e.event_type = 'execution_started'
      AND e.payload->'data' ? 'attempt_id'
    ORDER BY e.seq DESC LIMIT 1;

    v_terminal := NULL;
    IF v_attempt IS NOT NULL THEN
      SELECT e.event_type INTO v_terminal FROM public.work_events e
      WHERE e.work_item_id = v_item.id
        AND e.event_type IN ('result_submitted','execution_failed','work_cancelled','attempt_abandoned')
        AND e.payload->'data'->>'attempt_id' = v_attempt::text
      ORDER BY e.seq DESC LIMIT 1;
    END IF;

    -- ---------- (1) evento final já persistido, estado derivado atrasado ----------
    v_verdict := NULL;
    IF v_item.state = 'in_progress' AND v_terminal = 'result_submitted'
       AND private.work_item_requires_verifier(v_item.intent) THEN
      v_verdict := private.mandated_result_verdict(v_item.id, v_item.proposal_version,
        private.latest_result_event_id(v_item.id));
      IF v_verdict = 'human_resolved' THEN
        -- Pending Verification Human Recovery V0: o candidato foi encerrado por decisão
        -- humana. Não é pendente (sem re-verificação), não vira review, não é abandonado.
        v_terminal := NULL;
      ELSIF v_verdict NOT IN ('verified','rejected') THEN
        RETURN QUERY SELECT v_item.id, v_attempt, NULL::uuid,
          'result_pending_verification'::text, 'requires_verification'::text, v_item.state,
          jsonb_build_object('verifier_status', v_verdict);
        v_terminal := NULL;
      END IF;
    END IF;

    IF v_item.state = 'in_progress' AND v_terminal IS NOT NULL THEN
      SELECT t.to_state INTO v_target_state FROM private.work_state_transitions t
      WHERE t.from_state = v_item.state AND t.event_type = v_terminal;
      IF FOUND THEN
        UPDATE public.work_items SET state=v_target_state, updated_at=v_now
        WHERE id=v_item.id RETURNING * INTO v_item;
        RETURN QUERY SELECT v_item.id, v_attempt, NULL::uuid,
          'terminal_not_materialized'::text, 'state_materialized'::text, v_item.state,
          jsonb_build_object('terminal_event_type', v_terminal::text);
      END IF;
    END IF;

    -- ---------- (2) posse aberta ----------
    v_claim := NULL;
    SELECT * INTO v_claim FROM public.work_claims c
    WHERE c.work_item_id = v_item.id AND c.released_at IS NULL FOR UPDATE;
    IF FOUND THEN
      v_release_reason := NULL;
      IF v_claim.attempt_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.work_events e
        WHERE e.work_item_id = v_item.id
          AND e.event_type IN ('result_submitted','execution_failed','work_cancelled','attempt_abandoned')
          AND e.payload->'data'->>'attempt_id' = v_claim.attempt_id::text
      ) THEN
        v_release_reason := 'attempt_finished';
      ELSIF v_claim.expires_at <= v_now THEN
        v_release_reason := 'expired';
      END IF;

      IF v_release_reason IS NOT NULL THEN
        UPDATE public.work_claims SET released_at=v_now, release_reason=v_release_reason
        WHERE id=v_claim.id RETURNING * INTO v_claim;
        INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
          (v_claim.work_item_id,'work_claim_released','system',v_claim.approved_proposal_version,
            jsonb_build_object('schema_version',1,'data',jsonb_build_object(
              'claim_id',v_claim.id,'work_item_id',v_claim.work_item_id,
              'approved_proposal_version',v_claim.approved_proposal_version,
              'owner_instance_id',v_claim.owner_instance_id,'attempt_id',v_claim.attempt_id,
              'reason',v_release_reason,'released_at',v_now)));
        RETURN QUERY SELECT v_item.id, v_claim.attempt_id, v_claim.id,
          (CASE WHEN v_release_reason='expired' THEN 'claim_expired' ELSE 'claim_open_after_terminal' END)::text,
          'claim_released'::text, v_item.state,
          jsonb_build_object('release_reason',v_release_reason,'owner_instance_id',v_claim.owner_instance_id);
      ELSE
        RETURN QUERY SELECT v_item.id, v_claim.attempt_id, v_claim.id,
          'claim_active'::text, 'none'::text, v_item.state,
          jsonb_build_object('expires_at',v_claim.expires_at,'owner_instance_id',v_claim.owner_instance_id);
      END IF;
    END IF;

    -- ---------- (3) tentativa interrompida ----------
    IF v_item.state = 'in_progress' AND v_terminal IS NULL AND v_verdict IS NULL THEN
      IF v_attempt IS NULL THEN
        RETURN QUERY SELECT v_item.id, NULL::uuid, NULL::uuid,
          'attempt_missing'::text, 'requires_human'::text, v_item.state,
          jsonb_build_object('explanation','item em execução sem evento de tentativa correlacionado');
      ELSE
        v_lease := NULL;
        SELECT * INTO v_lease FROM public.work_claims c
        WHERE c.user_id = v_user_id AND c.attempt_id = v_attempt;
        v_lease_bound := FOUND;
        v_lease_exceeded := v_lease_bound
          AND (v_lease.released_at IS NOT NULL OR v_lease.expires_at <= v_now);

        v_duration_minutes := NULL;
        IF jsonb_typeof(v_item.intent #> '{execution_spec,limits,max_duration_minutes}') = 'number'
           AND (v_item.intent #>> '{execution_spec,limits,max_duration_minutes}') ~ '^[0-9]+$'
           AND (v_item.intent #>> '{execution_spec,limits,max_duration_minutes}')::numeric > 0 THEN
          v_duration_minutes := (v_item.intent #>> '{execution_spec,limits,max_duration_minutes}')::integer;
        END IF;
        v_duration_bound := v_duration_minutes IS NOT NULL;
        v_duration_exceeded := v_duration_bound
          AND v_attempt_started + make_interval(mins => v_duration_minutes) <= v_now;

        IF NOT v_lease_bound AND NOT v_duration_bound THEN
          RETURN QUERY SELECT v_item.id, v_attempt, NULL::uuid,
            'attempt_without_declared_bound'::text, 'requires_human'::text, v_item.state,
            jsonb_build_object(
              'explanation','tentativa sem lease e sem max_duration_minutes: nada delimita quando ela deixou de valer',
              'attempt_started_at',v_attempt_started);
        ELSIF (NOT v_lease_bound OR v_lease_exceeded)
              AND (NOT v_duration_bound OR v_duration_exceeded) THEN
          v_reason := CASE
            WHEN v_lease_bound AND v_duration_bound THEN 'declared_bounds_exceeded'
            WHEN v_lease_bound THEN 'lease_expired'
            ELSE 'duration_limit_exceeded' END;

          SELECT t.to_state INTO v_target_state FROM private.work_state_transitions t
          WHERE t.from_state = v_item.state AND t.event_type = 'attempt_abandoned';
          IF NOT FOUND THEN RAISE EXCEPTION 'transition not allowed' USING ERRCODE='22023'; END IF;

          UPDATE public.work_items SET state=v_target_state, updated_at=v_now
          WHERE id=v_item.id RETURNING * INTO v_item;
          INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
            (v_item.id,'attempt_abandoned','system',v_item.proposal_version,
              jsonb_build_object('schema_version',1,'data',jsonb_build_object(
                'work_item_id',v_item.id,'attempt_id',v_attempt,
                'approved_proposal_version',v_item.proposal_version,
                'claim_id',v_lease.id,
                'origin',CASE WHEN v_lease_bound THEN 'supervised' ELSE 'commanded' END,
                'reason',v_reason,
                'attempt_started_at',v_attempt_started,'observed_at',v_now,
                'lease_expires_at',v_lease.expires_at,
                'max_duration_minutes',v_duration_minutes)));
          RETURN QUERY SELECT v_item.id, v_attempt, v_lease.id,
            'attempt_abandoned'::text, 'attempt_abandoned'::text, v_item.state,
            jsonb_build_object('reason',v_reason,'attempt_started_at',v_attempt_started);
        ELSE
          RETURN QUERY SELECT v_item.id, v_attempt, v_lease.id,
            'attempt_within_declared_bounds'::text, 'none'::text, v_item.state,
            jsonb_build_object(
              'lease_expires_at',v_lease.expires_at,
              'max_duration_minutes',v_duration_minutes,
              'attempt_started_at',v_attempt_started);
        END IF;
      END IF;
    END IF;
  END LOOP;
END;
$$;
