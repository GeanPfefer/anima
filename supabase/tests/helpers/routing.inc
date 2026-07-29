-- Helper de regressão: testes anteriores ao INTEL-02 declaram explicitamente
-- a rota da tentativa que estão preparando. Não adiciona asserções.
CREATE FUNCTION pg_temp.record_test_route(
  p_item uuid,
  p_attempt uuid,
  p_executor text DEFAULT 'local-runner-v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_current jsonb;
  v_classification jsonb;
  v_effort text;
  v_capability text;
  v_decision jsonb;
  v_adjustment jsonb;
  v_version integer;
BEGIN
  v_current := public.current_work_intelligence_classification(p_item);
  v_classification := v_current -> 'classification';
  SELECT capability::text,proposal_version INTO v_capability,v_version
    FROM public.work_items WHERE id=p_item;
  v_adjustment:=private.expected_work_routing_adjustment(
    p_item,v_version,private.required_work_effort(v_classification)
  );
  PERFORM public.record_work_routing_adjustment(p_item,v_version,p_attempt,v_adjustment);
  v_effort := v_adjustment ->> 'effectiveEffort';
  v_decision := jsonb_build_object(
    'schemaVersion',1,
    'policyVersion','work-routing-v1',
    'capability',v_capability,
    'requiredEffort',v_effort,
    'selected',jsonb_build_object(
      'routeId','test:declared',
      'executorId',p_executor,
      'providerRef','test-node',
      'modelRef','test-model',
      'effort',v_effort
    ),
    'factors',jsonb_build_object(
      'complexity',v_classification ->> 'complexity',
      'risk',v_classification ->> 'risk',
      'reversibility',v_classification ->> 'reversibility',
      'planClarity',v_classification ->> 'planClarity',
      'urgency',v_classification ->> 'urgency',
      'urgencyTieBreakApplied',false
    ),
    'rejectedCandidates','[]'::jsonb
  );
  RETURN public.record_work_routing_decision(
    p_item,
    v_version,
    p_attempt,
    v_decision
  );
END;
$$;
