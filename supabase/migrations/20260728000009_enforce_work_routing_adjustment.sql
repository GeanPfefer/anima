-- INTEL-03: o esforço da rota deve coincidir com o ajuste validado para a tentativa.

ALTER FUNCTION private.is_valid_work_routing_decision(jsonb,public.work_capability,jsonb)
  RENAME TO is_valid_work_routing_decision_v1_baseline;

CREATE FUNCTION private.is_valid_work_routing_decision(
  p_decision jsonb, p_capability public.work_capability, p_classification jsonb
)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog
AS $$
DECLARE v_baseline text:=private.required_work_effort(p_classification); v_required text;
BEGIN
  v_required:=p_decision->>'requiredEffort';
  IF v_required NOT IN ('light','standard','strong') THEN RETURN false; END IF;
  IF (CASE v_required WHEN 'light' THEN 0 WHEN 'standard' THEN 1 ELSE 2 END)
     < (CASE v_baseline WHEN 'light' THEN 0 WHEN 'standard' THEN 1 ELSE 2 END)
  THEN RETURN false; END IF;
  RETURN private.is_valid_work_routing_decision_v1_baseline(
    jsonb_set(p_decision,'{requiredEffort}',to_jsonb(v_baseline),false),
    p_capability,p_classification
  );
END $$;

REVOKE ALL ON FUNCTION private.is_valid_work_routing_decision(jsonb,public.work_capability,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.is_valid_work_routing_decision(jsonb,public.work_capability,jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION private.enforce_autonomous_routing_on_attempt()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_route public.work_events; v_adjustment public.work_events;
  v_current_classification public.work_events;
BEGIN
  IF NEW.event_type<>'execution_started' OR NEW.payload#>>'{data,claim_id}' IS NULL
    THEN RETURN NEW; END IF;
  SELECT * INTO v_route FROM public.work_events e
   WHERE e.work_item_id=NEW.work_item_id AND e.event_type='work_routing_decided'
     AND e.proposal_version=NEW.proposal_version
     AND e.payload#>>'{data,attempt_id}'=NEW.payload#>>'{data,attempt_id}' LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'work routing decision missing' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_adjustment FROM public.work_events e
   WHERE e.work_item_id=NEW.work_item_id AND e.event_type='work_routing_adjusted'
     AND e.proposal_version=NEW.proposal_version
     AND e.payload#>>'{data,attempt_id}'=NEW.payload#>>'{data,attempt_id}' LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'work routing adjustment missing' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_current_classification FROM public.work_events e
   WHERE e.work_item_id=NEW.work_item_id AND e.event_type='work_intelligence_classified'
     AND e.proposal_version=NEW.proposal_version
     AND private.is_valid_work_intelligence_classification(e.payload#>'{data,classification}')
   ORDER BY (e.payload#>>'{data,classification_revision}')::integer DESC NULLS LAST,e.seq DESC LIMIT 1;
  IF v_current_classification.id IS NULL
    OR v_route.payload#>>'{data,classification_event_id}'<>v_current_classification.id::text
    THEN RAISE EXCEPTION 'work routing decision obsolete' USING ERRCODE='55000'; END IF;
  IF v_route.payload#>>'{data,decision,selected,executorId}'<>NEW.payload#>>'{data,executor_id}'
    THEN RAISE EXCEPTION 'work routing executor mismatch' USING ERRCODE='55000'; END IF;
  IF v_route.payload#>>'{data,decision,requiredEffort}'
       <>v_adjustment.payload#>>'{data,adjustment,effectiveEffort}'
    THEN RAISE EXCEPTION 'work routing effort mismatch' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
