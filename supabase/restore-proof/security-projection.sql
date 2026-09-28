-- Security projection V0.1 (read-only). Output: one line per row "<projection>\t<canonical row>".
-- Digest per projection = sha256 of its rows sorted with LC_ALL=C, joined by "\n" (trailing "\n").
\set ON_ERROR_STOP 1
SET default_transaction_read_only = on;
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH
rels AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.relacl, c.relowner, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m','f','S')
),
funcs AS (
  SELECT p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prokind, p.prosecdef, p.proacl, p.proowner,
         (SELECT e.extname FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
           WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e') AS ext
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public','private')
),
g(role) AS (VALUES ('anon'),('authenticated'),('service_role'),('authenticator'),('postgres'))
SELECT proj || E'\t' || row FROM (
  -- 1/2 table + sequence ACL (effective, defaulting NULL ACL to built-in acldefault)
  SELECT CASE WHEN r.relkind = 'S' THEN 'sequence_acl' ELSE 'table_acl' END AS proj,
         r.nspname||'.'||r.relname||'|'||r.relkind::text||'|'||CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||'|'||a.privilege_type||'|'||a.is_grantable AS row
  FROM rels r, aclexplode(coalesce(r.relacl, acldefault((CASE WHEN r.relkind = 'S' THEN 's' ELSE 'r' END)::"char", r.relowner))) a
  UNION ALL
  -- column-level ACL
  SELECT 'column_acl', r.nspname||'.'||r.relname||'.'||at.attname||'|'||CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||'|'||a.privilege_type||'|'||a.is_grantable
  FROM rels r JOIN pg_attribute at ON at.attrelid = r.oid AND at.attnum > 0 AND NOT at.attisdropped AND at.attacl IS NOT NULL, aclexplode(at.attacl) a
  UNION ALL
  -- 3 function ACL (ext= marks extension members)
  SELECT 'function_acl', f.nspname||'.'||f.proname||'('||f.args||')|'||coalesce(f.ext,'-')||'|'||CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||'|'||a.privilege_type||'|'||a.is_grantable
  FROM funcs f, aclexplode(coalesce(f.proacl, acldefault('f'::"char", f.proowner))) a
  UNION ALL
  -- 4 SECURITY DEFINER exposure: effective EXECUTE per API role (includes PUBLIC/membership)
  SELECT 'secdef_exposure', f.nspname||'.'||f.proname||'('||f.args||')|'||g.role||'|'||has_function_privilege(g.role, f.oid, 'EXECUTE')
  FROM funcs f CROSS JOIN g WHERE f.prosecdef
  UNION ALL
  -- 5 owners (relations, functions, schemas)
  SELECT 'owners', 'rel|'||r.nspname||'.'||r.relname||'|'||r.relkind::text||'|'||pg_get_userbyid(r.relowner) FROM rels r
  UNION ALL
  SELECT 'owners', 'fn|'||f.nspname||'.'||f.proname||'('||f.args||')|'||coalesce(f.ext,'-')||'|'||pg_get_userbyid(f.proowner) FROM funcs f
  UNION ALL
  SELECT 'owners', 'schema|'||n.nspname||'|'||pg_get_userbyid(n.nspowner) FROM pg_namespace n WHERE n.nspname IN ('public','private')
  UNION ALL
  -- schema ACL
  SELECT 'schema_acl', n.nspname||'|'||CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||'|'||a.privilege_type||'|'||a.is_grantable
  FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n'::"char", n.nspowner))) a WHERE n.nspname IN ('public','private')
  UNION ALL
  -- 6/7 RLS + FORCE RLS
  SELECT 'rls', r.nspname||'.'||r.relname||'|'||r.relrowsecurity FROM rels r WHERE r.relkind IN ('r','p')
  UNION ALL
  SELECT 'force_rls', r.nspname||'.'||r.relname||'|'||r.relforcerowsecurity FROM rels r WHERE r.relkind IN ('r','p')
  UNION ALL
  -- 8 policies (full semantic text)
  SELECT 'policies', schemaname||'.'||tablename||'|'||policyname||'|'||permissive||'|'||cmd||'|'||array_to_string(roles, ',')||'|'||regexp_replace(coalesce(qual,''), '[[:space:]]+', ' ', 'g')||'|'||regexp_replace(coalesce(with_check,''), '[[:space:]]+', ' ', 'g')
  FROM pg_policies WHERE schemaname IN ('public','private','storage')
  UNION ALL
  -- 9 triggers (definition + enabled state), incl. managed schemas auth/storage
  SELECT 'triggers', n.nspname||'.'||c.relname||'|'||t.tgname||'|'||t.tgenabled::text||'|'||regexp_replace(pg_get_triggerdef(t.oid), '[[:space:]]+', ' ', 'g')
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal AND n.nspname IN ('public','private','auth','storage')
  UNION ALL
  -- 10 default privileges (future objects)
  SELECT 'default_acl', pg_get_userbyid(d.defaclrole)||'|'||coalesce(n.nspname,'<global>')||'|'||d.defaclobjtype::text||'|'||CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||'|'||a.privilege_type||'|'||a.is_grantable
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
  UNION ALL
  -- extra: realtime publication membership of ANIMA tables
  SELECT 'publication_membership', pubname||'|'||schemaname||'.'||tablename FROM pg_publication_tables WHERE schemaname IN ('public','private')
) s;
COMMIT;
