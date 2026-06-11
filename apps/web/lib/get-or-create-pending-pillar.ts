import { createClient } from '@/lib/supabase/server';

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Cria pilar com status 'pending' se não existir ainda (em qualquer status).
// Retorna true se criado, false se já existia.
export async function getOrCreatePendingPillar(data: {
  pillarName:      string;
  durationMinutes: number;
  note:            string;
}): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: allPillars } = await supabase
    .from('user_pillars')
    .select('name')
    .eq('user_id', user.id);

  const exists = (allPillars ?? []).some(p => norm(p.name) === norm(data.pillarName));
  if (exists) return false;

  const { count } = await supabase
    .from('user_pillars')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);

  const { error } = await supabase
    .from('user_pillars')
    .insert({
      user_id:    user.id,
      catalog_id: null,
      name:       data.pillarName,
      xp_rate:    1.0,
      is_active:  false,
      status:     'pending',
      sort_order: (count ?? 3) + 10,
      pending_activity: {
        durationMinutes: data.durationMinutes,
        note:            data.note,
        detectedAt:      new Date().toISOString(),
      },
    });

  return !error;
}
