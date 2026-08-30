-- Extende a régua da evidência V1 com identidade opcional de placement conhecida
-- pelo host. Eventos legados sem estes campos continuam válidos.
CREATE OR REPLACE FUNCTION private.is_valid_host_coder_evidence(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN false
    WHEN p -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'workItemId') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'attemptId') THEN false
    WHEN NOT private.jsonb_is_positive_integer(p -> 'approvedProposalVersion') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'backendId') THEN false
    WHEN (p ->> 'backendId') ~ '^[A-Za-z]:[\\/]' OR (p ->> 'backendId') LIKE '/%' THEN false
    WHEN jsonb_typeof(p -> 'durationMs') <> 'number' THEN false
    WHEN (p ->> 'durationMs')::numeric < 0
      OR (p ->> 'durationMs')::numeric <> trunc((p ->> 'durationMs')::numeric) THEN false
    WHEN (p ->> 'outcome') NOT IN ('succeeded', 'failed', 'cancelled') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'observedAt') THEN false
    WHEN p ?| ARRAY['placement', 'nodeId', 'model'] THEN CASE
      WHEN (p ->> 'placement') NOT IN ('local', 'remote') THEN false
      WHEN NOT private.jsonb_is_nonblank_string(p -> 'model') THEN false
      WHEN p ->> 'placement' = 'remote' AND NOT private.jsonb_is_nonblank_string(p -> 'nodeId') THEN false
      WHEN p ->> 'placement' = 'local' AND p -> 'nodeId' IS DISTINCT FROM 'null'::jsonb THEN false
      ELSE true
    END
    ELSE true
  END;
$$;

COMMENT ON FUNCTION private.is_valid_host_coder_evidence(jsonb) IS
  'Valida HostObservedCoderEvidenceV1, incluindo identidade opcional e coerente de placement/node/model conhecida pelo host; eventos legados sem esses campos permanecem válidos.';
