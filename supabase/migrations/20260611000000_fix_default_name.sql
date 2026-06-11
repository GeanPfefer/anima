-- Corrige o nome padrão do perfil: 'Jogador' era um placeholder ruim.
-- Novos usuários ficam com name = NULL até o onboarding identificar o nome real.

-- Reseta perfis que ainda têm o placeholder genérico
UPDATE public.profiles SET name = 'usuário' WHERE name = 'Jogador';

-- Atualiza o trigger: usa 'usuário' como placeholder neutro em vez de 'Jogador'
-- O app normaliza 'usuário' para string vazia no onboarding, então a IA não
-- usa esse nome na saudação.
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
    COALESCE(NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'name', '')), ''), 'usuário')
  );

  INSERT INTO public.user_pillars (user_id, catalog_id, name, xp_rate, sort_order)
  VALUES
    (NEW.id, NULL, 'Saúde',    1.0, 0),
    (NEW.id, NULL, 'Mente',    1.0, 1),
    (NEW.id, NULL, 'Relações', 1.0, 2);

  RETURN NEW;
END;
$$;
