CREATE FUNCTION private.is_valid_project_backlog_slices(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
SELECT CASE WHEN jsonb_typeof(v)<>'array' OR jsonb_array_length(v) NOT BETWEEN 1 AND 12 THEN false ELSE
  NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v) s WHERE
    jsonb_typeof(s)<>'object' OR coalesce(s->>'slice_key','') !~ '^[a-z0-9][a-z0-9-]{1,63}$' OR length(btrim(coalesce(s->>'summary','')))=0
    OR jsonb_typeof(s->'intent')<>'object' OR private.is_valid_work_proposal(s->'proposal') IS DISTINCT FROM true
    OR jsonb_typeof(s->'dependencies')<>'array'
    OR ((s->'intent') ? 'execution_spec' AND private.is_valid_execution_spec(s->'intent'->'execution_spec') IS DISTINCT FROM true)
  )
  AND NOT EXISTS(SELECT 1 FROM (SELECT s->>'slice_key' key,count(*) n FROM jsonb_array_elements(v) s GROUP BY 1 HAVING count(*)<>1) duplicate)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v) s, jsonb_array_elements_text(s->'dependencies') dep WHERE dep=s->>'slice_key' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v) candidate WHERE candidate->>'slice_key'=dep))
END $$;
REVOKE ALL ON FUNCTION private.is_valid_project_backlog_slices(jsonb) FROM PUBLIC,anon,authenticated;
ALTER TABLE public.project_backlog_proposals ADD CONSTRAINT project_backlog_slices_valid CHECK(private.is_valid_project_backlog_slices(slices));
