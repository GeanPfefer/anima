CREATE TYPE public.project_decision_event_type AS ENUM ('proposal_created','ratified','rejected','changes_requested');

CREATE TABLE public.project_decision_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  statement text NOT NULL CHECK (length(btrim(statement)) BETWEEN 12 AND 2000),
  rationale text NOT NULL DEFAULT '' CHECK (length(rationale) <= 4000),
  constraints jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(constraints)='array'),
  implications jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(implications)='array'),
  alternatives jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(alternatives)='array'),
  uncertainties jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(uncertainties)='array'),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance)='object'),
  supersedes_id uuid REFERENCES public.project_decision_proposals(id),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,idempotency_key), UNIQUE(user_id,id,version)
);

CREATE TABLE public.project_decision_events (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  proposal_id uuid NOT NULL REFERENCES public.project_decision_proposals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proposal_version integer NOT NULL,
  event_type public.project_decision_event_type NOT NULL,
  actor text NOT NULL CHECK (actor IN ('user','system')),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,idempotency_key),
  FOREIGN KEY(user_id,proposal_id,proposal_version) REFERENCES public.project_decision_proposals(user_id,id,version)
);
CREATE UNIQUE INDEX project_decision_terminal_once ON public.project_decision_events(proposal_id)
  WHERE event_type IN ('ratified','rejected','changes_requested');

ALTER TABLE public.project_decision_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_decision_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_decision_proposals_read_own ON public.project_decision_proposals FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY project_decision_events_read_own ON public.project_decision_events FOR SELECT TO authenticated USING (user_id=auth.uid());
REVOKE INSERT,UPDATE,DELETE ON public.project_decision_proposals,public.project_decision_events FROM anon,authenticated;
GRANT SELECT ON public.project_decision_proposals,public.project_decision_events TO authenticated,service_role;

CREATE VIEW public.project_decision_proposal_state WITH (security_invoker=true) AS
SELECT p.*,
  COALESCE((SELECT e.event_type::text FROM public.project_decision_events e WHERE e.proposal_id=p.id AND e.event_type<>'proposal_created' ORDER BY e.seq DESC LIMIT 1),'awaiting_confirmation') AS status
FROM public.project_decision_proposals p;
GRANT SELECT ON public.project_decision_proposal_state TO authenticated,service_role;

CREATE FUNCTION public.create_project_decision_proposal(
  statement text, rationale text, constraints jsonb, implications jsonb, alternatives jsonb, uncertainties jsonb,
  provenance jsonb, idempotency_key text, supersedes_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE u uuid:=auth.uid(); p public.project_decision_proposals; prior public.project_decision_proposals; v integer:=1;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF statement IS NULL OR length(btrim(statement))<12 OR provenance IS NULL OR jsonb_typeof(provenance)<>'object'
    OR provenance->>'source' IS DISTINCT FROM 'human_expression' THEN RAISE EXCEPTION 'invalid decision proposal' USING ERRCODE='22023'; END IF;
  SELECT * INTO p FROM public.project_decision_proposals x WHERE x.user_id=u AND x.idempotency_key=create_project_decision_proposal.idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('action','replayed','proposal_id',p.id,'version',p.version); END IF;
  IF supersedes_id IS NOT NULL THEN
    SELECT * INTO prior FROM public.project_decision_proposals x WHERE x.id=supersedes_id AND x.user_id=u FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'proposal not found' USING ERRCODE='P0002'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.project_decision_events e WHERE e.proposal_id=prior.id AND e.event_type='changes_requested') THEN RAISE EXCEPTION 'proposal is not revisable' USING ERRCODE='55000'; END IF;
    v:=prior.version+1;
  END IF;
  INSERT INTO public.project_decision_proposals(user_id,version,statement,rationale,constraints,implications,alternatives,uncertainties,provenance,supersedes_id,idempotency_key)
  VALUES(u,v,btrim(statement),COALESCE(rationale,''),COALESCE(constraints,'[]'),COALESCE(implications,'[]'),COALESCE(alternatives,'[]'),COALESCE(uncertainties,'[]'),provenance,supersedes_id,idempotency_key) RETURNING * INTO p;
  INSERT INTO public.project_decision_events(proposal_id,user_id,proposal_version,event_type,actor,idempotency_key,provenance)
  VALUES(p.id,u,p.version,'proposal_created','system',idempotency_key||':created',jsonb_build_object('source','host','proposal_provenance',provenance));
  RETURN jsonb_build_object('action','recorded','proposal_id',p.id,'version',p.version);
END $$;

CREATE FUNCTION public.resolve_project_decision_proposal(proposal_id uuid, expected_version integer, outcome public.project_decision_event_type, idempotency_key text, provenance jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid:=auth.uid(); p public.project_decision_proposals; existing public.project_decision_events; s bigint;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF outcome NOT IN ('ratified','rejected','changes_requested') OR provenance->>'source' IS DISTINCT FROM 'human_confirmation' THEN RAISE EXCEPTION 'invalid decision outcome' USING ERRCODE='22023'; END IF;
  SELECT * INTO existing FROM public.project_decision_events e WHERE e.user_id=u AND e.idempotency_key=resolve_project_decision_proposal.idempotency_key;
  IF FOUND THEN
    IF existing.proposal_id=proposal_id AND existing.proposal_version=expected_version AND existing.event_type=outcome THEN RETURN jsonb_build_object('action','replayed','event_seq',existing.seq); END IF;
    RAISE EXCEPTION 'decision idempotency conflict' USING ERRCODE='55000';
  END IF;
  SELECT * INTO p FROM public.project_decision_proposals x WHERE x.id=proposal_id AND x.user_id=u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'proposal not found' USING ERRCODE='P0002'; END IF;
  IF p.version<>expected_version THEN RAISE EXCEPTION 'proposal version changed' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM public.project_decision_events e WHERE e.proposal_id=p.id AND e.event_type IN ('ratified','rejected','changes_requested')) THEN RAISE EXCEPTION 'proposal already resolved' USING ERRCODE='55000'; END IF;
  INSERT INTO public.project_decision_events(proposal_id,user_id,proposal_version,event_type,actor,idempotency_key,provenance)
  VALUES(p.id,u,p.version,outcome,'user',idempotency_key,provenance) RETURNING seq INTO s;
  RETURN jsonb_build_object('action','recorded','event_seq',s,'outcome',outcome::text);
END $$;

REVOKE ALL ON FUNCTION public.create_project_decision_proposal(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.resolve_project_decision_proposal(uuid,integer,public.project_decision_event_type,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_project_decision_proposal(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_project_decision_proposal(uuid,integer,public.project_decision_event_type,text,jsonb) TO authenticated,service_role;
