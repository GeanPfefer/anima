import { supabase } from './supabase';
import { calculateBonusMultiplier } from '@anima/core';
import type { ActivityBonusType } from '@anima/types';

/**
 * Detecta automaticamente quais bônus se aplicam ao registrar uma atividade.
 * Replica a lógica do Server Action do web (apps/web/app/(app)/home/actions.ts).
 */
export async function getActivityBonuses(
  pillarId: string,
  userId: string,
): Promise<ActivityBonusType[]> {
  const bonuses: ActivityBonusType[] = [];
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).toISOString();

  // first_of_day: nenhum registro hoje (qualquer pilar)
  const { count: todayCount } = await supabase
    .from('xp_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', todayStart);
  if ((todayCount ?? 0) === 0) bonuses.push('first_of_day');

  // forgotten_pillar: nenhum registro neste pilar nos últimos 5 dias
  const fiveDaysAgo = new Date(
    now.getTime() - 5 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { count: recentCount } = await supabase
    .from('xp_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('pillar_id', pillarId)
    .gte('created_at', fiveDaysAgo);
  if ((recentCount ?? 0) === 0) bonuses.push('forgotten_pillar');

  // active_streak: registro nos 6 dias anteriores = 7º dia consecutivo
  const sevenDaysAgo = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: streakRecords } = await supabase
    .from('xp_records')
    .select('created_at')
    .eq('user_id', userId)
    .eq('pillar_id', pillarId)
    .gte('created_at', sevenDaysAgo)
    .lt('created_at', todayStart);

  const daysWithRecords = new Set(
    (streakRecords ?? []).map((r) => r.created_at.slice(0, 10)),
  );
  let hasStreak = true;
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const dayStr = d.toISOString().slice(0, 10);
    if (!daysWithRecords.has(dayStr)) {
      hasStreak = false;
      break;
    }
  }
  if (hasStreak) bonuses.push('active_streak');

  // active_quest: existe quest open/in_progress vinculada a este pilar
  const { count: activeQuestCount } = await supabase
    .from('quests')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('pillar_id', pillarId)
    .in('status', ['open', 'in_progress']);
  if ((activeQuestCount ?? 0) > 0) bonuses.push('active_quest');

  return bonuses;
}

export async function logActivity(data: {
  userId: string;
  pillarId: string;
  durationMinutes: number;
  note: string;
  questId?: string;
}): Promise<{ totalXP: number; bonuses: ActivityBonusType[] }> {
  const { data: pillar } = await supabase
    .from('user_pillars')
    .select('xp_rate')
    .eq('id', data.pillarId)
    .eq('user_id', data.userId)
    .single();

  if (!pillar) throw new Error('Pilar não encontrado');

  // Recalcula bônus no save — evita race condition entre preview e submit
  const bonuses = await getActivityBonuses(data.pillarId, data.userId);
  const baseXP = Math.round(data.durationMinutes * pillar.xp_rate);
  const bonusMultiplier = calculateBonusMultiplier(bonuses);
  const totalXP = Math.round(baseXP * bonusMultiplier);

  const { error } = await supabase.from('xp_records').insert({
    user_id: data.userId,
    pillar_id: data.pillarId,
    quest_id: data.questId ?? null,
    duration_minutes: data.durationMinutes,
    base_xp: baseXP,
    bonus_multiplier: bonusMultiplier,
    total_xp: totalXP,
    bonuses,
    note: data.note?.trim() || null,
  });

  if (error) throw new Error(error.message);
  return { totalXP, bonuses };
}

/**
 * Registra múltiplas atividades em sequência.
 * Roda em série — não em paralelo — para que os bônus (first_of_day, etc.)
 * sejam recalculados corretamente a cada registro.
 */
export async function logMultipleActivities(
  entries: Array<{
    userId: string;
    pillarId: string;
    durationMinutes: number;
    note: string;
    questId?: string;
  }>,
): Promise<{ totalXP: number; count: number }> {
  let totalXP = 0;
  for (const entry of entries) {
    const { totalXP: xp } = await logActivity(entry);
    totalXP += xp;
  }
  return { totalXP, count: entries.length };
}
