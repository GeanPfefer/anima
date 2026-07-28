-- INTEL-01: persistência append-only e reconstrução da classificação corrente.
--
-- Esta migration não seleciona executor, não decide roteamento e não altera
-- estado, tentativa, claim ou aprovação. Ela somente registra fatos
-- classificados contra uma versão de proposta já aprovada e os reconstrói.

CREATE FUNCTION private.is_valid_work_intelligence_classification(p jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_provenance jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p)) <> 7
     OR p -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb
     OR p ->> 'complexity' NOT IN ('routine','bounded','complex','unknown')
     OR p ->> 'risk' NOT IN ('low','moderate','high','critical','unknown')
     OR p ->> 'reversibility' NOT IN ('reversible','conditionally_reversible','irreversible','unknown')
     OR p ->> 'planClarity' NOT IN ('clear','partial','unclear','unknown')
     OR p ->> 'urgency' NOT IN ('deferrable','normal','time_sensitive','immediate','unknown')
     OR NOT (p ?& ARRAY['schemaVersion','complexity','risk','reversibility','planClarity','urgency','provenance'])
  THEN
    RETURN false;
  END IF;

  v_provenance := p -> 'provenance';
  IF v_provenance IS NULL OR jsonb_typeof(v_provenance) <> 'object'
     OR NOT private.jsonb_is_nonblank_string(v_provenance -> 'classifiedAt')
     OR NOT private.jsonb_is_nonblank_string(v_provenance -> 'classifierId')
  THEN
    RETURN false;
  END IF;

  IF v_provenance ->> 'kind' = 'human_confirmed' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(v_provenance)) <> 3
       OR NOT (v_provenance ?& ARRAY['kind','classifiedAt','classifierId'])
    THEN RETURN false; END IF;
  ELSIF v_provenance ->> 'kind' = 'system_assessed' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(v_provenance)) <> 4
       OR NOT (v_provenance ?& ARRAY['kind','classifiedAt','classifierId','policyVersion'])
       OR NOT private.jsonb_is_nonblank_string(v_provenance -> 'policyVersion')
    THEN RETURN false; END IF;
  ELSE
    RETURN false;
  END IF;

  -- O cast valida calendário, hora e offset. Qualquer formato/cast inválido
  -- falha fechado sem propagar uma exceção de implementação.
  IF v_provenance ->> 'classifiedAt'
       !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
  THEN RETURN false; END IF;
  PERFORM (v_provenance ->> 'classifiedAt')::timestamptz;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.is_valid_work_intelligence_classification(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_valid_work_intelligence_classification(jsonb)
  TO service_role;

CREATE UNIQUE INDEX work_events_intelligence_revision_idx
  ON public.work_events (
    work_item_id,
    proposal_version,
    (payload -> 'data' ->> 'classification_revision')
  )
  WHERE event_type = 'work_intelligence_classified';

CREATE FUNCTION public.record_work_intelligence_classification(
  p_work_item_id uuid,
  p_expected_proposal_version integer,
  p_expected_classification_revision integer,
  p_classification jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_last public.work_events;
  v_last_revision integer := 0;
  v_replay public.work_events;
  v_revision integer;
  v_event_id uuid;
  v_event_seq bigint;
  v_author public.work_event_author;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id
  ) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF p_expected_proposal_version IS NULL OR p_expected_proposal_version < 1
     OR p_expected_classification_revision IS NULL
     OR p_expected_classification_revision < 0
     OR NOT private.is_valid_work_intelligence_classification(p_classification)
  THEN
    RAISE EXCEPTION 'invalid work intelligence classification' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item
  FROM public.work_items i
  WHERE i.id=p_work_item_id AND i.user_id=v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002';
  END IF;
  IF v_item.proposal_version IS DISTINCT FROM p_expected_proposal_version THEN
    RAISE EXCEPTION 'work item proposal version changed' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_item.id
      AND e.event_type='work_approved'
      AND e.proposal_version=p_expected_proposal_version
  ) THEN
    RAISE EXCEPTION 'proposal version is not approved' USING ERRCODE='55000';
  END IF;

  SELECT * INTO v_last
  FROM public.work_events e
  WHERE e.work_item_id=v_item.id
    AND e.event_type='work_intelligence_classified'
    AND e.proposal_version=p_expected_proposal_version
    AND private.is_valid_work_intelligence_classification(
      e.payload -> 'data' -> 'classification'
    )
  ORDER BY (e.payload -> 'data' ->> 'classification_revision')::integer DESC,
           e.seq DESC
  LIMIT 1;
  IF FOUND THEN
    v_last_revision := (v_last.payload -> 'data' ->> 'classification_revision')::integer;
  END IF;

  -- Uma reentrega do mesmo comando encontra o evento que avançou exatamente
  -- a revisão esperada e devolve replay, sem inserir outro fato.
  SELECT * INTO v_replay
  FROM public.work_events e
  WHERE e.work_item_id=v_item.id
    AND e.event_type='work_intelligence_classified'
    AND e.proposal_version=p_expected_proposal_version
    AND (e.payload -> 'data' ->> 'previous_classification_revision')::integer
          = p_expected_classification_revision
    AND e.payload -> 'data' -> 'classification' = p_classification
  ORDER BY e.seq DESC
  LIMIT 1;
  IF FOUND AND v_replay.id=v_last.id THEN
    RETURN jsonb_build_object(
      'action','replayed',
      'event_id',v_replay.id,
      'event_seq',v_replay.seq,
      'classification_revision',
        (v_replay.payload -> 'data' ->> 'classification_revision')::integer,
      'proposal_version',p_expected_proposal_version
    );
  END IF;

  IF v_last_revision <> p_expected_classification_revision THEN
    RAISE EXCEPTION 'work intelligence classification revision changed'
      USING ERRCODE='55000';
  END IF;

  v_revision := v_last_revision + 1;
  v_author := CASE p_classification #>> '{provenance,kind}'
    WHEN 'human_confirmed' THEN 'user'::public.work_event_author
    ELSE 'system'::public.work_event_author
  END;

  INSERT INTO public.work_events(
    work_item_id, event_type, author, proposal_version, payload
  )
  VALUES (
    v_item.id,
    'work_intelligence_classified',
    v_author,
    p_expected_proposal_version,
    jsonb_build_object(
      'schema_version',1,
      'data',jsonb_build_object(
        'work_item_id',v_item.id,
        'approved_proposal_version',p_expected_proposal_version,
        'classification_revision',v_revision,
        'previous_classification_revision',v_last_revision,
        'supersedes_event_id',CASE WHEN v_last_revision=0 THEN NULL ELSE v_last.id END,
        'classification',p_classification
      )
    )
  )
  RETURNING id, seq INTO v_event_id, v_event_seq;

  RETURN jsonb_build_object(
    'action','recorded',
    'event_id',v_event_id,
    'event_seq',v_event_seq,
    'classification_revision',v_revision,
    'proposal_version',p_expected_proposal_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_work_intelligence_classification(
  uuid, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_work_intelligence_classification(
  uuid, integer, integer, jsonb
) TO authenticated, service_role;

COMMENT ON FUNCTION public.record_work_intelligence_classification(
  uuid, integer, integer, jsonb
) IS
  'INTEL-01: registra classificação ou reclassificação append-only contra a versão atual aprovada, com concorrência otimista e replay idempotente. Não seleciona executor, não roteia e não altera estado.';

CREATE FUNCTION public.current_work_intelligence_classification(
  p_work_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
STABLE
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_proposal_version integer;
  v_data jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id
  ) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;

  SELECT i.proposal_version INTO v_proposal_version
  FROM public.work_items i
  WHERE i.id=p_work_item_id AND i.user_id=v_user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- A versão corrente precisa ter sido aprovada. Uma revisão de proposta
  -- invalida imediatamente a classificação anterior, inclusive antes da nova
  -- aprovação, e nunca reutiliza silenciosamente seu payload.
  IF NOT EXISTS (
    SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=p_work_item_id
      AND e.event_type='work_approved'
      AND e.proposal_version=v_proposal_version
  ) THEN RETURN NULL; END IF;

  SELECT e.payload -> 'data' INTO v_data
  FROM public.work_events e
  WHERE e.work_item_id=p_work_item_id
    AND e.event_type='work_intelligence_classified'
    AND e.proposal_version=v_proposal_version
    AND e.payload -> 'data' ->> 'work_item_id'=p_work_item_id::text
    AND (e.payload -> 'data' ->> 'approved_proposal_version')::integer=v_proposal_version
    AND private.is_valid_work_intelligence_classification(
      e.payload -> 'data' -> 'classification'
    )
  ORDER BY (e.payload -> 'data' ->> 'classification_revision')::integer DESC,
           e.seq DESC
  LIMIT 1;
  RETURN v_data;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  -- Evento estruturalmente corrompido não é reinterpretado.
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.current_work_intelligence_classification(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_work_intelligence_classification(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.current_work_intelligence_classification(uuid) IS
  'INTEL-01: reconstrói a última classificação válida da versão de proposta corrente e aprovada. Retorna NULL para ausência, nova versão sem classificação ou item inacessível; não roteia nem altera estado.';
