-- Recompila o validador para instalacoes que ja aplicaram 00005.
-- providerRef permanece opcional nos fatos antigos, mas nunca pode ser string vazia.
-- provider_identified continua exigindo providerRef nao-vazio e healthy=false.

CREATE OR REPLACE FUNCTION private.is_valid_node_lifecycle_evidence(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'object' OR p->'schemaVersion' <> '1'::jsonb THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p->'nodeId')
      OR NOT private.jsonb_is_nonblank_string(p->'providerId') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p->'leaseId')
      OR NOT private.jsonb_is_nonblank_string(p->'workItemId') THEN false
    WHEN p->'attemptId' IS DISTINCT FROM 'null'::jsonb
      AND NOT private.jsonb_is_nonblank_string(p->'attemptId') THEN false
    -- providerRef continua opcional para fatos anteriores, mas quando presente
    -- precisa ser null ou uma identidade opaca nao-vazia.
    WHEN p ? 'providerRef'
      AND p->'providerRef' IS DISTINCT FROM 'null'::jsonb
      AND NOT private.jsonb_is_nonblank_string(p->'providerRef') THEN false
    WHEN p->>'billingMode' NOT IN ('owned','already_provisioned','paid') THEN false
    WHEN jsonb_typeof(p->'transition') <> 'object' THEN false
    WHEN p->'transition'->>'from' NOT IN (
      'offline','provisioning','ready','busy','idle','shutting_down',
      'provision_failed','health_failed','shutdown_failed'
    ) THEN false
    WHEN p->'transition'->>'to' NOT IN (
      'offline','provisioning','ready','busy','idle','shutting_down',
      'provision_failed','health_failed','shutdown_failed'
    ) THEN false
    WHEN p->'transition'->>'event' NOT IN (
      'provision_requested',
      'provider_identified',
      'health_confirmed',
      'provision_failed',
      'health_lost',
      'reserved',
      'released',
      'shutdown_requested',
      'shutdown_confirmed',
      'shutdown_failed'
    ) THEN false

    -- Regra especifica deste fato: identidade nao e readiness.
    WHEN p->'transition'->>'event' = 'provider_identified'
      AND (
        p->'transition'->>'from' <> 'provisioning'
        OR p->'transition'->>'to' <> 'provisioning'
        OR p->>'healthy' <> 'false'
        OR NOT private.jsonb_is_nonblank_string(p->'providerRef')
      ) THEN false

    WHEN jsonb_typeof(p->'healthy') <> 'boolean' THEN false
    WHEN jsonb_typeof(p->'activeDurationMs') <> 'number'
      OR (p->>'activeDurationMs')::numeric < 0
      OR (p->>'activeDurationMs')::numeric <> trunc((p->>'activeDurationMs')::numeric) THEN false
    WHEN p->>'billingMode'='paid'
      AND NOT private.jsonb_is_nonblank_string(p->'authorizationRef') THEN false
    WHEN p->>'billingMode'<>'paid'
      AND p->'authorizationRef' IS DISTINCT FROM 'null'::jsonb THEN false
    WHEN p->'estimatedCost' IS DISTINCT FROM 'null'::jsonb
      AND (
        jsonb_typeof(p->'estimatedCost') <> 'object'
        OR NOT private.jsonb_is_nonblank_string(p->'estimatedCost'->'currency')
        OR jsonb_typeof(p->'estimatedCost'->'amount') <> 'number'
        OR (p->'estimatedCost'->>'amount')::numeric < 0
      ) THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p->'observedAt') THEN false
    ELSE true
  END;
$$;
