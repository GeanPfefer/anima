-- SUP-04: vocabulário da reconciliação.
--
-- Isolado em migration própria pela mesma razão do AUTO-02: um valor novo de
-- enum só pode ser usado depois de commitado, então a transição que o consome
-- vive na migration seguinte.
--
-- `attempt_abandoned` afirma exatamente uma coisa: a tentativa excedeu um
-- limite declarado e persistido, e por isso deixou de ser a ocupante do item.
-- Não afirma sucesso, não afirma fracasso e não toca resultado algum — é
-- estritamente mais fraco que `result_submitted` ou `execution_failed`, e é
-- essa fraqueza que o torna seguro de emitir sem evidência do executor.

ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'attempt_abandoned';
