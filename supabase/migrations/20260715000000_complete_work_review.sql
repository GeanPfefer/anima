-- Completa o ciclo manual da F5 com uma decisão semântica de revisão.
CREATE TYPE public.work_review_decision AS ENUM ('accept', 'request_changes');

CREATE OR REPLACE FUNCTION public.review_work_result(
  work_item_id uuid,
  expected_proposal_version integer,
  decision public.work_review_decision,
  decision_context jsonb DEFAULT '{}'::jsonb
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_event public.work_event_type;
  v_target_state public.work_state;
  v_result_event_id uuid;
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
     OR decision IS NULL
     OR jsonb_typeof(decision_context) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid review input' USING ERRCODE = '22023';
  END IF;

  IF decision = 'request_changes'
     AND (
       jsonb_typeof(decision_context -> 'requested_changes') IS DISTINCT FROM 'string'
       OR length(btrim(decision_context ->> 'requested_changes')) = 0
     ) THEN
    RAISE EXCEPTION 'requested_changes is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item
  FROM public.work_items AS item
  WHERE item.id = work_item_id
    AND item.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'work item not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_item.state <> 'review' OR v_item.proposal_version <> expected_proposal_version THEN
    -- 55000 e não 40001: serialization_failure dispara retry automático do
    -- PostgREST, e um conflito de versão nunca se resolve repetindo a chamada.
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE = '55000';
  END IF;

  SELECT event.id INTO v_result_event_id
  FROM public.work_events AS event
  WHERE event.work_item_id = v_item.id
    AND event.event_type = 'result_submitted'
  ORDER BY event.created_at DESC, event.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'result event not found' USING ERRCODE = 'P0002';
  END IF;

  v_event := CASE decision
    WHEN 'accept' THEN 'result_accepted'::public.work_event_type
    WHEN 'request_changes' THEN 'changes_requested'::public.work_event_type
  END;

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

  INSERT INTO public.work_events (
    work_item_id, event_type, author, proposal_version, payload
  ) VALUES (
    v_item.id,
    v_event,
    'user',
    v_item.proposal_version,
    jsonb_build_object('schema_version', 1, 'data',
      CASE decision
        WHEN 'accept' THEN jsonb_build_object(
          'accepted_result_event_id', v_result_event_id
        )
        WHEN 'request_changes' THEN jsonb_build_object(
          'requested_changes', decision_context ->> 'requested_changes',
          'reviewed_proposal_version', v_item.proposal_version,
          'reviewed_result_event_id', v_result_event_id
        )
      END
    )
  );

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.review_work_result(uuid, integer, public.work_review_decision, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_work_result(uuid, integer, public.work_review_decision, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.review_work_result(uuid, integer, public.work_review_decision, jsonb) IS
  'Aceita o resultado mais recente ou pede correções, derivando estado e evento de forma transacional.';
