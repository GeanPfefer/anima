-- ============================================================
-- Modo de exibição do dashboard: game | analytical | minimal
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN display_mode text NOT NULL DEFAULT 'game'
    CHECK (display_mode IN ('game', 'analytical', 'minimal'));
