-- A concessão não pode sobreviver como token latente se a janela já se recuperou.
DO $$
DECLARE
  definition text; fixed text; body text; body_hash text;
  old_hash constant text := 'c25faccff543acf47738ee13cd9ad5cd037f0d86e13dace01ecc5472124e2f9d';
  corrected_hash constant text := 'ea9cb3ee3d1e88191c954317412d62016decd26dd74aa0837b0b977a485353a0';
BEGIN
  -- Corpo integral sem guarda (antigo) ou exatamente a definição atual da 246.
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
  IF body_hash IS NULL OR body_hash NOT IN (old_hash,corrected_hash) THEN
    RAISE EXCEPTION 'current_budget_block_definition_unknown';
  END IF;
  IF body_hash=corrected_hash THEN RETURN; END IF;
  definition:=pg_catalog.pg_get_functiondef('public.authorize_work_resume(uuid,integer,jsonb)'::regprocedure);
  fixed:=pg_catalog.replace(definition,'reason text; request_id uuid; active_attempt boolean;',
    'reason text; request_id uuid; active_attempt boolean; budget_decision jsonb;');
  fixed:=pg_catalog.replace(fixed,
    '  INSERT INTO public.work_budget_resume_authorizations(id,user_id,work_item_id,request_id,proposal_version,blocked_event_id,budget_reason,authority)',
    '  budget_decision:=private.autonomous_work_budget_decision(u,i.id,now());'||pg_catalog.chr(10)||
    '  IF coalesce((budget_decision->>''admitted'')::boolean,false)'||pg_catalog.chr(10)||
    '    OR budget_decision->>''reason'' IS DISTINCT FROM reason'||pg_catalog.chr(10)||
    '    THEN RAISE EXCEPTION ''budget_block_no_longer_current'' USING ERRCODE=''55000''; END IF;'||pg_catalog.chr(10)||pg_catalog.chr(10)||
    '  INSERT INTO public.work_budget_resume_authorizations(id,user_id,work_item_id,request_id,proposal_version,blocked_event_id,budget_reason,authority)');
  IF fixed=definition THEN RAISE EXCEPTION 'current_budget_block_patch_not_applied'; END IF;
  EXECUTE fixed;
  SELECT prosrc INTO body FROM pg_catalog.pg_proc
   WHERE oid='public.authorize_work_resume(uuid,integer,jsonb)'::regprocedure;
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(body,'UTF8')),'hex') IS DISTINCT FROM corrected_hash THEN
    RAISE EXCEPTION 'current_budget_block_postcondition_failed';
  END IF;
END $$;
