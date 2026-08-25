-- Recuperacao honesta de um ciclo manual iniciado sem tentativa de executor.
-- Fato estritamente operacional: nao afirma sucesso, falha, cancelamento de attempt
-- nem resultado. Permite somente devolver a autoridade de execucao ao estado approved.
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'manual_work_released';
