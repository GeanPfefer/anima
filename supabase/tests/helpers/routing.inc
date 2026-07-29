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
BEGIN
  v_current := public.current_work_intelligence_classification(p_item);
  v_classification := v_current -> 'classification';
  v_effort := private.required_work_effort(v_classification);
  SELECT capability::text INTO v_capability FROM public.work_items WHERE id=p_item;
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
    (SELECT proposal_version FROM public.work_items WHERE id=p_item),
    p_attempt,
    v_decision
  );
END;
$$;
