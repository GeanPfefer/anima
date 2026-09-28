-- Operational Durability — data snapshot (READ-ONLY). Run: psql -X -A -t -q -v email="$ANIMA_RESIDENT_EMAIL" < data-snapshot.sql
-- Emits key=value counts/anchors/digests only; the resident email is used for the fingerprint lookup and never printed.
\set ON_ERROR_STOP 1
SET default_transaction_read_only = on;
SET TIME ZONE 'UTC';
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'migration_version=' || max(version) FROM supabase_migrations.schema_migrations;
SELECT 'migration_count=' || count(*) FROM supabase_migrations.schema_migrations;
SELECT 'auth_users=' || count(*) FROM auth.users;
SELECT 'auth_identities=' || count(*) FROM auth.identities;
SELECT 'auth_users_without_identity=' || count(*) FROM auth.users u WHERE NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id);
SELECT 'resident_identities=' || count(*) FROM auth.identities i JOIN auth.users u ON u.id = i.user_id WHERE lower(u.email) = lower(:'email');
SELECT 'resident_fingerprint=' || coalesce(left(encode(sha256(convert_to('anima-resident:' || id::text,'UTF8')),'hex'),16),'MISSING') FROM (SELECT (SELECT id FROM auth.users WHERE lower(email)=lower(:'email')) AS id) s;
SELECT 'storage_buckets=' || count(*) FROM storage.buckets;
SELECT 'storage_objects=' || count(*) FROM storage.objects;
SELECT 'work_items=' || count(*) FROM public.work_items;
SELECT 'work_events=' || count(*) FROM public.work_events;
SELECT 'work_events_last_seq=' || max(seq) FROM public.work_events;
SELECT 'work_events_last_id=' || id FROM public.work_events ORDER BY seq DESC LIMIT 1;
SELECT 'work_recovery_lineage=' || count(*) FROM public.work_recovery_lineage;
SELECT 'work_harness_recoveries=' || count(*) FROM public.work_harness_recoveries;
SELECT 'paid_compute_authorizations=' || count(*) FROM public.paid_compute_authorizations;
SELECT 'paid_compute_authorization_events=' || count(*) FROM public.paid_compute_authorization_events;
SELECT 'budget_' || event_type || '=' || count(*) FROM public.paid_compute_budget_events GROUP BY event_type ORDER BY event_type;
SELECT 'work_claims=' || count(*) FROM public.work_claims;
SELECT 'work_resume_authorizations=' || count(*) FROM public.work_resume_authorizations;
-- Digest V0 (equality proof only): work_events ordered by seq, projection:
-- seq \t id \t work_item_id \t event_type \t author \t proposal_version \t created_at(UTC, microsecond ISO) \t payload(jsonb canonical text), rows joined by \n
SELECT 'work_events_digest=' || encode(sha256(convert_to(coalesce(string_agg(concat_ws(E'\t', seq::text, id::text, work_item_id::text, event_type::text, author::text, coalesce(proposal_version::text,''), to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), payload::text), E'\n' ORDER BY seq),''),'UTF8')),'hex') FROM public.work_events;
-- Auxiliary digests: full row to_jsonb(row)::text ordered by id
SELECT 'work_items_digest=' || encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id),''),'UTF8')),'hex') FROM public.work_items t;
SELECT 'budget_events_digest=' || encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id),''),'UTF8')),'hex') FROM public.paid_compute_budget_events t;
SELECT 'authorizations_digest=' || encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id),''),'UTF8')),'hex') FROM public.paid_compute_authorizations t;
SELECT 'lineage_digest=' || encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id),''),'UTF8')),'hex') FROM public.work_recovery_lineage t;
SELECT 'rls_tables_enabled=' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND c.relkind='r' AND c.relrowsecurity;
SELECT 'policies=' || count(*) FROM pg_policies WHERE schemaname IN ('public','private','storage');
SELECT 'functions_public_private=' || count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private');
SELECT 'functions_signature_digest=' || encode(sha256(convert_to(string_agg(sig, E'
' ORDER BY sig),'UTF8')),'hex') FROM (SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private')) s;
SELECT 'triggers=' || count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN ('public','private','auth','storage');
SELECT 'triggers_digest=' || encode(sha256(convert_to(string_agg(sig, E'
' ORDER BY sig),'UTF8')),'hex') FROM (SELECT n.nspname||'.'||c.relname||':'||t.tgname||':'||p.proname AS sig FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND n.nspname IN ('public','private','auth','storage')) s;
SELECT 'extensions=' || string_agg(extname||'@'||extversion, ',' ORDER BY extname) FROM pg_extension;
SELECT 'pg_version=' || current_setting('server_version');
COMMIT;
