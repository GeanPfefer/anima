-- A2-0 / Recorte 2 — ACEITE SOB MANDATO ANTECIPADO. CANDIDATA: NÃO aplicar no residente sem checkpoint humano.
-- Só o vocabulário: `ALTER TYPE ... ADD VALUE` não pode ser usado na mesma transação que referencia o valor novo
-- (a lógica vive em `20261017000001_acceptance_mandate_candidate.sql`). Aditiva: nenhum evento é lido nem alterado.
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'work_mandate_granted';
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'work_mandate_revoked';
