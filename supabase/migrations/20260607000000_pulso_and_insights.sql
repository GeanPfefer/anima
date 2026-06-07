-- P2: Pulso do dia + Insights automáticos (Camada 4)

-- ─── Relax xp_records — entrada sem tempo é válida (PRD §1b) ─────────────────
-- "Entrada sem tempo: permitida, gera 0 XP, conta como presença"

ALTER TABLE public.xp_records
  DROP CONSTRAINT IF EXISTS xp_records_duration_minutes_check,
  DROP CONSTRAINT IF EXISTS xp_records_base_xp_check,
  DROP CONSTRAINT IF EXISTS xp_records_total_xp_check;

ALTER TABLE public.xp_records
  ADD CONSTRAINT xp_records_duration_minutes_check CHECK (duration_minutes >= 0),
  ADD CONSTRAINT xp_records_base_xp_check          CHECK (base_xp >= 0),
  ADD CONSTRAINT xp_records_total_xp_check         CHECK (total_xp >= 0);

-- ─── insights ─────────────────────────────────────────────────────────────────
-- Camada 4 — insights gerados pela IA sobre padrões no histórico.
-- Critérios: raros, específicos, contextualizados, honestos (sem coaching).

CREATE TABLE public.insights (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  text         text        NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz          -- NULL = ainda visível
);

CREATE INDEX insights_user_idx ON public.insights (user_id, generated_at DESC);

ALTER TABLE public.insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insights: leitura própria"
  ON public.insights FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "insights: inserção própria"
  ON public.insights FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Dismiss
CREATE POLICY "insights: atualização própria"
  ON public.insights FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
