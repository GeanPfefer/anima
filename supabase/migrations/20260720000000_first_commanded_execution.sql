-- INT-04: primeira execução real sob comando. A tentativa é iniciada
-- atomicamente a partir do item aprovado e o único sinal terminal do executor
-- é persistido com correlação completa. Não há fila, retry ou integração.

CREATE FUNCTION public.start_commanded_work_attempt(
  work_item_id uuid,
  expected_proposal_version integer,
  attempt_id uuid,
  executor_id text
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_started public.work_events;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version < 1 OR attempt_id IS NULL
     OR executor_id IS NULL OR length(btrim(executor_id))=0 THEN
    RAISE EXCEPTION 'invalid commanded attempt input' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items i
  WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_started FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
    AND e.payload->'data'->>'attempt_id'=attempt_id::text
  ORDER BY e.seq DESC LIMIT 1;
  IF FOUND THEN
    IF v_started.proposal_version=expected_proposal_version
       AND v_started.payload->'data'->>'executor_id'=btrim(executor_id)
       AND v_started.payload->'data'->>'work_item_id'=v_item.id::text THEN RETURN v_item; END IF;
    RAISE EXCEPTION 'attempt correlation conflict' USING ERRCODE='55000';
  END IF;

  IF v_item.state<>'approved' OR v_item.proposal_version<>expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;
  IF jsonb_typeof(v_item.intent->'execution_spec') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'execution specification missing' USING ERRCODE='22023';
  END IF;

  UPDATE public.work_items SET state='in_progress',updated_at=now() WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
    (v_item.id,'work_started','user',v_item.proposal_version,
      jsonb_build_object('schema_version',1,'data',jsonb_build_object('reason','commanded_execution','attempt_id',attempt_id))),
    (v_item.id,'execution_started','anima',v_item.proposal_version,
      jsonb_build_object('schema_version',1,'data',jsonb_build_object(
        'work_item_id',v_item.id,'attempt_id',attempt_id,'approved_proposal_version',v_item.proposal_version,
        'origin','anima','executor_id',btrim(executor_id))));
  RETURN v_item;
END;
$$;

CREATE FUNCTION public.record_commanded_work_terminal(
  work_item_id uuid,
  expected_proposal_version integer,
  attempt_id uuid,
  signal jsonb
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_previous public.work_events;
  v_event public.work_event_type;
  v_state public.work_state;
  v_data jsonb;
  v_kind text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version<1 OR attempt_id IS NULL
     OR jsonb_typeof(signal) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid terminal signal' USING ERRCODE='22023';
  END IF;
  v_kind := signal->>'kind';
  IF v_kind NOT IN ('result','error','cancelled')
     OR signal->>'workItemId' IS DISTINCT FROM work_item_id::text
     OR signal->>'attemptId' IS DISTINCT FROM attempt_id::text
     OR (signal->>'approvedProposalVersion')::integer IS DISTINCT FROM expected_proposal_version
     OR signal->>'origin' IS DISTINCT FROM 'executor'
     OR (signal->>'sequence')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'terminal signal correlation mismatch' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
    AND e.proposal_version=expected_proposal_version AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'attempt not found' USING ERRCODE='P0002';
  END IF;

  SELECT * INTO v_previous FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type IN ('result_submitted','execution_failed','work_cancelled')
    AND e.payload->'data'->>'attempt_id'=attempt_id::text ORDER BY e.seq DESC LIMIT 1;
  IF FOUND THEN
    IF v_previous.payload->'data'->'executor_signal'=signal THEN RETURN v_item; END IF;
    RAISE EXCEPTION 'attempt already finished with different signal' USING ERRCODE='55000';
  END IF;
  IF v_item.state<>'in_progress' OR v_item.proposal_version<>expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;

  IF v_kind='result' THEN
    IF jsonb_typeof(signal->'resultReferences') IS DISTINCT FROM 'array'
       OR jsonb_typeof(signal->'validations') IS DISTINCT FROM 'array'
       OR jsonb_typeof(signal->'limitations') IS DISTINCT FROM 'array'
       OR length(btrim(signal->>'summary'))=0 OR length(btrim(signal->>'handoffReference'))=0
       OR signal->>'handoffReference' ~ '^[A-Za-z]:[\\/]' OR signal->>'handoffReference' LIKE '/%' THEN
      RAISE EXCEPTION 'invalid result signal' USING ERRCODE='22023';
    END IF;
    v_event:='result_submitted'; v_state:='review';
    v_data:=jsonb_build_object('summary',signal->>'summary','result_references',signal->'resultReferences',
      'validations',signal->'validations','limitations',signal->'limitations','handoff_reference',signal->>'handoffReference');
  ELSIF v_kind='cancelled' THEN
    v_event:='work_cancelled'; v_state:='cancelled';
    v_data:=jsonb_build_object('reason','execution_cancelled','handoff_reference',signal->>'handoffReference');
  ELSE
    IF length(btrim(signal->>'message'))=0 OR length(btrim(signal->>'handoffReference'))=0 THEN
      RAISE EXCEPTION 'invalid error signal' USING ERRCODE='22023';
    END IF;
    v_event:='execution_failed'; v_state:='failed';
    v_data:=jsonb_build_object('reason',signal->>'code','message',signal->>'message',
      'retryable',signal->'retryable','handoff_reference',signal->>'handoffReference');
  END IF;
  v_data:=v_data||jsonb_build_object('work_item_id',v_item.id,'attempt_id',attempt_id,
    'approved_proposal_version',expected_proposal_version,'origin','executor','signal_sequence',1,'executor_signal',signal);

  UPDATE public.work_items SET state=v_state,updated_at=now() WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,v_event,CASE WHEN v_kind='cancelled' THEN 'user'::public.work_event_author ELSE 'executor'::public.work_event_author END,
    v_item.proposal_version,jsonb_build_object('schema_version',1,'data',v_data));
  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.start_commanded_work_attempt(uuid,integer,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_commanded_work_terminal(uuid,integer,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_commanded_work_attempt(uuid,integer,uuid,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_commanded_work_terminal(uuid,integer,uuid,jsonb) TO authenticated,service_role;
