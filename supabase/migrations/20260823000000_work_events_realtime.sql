-- Wake event-driven do Resident Local Host (ADR-003, AUTO_EVENT_WAKE).
--
-- Habilita o broadcast Realtime de INSERTs em `public.work_events` para que o processo
-- residente ACORDE quando algo muda (novo proposto/aprovado, decisão humana resolvida,
-- terminal, etc.) em vez de depender de polling como mecanismo primário.
--
-- ADITIVO e de baixo risco: apenas adiciona a tabela à publicação `supabase_realtime`.
-- Nenhuma mudança de estrutura/coluna → nenhuma regeneração de tipos necessária.
--
-- SEGURANÇA: a RLS de `work_events` continua sendo a autoridade — o Realtime aplica a
-- política SELECT por assinante usando o JWT dele, então o resident host (assinando com o
-- Bearer do usuário) só recebe eventos DAQUELE usuário. NUNCA service_role.
--
-- Só INSERT é observado pelo wake (evento novo). Não é preciso `REPLICA IDENTITY FULL`
-- (que só afeta o payload de UPDATE/DELETE). A fonte do wake NÃO é a fonte da decisão:
-- após acordar, o runner reconcilia e a política pura decide; evento perdido/duplicado é
-- seguro (há um fallback de reconciliação lenta).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'work_events'
  ) then
    execute 'alter publication supabase_realtime add table public.work_events';
  end if;
end $$;
