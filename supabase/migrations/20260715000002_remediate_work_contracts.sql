-- Remediações F4–F8: revisão atômica, proveniência inicial e foco operacional.

-- Eventos criados na mesma transação compartilham created_at; a sequência
-- monotônica garante ordem total do log e proveniência reconstruível.
ALTER TABLE public.work_events ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX work_events_item_seq_idx ON public.work_events (work_item_id, seq);

CREATE FUNCTION private.attach_initial_work_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_item public.work_items;
  v_context public.work_contexts;
BEGIN
  IF NEW.event_type <> 'work_proposed' THEN RETURN NEW; END IF;
  SELECT * INTO v_item FROM public.work_items WHERE id = NEW.work_item_id;
  INSERT INTO public.work_contexts(work_item_id,version,context_references)
  VALUES(v_item.id,1,jsonb_build_array(jsonb_build_object('kind','message','id',v_item.source_message_id::text)))
  RETURNING * INTO v_context;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'context_attached','anima',v_item.proposal_version,jsonb_build_object('schema_version',1,'data',jsonb_build_object('context_id',v_context.id,'context_version',1,'context_references',v_context.context_references)));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.attach_initial_work_context() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER attach_initial_work_context
AFTER INSERT ON public.work_events
FOR EACH ROW EXECUTE FUNCTION private.attach_initial_work_context();

CREATE FUNCTION public.request_work_proposal_revision(
  work_item_id uuid,
  expected_proposal_version integer,
  requested_changes text,
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
  v_previous_version integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version<=0 OR requested_changes IS NULL OR length(btrim(requested_changes))=0 OR jsonb_typeof(intent) IS DISTINCT FROM 'object' OR private.is_valid_work_proposal(proposal) IS DISTINCT FROM true THEN RAISE EXCEPTION 'invalid proposal revision input' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_item FROM public.work_items item WHERE item.id=work_item_id AND item.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.state<>'proposed' OR v_item.proposal_version<>expected_proposal_version THEN RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000'; END IF;
  v_previous_version:=v_item.proposal_version;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'proposal_changes_requested','user',v_previous_version,jsonb_build_object('schema_version',1,'data',jsonb_build_object('requested_changes',btrim(requested_changes),'reviewed_proposal_version',v_previous_version)));
  UPDATE public.work_items item SET intent=request_work_proposal_revision.intent,proposal=request_work_proposal_revision.proposal,proposal_version=item.proposal_version+1,updated_at=now() WHERE item.id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'proposal_revised','anima',v_item.proposal_version,jsonb_build_object('schema_version',1,'data',jsonb_build_object('proposal',proposal,'requested_changes',btrim(requested_changes),'previous_proposal_version',v_previous_version)));
  RETURN v_item;
END;
$$;
REVOKE ALL ON FUNCTION public.request_work_proposal_revision(uuid,integer,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_work_proposal_revision(uuid,integer,text,jsonb,jsonb) TO authenticated,service_role;

CREATE FUNCTION public.review_work_result_versioned(
  work_item_id uuid,
  expected_proposal_version integer,
  reviewed_result_event_id uuid,
  decision public.work_review_decision,
  decision_context jsonb DEFAULT '{}'::jsonb
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE v_user_id uuid:=auth.uid();v_item public.work_items;v_latest_result_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM public.work_items item WHERE item.id=work_item_id AND item.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.state<>'review' OR v_item.proposal_version<>expected_proposal_version THEN RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000'; END IF;
  SELECT event.id INTO v_latest_result_id FROM public.work_events event WHERE event.work_item_id=v_item.id AND event.event_type='result_submitted' ORDER BY event.seq DESC LIMIT 1;
  IF reviewed_result_event_id IS NULL OR reviewed_result_event_id IS DISTINCT FROM v_latest_result_id THEN RAISE EXCEPTION 'reviewed result changed' USING ERRCODE='55000'; END IF;
  RETURN public.review_work_result(work_item_id,expected_proposal_version,decision,decision_context);
END;
$$;
REVOKE ALL ON FUNCTION public.review_work_result(uuid,integer,public.work_review_decision,jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.review_work_result_versioned(uuid,integer,uuid,public.work_review_decision,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_work_result_versioned(uuid,integer,uuid,public.work_review_decision,jsonb) TO authenticated,service_role;

CREATE TABLE public.work_focus (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.work_focus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuário lê seu foco de trabalho" ON public.work_focus FOR SELECT TO authenticated USING((SELECT auth.uid())=user_id);
REVOKE ALL ON TABLE public.work_focus FROM anon,authenticated;
GRANT SELECT ON TABLE public.work_focus TO authenticated;
GRANT ALL ON TABLE public.work_focus TO service_role;

CREATE FUNCTION public.set_work_focus(work_item_id uuid)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE v_user_id uuid:=auth.uid();v_item public.work_items;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM public.work_items item WHERE item.id=work_item_id AND item.user_id=v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.state IN('completed','failed','rejected','cancelled') THEN RAISE EXCEPTION 'terminal work item cannot receive focus' USING ERRCODE='22023'; END IF;
  INSERT INTO public.work_focus(user_id,work_item_id,updated_at) VALUES(v_user_id,v_item.id,now()) ON CONFLICT(user_id) DO UPDATE SET work_item_id=excluded.work_item_id,updated_at=excluded.updated_at;
  RETURN v_item;
END;
$$;
REVOKE ALL ON FUNCTION public.set_work_focus(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_work_focus(uuid) TO authenticated,service_role;

CREATE FUNCTION private.clear_terminal_work_focus()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.state IN('completed','failed','rejected','cancelled') THEN DELETE FROM public.work_focus WHERE work_item_id=NEW.id; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.clear_terminal_work_focus() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER clear_terminal_work_focus AFTER UPDATE OF state ON public.work_items FOR EACH ROW EXECUTE FUNCTION private.clear_terminal_work_focus();

ALTER TABLE public.conversation_sessions ADD COLUMN active_turn_started_at timestamptz;
CREATE FUNCTION private.track_conversation_turn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.role='user' THEN UPDATE public.conversation_sessions SET active_turn_started_at=coalesce(active_turn_started_at,now()) WHERE id=NEW.session_id;
  ELSE UPDATE public.conversation_sessions SET active_turn_started_at=NULL WHERE id=NEW.session_id; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.track_conversation_turn() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER track_conversation_turn AFTER INSERT ON public.ai_conversations FOR EACH ROW EXECUTE FUNCTION private.track_conversation_turn();

CREATE OR REPLACE FUNCTION public.archive_current_conversation()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_user_id uuid:=auth.uid();v_session_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  -- Turnos órfãos (cliente que morreu sem encerrar) expiram após 10 minutos
  -- para não bloquear o arquivamento indefinidamente.
  IF EXISTS(SELECT 1 FROM public.conversation_sessions session WHERE session.user_id=v_user_id AND session.archived_at IS NULL AND session.active_turn_started_at > now() - interval '10 minutes') THEN RAISE EXCEPTION 'conversation turn is still active' USING ERRCODE='55000'; END IF;
  UPDATE public.conversation_sessions session SET archived_at=now() WHERE session.user_id=v_user_id AND session.archived_at IS NULL RETURNING id INTO v_session_id;
  INSERT INTO public.conversation_sessions(user_id)VALUES(v_user_id)RETURNING id INTO v_session_id;
  RETURN v_session_id;
END;
$$;

CREATE FUNCTION public.abandon_current_conversation_turn()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_user_id uuid:=auth.uid();BEGIN IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501';END IF;UPDATE public.conversation_sessions SET active_turn_started_at=NULL WHERE user_id=v_user_id AND archived_at IS NULL;END;
$$;
REVOKE ALL ON FUNCTION public.abandon_current_conversation_turn() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_current_conversation_turn() TO authenticated,service_role;

-- ============================================================
-- Conflito de versão passa de 40001 para 55000 nas RPCs herdadas.
-- 40001 (serialization_failure) faz o PostgREST reexecutar a transação em
-- loop até o gateway estourar; um conflito de versão de negócio nunca se
-- resolve repetindo a chamada. Corpos idênticos aos originais exceto o código.
-- ============================================================

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
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'proposal version changed' USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'proposal version changed' USING ERRCODE = '55000';
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
