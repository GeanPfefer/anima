import { createClient } from '@/lib/supabase/server';
import { calculateBonusMultiplier } from '@anima/core';
import type { ActivityBonusType } from '@anima/types';

export async function getActivityBonuses(
  pillarId: string,
  activityDate: string,
): Promise<ActivityBonusType[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const bonuses: ActivityBonusType[] = [];
  const target     = new Date(activityDate + 'T12:00:00');
  const minus5Days = new Date(target.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const minus7Days = new Date(target.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { count: sameDayCount } = await supabase
    .from('xp_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('activity_date', activityDate);

  if ((sameDayCount ?? 0) === 0) bonuses.push('first_of_day');

  const { count: recentCount } = await supabase
    .from('xp_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('pillar_id', pillarId)
    .gte('activity_date', minus5Days)
    .lt('activity_date', activityDate);

  if ((recentCount ?? 0) === 0) bonuses.push('forgotten_pillar');

  const { data: streakRecords } = await supabase
    .from('xp_records')
    .select('activity_date')
    .eq('user_id', user.id)
    .eq('pillar_id', pillarId)
    .gte('activity_date', minus7Days)
    .lt('activity_date', activityDate);

  const daysWithRecords = new Set((streakRecords ?? []).map(r => r.activity_date));
  let hasStreak = true;
  for (let i = 1; i <= 6; i++) {
    const d = new Date(target.getFullYear(), target.getMonth(), target.getDate() - i);
    if (!daysWithRecords.has(d.toISOString().slice(0, 10))) { hasStreak = false; break; }
  }
  if (hasStreak) bonuses.push('active_streak');

  const { count: activeQuestCount } = await supabase
    .from('quests')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('pillar_id', pillarId)
    .in('status', ['open', 'in_progress']);

  if ((activeQuestCount ?? 0) > 0) bonuses.push('active_quest');

  return bonuses;
}

export async function logActivity(data: {
  pillarId: string;
  durationMinutes: number;
  note: string;
  activityDate?: string;
  questId?: string;
}): Promise<{ totalXP: number; bonuses: ActivityBonusType[]; recordId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Não autenticado');

  const { data: pillar } = await supabase
    .from('user_pillars')
    .select('xp_rate')
    .eq('id', data.pillarId)
    .eq('user_id', user.id)
    .single();

  if (!pillar) throw new Error('Pilar não encontrado');

  const activityDate    = data.activityDate ?? new Date().toISOString().slice(0, 10);
  const bonuses         = await getActivityBonuses(data.pillarId, activityDate);
  const baseXP          = Math.round(data.durationMinutes * pillar.xp_rate);
  const bonusMultiplier = calculateBonusMultiplier(bonuses);
  const totalXP         = Math.round(baseXP * bonusMultiplier);

  const { data: record, error } = await supabase
    .from('xp_records')
    .insert({
      user_id:          user.id,
      pillar_id:        data.pillarId,
      quest_id:         data.questId ?? null,
      duration_minutes: data.durationMinutes,
      base_xp:          baseXP,
      bonus_multiplier: bonusMultiplier,
      total_xp:         totalXP,
      bonuses,
      note:             data.note || null,
      activity_date:    activityDate,
    })
    .select('id')
    .single();

  if (error || !record) throw new Error(error?.message ?? 'Erro ao inserir registro');

  return { totalXP, bonuses, recordId: record.id };
}
