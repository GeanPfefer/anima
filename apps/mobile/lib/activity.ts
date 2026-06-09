import { supabase } from './supabase';
import { calculateBonusMultiplier } from '@anima/core';
import type { ActivityBonusType } from '@anima/types';

/**
 * Retorna o id do pilar com esse nome para o usuário,
 * criando-o se ainda não existir.
 * Busca case-insensitive — evita duplicatas de capitalização.
 */
export async function getOrCreatePillar(
  userId: string,
  name: string,
): Promise<{ id: string; name: string; xp_rate: number; isNew: boolean }> {
  const normalized = name.trim();

  const { data: existing } = await supabase
    .from('user_pillars')
    .select('id, name, xp_rate')
    .eq('user_id', userId)
    .ilike('name', normalized)
    .maybeSingle();

  if (existing) return { ...existing, isNew: false };

  // Obtém sort_order para o novo pilar
  const { count } = await supabase
    .from('user_pillars')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  const { data: created, error } = await supabase
    .from('user_pillars')
    .insert({
      user_id:    userId,
      catalog_id: null,
      name:       normalized,
      xp_rate:    1.0,
      sort_order: count ?? 10,
    })
    .select('id, name, xp_rate')
    .single();

  if (error || !created) throw new Error(`Não foi possível criar pilar "${normalized}": ${error?.message}`);

  return { ...created, isNew: true };
}

/**
 * Detecta automaticamente quais bônus se aplicam ao registrar uma atividade.
 * Bônus são calculados relativos a activityDate, não a created_at
 * (PRD §1b: backfill com data passada).
 */
export async function getActivityBonuses(
  pillarId: string,
  userId: string,
  activityDate?: string, // YYYY-MM-DD; padrão: hoje
): Promise<ActivityBonusType[]> {
  const bonuses: ActivityBonusType[] = [];

  const targetDate = activityDate ?? new Date().toISOString().slice(0, 10);
  const target     = new Date(targetDate + 'T12:00:00');
  const minus5Days = new Date(target.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const minus7Days = new Date(target.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // first_of_day: nenhum registro com activity_date = targetDate
  const { count: sameDayCount } = await supabase
    .from('xp_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('activity_date', targetDate);
  if ((sameDayCount ?? 0) === 0) bonuses.push('first_of_day');

  // forgotten_pillar: nenhum registro neste pilar nos 5 dias antes da targetDate
  const { count: recentCount } = await supabase
    .from('xp_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('pillar_id', pillarId)
    .gte('activity_date', minus5Days)
    .lt('activity_date', targetDate);
  if ((recentCount ?? 0) === 0) bonuses.push('forgotten_pillar');

  // active_streak: registro nos 6 dias anteriores = 7º dia consecutivo
  const { data: streakRecords } = await supabase
    .from('xp_records')
    .select('activity_date')
    .eq('user_id', userId)
    .eq('pillar_id', pillarId)
    .gte('activity_date', minus7Days)
    .lt('activity_date', targetDate);

  const daysWithRecords = new Set(
    (streakRecords ?? []).map((r) => r.activity_date),
  );
  let hasStreak = true;
  for (let i = 1; i <= 6; i++) {
    const d = new Date(target.getFullYear(), target.getMonth(), target.getDate() - i);
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
  activityDate?: string; // YYYY-MM-DD; padrão: hoje
  questId?: string;
}): Promise<{ totalXP: number; bonuses: ActivityBonusType[]; recordId: string }> {
  const { data: pillar } = await supabase
    .from('user_pillars')
    .select('xp_rate')
    .eq('id', data.pillarId)
    .eq('user_id', data.userId)
    .single();

  if (!pillar) throw new Error('Pilar não encontrado');

  const activityDate = data.activityDate ?? new Date().toISOString().slice(0, 10);

  // Recalcula bônus no save com a data correta
  const bonuses = await getActivityBonuses(data.pillarId, data.userId, activityDate);
  const baseXP = Math.round(data.durationMinutes * pillar.xp_rate);
  const bonusMultiplier = calculateBonusMultiplier(bonuses);
  const totalXP = Math.round(baseXP * bonusMultiplier);

  const { data: record, error } = await supabase
    .from('xp_records')
    .insert({
      user_id:          data.userId,
      pillar_id:        data.pillarId,
      quest_id:         data.questId ?? null,
      duration_minutes: data.durationMinutes,
      base_xp:          baseXP,
      bonus_multiplier: bonusMultiplier,
      total_xp:         totalXP,
      bonuses,
      note:             data.note?.trim() || null,
      activity_date:    activityDate,
    })
    .select('id')
    .single();

  if (error || !record) throw new Error(error?.message ?? 'Erro ao inserir registro');
  return { totalXP, bonuses, recordId: record.id };
}

/**
 * Registra múltiplas atividades em sequência.
 * Série (não paralelo) para que os bônus sejam recalculados corretamente.
 */
export async function logMultipleActivities(
  entries: Array<{
    userId: string;
    pillarId: string;
    durationMinutes: number;
    note: string;
    activityDate?: string;
    questId?: string;
  }>,
): Promise<{ totalXP: number; count: number; entries: Array<{ recordId: string; note: string }> }> {
  let totalXP = 0;
  const logged: Array<{ recordId: string; note: string }> = [];
  for (const entry of entries) {
    const { totalXP: xp, recordId } = await logActivity(entry);
    totalXP += xp;
    logged.push({ recordId, note: entry.note });
  }
  return { totalXP, count: entries.length, entries: logged };
}
