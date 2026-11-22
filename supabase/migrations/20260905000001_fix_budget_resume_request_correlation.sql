-- Correção append-only da migration 20260905000000 já exercitada no banco vivo:
-- qualifica request_id para eliminar a ambiguidade coluna/variável do PL/pgSQL.
DO $$
DECLARE
  definition text; fixed text; body text; body_hash text;
  expected_hash text;
  old_hash constant text := '0724495b4f67f42cab9d11c2a9ef922e5191da10c2f372ca8696a1ddbd623882';
  old_without_budget_guard_hash constant text := '14bd680673acb08bce6c40f1f44fa85675ed96458d80928fb9b64e5d224fa9f0';
  corrected_without_budget_guard_hash constant text := 'c25faccff543acf47738ee13cd9ad5cd037f0d86e13dace01ecc5472124e2f9d';
  corrected_hash constant text := 'ea9cb3ee3d1e88191c954317412d62016decd26dd74aa0837b0b977a485353a0';
BEGIN
  -- Corpos integrais (LF) nas duas revisões, com e sem a correlação corrigida.
  -- Não basta reconhecer um fragmento: alterações em owner/versão/authority
  -- ou em qualquer outra guarda devem recusar, inclusive no caminho no-op.
  SELECT p.prosrc INTO body FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
   WHERE p.oid='public.authorize_work_resume(uuid,integer,jsonb)'::regprocedure
     AND l.lanname='plpgsql' AND p.prokind='f' AND p.prosecdef
     AND p.provolatile='v' AND NOT p.proisstrict AND NOT p.proleakproof
     AND p.proparallel='u' AND NOT p.proretset
     AND p.prorettype='jsonb'::regtype AND p.pronargdefaults=0
     AND p.proargmodes IS NULL AND p.provariadic=0 AND p.prosupport=0
     AND p.procost=100 AND p.prorows=0
     AND p.proowner='postgres'::regrole
     AND pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
     AND NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
       WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole,'service_role'::regrole)
         OR a.grantor<>p.proowner OR (a.is_grantable AND a.grantee<>p.proowner)
     )
     AND p.proargnames=ARRAY['p_work_item_id','p_expected_proposal_version','p_authorization']::text[]
     AND p.proconfig=ARRAY['search_path=pg_catalog']::text[];
  body_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(body,'UTF8')),'hex');
  IF body_hash IN (corrected_hash,corrected_without_budget_guard_hash) THEN RETURN; END IF;
  expected_hash:=CASE body_hash
    WHEN old_hash THEN corrected_hash
    WHEN old_without_budget_guard_hash THEN corrected_without_budget_guard_hash
  END;
  IF expected_hash IS NULL THEN
    RAISE EXCEPTION 'budget_resume_request_correlation_definition_unknown';
  END IF;
  definition:=pg_catalog.pg_get_functiondef('public.authorize_work_resume(uuid,integer,jsonb)'::regprocedure);
  fixed:=pg_catalog.replace(definition,
    'SELECT * INTO old FROM public.work_budget_resume_authorizations'||pg_catalog.chr(10)||
    '   WHERE work_item_id=i.id OR (user_id=u AND request_id=request_id);',
    'SELECT * INTO old FROM public.work_budget_resume_authorizations a'||pg_catalog.chr(10)||
    '   WHERE a.work_item_id=i.id OR (a.user_id=u AND a.request_id=(p_authorization->>''requestId'')::uuid);');
  IF fixed=definition THEN RAISE EXCEPTION 'budget_resume_request_correlation_patch_not_applied'; END IF;
  EXECUTE fixed;
  SELECT prosrc INTO body FROM pg_catalog.pg_proc
   WHERE oid='public.authorize_work_resume(uuid,integer,jsonb)'::regprocedure;
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(body,'UTF8')),'hex') IS DISTINCT FROM expected_hash THEN
    RAISE EXCEPTION 'budget_resume_request_correlation_postcondition_failed';
  END IF;
END $$;
