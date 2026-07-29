-- Toda decisão nova de rota referencia implicitamente o ajuste da mesma tentativa.
CREATE FUNCTION private.enforce_adjustment_on_routing_decision()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_adjustment public.work_events;
BEGIN
  IF NEW.event_type<>'work_routing_decided' THEN RETURN NEW; END IF;
  SELECT * INTO v_adjustment FROM public.work_events e
   WHERE e.work_item_id=NEW.work_item_id
     AND e.proposal_version=NEW.proposal_version
     AND e.event_type='work_routing_adjusted'
     AND e.payload#>>'{data,attempt_id}'=NEW.payload#>>'{data,attempt_id}'
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work routing adjustment missing' USING ERRCODE='55000';
  END IF;
  IF NEW.payload#>>'{data,decision,requiredEffort}'
       <>v_adjustment.payload#>>'{data,adjustment,effectiveEffort}'
  THEN RAISE EXCEPTION 'work routing effort mismatch' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.enforce_adjustment_on_routing_decision()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.enforce_adjustment_on_routing_decision() TO service_role;

CREATE TRIGGER enforce_adjustment_on_routing_decision
BEFORE INSERT ON public.work_events
FOR EACH ROW EXECUTE FUNCTION private.enforce_adjustment_on_routing_decision();
