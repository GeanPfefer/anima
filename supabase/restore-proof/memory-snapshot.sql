\set ON_ERROR_STOP 1
SET default_transaction_read_only = on;
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET TIME ZONE 'UTC';

SELECT format($q$
SELECT %L || '=' || count(*)::text || ':' ||
 encode(sha256(convert_to(coalesce(string_agg(j, E'\n' ORDER BY j COLLATE "C"), ''), 'UTF8')), 'hex')
FROM (SELECT to_jsonb(t)::text AS j FROM %I.%I t) rows_for_digest;
$q$, 'table:' || n.nspname || '.' || c.relname, n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND
 (n.nspname IN ('public', 'private', 'storage', 'supabase_migrations') OR
  (n.nspname = 'auth' AND c.relname IN ('users', 'identities')))
ORDER BY 1
\gexec

SELECT 'coverage_tables_in_scope=' || count(*)::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND
 (n.nspname IN ('public', 'private', 'storage', 'supabase_migrations') OR
  (n.nspname = 'auth' AND c.relname IN ('users', 'identities')));

SELECT format($q$
SELECT %L || '=' || count(*)::text FROM %s c
WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s);
$q$, 'fk_orphans:' || n.nspname || '.' || child.relname || '.' || co.conname,
 co.conrelid::regclass,
 string_agg(format('c.%I IS NOT NULL', ca.attname), ' AND ' ORDER BY cols.ordinality),
 co.confrelid::regclass,
 string_agg(format('p.%I = c.%I', pa.attname, ca.attname), ' AND ' ORDER BY cols.ordinality))
FROM pg_constraint co
JOIN pg_class child ON child.oid = co.conrelid
JOIN pg_namespace n ON n.oid = child.relnamespace
CROSS JOIN LATERAL unnest(co.conkey, co.confkey) WITH ORDINALITY AS cols(child_num, parent_num, ordinality)
JOIN pg_attribute ca ON ca.attrelid = co.conrelid AND ca.attnum = cols.child_num
JOIN pg_attribute pa ON pa.attrelid = co.confrelid AND pa.attnum = cols.parent_num
WHERE co.contype = 'f' AND n.nspname IN ('public', 'private')
GROUP BY co.oid, co.conname, co.conrelid, co.confrelid, n.nspname, child.relname
ORDER BY 1
\gexec

SELECT 'constraints=' || count(*)::text || ':' ||
 encode(sha256(convert_to(coalesce(string_agg(j, E'\n' ORDER BY j COLLATE "C"), ''), 'UTF8')), 'hex')
FROM (
 SELECT n.nspname || '.' || c.relname || '|' || co.conname || '|' || co.contype::text ||
 '|' || co.convalidated::text || '|' || regexp_replace(pg_get_constraintdef(co.oid), '[[:space:]]+', ' ', 'g') AS j
 FROM pg_constraint co JOIN pg_class c ON c.oid = co.conrelid
 JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('public', 'private')
) definitions;

SELECT 'indexes=' || count(*)::text || ':' ||
 encode(sha256(convert_to(coalesce(string_agg(j, E'\n' ORDER BY j COLLATE "C"), ''), 'UTF8')), 'hex')
FROM (
 SELECT schemaname || '.' || tablename || '|' || indexname || '|' ||
 regexp_replace(indexdef, '[[:space:]]+', ' ', 'g') AS j
 FROM pg_indexes WHERE schemaname IN ('public', 'private')
) definitions;

SELECT 'columns=' || count(*)::text || ':' ||
 encode(sha256(convert_to(coalesce(string_agg(j, E'\n' ORDER BY j COLLATE "C"), ''), 'UTF8')), 'hex')
FROM (
 SELECT n.nspname || '.' || c.relname || '.' || a.attname || '|' ||
 format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull::text || '|' ||
 coalesce(pg_get_expr(d.adbin, d.adrelid), '') AS j
 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 JOIN pg_attribute a ON a.attrelid = c.oid
 LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
 WHERE n.nspname IN ('public', 'private') AND c.relkind IN ('r', 'p')
 AND a.attnum > 0 AND NOT a.attisdropped
) definitions;

SELECT format($q$SELECT %L || '=' || last_value::text || ':' || CASE WHEN is_called THEN 't' ELSE 'f' END FROM %I.%I;$q$,
 'sequence:' || n.nspname || '.' || c.relname, n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'S' AND n.nspname IN ('public', 'private')
ORDER BY 1
\gexec
COMMIT;
