-- ============================================================
-- Pilares livres: remove catálogo fixo, 3 pilares raiz criados
-- automaticamente para todo novo usuário via trigger.
--
-- Pilares são inferidos livremente pela IA — sem lista pré-definida.
-- Únicos pilares garantidos (raiz): Saúde, Mente, Relações.
-- ============================================================

-- Remove o FK de catalog_id — catalog_id vira campo livre (legado)
ALTER TABLE public.user_pillars
  DROP CONSTRAINT IF EXISTS user_pillars_catalog_id_fkey;

-- Limpa o catálogo legado (referências FK já removidas)
DELETE FROM public.pillar_catalog;

-- Atualiza o trigger de criação de usuário para criar
-- os 3 pilares raiz imediatamente após o signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', 'Jogador')
  );

  -- 3 pilares raiz — universais, existem para todo ser humano
  INSERT INTO public.user_pillars (user_id, catalog_id, name, xp_rate, sort_order)
  VALUES
    (NEW.id, NULL, 'Saúde',    1.0, 0),
    (NEW.id, NULL, 'Mente',    1.0, 1),
    (NEW.id, NULL, 'Relações', 1.0, 2);

  RETURN NEW;
END;
$$;
