-- Proveniência correta do cancelamento originado pelo executor.
--
-- `record_commanded_work_terminal` e `finish_work_execution` só registram
-- terminais de origem EXECUTOR (a primeira valida `origin='executor'`; a segunda
-- projeta o desfecho do `BoundedWorkExecutor`). Um terminal `cancelled` desses
-- executores nasce exclusivamente de `signal.aborted` — nunca é uma decisão
-- humana. O cancelamento humano explícito tem fluxo próprio e auditável
-- (`request_work_control` → `apply_work_control_at_checkpoint`), que grava
-- `work_cancelled` com `author=user` e `reason=cancelled_by_user`.
--
-- Até aqui ambas as funções atribuíam `author=user` ao cancelamento do executor,
-- confundindo as duas proveniências no log append-only. A `reason` já era
-- `execution_cancelled`; corrige-se somente a autoria para `executor`, mantendo
-- a distinção entre "o executor foi abortado" e "o usuário cancelou". Sem
-- alteração de assinatura, de estado alcançado ou de qualquer outro caminho.
--
-- O corpo de `record_commanded_work_terminal` reproduz a definição vigente
-- (`20260726000003`, terminal após checkpoints) trocando apenas a autoria; o de
-- `finish_work_execution` reproduz a definição única (`20260715000004`) com a
-- mesma troca. `CREATE OR REPLACE` preserva os GRANTs e COMMENTs existentes.

CREATE OR REPLACE FUNCTION public.record_commanded_work_terminal(
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
  v_terminal_seq integer;
  v_max_checkpoint_seq integer;
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
     OR jsonb_typeof(signal->'sequence') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'terminal signal correlation mismatch' USING ERRCODE='22023';
  END IF;
  v_terminal_seq := (signal->>'sequence')::integer;
  IF v_terminal_seq < 1 THEN
    RAISE EXCEPTION 'terminal sequence must be a positive integer' USING ERRCODE='22023';
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

  -- SUP-04: tentativa abandonada pela reconciliação não é ressuscitada por um
  -- sinal tardio. O bundle produzido não é apagado nem perdido — permanece
  -- referenciado pelo evento de abandono —, mas não move estado nenhum.
  IF EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_item.id AND e.event_type='attempt_abandoned'
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'attempt was abandoned by reconciliation' USING ERRCODE='55000';
  END IF;

  -- Etapa 2B.1: o terminal vem DEPOIS de todos os checkpoints persistidos da
  -- tentativa. progress não é persistido, então basta estar à frente do maior.
  SELECT max((e.payload->'data'->>'signal_sequence')::integer) INTO v_max_checkpoint_seq
  FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
    AND e.payload->'data'->>'attempt_id'=attempt_id::text;
  IF v_max_checkpoint_seq IS NOT NULL AND v_terminal_seq <= v_max_checkpoint_seq THEN
    RAISE EXCEPTION 'terminal sequence must follow the latest checkpoint' USING ERRCODE='55000';
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
    'approved_proposal_version',expected_proposal_version,'origin','executor','signal_sequence',v_terminal_seq,'executor_signal',signal);

  UPDATE public.work_items SET state=v_state,updated_at=now() WHERE id=v_item.id RETURNING * INTO v_item;
  -- Terminal do executor: a autoria é sempre `executor`. O cancelamento humano
  -- explícito nunca chega por aqui — tem seu próprio caminho em checkpoint.
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,v_event,'executor'::public.work_event_author,
    v_item.proposal_version,jsonb_build_object('schema_version',1,'data',v_data));
  RETURN v_item;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_work_execution(
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
    -- Cancelamento originado pelo executor (abort do sinal), não decisão humana.
    v_author := 'executor';
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
