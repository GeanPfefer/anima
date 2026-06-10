-- ============================================================
-- Pilares pendentes — status + dados da atividade original
-- ============================================================

-- status distingue pilares ativos de pendentes (aguardando confirmação)
-- e inativos (desativados pelo usuário).
ALTER TABLE public.user_pillars
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending', 'inactive'));

-- pending_activity armazena a atividade que disparou a criação do pilar pendente.
-- Usado para aplicar o XP quando o usuário confirmar.
ALTER TABLE public.user_pillars
  ADD COLUMN pending_activity jsonb;

-- Pilares que já estão desativados (is_active = false) recebem status 'inactive'.
UPDATE public.user_pillars
  SET status = 'inactive'
  WHERE is_active = false;

-- Índice para buscar pendentes rapidamente
CREATE INDEX user_pillars_pending_idx
  ON public.user_pillars (user_id, status)
  WHERE status = 'pending';
