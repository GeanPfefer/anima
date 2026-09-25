-- Evento dedicado da preferência de compute por unidade. Isolado em migration própria:
-- um valor novo de enum não pode ser usado na mesma transação que o cria.
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'compute_preference_recorded';
