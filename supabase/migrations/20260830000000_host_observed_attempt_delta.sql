-- Distingue proveniência completa (base -> commit) do delta produzido pela
-- tentativa (start/checkpoint -> commit), mantendo compatibilidade com eventos
-- HostObservedGitEvidenceV1 históricos que ainda não possuem o novo campo.

CREATE OR REPLACE FUNCTION private.is_valid_host_observed_evidence(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN false
    WHEN p -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'workItemId') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'attemptId') THEN false
    WHEN NOT private.jsonb_is_positive_integer(p -> 'approvedProposalVersion') THEN false
    WHEN (p ->> 'baseSha') !~ '^[a-f0-9]{40}$' THEN false
    WHEN (p ->> 'observedCommitSha') !~ '^[a-f0-9]{40}$' THEN false
    WHEN (p ->> 'baseSha') = (p ->> 'observedCommitSha') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'observedAt') THEN false
    WHEN NOT private.jsonb_is_nonblank_string_array(p -> 'observedChangedFiles', 1) THEN false
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p -> 'observedChangedFiles') AS f(path)
      WHERE f.path ~ '^[A-Za-z]:[\\/]' OR f.path LIKE '/%' OR f.path LIKE '\\%'
    ) THEN false
    WHEN p ? 'observedChangedFilesSinceStart'
      AND NOT private.jsonb_is_nonblank_string_array(p -> 'observedChangedFilesSinceStart', 1) THEN false
    WHEN p ? 'observedChangedFilesSinceStart' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p -> 'observedChangedFilesSinceStart') AS f(path)
      WHERE f.path ~ '^[A-Za-z]:[\\/]' OR f.path LIKE '/%' OR f.path LIKE '\\%'
    ) THEN false
    WHEN jsonb_typeof(p -> 'observedDiffSummary') <> 'object' THEN false
    WHEN jsonb_typeof(p #> '{observedDiffSummary,filesChanged}') <> 'number' THEN false
    WHEN jsonb_typeof(p #> '{observedDiffSummary,insertions}') <> 'number' THEN false
    WHEN jsonb_typeof(p #> '{observedDiffSummary,deletions}') <> 'number' THEN false
    WHEN NOT private.is_valid_host_git_diff_files(p #> '{observedDiffSummary,files}') THEN false
    WHEN (p #> '{coverage,git}') IS DISTINCT FROM 'true'::jsonb THEN false
    WHEN (p #> '{coverage,gates}') IS DISTINCT FROM 'false'::jsonb THEN false
    ELSE true
  END;
$$;

COMMENT ON FUNCTION private.is_valid_host_observed_evidence(jsonb) IS
  'Valida HostObservedGitEvidenceV1. observedChangedFiles preserva o diff completo contra baseSha; observedChangedFilesSinceStart, quando presente, registra o delta da tentativa contra startSha/checkpoint. A ausência permanece válida apenas para compatibilidade histórica e nunca significa delta vazio.';
