-- P1.6: execuções delimitadas ganham ciclo persistido. Início e término são
-- eventos no log com identificador de execução, executor e versão da proposta.
-- Um resultado tardio ou divergente nunca sobrescreve um estado final: o
-- término exige o item ainda em in_progress na versão observada, e términos
-- repetidos só são aceitos quando idempotentes (mesmo desfecho).

CREATE FUNCTION public.start_work_execution(
  work_item_id uuid,
  expected_proposal_version integer,
  execution_id uuid,
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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.work_orchestration_allowlist AS allowlist
    WHERE allowlist.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE = '42501';
  END IF;

  IF expected_proposal_version IS NULL OR expected_proposal_version <= 0
     OR execution_id IS NULL
     OR executor_id IS NULL OR length(btrim(executor_id)) = 0 THEN
    RAISE EXCEPTION 'invalid execution input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item
  FROM public.work_items AS item
  WHERE item.id = work_item_id
    AND item.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'work item not found' USING ERRCODE = 'P0002';
  END IF;

  -- Repetição idempotente: o mesmo início não duplica o evento.
  IF EXISTS (
    SELECT 1 FROM public.work_events AS event
    WHERE event.work_item_id = v_item.id
      AND event.event_type = 'execution_started'
      AND event.payload -> 'data' ->> 'execution_id' = execution_id::text
  ) THEN
    RETURN v_item;
  END IF;

  IF v_item.state <> 'in_progress' OR v_item.proposal_version <> expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE = '55000';
  END IF;

  -- Uma execução aberta por vez: início sem término correspondente bloqueia.
  IF EXISTS (
    SELECT 1 FROM public.work_events AS started
    WHERE started.work_item_id = v_item.id
      AND started.event_type = 'execution_started'
      AND NOT EXISTS (
        SELECT 1 FROM public.work_events AS finished
        WHERE finished.work_item_id = v_item.id
          AND finished.event_type IN ('result_submitted', 'execution_failed', 'work_cancelled')
          AND finished.payload -> 'data' ->> 'execution_id'
              = started.payload -> 'data' ->> 'execution_id'
      )
  ) THEN
    RAISE EXCEPTION 'another execution is still open' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.work_events (work_item_id, event_type, author, proposal_version, payload)
  VALUES (
    v_item.id,
    'execution_started',
    'anima',
    v_item.proposal_version,
    jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
      'execution_id', execution_id,
      'executor_id', btrim(executor_id)
    ))
  );

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.start_work_execution(uuid, integer, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_work_execution(uuid, integer, uuid, text) TO authenticated, service_role;

CREATE FUNCTION public.finish_work_execution(
  work_item_id uuid,
  expected_proposal_version integer,
  execution_id uuid,
  outcome jsonb
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_kind text;
  v_executor_id text;
  v_previous_kind text;
  v_event public.work_event_type;
  v_author public.work_event_author;
  v_target_state public.work_state;
  v_payload jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.work_orchestration_allowlist AS allowlist
    WHERE allowlist.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE = '42501';
  END IF;

  IF expected_proposal_version IS NULL OR expected_proposal_version <= 0
     OR execution_id IS NULL
     OR jsonb_typeof(outcome) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid execution outcome' USING ERRCODE = '22023';
  END IF;

  v_kind := outcome ->> 'kind';
  IF v_kind IS NULL OR v_kind NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled')
     OR jsonb_typeof(outcome -> 'attempts') IS DISTINCT FROM 'number'
     OR (outcome ->> 'attempts')::numeric <> floor((outcome ->> 'attempts')::numeric)
     OR (outcome ->> 'attempts')::numeric < 0
     OR jsonb_typeof(outcome -> 'executor_id') IS DISTINCT FROM 'string'
     OR length(btrim(outcome ->> 'executor_id')) = 0 THEN
    RAISE EXCEPTION 'invalid execution outcome' USING ERRCODE = '22023';
  END IF;

  IF v_kind = 'succeeded' AND (
       jsonb_typeof(outcome -> 'summary') IS DISTINCT FROM 'string'
       OR length(btrim(outcome ->> 'summary')) = 0
       OR jsonb_typeof(outcome -> 'result_references') IS DISTINCT FROM 'array'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(outcome -> 'result_references') AS reference
         WHERE jsonb_typeof(reference) <> 'string'
       )
     ) THEN
    RAISE EXCEPTION 'invalid execution outcome' USING ERRCODE = '22023';
  END IF;

  IF v_kind = 'failed' AND (
       jsonb_typeof(outcome -> 'message') IS DISTINCT FROM 'string'
       OR length(btrim(outcome ->> 'message')) = 0
     ) THEN
    RAISE EXCEPTION 'invalid execution outcome' USING ERRCODE = '22023';
  END IF;

  IF v_kind IN ('timed_out', 'cancelled')
     AND jsonb_typeof(outcome -> 'terminated_cleanly') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'invalid execution outcome' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item
  FROM public.work_items AS item
  WHERE item.id = work_item_id
    AND item.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'work item not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT event.payload -> 'data' ->> 'executor_id' INTO v_executor_id
  FROM public.work_events AS event
  WHERE event.work_item_id = v_item.id
    AND event.event_type = 'execution_started'
    AND event.payload -> 'data' ->> 'execution_id' = execution_id::text;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'execution not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_executor_id IS DISTINCT FROM btrim(outcome ->> 'executor_id') THEN
    RAISE EXCEPTION 'executor does not match execution' USING ERRCODE = '22023';
  END IF;

  -- Término repetido: idempotente quando o desfecho é o mesmo; divergente
  -- (resultado tardio após timeout/cancelamento, por exemplo) é rejeitado.
  SELECT finished.payload -> 'data' ->> 'outcome_kind' INTO v_previous_kind
  FROM public.work_events AS finished
  WHERE finished.work_item_id = v_item.id
    AND finished.event_type IN ('result_submitted', 'execution_failed', 'work_cancelled')
    AND finished.payload -> 'data' ->> 'execution_id' = execution_id::text
  ORDER BY finished.seq DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_previous_kind = v_kind THEN
      RETURN v_item;
    END IF;
    RAISE EXCEPTION 'execution already finished with a different outcome' USING ERRCODE = '55000';
  END IF;

  IF v_item.state <> 'in_progress' OR v_item.proposal_version <> expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE = '55000';
  END IF;

  IF v_kind = 'succeeded' THEN
    v_event := 'result_submitted';
    v_author := 'executor';
    v_payload := jsonb_build_object(
      'summary', outcome ->> 'summary',
      'result_references', outcome -> 'result_references',
      'execution_id', execution_id,
      'executor_id', v_executor_id,
      'attempts', (outcome ->> 'attempts')::integer,
      'outcome_kind', v_kind
    );
  ELSIF v_kind = 'cancelled' THEN
    v_event := 'work_cancelled';
    v_author := 'user';
    v_payload := jsonb_build_object(
      'reason', 'execution_cancelled',
      'execution_id', execution_id,
      'executor_id', v_executor_id,
      'attempts', (outcome ->> 'attempts')::integer,
      'terminated_cleanly', (outcome ->> 'terminated_cleanly')::boolean,
      'outcome_kind', v_kind
    );
  ELSE
    v_event := 'execution_failed';
    v_author := 'executor';
    v_payload := jsonb_build_object(
      'reason', v_kind,
      'execution_id', execution_id,
      'executor_id', v_executor_id,
      'attempts', (outcome ->> 'attempts')::integer,
      'outcome_kind', v_kind
    );
    IF v_kind = 'failed' THEN
      v_payload := v_payload || jsonb_build_object('message', outcome ->> 'message');
    ELSE
      v_payload := v_payload || jsonb_build_object('terminated_cleanly', (outcome ->> 'terminated_cleanly')::boolean);
    END IF;
  END IF;

  SELECT transition.to_state INTO v_target_state
  FROM private.work_state_transitions AS transition
  WHERE transition.from_state = v_item.state
    AND transition.event_type = v_event;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.work_items AS item
  SET state = v_target_state,
      updated_at = now()
  WHERE item.id = v_item.id
  RETURNING * INTO v_item;

  INSERT INTO public.work_events (work_item_id, event_type, author, proposal_version, payload)
  VALUES (
    v_item.id,
    v_event,
    v_author,
    v_item.proposal_version,
    jsonb_build_object('schema_version', 1, 'data', v_payload)
  );

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_work_execution(uuid, integer, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_work_execution(uuid, integer, uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.start_work_execution(uuid, integer, uuid, text) IS
  'Registra o início persistido de uma execução delimitada, com id de execução e executor correlacionados ao item e à versão.';
COMMENT ON FUNCTION public.finish_work_execution(uuid, integer, uuid, jsonb) IS
  'Persiste o desfecho tipado de uma execução; términos divergentes ou tardios são rejeitados, nunca sobrescrevem estado final.';
