-- Evidência de GATE observada pelo host (independência de primeira parte, sem
-- reexecução). Só o vocabulário aqui — `ALTER TYPE ... ADD VALUE` não pode ser
-- usado na mesma transação que referencia o novo valor.
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'host_observed_gate_evidence_recorded';
