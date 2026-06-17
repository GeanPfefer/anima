import type { SupabaseClient } from '@supabase/supabase-js';

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Cria (ou reaproveita) um pilar pendente por nome, tolerante a corrida.
// Três caminhos de detecção (atividade, quest, entidade) podem tentar criar o
// mesmo pilar na mesma mensagem; a unique index user_pillars(user_id, lower(name))
// garante linha única e, em caso de conflito, relemos o pilar existente em vez
// de falhar. Retorna o id do pilar (existente ou recém-criado) ou null.
export async function createPendingPillar(
  supabase: SupabaseClient,
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
      ...(pendingActivity ? { pending_activity: pendingActivity } : {}),
    })
    .select('id')
    .single();

  if (created) return created.id;

  // Conflito de corrida (outro caminho criou o mesmo nome) — relê.
  return findByName();
}
