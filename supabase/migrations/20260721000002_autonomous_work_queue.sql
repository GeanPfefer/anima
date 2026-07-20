-- SUP-01: fila de trabalho autônomo como projeção.
--
-- A fila não tem tabela própria: é derivada de work_items, do evento de
-- aprovação vigente e de work_claims. Por isso ela sobrevive a reinícios e um
-- item que deixa de ser elegível sai dela sozinho, sem poder divergir do
-- estado real.
--
-- A régua completa de elegibilidade do AUTO-01 ganha aqui uma única
-- implementação em SQL, reutilizável, espelhando `evaluateAutonomousEligibility`
-- do core. Os testes provam que as duas concordam caso a caso.
--
-- Todos os predicados usam CASE com guarda explícita de NULL e de tipo: o AND
-- do SQL não garante curto-circuito, e `jsonb_array_elements` sobre um escalar
-- levanta exceção em vez de devolver falso. Entrada ausente ou malformada
-- resulta em `false`, nunca em NULL nem em erro.

CREATE FUNCTION private.jsonb_is_nonblank_string(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT COALESCE(jsonb_typeof(v) = 'string' AND length(btrim(v #>> '{}')) > 0, false);
$$;

CREATE FUNCTION private.jsonb_is_positive_integer(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT COALESCE(jsonb_typeof(v) = 'number' AND (v #>> '{}') ~ '^[0-9]+$' AND (v #>> '{}')::numeric > 0, false);
$$;

CREATE FUNCTION private.jsonb_is_nonblank_string_array(v jsonb, min_entries integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN v IS NULL OR jsonb_typeof(v) <> 'array' THEN false
    WHEN jsonb_array_length(v) < min_entries THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v) AS entry
      WHERE NOT private.jsonb_is_nonblank_string(entry.value)
    )
  END;
$$;

-- Cada critério é objeto com rótulo não vazio; `command`, quando presente,
-- também precisa ser texto não vazio.
CREATE FUNCTION private.is_valid_validation_criteria(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN v IS NULL OR jsonb_typeof(v) <> 'array' OR jsonb_array_length(v) = 0 THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v) AS criterion
      WHERE jsonb_typeof(criterion.value) <> 'object'
         OR NOT private.jsonb_is_nonblank_string(criterion.value -> 'label')
         OR (criterion.value ? 'command' AND NOT private.jsonb_is_nonblank_string(criterion.value -> 'command'))
    )
  END;
$$;

-- Ao menos um limite positivo declarado; qualquer limite conhecido presente
-- precisa ser inteiro positivo. Chaves desconhecidas são ignoradas.
CREATE FUNCTION private.is_valid_execution_limits(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN v IS NULL OR jsonb_typeof(v) <> 'object' THEN false
    ELSE NOT EXISTS (
           SELECT 1 FROM jsonb_each(v) AS declared
           WHERE declared.key IN ('max_attempts', 'max_duration_minutes', 'max_resource_units')
             AND NOT private.jsonb_is_positive_integer(declared.value)
         )
         AND EXISTS (
           SELECT 1 FROM jsonb_each(v) AS declared
           WHERE declared.key IN ('max_attempts', 'max_duration_minutes', 'max_resource_units')
         )
  END;
$$;

-- Espelho SQL de AutonomousExecutionSpecV1. Permissões vazias contam como
-- declaradas de propósito.
CREATE FUNCTION private.is_valid_execution_spec(spec jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN spec IS NULL OR jsonb_typeof(spec) <> 'object' THEN false
    WHEN spec -> 'schema_version' IS DISTINCT FROM '1'::jsonb THEN false
    WHEN jsonb_typeof(spec -> 'target') IS DISTINCT FROM 'object' THEN false
    WHEN COALESCE(spec #>> '{target,kind}', '') NOT IN ('project', 'workspace', 'resource') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(spec #> '{target,reference}') THEN false
    WHEN NOT private.jsonb_is_nonblank_string_array(spec -> 'permissions', 0) THEN false
    WHEN NOT private.is_valid_validation_criteria(spec -> 'validation_criteria') THEN false
    WHEN NOT private.is_valid_execution_limits(spec -> 'limits') THEN false
    ELSE true
  END;
$$;

-- Régua completa do Marco 003 §Elegibilidade. `capability` não é verificada
-- porque a coluna já é o enum fechado do domínio.
CREATE FUNCTION private.is_autonomously_eligible(p_state public.work_state, p_proposal jsonb, p_intent jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN p_state IS DISTINCT FROM 'approved' THEN false
    WHEN NOT private.jsonb_is_nonblank_string_array(p_proposal #> '{data,included_scope}', 1) THEN false
    WHEN NOT private.jsonb_is_nonblank_string_array(p_proposal #> '{data,excluded_scope}', 1) THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p_proposal #> '{data,objective}') THEN false
    WHEN NOT private.jsonb_is_nonblank_string_array(p_proposal #> '{data,expected_effects}', 1) THEN false
    WHEN NOT private.is_valid_execution_spec(p_intent -> 'execution_spec') THEN false
    ELSE true
  END;
$$;

REVOKE ALL ON FUNCTION private.jsonb_is_nonblank_string(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.jsonb_is_positive_integer(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.jsonb_is_nonblank_string_array(jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_valid_validation_criteria(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_valid_execution_limits(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_valid_execution_spec(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_autonomously_eligible(public.work_state, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.jsonb_is_nonblank_string(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.jsonb_is_positive_integer(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.jsonb_is_nonblank_string_array(jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION private.is_valid_validation_criteria(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.is_valid_execution_limits(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.is_valid_execution_spec(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.is_autonomously_eligible(public.work_state, jsonb, jsonb) TO service_role;

-- ============================================================
-- Projeção consultável da fila.
--
-- É função SECURITY DEFINER, não view: mantém o mesmo padrão de acesso das
-- demais RPCs de orquestração (auth.uid() + allowlist explícitos) e permite
-- reutilizar os predicados privados sem expor o schema `private`.
-- ============================================================

CREATE FUNCTION public.autonomous_work_queue()
RETURNS TABLE (
  work_item_id              uuid,
  approved_proposal_version integer,
  approval_seq              bigint,
  approved_at               timestamptz,
  capability                public.work_capability,
  target_reference          text,
  queue_position            bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.proposal_version,
    approval.seq,
    approval.created_at,
    i.capability,
    i.intent #>> '{execution_spec,target,reference}',
    -- Ordem total materializada como dado, não como sorte de plano.
    row_number() OVER (ORDER BY approval.seq, i.id)
  FROM public.work_items i
  -- Aprovação vigente: proposta revisada perde a posição anterior na fila.
  JOIN LATERAL (
    SELECT e.seq, e.created_at
    FROM public.work_events e
    WHERE e.work_item_id = i.id
      AND e.event_type = 'work_approved'
      AND e.proposal_version = i.proposal_version
    ORDER BY e.seq DESC
    LIMIT 1
  ) AS approval ON TRUE
  WHERE i.user_id = v_user_id
    AND private.is_autonomously_eligible(i.state, i.proposal, i.intent)
    -- Claim ativo significa que o item já pertence a alguém; claim expirado ou
    -- liberado devolve o item à fila para retomada.
    AND NOT EXISTS (
      SELECT 1 FROM public.work_claims c
      WHERE c.work_item_id = i.id AND c.released_at IS NULL AND c.expires_at > now()
    )
  ORDER BY approval.seq, i.id;
END;
$$;

REVOKE ALL ON FUNCTION public.autonomous_work_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.autonomous_work_queue() TO authenticated, service_role;

COMMENT ON FUNCTION public.autonomous_work_queue() IS
  'Projeção da fila de trabalhos aguardando execução autônoma, derivada de work_items, da aprovação vigente e de work_claims. Ordem FIFO pela sequência do evento de aprovação, com o id do item como desempate defensivo. Não possui estado próprio.';
