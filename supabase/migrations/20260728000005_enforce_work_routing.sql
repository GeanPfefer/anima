-- INTEL-02: uma tentativa autônoma só inicia com decisão de roteamento vigente.

CREATE FUNCTION private.enforce_autonomous_routing_on_attempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_route public.work_events;
  v_current_classification public.work_events;
BEGIN
  IF NEW.event_type <> 'execution_started'
    OR NEW.payload -> 'data' ->> 'claim_id' IS NULL
  THEN RETURN NEW; END IF;

  SELECT * INTO v_route
  FROM public.work_events e
  WHERE e.work_item_id=NEW.work_item_id
    AND e.event_type='work_routing_decided'
    AND e.proposal_version=NEW.proposal_version
    AND e.payload -> 'data' ->> 'attempt_id'=NEW.payload -> 'data' ->> 'attempt_id'
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work routing decision missing' USING ERRCODE='55000';
  END IF;

  SELECT * INTO v_current_classification
  FROM public.work_events e
  WHERE e.work_item_id=NEW.work_item_id
    AND e.event_type='work_intelligence_classified'
    AND e.proposal_version=NEW.proposal_version
    AND private.is_valid_work_intelligence_classification(e.payload -> 'data' -> 'classification')
  ORDER BY
    CASE WHEN e.payload -> 'data' ->> 'classification_revision' ~ '^[1-9][0-9]*$'
      THEN (e.payload -> 'data' ->> 'classification_revision')::integer END DESC NULLS LAST,
    e.seq DESC
  LIMIT 1;

  IF v_current_classification.id IS NULL
    OR v_route.payload -> 'data' ->> 'classification_event_id' <> v_current_classification.id::text
  THEN RAISE EXCEPTION 'work routing decision obsolete' USING ERRCODE='55000'; END IF;
  IF v_route.payload #>> '{data,decision,selected,executorId}'
       <> NEW.payload #>> '{data,executor_id}'
  THEN RAISE EXCEPTION 'work routing executor mismatch' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_autonomous_routing_on_attempt()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.enforce_autonomous_routing_on_attempt()
  TO service_role;

CREATE TRIGGER enforce_autonomous_routing_on_attempt
BEFORE INSERT ON public.work_events
FOR EACH ROW EXECUTE FUNCTION private.enforce_autonomous_routing_on_attempt();
