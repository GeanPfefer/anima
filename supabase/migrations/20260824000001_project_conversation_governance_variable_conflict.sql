-- Recompila a função já aplicada localmente com resolução explícita de parâmetros.
CREATE OR REPLACE FUNCTION public.create_project_decision_proposal(
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
