CREATE OR REPLACE FUNCTION public.materialize_project_backlog_proposal(proposal_id uuid,expected_version integer,confirmation_message_id uuid,idempotency_key text,provenance jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid:=auth.uid(); p public.project_backlog_proposals; e public.project_backlog_events; s jsonb; wi public.work_items; pos integer:=0; ids jsonb:='[]'::jsonb; prov jsonb;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.project_backlog_events x WHERE x.user_id=u AND x.idempotency_key=materialize_project_backlog_proposal.idempotency_key;
 IF FOUND THEN
   IF e.proposal_id=proposal_id AND e.proposal_version=expected_version AND e.event_type='materialization_confirmed' AND e.provenance->>'source_message_id'=confirmation_message_id::text AND provenance->>'source'='human_confirmation' THEN
     SELECT COALESCE(jsonb_agg(work_item_id ORDER BY position),'[]') INTO ids FROM public.project_backlog_materialized_items WHERE project_backlog_materialized_items.proposal_id=materialize_project_backlog_proposal.proposal_id;
     RETURN jsonb_build_object('action','replayed','work_item_ids',ids);
   END IF;
   RAISE EXCEPTION 'materialization idempotency conflict' USING ERRCODE='55000';
 END IF;
 SELECT * INTO p FROM public.project_backlog_proposals x WHERE x.id=proposal_id AND x.user_id=u FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'backlog proposal not found' USING ERRCODE='P0002'; END IF;
 IF p.version<>expected_version OR EXISTS(SELECT 1 FROM public.project_backlog_events x WHERE x.proposal_id=p.id AND x.event_type IN ('changes_requested','materialization_confirmed')) THEN RAISE EXCEPTION 'backlog proposal is not current' USING ERRCODE='55000'; END IF;
 IF provenance->>'source' IS DISTINCT FROM 'human_confirmation' OR NOT EXISTS(SELECT 1 FROM public.ai_conversations m WHERE m.id=confirmation_message_id AND m.user_id=u AND m.role='user') THEN RAISE EXCEPTION 'invalid human confirmation' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=u) THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p.slices) LOOP
   pos:=pos+1;
   IF s->>'slice_key' IS NULL OR s->>'summary' IS NULL OR jsonb_typeof(s->'intent') IS DISTINCT FROM 'object' OR private.is_valid_work_proposal(s->'proposal') IS DISTINCT FROM true OR jsonb_typeof(s->'dependencies') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid backlog slice' USING ERRCODE='22023'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(s->'dependencies') dep WHERE dep=s->>'slice_key' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.slices) candidate WHERE candidate->>'slice_key'=dep)) THEN RAISE EXCEPTION 'invalid slice dependency' USING ERRCODE='22023'; END IF;
   prov:=jsonb_build_object('kind','project_backlog_proposal','source_decision_id',p.source_decision_id,'source_decision_version',p.source_decision_version,'backlog_proposal_id',p.id,'backlog_proposal_version',p.version,'slice_key',s->>'slice_key','materialization_confirmation_message_id',confirmation_message_id,'dependencies',s->'dependencies');
   INSERT INTO public.work_items(user_id,source_message_id,state,impact_level,capability,original_request,intent,proposal,proposal_version)
   SELECT u,confirmation_message_id,'proposed',(s->>'impact_level')::public.work_impact_level,(s->>'capability')::public.work_capability,m.content,(s->'intent')||jsonb_build_object('backlog_provenance',prov),s->'proposal',1 FROM public.ai_conversations m WHERE m.id=confirmation_message_id RETURNING * INTO wi;
   INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(wi.id,'work_proposed','anima',1,jsonb_build_object('schema_version',1,'data',jsonb_build_object('proposal',wi.proposal)));
   INSERT INTO public.project_backlog_materialized_items(proposal_id,proposal_version,slice_key,position,dependencies,work_item_id) VALUES(p.id,p.version,s->>'slice_key',pos,s->'dependencies',wi.id);
   ids:=ids||jsonb_build_array(wi.id);
 END LOOP;
 INSERT INTO public.project_backlog_events(proposal_id,user_id,proposal_version,event_type,actor,idempotency_key,provenance) VALUES(p.id,u,p.version,'materialization_confirmed','user',idempotency_key,provenance||jsonb_build_object('source_message_id',confirmation_message_id)) RETURNING * INTO e;
 INSERT INTO public.project_backlog_events(proposal_id,user_id,proposal_version,event_type,actor,idempotency_key,provenance) VALUES(p.id,u,p.version,'materialized','system',idempotency_key||':materialized',jsonb_build_object('source','host','work_item_ids',ids));
 RETURN jsonb_build_object('action','recorded','work_item_ids',ids);
END $$;
