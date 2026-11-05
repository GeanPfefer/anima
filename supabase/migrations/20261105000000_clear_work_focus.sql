-- ACC-01-FIX-02: operação canônica de limpeza do foco de trabalho.
-- Aditiva: não altera `set_work_focus`, `work_focus`, RLS nem grants da tabela
-- (authenticated segue só com SELECT; a escrita passa exclusivamente por RPC).
-- Menor privilégio: só `authenticated`; só a linha do próprio `auth.uid()`; nunca toca
-- work_items, work_events ou work_contexts. Idempotente: devolve false se não havia foco.
CREATE FUNCTION public.clear_work_focus()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE v_user_id uuid:=auth.uid(); v_deleted integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  DELETE FROM public.work_focus WHERE user_id=v_user_id;
  GET DIAGNOSTICS v_deleted=ROW_COUNT;
  RETURN v_deleted>0;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_work_focus() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clear_work_focus() TO authenticated;
