-- ORQ-04: retoma a conversa arquivada mais recente sem apagar a sessão atual.
CREATE FUNCTION public.reopen_latest_conversation()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_active_id uuid;
  v_archived_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT session.id INTO v_active_id
  FROM public.conversation_sessions AS session
  WHERE session.user_id = v_user_id AND session.archived_at IS NULL
  FOR UPDATE;

  IF v_active_id IS NULL THEN
    RAISE EXCEPTION 'active conversation not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_conversations AS message WHERE message.session_id = v_active_id) THEN
    RAISE EXCEPTION 'active conversation is not empty' USING ERRCODE = '55000';
  END IF;

  SELECT session.id INTO v_archived_id
  FROM public.conversation_sessions AS session
  WHERE session.user_id = v_user_id
    AND session.archived_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.ai_conversations AS message WHERE message.session_id = session.id)
  ORDER BY session.archived_at DESC, session.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_archived_id IS NULL THEN
    RAISE EXCEPTION 'archived conversation not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.conversation_sessions SET archived_at = now() WHERE id = v_active_id;
  UPDATE public.conversation_sessions SET archived_at = NULL WHERE id = v_archived_id;
  RETURN v_archived_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_latest_conversation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_latest_conversation() TO authenticated, service_role;
COMMENT ON FUNCTION public.reopen_latest_conversation() IS 'Reabre a conversa arquivada mais recente somente quando a conversa ativa ainda está vazia.';
