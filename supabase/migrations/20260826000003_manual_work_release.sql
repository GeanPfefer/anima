-- Recuperacao de start manual sem attempt.
--
-- O ciclo manual (`start_work`) e legitimo: o usuario pode executar o trabalho fora
-- do executor e depois registrar o resultado. O problema tratado aqui e apenas a
-- ausencia de uma saida honesta quando ele decide NAO continuar esse ciclo.
--
-- `manual_work_released` nunca representa abandono de attempt: a RPC exige justamente
-- que nenhuma tentativa real tenha sido iniciada desde o `work_started` manual.

INSERT INTO private.work_state_transitions(from_state,event_type,to_state)
VALUES ('in_progress','manual_work_released','approved')
ON CONFLICT DO NOTHING;

CREATE FUNCTION public.release_manual_work(
  p_work_item_id uuid,
  p_expected_proposal_version integer
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_uid uuid:=auth.uid();
  v_item public.work_items;
  v_start public.work_events;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS(
    SELECT 1
    FROM private.work_orchestration_allowlist a
    WHERE a.user_id=v_uid
  ) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;

  IF p_expected_proposal_version IS NULL OR p_expected_proposal_version < 1 THEN
    RAISE EXCEPTION 'invalid expected proposal version' USING ERRCODE='22023';
  END IF;

  SELECT *
  INTO v_item
  FROM public.work_items i
  WHERE i.id=p_work_item_id
    AND i.user_id=v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002';
  END IF;

  IF v_item.proposal_version<>p_expected_proposal_version THEN
    RAISE EXCEPTION 'proposal version changed' USING ERRCODE='40001';
  END IF;

  IF v_item.state<>'in_progress' THEN
    RAISE EXCEPTION 'work item is not in manual progress' USING ERRCODE='55000';
  END IF;

  SELECT *
  INTO v_start
  FROM public.work_events e
  WHERE e.work_item_id=v_item.id
    AND e.proposal_version=v_item.proposal_version
    AND e.event_type='work_started'
    AND e.author='user'
  ORDER BY e.seq DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'manual start not found' USING ERRCODE='55000';
  END IF;

  -- Qualquer tentativa real posterior transforma este item em outro protocolo.
  IF EXISTS(
    SELECT 1
    FROM public.work_events e
    WHERE e.work_item_id=v_item.id
      AND e.seq>v_start.seq
      AND e.event_type='execution_started'
  ) THEN
    RAISE EXCEPTION 'execution attempt exists after manual start' USING ERRCODE='55000';
  END IF;

  -- Nao reescreve ou contradiz nenhum desfecho posterior.
  IF EXISTS(
    SELECT 1
    FROM public.work_events e
    WHERE e.work_item_id=v_item.id
      AND e.seq>v_start.seq
      AND e.event_type IN (
        'result_submitted',
        'execution_failed',
        'work_cancelled',
        'attempt_abandoned'
      )
  ) THEN
    RAISE EXCEPTION 'manual work already has a terminal fact' USING ERRCODE='55000';
  END IF;

  -- Um claim aberto significa posse real e impede esta recuperacao simplificada.
  IF EXISTS(
    SELECT 1
    FROM public.work_claims c
    WHERE c.work_item_id=v_item.id
      AND c.released_at IS NULL
  ) THEN
    RAISE EXCEPTION 'work item has an open claim' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.work_events(
    work_item_id,event_type,author,proposal_version,payload
  )
  VALUES(
    v_item.id,
    'manual_work_released',
    'user',
    v_item.proposal_version,
    jsonb_build_object(
      'schema_version',1,
      'data',jsonb_build_object(
        'reason','manual_cycle_released',
        'manual_start_event_id',v_start.id,
        'manual_start_event_seq',v_start.seq
      )
    )
  );

  UPDATE public.work_items i
  SET state='approved',
      updated_at=now()
  WHERE i.id=v_item.id
  RETURNING * INTO v_item;

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.release_manual_work(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.release_manual_work(uuid,integer) TO authenticated,service_role;

COMMENT ON FUNCTION public.release_manual_work(uuid,integer) IS
  'Encerra apenas a posse manual iniciada por start_work quando nenhuma tentativa real, claim ou desfecho posterior existe; retorna o item a approved sem inventar resultado ou attempt.';
