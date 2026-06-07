-- Permite que usuários apaguem pilares próprios sem histórico de XP.
-- A constraint de FK em xp_records (sem CASCADE) garante que pilares com
-- registros não podem ser deletados no banco — a checagem xp_total=0
-- no cliente é a primeira barreira; esta policy é a segunda.

CREATE POLICY "user_pillars: deleção própria"
  ON public.user_pillars FOR DELETE
  USING (auth.uid() = user_id);
