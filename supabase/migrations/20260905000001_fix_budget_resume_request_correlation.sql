-- Correção append-only da migration 20260905000000 já exercitada no banco vivo:
-- qualifica request_id para eliminar a ambiguidade coluna/variável do PL/pgSQL.
DO $$
DECLARE definition text; fixed text;
BEGIN
  definition:=pg_get_functiondef('public.authorize_work_resume(uuid,integer,jsonb)'::regprocedure);
  fixed:=replace(definition,
    'SELECT * INTO old FROM public.work_budget_resume_authorizations'||chr(10)||
    '   WHERE work_item_id=i.id OR (user_id=u AND request_id=request_id);',
    'SELECT * INTO old FROM public.work_budget_resume_authorizations a'||chr(10)||
    '   WHERE a.work_item_id=i.id OR (a.user_id=u AND a.request_id=(p_authorization->>''requestId'')::uuid);');
  IF fixed=definition THEN RAISE EXCEPTION 'budget_resume_request_correlation_patch_not_applied'; END IF;
  EXECUTE fixed;
END $$;
