-- Persistência append-only da evidência OBSERVADA PELO HOST (independência real:
-- o executor não fabrica a evidência que verifica o próprio trabalho). Só o
-- vocabulário aqui — `ALTER TYPE ... ADD VALUE` não pode ser usado na mesma
-- transação que referencia o novo valor, como em branch_publication_vocabulary e
-- review_request_vocabulary.
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'host_observed_evidence_recorded';
