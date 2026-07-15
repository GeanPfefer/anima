-- F6: contexto versionado por referência e conversas arquiváveis.
CREATE TABLE public.conversation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (archived_at IS NULL OR archived_at >= created_at)
);

CREATE UNIQUE INDEX conversation_sessions_one_active_user_idx
  ON public.conversation_sessions (user_id) WHERE archived_at IS NULL;
CREATE INDEX conversation_sessions_user_time_idx
  ON public.conversation_sessions (user_id, created_at DESC);

ALTER TABLE public.conversation_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuário lê suas sessões de conversa"
  ON public.conversation_sessions FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON TABLE public.conversation_sessions FROM anon, authenticated;
GRANT SELECT ON TABLE public.conversation_sessions TO authenticated;
GRANT ALL ON TABLE public.conversation_sessions TO service_role;

ALTER TABLE public.ai_conversations ADD COLUMN session_id uuid;

WITH sessions AS (
  INSERT INTO public.conversation_sessions (user_id)
  SELECT DISTINCT message.user_id FROM public.ai_conversations AS message
  RETURNING id, user_id
)
UPDATE public.ai_conversations AS message
SET session_id = sessions.id
FROM sessions
WHERE sessions.user_id = message.user_id;

ALTER TABLE public.ai_conversations
  ADD CONSTRAINT ai_conversations_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.conversation_sessions(id) ON DELETE RESTRICT;
CREATE INDEX ai_conversations_session_time_idx
  ON public.ai_conversations (session_id, created_at, id);

CREATE FUNCTION private.assign_active_conversation_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_session_id uuid;
BEGIN
  IF NEW.session_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.conversation_sessions AS session
      WHERE session.id = NEW.session_id
        AND session.user_id = NEW.user_id
        AND session.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'conversation session is not active for user' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  SELECT session.id INTO v_session_id
  FROM public.conversation_sessions AS session
  WHERE session.user_id = NEW.user_id AND session.archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.conversation_sessions (user_id)
    VALUES (NEW.user_id)
    RETURNING id INTO v_session_id;
  END IF;

  NEW.session_id := v_session_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.assign_active_conversation_session() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER assign_active_conversation_session
BEFORE INSERT ON public.ai_conversations
FOR EACH ROW EXECUTE FUNCTION private.assign_active_conversation_session();

CREATE FUNCTION public.archive_current_conversation()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.conversation_sessions AS session
  SET archived_at = now()
  WHERE session.user_id = v_user_id AND session.archived_at IS NULL
  RETURNING id INTO v_session_id;

  INSERT INTO public.conversation_sessions (user_id)
  VALUES (v_user_id)
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

DROP POLICY "Usuário deleta só suas mensagens" ON public.ai_conversations;
REVOKE DELETE ON TABLE public.ai_conversations FROM authenticated;
REVOKE ALL ON FUNCTION public.archive_current_conversation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_current_conversation() TO authenticated, service_role;

CREATE TABLE public.work_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  context_references jsonb NOT NULL CHECK (jsonb_typeof(context_references) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, version)
);

CREATE INDEX work_contexts_item_version_idx
  ON public.work_contexts (work_item_id, version DESC);
ALTER TABLE public.work_contexts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuário lê contextos dos seus trabalhos"
  ON public.work_contexts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.work_items AS item
    WHERE item.id = work_contexts.work_item_id
      AND item.user_id = (SELECT auth.uid())
  ));
REVOKE ALL ON TABLE public.work_contexts FROM anon, authenticated;
GRANT SELECT ON TABLE public.work_contexts TO authenticated;
GRANT ALL ON TABLE public.work_contexts TO service_role;

CREATE FUNCTION public.attach_work_context(
  work_item_id uuid,
  expected_proposal_version integer,
  context_references jsonb
)
RETURNS public.work_contexts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_context public.work_contexts;
  v_version integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist AS allowlist WHERE allowlist.user_id = v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE = '42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version <= 0
     OR jsonb_typeof(context_references) IS DISTINCT FROM 'array'
     OR jsonb_array_length(context_references) = 0
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(context_references) AS reference
       WHERE jsonb_typeof(reference) <> 'object'
          OR jsonb_typeof(reference -> 'kind') <> 'string'
          OR length(btrim(reference ->> 'kind')) = 0
          OR jsonb_typeof(reference -> 'id') <> 'string'
          OR length(btrim(reference ->> 'id')) = 0
     ) THEN
    RAISE EXCEPTION 'invalid context references' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items AS item
  WHERE item.id = work_item_id AND item.user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE = 'P0002'; END IF;
  IF v_item.proposal_version <> expected_proposal_version
     OR v_item.state IN ('completed','failed','rejected','cancelled') THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE = '40001';
  END IF;

  SELECT coalesce(max(context.version), 0) + 1 INTO v_version
  FROM public.work_contexts AS context WHERE context.work_item_id = v_item.id;

  INSERT INTO public.work_contexts (work_item_id, version, context_references)
  VALUES (v_item.id, v_version, context_references)
  RETURNING * INTO v_context;

  INSERT INTO public.work_events (work_item_id, event_type, author, proposal_version, payload)
  VALUES (v_item.id, 'context_attached', 'anima', v_item.proposal_version,
    jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
      'context_id', v_context.id,
      'context_version', v_context.version,
      'context_references', v_context.context_references
    )));

  RETURN v_context;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_work_context(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_work_context(uuid, integer, jsonb) TO authenticated, service_role;

COMMENT ON TABLE public.work_contexts IS 'Snapshots versionados compostos apenas por referências; conteúdo permanece em sua fonte original.';
COMMENT ON FUNCTION public.archive_current_conversation() IS 'Arquiva a sessão visível atual sem apagar mensagens e abre uma nova sessão.';
