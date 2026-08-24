CREATE TYPE public.project_backlog_event_type AS ENUM ('proposal_created','changes_requested','materialization_confirmed','materialized');

CREATE TABLE public.project_backlog_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_decision_id uuid NOT NULL REFERENCES public.project_decision_proposals(id) ON DELETE RESTRICT,
  source_decision_version integer NOT NULL CHECK(source_decision_version>0), version integer NOT NULL CHECK(version>0),
  objective text NOT NULL CHECK(length(btrim(objective)) BETWEEN 12 AND 2000), slices jsonb NOT NULL CHECK(jsonb_typeof(slices)='array' AND jsonb_array_length(slices) BETWEEN 1 AND 12),
  rationale text NOT NULL DEFAULT '' CHECK(length(rationale)<=4000), exclusions jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(exclusions)='array'),
  uncertainties jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(uncertainties)='array'), provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object'),
  supersedes_id uuid REFERENCES public.project_backlog_proposals(id), idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,idempotency_key), UNIQUE(user_id,id,version)
);
CREATE TABLE public.project_backlog_events (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  proposal_id uuid NOT NULL REFERENCES public.project_backlog_proposals(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proposal_version integer NOT NULL, event_type public.project_backlog_event_type NOT NULL, actor text NOT NULL CHECK(actor IN ('user','system')),
  idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key)) BETWEEN 8 AND 200), provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object'), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,idempotency_key), FOREIGN KEY(user_id,proposal_id,proposal_version) REFERENCES public.project_backlog_proposals(user_id,id,version)
);
CREATE UNIQUE INDEX project_backlog_resolution_once ON public.project_backlog_events(proposal_id) WHERE event_type IN ('changes_requested','materialization_confirmed');
CREATE TABLE public.project_backlog_materialized_items (
  proposal_id uuid NOT NULL REFERENCES public.project_backlog_proposals(id) ON DELETE RESTRICT, proposal_version integer NOT NULL,
  slice_key text NOT NULL CHECK(length(btrim(slice_key)) BETWEEN 2 AND 64), position integer NOT NULL CHECK(position>0), dependencies jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(dependencies)='array'),
  work_item_id uuid NOT NULL UNIQUE REFERENCES public.work_items(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(proposal_id,slice_key), UNIQUE(proposal_id,position)
);

ALTER TABLE public.project_backlog_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_backlog_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_backlog_materialized_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_backlog_proposals_read_own ON public.project_backlog_proposals FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY project_backlog_events_read_own ON public.project_backlog_events FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY project_backlog_items_read_own ON public.project_backlog_materialized_items FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.project_backlog_proposals p WHERE p.id=proposal_id AND p.user_id=auth.uid()));
REVOKE INSERT,UPDATE,DELETE ON public.project_backlog_proposals,public.project_backlog_events,public.project_backlog_materialized_items FROM anon,authenticated;
GRANT SELECT ON public.project_backlog_proposals,public.project_backlog_events,public.project_backlog_materialized_items TO authenticated,service_role;

CREATE VIEW public.project_backlog_proposal_state WITH(security_invoker=true) AS
SELECT p.*, COALESCE((SELECT e.event_type::text FROM public.project_backlog_events e WHERE e.proposal_id=p.id AND e.event_type IN ('changes_requested','materialization_confirmed') ORDER BY e.seq DESC LIMIT 1),'awaiting_confirmation') status
FROM public.project_backlog_proposals p;
GRANT SELECT ON public.project_backlog_proposal_state TO authenticated,service_role;

CREATE FUNCTION public.create_project_backlog_proposal(source_decision_id uuid,source_decision_version integer,objective text,slices jsonb,rationale text,exclusions jsonb,uncertainties jsonb,provenance jsonb,idempotency_key text,supersedes_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE u uuid:=auth.uid(); d public.project_decision_proposals; p public.project_backlog_proposals; prior public.project_backlog_proposals; v integer:=1;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.project_backlog_proposals x WHERE x.user_id=u AND x.idempotency_key=create_project_backlog_proposal.idempotency_key;
 IF FOUND THEN IF p.source_decision_id=source_decision_id AND p.source_decision_version=source_decision_version AND p.slices=slices THEN RETURN jsonb_build_object('action','replayed','proposal_id',p.id,'version',p.version); END IF; RAISE EXCEPTION 'backlog proposal idempotency conflict' USING ERRCODE='55000'; END IF;
 SELECT * INTO d FROM public.project_decision_proposals x WHERE x.id=source_decision_id AND x.user_id=u AND x.version=source_decision_version;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.project_decision_events e WHERE e.proposal_id=d.id AND e.event_type='ratified') THEN RAISE EXCEPTION 'ratified decision not found' USING ERRCODE='P0002'; END IF;
 IF jsonb_typeof(slices) IS DISTINCT FROM 'array' OR jsonb_array_length(slices) NOT BETWEEN 1 AND 12 OR provenance->>'source' IS DISTINCT FROM 'system_derivation' THEN RAISE EXCEPTION 'invalid backlog proposal' USING ERRCODE='22023'; END IF;
 IF supersedes_id IS NOT NULL THEN SELECT * INTO prior FROM public.project_backlog_proposals x WHERE x.id=supersedes_id AND x.user_id=u FOR UPDATE; IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.project_backlog_events e WHERE e.proposal_id=prior.id AND e.event_type='changes_requested') OR prior.source_decision_id<>source_decision_id THEN RAISE EXCEPTION 'proposal is not revisable' USING ERRCODE='55000'; END IF; v:=prior.version+1; END IF;
 INSERT INTO public.project_backlog_proposals(user_id,source_decision_id,source_decision_version,version,objective,slices,rationale,exclusions,uncertainties,provenance,supersedes_id,idempotency_key)
 VALUES(u,source_decision_id,source_decision_version,v,btrim(objective),slices,COALESCE(rationale,''),COALESCE(exclusions,'[]'),COALESCE(uncertainties,'[]'),provenance,supersedes_id,idempotency_key) RETURNING * INTO p;
 INSERT INTO public.project_backlog_events(proposal_id,user_id,proposal_version,event_type,actor,idempotency_key,provenance) VALUES(p.id,u,p.version,'proposal_created','system',idempotency_key||':created',jsonb_build_object('source','host','proposal_provenance',provenance));
 RETURN jsonb_build_object('action','recorded','proposal_id',p.id,'version',p.version);
END $$;

CREATE FUNCTION public.request_project_backlog_proposal_changes(proposal_id uuid,expected_version integer,source_message_id uuid,idempotency_key text,requested_changes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid:=auth.uid(); p public.project_backlog_proposals; e public.project_backlog_events;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.project_backlog_events x WHERE x.user_id=u AND x.idempotency_key=request_project_backlog_proposal_changes.idempotency_key; IF FOUND THEN RETURN jsonb_build_object('action','replayed','event_seq',e.seq); END IF;
 SELECT * INTO p FROM public.project_backlog_proposals x WHERE x.id=proposal_id AND x.user_id=u FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'backlog proposal not found' USING ERRCODE='P0002'; END IF;
 IF p.version<>expected_version OR EXISTS(SELECT 1 FROM public.project_backlog_events x WHERE x.proposal_id=p.id AND x.event_type IN ('changes_requested','materialization_confirmed')) THEN RAISE EXCEPTION 'backlog proposal is not current' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ai_conversations m WHERE m.id=source_message_id AND m.user_id=u AND m.role='user') OR length(btrim(requested_changes))=0 THEN RAISE EXCEPTION 'invalid human revision' USING ERRCODE='22023'; END IF;
 INSERT INTO public.project_backlog_events(proposal_id,user_id,proposal_version,event_type,actor,idempotency_key,provenance) VALUES(p.id,u,p.version,'changes_requested','user',idempotency_key,jsonb_build_object('source','human_revision','source_message_id',source_message_id,'requested_changes',requested_changes)) RETURNING * INTO e;
 RETURN jsonb_build_object('action','recorded','event_seq',e.seq);
END $$;

CREATE FUNCTION public.materialize_project_backlog_proposal(proposal_id uuid,expected_version integer,confirmation_message_id uuid,idempotency_key text,provenance jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid:=auth.uid(); p public.project_backlog_proposals; e public.project_backlog_events; s jsonb; wi public.work_items; pos integer:=0; ids jsonb:='[]'::jsonb; prov jsonb;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.project_backlog_events x WHERE x.user_id=u AND x.idempotency_key=materialize_project_backlog_proposal.idempotency_key;
 IF FOUND THEN IF e.proposal_id=proposal_id AND e.proposal_version=expected_version AND e.event_type='materialization_confirmed' AND e.provenance->>'source_message_id'=confirmation_message_id::text AND provenance->>'source'='human_confirmation' THEN SELECT COALESCE(jsonb_agg(work_item_id ORDER BY position),'[]') INTO ids FROM public.project_backlog_materialized_items WHERE project_backlog_materialized_items.proposal_id=materialize_project_backlog_proposal.proposal_id; RETURN jsonb_build_object('action','replayed','work_item_ids',ids); END IF; RAISE EXCEPTION 'materialization idempotency conflict' USING ERRCODE='55000'; END IF;
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

REVOKE ALL ON FUNCTION public.create_project_backlog_proposal(uuid,integer,text,jsonb,text,jsonb,jsonb,jsonb,text,uuid), public.request_project_backlog_proposal_changes(uuid,integer,uuid,text,text), public.materialize_project_backlog_proposal(uuid,integer,uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_project_backlog_proposal(uuid,integer,text,jsonb,text,jsonb,jsonb,jsonb,text,uuid), public.request_project_backlog_proposal_changes(uuid,integer,uuid,text,text), public.materialize_project_backlog_proposal(uuid,integer,uuid,text,jsonb) TO authenticated,service_role;
