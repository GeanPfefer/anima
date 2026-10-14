\set ON_ERROR_STOP 1
SET default_transaction_read_only = on;
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
\if :{?min_quiet_seconds}
\else
\set min_quiet_seconds 300
\endif
SET TIME ZONE 'UTC';

SELECT 'claims_open=' || count(*)::text FROM public.work_claims WHERE released_at IS NULL;
SELECT 'claims_live=' || count(*)::text FROM public.work_claims WHERE released_at IS NULL AND expires_at > now();
SELECT 'claims_stale=' || count(*)::text FROM public.work_claims WHERE released_at IS NULL AND expires_at <= now();
SELECT 'stale_claim=' || left(replace(id::text, '-', ''), 8) || ':' || to_char(acquired_at, 'YYYY-MM-DD')
FROM public.work_claims WHERE released_at IS NULL AND expires_at <= now() ORDER BY id;
SELECT 'supervision_leases_live=' || count(*)::text FROM public.work_supervision_leases WHERE revoked_at IS NULL AND expires_at > now();
SELECT 'active_backends_other=' || count(*)::text FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid();
SELECT 'ledger_seq_max=' || coalesce(max(seq)::text, '-') FROM public.work_events;
SELECT 'ledger_last_event_age_s=' || coalesce(floor(extract(epoch FROM now() - max(created_at)))::bigint::text, '-') FROM public.work_events;
SELECT 'quiet_window_s=' || :'min_quiet_seconds'::integer::text;

WITH facts AS (
 SELECT EXISTS (SELECT 1 FROM public.work_claims WHERE released_at IS NULL AND expires_at > now()) AS claims_live,
 EXISTS (SELECT 1 FROM public.work_supervision_leases WHERE revoked_at IS NULL AND expires_at > now()) AS leases_live,
 EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid()) AS backends_active,
 coalesce(extract(epoch FROM now() - (SELECT max(created_at) FROM public.work_events)) < :'min_quiet_seconds'::integer, true) AS recent_events
), verdict AS (
 SELECT concat_ws(',', CASE WHEN claims_live THEN 'claims_live' END, CASE WHEN leases_live THEN 'leases_live' END,
 CASE WHEN backends_active THEN 'backends_active' END, CASE WHEN recent_events THEN 'recent_events' END) AS failures FROM facts
)
SELECT 'quiescence_failures=' || coalesce(nullif(failures, ''), '-') FROM verdict;

SELECT (
 EXISTS (SELECT 1 FROM public.work_claims WHERE released_at IS NULL AND expires_at > now()) OR
 EXISTS (SELECT 1 FROM public.work_supervision_leases WHERE revoked_at IS NULL AND expires_at > now()) OR
 EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid()) OR
 coalesce(extract(epoch FROM now() - (SELECT max(created_at) FROM public.work_events)) < :'min_quiet_seconds'::integer, true)
) AS quiescence_failed
\gset
SELECT 'quiescence_verdict=' || CASE WHEN :'quiescence_failed'::boolean THEN 'FAIL' ELSE 'PASS' END;
\if :quiescence_failed
DO $$ BEGIN RAISE EXCEPTION 'quiescence_failed' USING ERRCODE = 'P0001'; END $$;
\endif
COMMIT;
