import { createClient } from '@/lib/supabase/server';
import { createPendingPillar } from '@/lib/create-pending-pillar';

// Cria pilar 'pending' (com a atividade detectada anexada) se não existir ainda,
// em qualquer status. Tolerante a corrida via createPendingPillar.
// Retorna true se o pilar existe/foi criado, false em falha.
export async function getOrCreatePendingPillar(data: {
  pillarName:      string;
  durationMinutes: number;
  note:            string;
}): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const id = await createPendingPillar(supabase, user.id, data.pillarName, {
    durationMinutes: data.durationMinutes,
    note:            data.note,
    detectedAt:      new Date().toISOString(),
  });

  return !!id;
}
