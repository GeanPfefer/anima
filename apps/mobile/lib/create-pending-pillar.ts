import { supabase } from './supabase';
import type { Json } from '@anima/types';

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Cria (ou reaproveita) um pilar pendente por nome, tolerante a corrida.
// A unique index user_pillars(user_id, lower(name)) garante linha única; em
// conflito (outro caminho criou o mesmo nome na mesma mensagem) relemos o pilar
// existente em vez de duplicar. Retorna o id ou null.
export async function createPendingPillar(
  userId: string,
  rawName: string,
  pendingActivity?: Record<string, unknown>,
): Promise<string | null> {
  const name = rawName.trim().slice(0, 20);
  if (!name) return null;

  const findByName = async (): Promise<string | null> => {
    const { data } = await supabase
      .from('user_pillars')
      .select('id, name')
      .eq('user_id', userId);
    return (data ?? []).find(p => norm(p.name) === norm(name))?.id ?? null;
  };

  const existing = await findByName();
  if (existing) return existing;

  const { count } = await supabase
    .from('user_pillars')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  const { data: created } = await supabase
    .from('user_pillars')
    .insert({
      user_id:    userId,
      catalog_id: null,
      name,
      xp_rate:    1.0,
      is_active:  false,
      status:     'pending',
      sort_order: (count ?? 3) + 10,
      ...(pendingActivity ? { pending_activity: pendingActivity as Json } : {}),
    })
    .select('id')
    .single();

  if (created) return created.id;

  // Conflito de corrida — relê.
  return findByName();
}
