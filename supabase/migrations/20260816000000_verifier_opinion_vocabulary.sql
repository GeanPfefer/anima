-- Persistência append-only do PARECER do Verifier (advisory, versionado). Só o
-- vocabulário aqui — `ALTER TYPE ... ADD VALUE` não pode ser usado na mesma
-- transação que referencia o novo valor, como em host_observed_evidence_vocabulary.
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'verifier_opinion_recorded';
