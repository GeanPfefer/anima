-- INTEL-01: vocabulário mínimo para a classificação de inteligência.
--
-- Um único tipo de evento atende tanto a primeira classificação quanto as
-- reclassificações. A distinção é persistida no payload por
-- `classification_revision` e `supersedes_event_id`, evitando inflar o enum.
ALTER TYPE public.work_event_type
  ADD VALUE IF NOT EXISTS 'work_intelligence_classified';
