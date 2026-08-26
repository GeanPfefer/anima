-- Torna a idempotência do successor recovery estrita e serializável.
-- A mesma chave só é replay quando TODOS os argumentos governados coincidem;
-- concorrência pela mesma chave é serializada antes da leitura/criação.

CREATE OR REPLACE FUNCTION private.record_recovery_successor(
  p_user_id uuid, p_original_work_item_id uuid, p_recovery_sequence integer,
  p_impact_level public.work_impact_level, p_capability public.work_capability,
  p_intent jsonb, p_proposal jsonb, p_recovery_reason text, p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE v_original public.work_items; v_existing public.work_recovery_lineage;
        v_existing_item public.work_items; v_item public.work_items;
        v_lineage public.work_recovery_lineage;
BEGIN
  IF p_user_id IS NULL OR p_idempotency_key IS NULL OR p_recovery_sequence IS NULL OR p_recovery_sequence < 1
     OR p_recovery_reason IS NULL OR length(btrim(p_recovery_reason)) = 0 THEN
    RAISE EXCEPTION 'invalid recovery successor input' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'work_recovery_successor:' || p_user_id::text || ':' || p_idempotency_key::text, 0));

  SELECT * INTO v_existing FROM public.work_recovery_lineage l
    WHERE l.user_id = p_user_id AND l.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT * INTO v_existing_item FROM public.work_items i
      WHERE i.id = v_existing.successor_work_item_id AND i.user_id = p_user_id;
    IF NOT FOUND
       OR v_existing.original_work_item_id IS DISTINCT FROM p_original_work_item_id
       OR v_existing.recovery_sequence IS DISTINCT FROM p_recovery_sequence
       OR v_existing.recovery_reason IS DISTINCT FROM btrim(p_recovery_reason)
       OR v_existing_item.impact_level IS DISTINCT FROM p_impact_level
       OR v_existing_item.capability IS DISTINCT FROM p_capability
       OR v_existing_item.intent IS DISTINCT FROM p_intent
       OR v_existing_item.proposal IS DISTINCT FROM p_proposal THEN
      RAISE EXCEPTION 'recovery successor idempotency conflict' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('successorWorkItemId', v_existing.successor_work_item_id,
      'lineageId', v_existing.id, 'recoverySequence', v_existing.recovery_sequence, 'replayed', true);
  END IF;

  SELECT * INTO v_original FROM public.work_items i
    WHERE i.id = p_original_work_item_id AND i.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'original work item not found' USING ERRCODE = 'P0002'; END IF;
  IF v_original.state <> 'failed' THEN
    RAISE EXCEPTION 'recovery successor requires a failed original' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p_intent) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'intent must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF private.is_valid_work_proposal(p_proposal) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'invalid proposal envelope' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.work_items(user_id, source_message_id, state, impact_level, capability,
    original_request, intent, proposal, proposal_version)
  VALUES (p_user_id, v_original.source_message_id, 'proposed', p_impact_level, p_capability,
    v_original.original_request, p_intent, p_proposal, 1)
  RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id, event_type, author, proposal_version, payload)
  VALUES (v_item.id, 'work_proposed', 'anima', 1,
    jsonb_build_object('schema_version', 1, 'data', jsonb_build_object('proposal', p_proposal)));
  INSERT INTO public.work_recovery_lineage(user_id, original_work_item_id, successor_work_item_id,
    recovery_sequence, recovery_reason, satisfies_original_objective, idempotency_key)
  VALUES (p_user_id, v_original.id, v_item.id, p_recovery_sequence, btrim(p_recovery_reason), false, p_idempotency_key)
  RETURNING * INTO v_lineage;
  RETURN jsonb_build_object('successorWorkItemId', v_item.id, 'lineageId', v_lineage.id,
    'recoverySequence', v_lineage.recovery_sequence, 'replayed', false, 'state', v_item.state);
END; $$;

COMMENT ON FUNCTION private.record_recovery_successor(uuid,uuid,integer,public.work_impact_level,public.work_capability,jsonb,jsonb,text,uuid) IS
  'Cria successor recovery atomicamente; serializa por owner+idempotency key e recusa replay divergente fail-closed.';

