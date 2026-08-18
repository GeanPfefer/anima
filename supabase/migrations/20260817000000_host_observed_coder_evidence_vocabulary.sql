-- Evidência do CODER observada pelo host (custo wall-clock de primeira parte, visão
-- §12). Só o vocabulário aqui — `ALTER TYPE ... ADD VALUE` não pode ser usado na mesma
-- transação que referencia o novo valor.
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'host_observed_coder_evidence_recorded';
