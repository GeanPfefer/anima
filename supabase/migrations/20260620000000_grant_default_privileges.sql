-- Migrations rodam como role `postgres`, mas só tabelas criadas pela role
-- `supabase_admin` recebem GRANT automático para anon/authenticated/service_role.
-- Sem isso, PostgREST retorna "permission denied" antes mesmo de avaliar RLS.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

-- Garante que tabelas/funções criadas por futuras migrations (rodando como
-- `postgres`) já nasçam com os grants corretos.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
