-- P1.1: o resultado registrado tem forma fechada. Campos de evidência
-- (validations, limitations) são opcionais mas tipados; chaves desconhecidas
-- são rejeitadas para que texto livre nunca se passe por evidência estruturada.

CREATE OR REPLACE FUNCTION public.submit_work_result(
  work_item_id uuid,
  expected_proposal_version integer,
  result jsonb
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_target_state public.work_state;
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
     OR jsonb_typeof(result) IS DISTINCT FROM 'object'
     OR jsonb_typeof(result -> 'summary') IS DISTINCT FROM 'string'
     OR length(btrim(result ->> 'summary')) = 0
     OR jsonb_typeof(result -> 'result_references') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid result input' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(result -> 'result_references') AS value
    WHERE jsonb_typeof(value) <> 'string'
  ) THEN
    RAISE EXCEPTION 'result_references must contain only strings' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(result) AS key
    WHERE key NOT IN ('summary', 'result_references', 'validations', 'limitations')
  ) THEN
    RAISE EXCEPTION 'unexpected result field' USING ERRCODE = '22023';
  END IF;

  IF result ? 'validations' THEN
    IF jsonb_typeof(result -> 'validations') IS DISTINCT FROM 'array'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(result -> 'validations') AS validation
         WHERE jsonb_typeof(validation) <> 'object'
            OR jsonb_typeof(validation -> 'label') IS DISTINCT FROM 'string'
            OR length(btrim(validation ->> 'label')) = 0
            OR validation ->> 'outcome' NOT IN ('passed', 'failed', 'declared')
            OR EXISTS (
              SELECT 1 FROM jsonb_object_keys(validation) AS validation_key
              WHERE validation_key NOT IN ('label', 'outcome')
            )
       ) THEN
      RAISE EXCEPTION 'invalid result validations' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF result ? 'limitations' THEN
    IF jsonb_typeof(result -> 'limitations') IS DISTINCT FROM 'array'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(result -> 'limitations') AS limitation
         WHERE jsonb_typeof(limitation) <> 'string'
            OR length(btrim(limitation #>> '{}')) = 0
       ) THEN
      RAISE EXCEPTION 'invalid result limitations' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_item
  FROM public.work_items AS item
  WHERE item.id = work_item_id
    AND item.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'work item not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_item.proposal_version <> expected_proposal_version THEN
    RAISE EXCEPTION 'proposal version changed' USING ERRCODE = '55000';
  END IF;

  SELECT transition.to_state INTO v_target_state
  FROM private.work_state_transitions AS transition
  WHERE transition.from_state = v_item.state
    AND transition.event_type = 'result_submitted';

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
    'result_submitted',
    'user',
    v_item.proposal_version,
    jsonb_build_object(
      'schema_version', 1,
      'data', result
    )
  );

  RETURN v_item;
END;
$$;

COMMENT ON FUNCTION public.submit_work_result(uuid, integer, jsonb) IS
  'Registra o resultado manual com forma fechada: summary, result_references e evidências opcionais tipadas (validations, limitations).';
