-- ============================================================
-- Notas — captura silenciosa de alimentação, gastos, humor, ideias
-- ============================================================

CREATE TABLE public.notes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content     text        NOT NULL,
  note_type   text        CHECK (note_type IN ('food', 'expense', 'mood', 'idea', 'other')),
  context     jsonb,
  pillar_hint text,
  xp_awarded  integer     NOT NULL DEFAULT 0,
  note_date   date        NOT NULL DEFAULT CURRENT_DATE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notes_user_date_idx ON public.notes (user_id, note_date DESC);

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notes: leitura própria"
  ON public.notes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "notes: inserção própria"
  ON public.notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notes: exclusão própria"
  ON public.notes FOR DELETE
  USING (auth.uid() = user_id);
