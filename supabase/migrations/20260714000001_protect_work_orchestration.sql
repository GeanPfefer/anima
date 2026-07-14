-- ============================================================
-- Anima — segurança e escrita transacional da Orquestração
-- ============================================================

ALTER TABLE public.work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuário lê seus work items"
  ON public.work_items FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Usuário lê eventos dos seus work items"
  ON public.work_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.work_items AS item
      WHERE item.id = work_events.work_item_id
        AND item.user_id = (SELECT auth.uid())
    )
  );

-- A migration de privilégios padrão concede ALL a novos objetos públicos.
-- Revogações explícitas mantêm toda escrita de clientes atrás das RPCs.
REVOKE ALL ON TABLE public.work_items FROM anon, authenticated;
REVOKE ALL ON TABLE public.work_events FROM anon, authenticated;
GRANT SELECT ON TABLE public.work_items TO authenticated;
GRANT SELECT ON TABLE public.work_events TO authenticated;
GRANT ALL ON TABLE public.work_items TO service_role;
GRANT ALL ON TABLE public.work_events TO service_role;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT ALL ON TABLE private.work_orchestration_allowlist TO service_role;
GRANT SELECT ON TABLE private.work_state_transitions TO service_role;

CREATE FUNCTION private.is_valid_work_proposal(candidate jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
BEGIN
  IF jsonb_typeof(candidate) IS DISTINCT FROM 'object'
     OR candidate -> 'schema_version' IS DISTINCT FROM '1'::jsonb
     OR jsonb_typeof(candidate -> 'data') IS DISTINCT FROM 'object'
     OR jsonb_typeof(candidate #> '{data,summary}') IS DISTINCT FROM 'string'
     OR length(btrim(candidate #>> '{data,summary}')) = 0
     OR jsonb_typeof(candidate #> '{data,objective}') IS DISTINCT FROM 'string'
     OR length(btrim(candidate #>> '{data,objective}')) = 0
     OR jsonb_typeof(candidate #> '{data,included_scope}') IS DISTINCT FROM 'array'
     OR jsonb_typeof(candidate #> '{data,excluded_scope}') IS DISTINCT FROM 'array'
     OR jsonb_typeof(candidate #> '{data,expected_effects}') IS DISTINCT FROM 'array'
     OR jsonb_typeof(candidate #> '{data,risks}') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
    FROM (
      SELECT value FROM jsonb_array_elements(candidate #> '{data,included_scope}')
      UNION ALL
      SELECT value FROM jsonb_array_elements(candidate #> '{data,excluded_scope}')
      UNION ALL
      SELECT value FROM jsonb_array_elements(candidate #> '{data,expected_effects}')
      UNION ALL
      SELECT value FROM jsonb_array_elements(candidate #> '{data,risks}')
    ) AS proposal_value
    WHERE jsonb_typeof(proposal_value.value) <> 'string'
  );
END;
$$;

REVOKE ALL ON FUNCTION private.is_valid_work_proposal(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_valid_work_proposal(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.create_work_proposal(
  source_message_id uuid,
  impact_level public.work_impact_level,
  capability public.work_capability,
  intent jsonb,
  proposal jsonb
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_original_request text;
  v_item public.work_items;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.work_orchestration_allowlist AS allowlist
    WHERE allowlist.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE = '42501';
  END IF;

  SELECT message.content
  INTO v_original_request
  FROM public.ai_conversations AS message
  WHERE message.id = source_message_id
    AND message.user_id = v_user_id
    AND message.role = 'user';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'source message not found or not eligible' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(intent) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'intent must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF private.is_valid_work_proposal(proposal) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'invalid proposal envelope' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.work_items (
    user_id, source_message_id, state, impact_level, capability,
    original_request, intent, proposal, proposal_version
  ) VALUES (
    v_user_id, source_message_id, 'proposed', impact_level, capability,
    v_original_request, intent, proposal, 1
  )
  RETURNING * INTO v_item;

  INSERT INTO public.work_events (
    work_item_id, event_type, author, proposal_version, payload
  ) VALUES (
    v_item.id,
    'work_proposed',
    'anima',
    v_item.proposal_version,
    jsonb_build_object(
      'schema_version', 1,
      'data', jsonb_build_object('proposal', proposal)
    )
  );

  RETURN v_item;
END;
$$;

CREATE OR REPLACE FUNCTION public.revise_work_proposal(
  work_item_id uuid,
  expected_proposal_version integer,
  intent jsonb,
  proposal jsonb
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.work_orchestration_allowlist AS allowlist
    WHERE allowlist.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE = '42501';
  END IF;

  IF expected_proposal_version IS NULL OR expected_proposal_version <= 0 THEN
    RAISE EXCEPTION 'invalid expected proposal version' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(intent) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'intent must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF private.is_valid_work_proposal(proposal) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'invalid proposal envelope' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item
  FROM public.work_items AS item
  WHERE item.id = work_item_id
    AND item.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'work item not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_item.state <> 'proposed' OR v_item.proposal_version <> expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE = '40001';
  END IF;

  UPDATE public.work_items AS item
  SET intent = revise_work_proposal.intent,
      proposal = revise_work_proposal.proposal,
      proposal_version = item.proposal_version + 1,
      updated_at = now()
  WHERE item.id = v_item.id
  RETURNING * INTO v_item;

  INSERT INTO public.work_events (
    work_item_id, event_type, author, proposal_version, payload
  ) VALUES (
    v_item.id,
    'proposal_revised',
    'anima',
    v_item.proposal_version,
    jsonb_build_object(
      'schema_version', 1,
      'data', jsonb_build_object('proposal', proposal)
    )
  );

  RETURN v_item;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_approval(
  work_item_id uuid,
  expected_proposal_version integer,
  decision public.work_approval_decision,
  decision_context jsonb DEFAULT '{}'::jsonb
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_event public.work_event_type;
  v_target_state public.work_state;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.work_orchestration_allowlist AS allowlist
    WHERE allowlist.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE = '42501';
  END IF;

  IF expected_proposal_version IS NULL OR expected_proposal_version <= 0
     OR decision IS NULL
     OR jsonb_typeof(decision_context) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid approval input' USING ERRCODE = '22023';
  END IF;

  IF decision = 'request_changes'
     AND (
       jsonb_typeof(decision_context -> 'requested_changes') IS DISTINCT FROM 'string'
       OR length(btrim(decision_context ->> 'requested_changes')) = 0
     ) THEN
    RAISE EXCEPTION 'requested_changes is required' USING ERRCODE = '22023';
  END IF;

  IF decision = 'defer'
     AND (
       jsonb_typeof(decision_context -> 'reason') IS DISTINCT FROM 'string'
       OR length(btrim(decision_context ->> 'reason')) = 0
     ) THEN
    RAISE EXCEPTION 'defer reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item
  FROM public.work_items AS item
  WHERE item.id = work_item_id
    AND item.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'work item not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_item.state <> 'proposed' OR v_item.proposal_version <> expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE = '40001';
  END IF;

  v_event := CASE decision
    WHEN 'approve' THEN 'work_approved'::public.work_event_type
    WHEN 'reject' THEN 'work_rejected'::public.work_event_type
    WHEN 'request_changes' THEN 'proposal_changes_requested'::public.work_event_type
    WHEN 'defer' THEN 'work_deferred'::public.work_event_type
  END;

  SELECT transition.to_state INTO v_target_state
  FROM private.work_state_transitions AS transition
  WHERE transition.from_state = v_item.state
    AND transition.event_type = v_event;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.work_items AS item
  SET state = v_target_state,
      updated_at = now()
  WHERE item.id = v_item.id
  RETURNING * INTO v_item;

  INSERT INTO public.work_events (
    work_item_id, event_type, author, proposal_version, payload
  ) VALUES (
    v_item.id,
    v_event,
    'user',
    v_item.proposal_version,
    jsonb_build_object('schema_version', 1, 'data',
      CASE decision
        WHEN 'approve' THEN jsonb_build_object(
          'decision', decision,
          'decided_proposal_version', v_item.proposal_version
        )
        WHEN 'reject' THEN jsonb_build_object(
          'decision', decision,
          'decided_proposal_version', v_item.proposal_version
        )
        WHEN 'request_changes' THEN jsonb_build_object(
          'requested_changes', decision_context ->> 'requested_changes',
          'reviewed_proposal_version', v_item.proposal_version
        )
        WHEN 'defer' THEN jsonb_build_object(
          'reason', decision_context ->> 'reason',
          'reviewed_proposal_version', v_item.proposal_version
        )
      END
    )
  );

  RETURN v_item;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_work(
  work_item_id uuid,
  expected_proposal_version integer
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_target_state public.work_state;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.work_orchestration_allowlist AS allowlist
    WHERE allowlist.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE = '42501';
  END IF;

  IF expected_proposal_version IS NULL OR expected_proposal_version <= 0 THEN
    RAISE EXCEPTION 'invalid expected proposal version' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item
  FROM public.work_items AS item
  WHERE item.id = work_item_id
    AND item.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'work item not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_item.proposal_version <> expected_proposal_version THEN
    RAISE EXCEPTION 'proposal version changed' USING ERRCODE = '40001';
  END IF;

  SELECT transition.to_state INTO v_target_state
  FROM private.work_state_transitions AS transition
  WHERE transition.from_state = v_item.state
    AND transition.event_type = 'work_started';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.work_items AS item
  SET state = v_target_state,
      updated_at = now()
  WHERE item.id = v_item.id
  RETURNING * INTO v_item;

  INSERT INTO public.work_events (
    work_item_id, event_type, author, proposal_version, payload
  ) VALUES (
    v_item.id,
    'work_started',
    'user',
    v_item.proposal_version,
    jsonb_build_object('schema_version', 1, 'data', jsonb_build_object())
  );

  RETURN v_item;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_work_result(
  work_item_id uuid,
  expected_proposal_version integer,
  result jsonb
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_target_state public.work_state;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.work_orchestration_allowlist AS allowlist
    WHERE allowlist.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE = '42501';
  END IF;

  IF expected_proposal_version IS NULL OR expected_proposal_version <= 0
     OR jsonb_typeof(result) IS DISTINCT FROM 'object'
     OR jsonb_typeof(result -> 'summary') IS DISTINCT FROM 'string'
     OR length(btrim(result ->> 'summary')) = 0
     OR jsonb_typeof(result -> 'result_references') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid result input' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(result -> 'result_references') AS value
    WHERE jsonb_typeof(value) <> 'string'
  ) THEN
    RAISE EXCEPTION 'result_references must contain only strings' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item
  FROM public.work_items AS item
  WHERE item.id = work_item_id
    AND item.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'work item not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_item.proposal_version <> expected_proposal_version THEN
    RAISE EXCEPTION 'proposal version changed' USING ERRCODE = '40001';
  END IF;

  SELECT transition.to_state INTO v_target_state
  FROM private.work_state_transitions AS transition
  WHERE transition.from_state = v_item.state
    AND transition.event_type = 'result_submitted';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.work_items AS item
  SET state = v_target_state,
      updated_at = now()
  WHERE item.id = v_item.id
  RETURNING * INTO v_item;

  INSERT INTO public.work_events (
    work_item_id, event_type, author, proposal_version, payload
  ) VALUES (
    v_item.id,
    'result_submitted',
    'user',
    v_item.proposal_version,
    jsonb_build_object(
      'schema_version', 1,
      'data', result
    )
  );

  RETURN v_item;
END;
$$;

-- Os defaults do schema public também concedem EXECUTE automaticamente.
REVOKE ALL ON FUNCTION public.create_work_proposal(uuid, public.work_impact_level, public.work_capability, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revise_work_proposal(uuid, integer, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_approval(uuid, integer, public.work_approval_decision, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_work(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_work_result(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_work_proposal(uuid, public.work_impact_level, public.work_capability, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revise_work_proposal(uuid, integer, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_approval(uuid, integer, public.work_approval_decision, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_work(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_work_result(uuid, integer, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_work_proposal(uuid, public.work_impact_level, public.work_capability, jsonb, jsonb) IS
  'Cria proposta e work_proposed atomicamente para a mensagem user do usuário autenticado e habilitado.';
COMMENT ON FUNCTION public.revise_work_proposal(uuid, integer, jsonb, jsonb) IS
  'Substitui intenção/proposta, incrementa a versão e registra proposal_revised atomicamente.';
COMMENT ON FUNCTION public.resolve_approval(uuid, integer, public.work_approval_decision, jsonb) IS
  'Deriva evento e estado de uma decisão semântica sobre a versão exata da proposta.';
COMMENT ON FUNCTION public.start_work(uuid, integer) IS
  'Inicia ou retoma trabalho permitido pela matriz e registra work_started atomicamente.';
COMMENT ON FUNCTION public.submit_work_result(uuid, integer, jsonb) IS
  'Move trabalho em progresso para revisão e registra result_submitted atomicamente.';
