\set ON_ERROR_STOP 1
SET default_transaction_read_only = on;
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anima_system_writer') THEN
  RAISE EXCEPTION 'required role anima_system_writer is missing' USING ERRCODE = 'P0001';
 END IF;
END $$;

SELECT 'role|' || rolname || '|login=' || rolcanlogin::text || '|inherit=' || rolinherit::text ||
 '|super=' || rolsuper::text || '|createrole=' || rolcreaterole::text || '|createdb=' || rolcreatedb::text ||
 '|repl=' || rolreplication::text || '|bypassrls=' || rolbypassrls::text || '|conn=' || rolconnlimit::text ||
 '|has_expiry=' || (rolvaliduntil IS NOT NULL)::text
FROM pg_roles WHERE left(rolname, 3) <> 'pg_' ORDER BY rolname COLLATE "C";

SELECT 'membership|' || r.rolname || '|member=' || m.rolname || '|admin=' || am.admin_option::text
FROM pg_auth_members am JOIN pg_roles r ON r.oid = am.roleid JOIN pg_roles m ON m.oid = am.member
ORDER BY r.rolname COLLATE "C", m.rolname COLLATE "C";

SELECT 'role_setting|' || coalesce(r.rolname, '<all>') || '|' || coalesce(d.datname, '<all>') || '|' || setting
FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid = s.setrole
LEFT JOIN pg_database d ON d.oid = s.setdatabase
CROSS JOIN LATERAL unnest(s.setconfig) AS config(setting)
ORDER BY 1;

SELECT 'writer_schema_usage|' || schema_name || '|' ||
 has_schema_privilege('anima_system_writer', schema_name, 'USAGE')::text
FROM (VALUES ('public'), ('private'), ('auth')) schemas(schema_name) ORDER BY schema_name COLLATE "C";

SELECT 'writer_exec|' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) ||
 ')|secdef=' || p.prosecdef::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private')
AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
AND has_function_privilege('anima_system_writer', p.oid, 'EXECUTE')
ORDER BY 1;

SELECT 'writer_table|' || n.nspname || '.' || c.relname || '|' || privilege_name
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) privileges(privilege_name)
WHERE n.nspname IN ('public', 'private') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
AND has_table_privilege('anima_system_writer', c.oid, privilege_name)
ORDER BY 1;

SELECT 'auth_users_by_role|' || coalesce(role::text, '<null>') || '|' || count(*)::text
FROM auth.users GROUP BY role ORDER BY coalesce(role::text, '<null>') COLLATE "C";
COMMIT;
