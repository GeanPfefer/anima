-- A concessão não pode sobreviver como token latente se a janela já se recuperou.
DO $$
DECLARE definition text; fixed text;
BEGIN
  definition:=pg_get_functiondef('public.authorize_work_resume(uuid,integer,jsonb)'::regprocedure);
  fixed:=replace(definition,'reason text; request_id uuid; active_attempt boolean;',
    'reason text; request_id uuid; active_attempt boolean; budget_decision jsonb;');
  fixed:=replace(fixed,
    '  INSERT INTO public.work_budget_resume_authorizations(id,user_id,work_item_id,request_id,proposal_version,blocked_event_id,budget_reason,authority)',
    '  budget_decision:=private.autonomous_work_budget_decision(u,i.id,now());'||chr(10)||
    '  IF coalesce((budget_decision->>''admitted'')::boolean,false)'||chr(10)||
    '    OR budget_decision->>''reason'' IS DISTINCT FROM reason'||chr(10)||
    '    THEN RAISE EXCEPTION ''budget_block_no_longer_current'' USING ERRCODE=''55000''; END IF;'||chr(10)||chr(10)||
    '  INSERT INTO public.work_budget_resume_authorizations(id,user_id,work_item_id,request_id,proposal_version,blocked_event_id,budget_reason,authority)');
  IF fixed=definition THEN RAISE EXCEPTION 'current_budget_block_patch_not_applied'; END IF;
  EXECUTE fixed;
END $$;
