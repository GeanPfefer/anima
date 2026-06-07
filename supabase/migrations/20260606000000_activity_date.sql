-- Backfill com data passada (PRD §1b: decidido)
-- Separa a data de ocorrência da atividade da data de criação do registro.
-- Bônus são calculados relativos a activity_date, não a created_at.

ALTER TABLE public.xp_records
  ADD COLUMN activity_date date NOT NULL DEFAULT now()::date;

-- Backfill: registros existentes recebem a data do seu created_at
UPDATE public.xp_records
  SET activity_date = created_at::date;

-- Índices para queries de bônus (streak, forgotten_pillar, first_of_day)
CREATE INDEX xp_records_user_activity_date_idx
  ON public.xp_records (user_id, activity_date DESC);

CREATE INDEX xp_records_pillar_activity_date_idx
  ON public.xp_records (pillar_id, activity_date DESC);
