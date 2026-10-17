-- A2-0 / Recorte 1 — fato de CONTEXTO DE EXECUÇÃO observado pelo host (execution_mode / actor_kind).
-- CANDIDATA: NÃO aplicar no residente sem checkpoint humano. Só o vocabulário aqui:
-- `ALTER TYPE ... ADD VALUE` não pode ser usado na mesma transação que referencia o novo valor
-- (a RPC vive em `20261016000001_host_observed_execution_context_candidate.sql`).
-- Aditiva: nenhum evento histórico é lido, alterado ou removido.
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'host_observed_execution_context_recorded';
