-- Dependências causais mínimas entre work items materializados.
-- Approval permanece independente; somente a elegibilidade de EXECUÇÃO espera
-- todos os IDs declarados em execution_spec.depends_on_work_item_ids estarem completed.

CREATE FUNCTION private.autonomous_work_dependencies_satisfied(
  p_user_id uuid, p_work_item_id uuid, p_intent jsonb)
RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog
AS $$
DECLARE v_dependencies jsonb; v_dependency text; v_total integer; v_unique integer;
BEGIN
  v_dependencies:=p_intent#>'{execution_spec,depends_on_work_item_ids}';
  IF v_dependencies IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(v_dependencies)<>'array' THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_dependencies) d WHERE jsonb_typeof(d)<>'string') THEN RETURN false; END IF;
  SELECT count(*),count(DISTINCT value) INTO v_total,v_unique FROM jsonb_array_elements_text(v_dependencies);
  IF v_total<>v_unique THEN RETURN false; END IF;
  FOR v_dependency IN SELECT value FROM jsonb_array_elements_text(v_dependencies) LOOP
    IF v_dependency !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR v_dependency::uuid=p_work_item_id
       OR NOT EXISTS(SELECT 1 FROM public.work_items i WHERE i.id=v_dependency::uuid AND i.user_id=p_user_id AND i.state='completed')
    THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION private.autonomous_work_dependencies_satisfied(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.autonomous_work_dependencies_satisfied(uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.autonomous_work_queue()
RETURNS TABLE (
  work_item_id uuid, approved_proposal_version integer, approval_seq bigint,
  approved_at timestamptz, capability public.work_capability, target_reference text,
  queue_position bigint, target_occupied boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE v_user_id uuid:=auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT i.id,i.proposal_version,approval.seq,approval.created_at,i.capability,
    btrim(i.intent#>>'{execution_spec,target,reference}'),
    row_number() OVER(ORDER BY approval.seq,i.id),
    (EXISTS(SELECT 1 FROM public.work_claims oc WHERE oc.user_id=v_user_id AND oc.target_reference=btrim(i.intent#>>'{execution_spec,target,reference}') AND oc.released_at IS NULL AND oc.expires_at>now())
     OR EXISTS(SELECT 1 FROM public.work_items oi WHERE oi.user_id=v_user_id AND oi.state='in_progress' AND btrim(oi.intent#>>'{execution_spec,target,reference}')=btrim(i.intent#>>'{execution_spec,target,reference}')))
  FROM public.work_items i
  JOIN LATERAL(SELECT e.seq,e.created_at FROM public.work_events e WHERE e.work_item_id=i.id AND e.event_type='work_approved' AND e.proposal_version=i.proposal_version ORDER BY e.seq DESC LIMIT 1) approval ON true
  WHERE i.user_id=v_user_id
    AND private.is_autonomously_eligible(i.state,i.proposal,i.intent)
    AND private.autonomous_intelligence_eligibility(i.id,i.proposal_version)->>'eligible'='true'
    AND private.autonomous_work_dependencies_satisfied(v_user_id,i.id,i.intent)
    AND NOT EXISTS(SELECT 1 FROM public.work_claims c WHERE c.work_item_id=i.id AND c.released_at IS NULL AND c.expires_at>now())
  ORDER BY approval.seq,i.id;
END;
$$;

COMMENT ON FUNCTION public.autonomous_work_queue() IS
  'Fila autônoma vigente: AUTO-01 + classificação completa + dependências explícitas completed. Approval não é bloqueado; execução dependente falha fechado.';

