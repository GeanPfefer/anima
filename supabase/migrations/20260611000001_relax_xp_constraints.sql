-- xp_records: permite duration_minutes = 0 (atividade registrada sem duração explícita)
-- e base_xp/total_xp = 0 (atividade de presença sem XP calculável)
ALTER TABLE public.xp_records
  DROP CONSTRAINT IF EXISTS xp_records_duration_minutes_check,
  DROP CONSTRAINT IF EXISTS xp_records_base_xp_check,
  DROP CONSTRAINT IF EXISTS xp_records_total_xp_check;

ALTER TABLE public.xp_records
  ADD CONSTRAINT xp_records_duration_minutes_check CHECK (duration_minutes >= 0),
  ADD CONSTRAINT xp_records_base_xp_check          CHECK (base_xp >= 0),
  ADD CONSTRAINT xp_records_total_xp_check          CHECK (total_xp >= 0);
