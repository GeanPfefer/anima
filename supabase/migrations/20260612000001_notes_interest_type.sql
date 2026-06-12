-- Adiciona 'interest' ao enum de tipos de nota (para notas de gostos/descobertas)
ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_note_type_check;

ALTER TABLE public.notes
  ADD CONSTRAINT notes_note_type_check
  CHECK (note_type IN ('food', 'expense', 'mood', 'idea', 'interest', 'other'));
