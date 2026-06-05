'use server';

import { createClient } from '@/lib/supabase/server';
import { calculateBonusMultiplier } from '@anima/core';
import type { ActivityBonusType } from '@anima/types';

export type ParsedActivity = {
  pillarName: string;
  durationMinutes: number;
  note: string;
};

export async function parseActivities(
  text: string,
  pillarNames: string[],
): Promise<ParsedActivity[]> {
  const ollamaUrl   = process.env.OLLAMA_URL   ?? 'http://100.68.239.78:11434';
  const ollamaModel = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

  const prompt = `Você extrai atividades de vida de textos escritos naturalmente.

Pilares disponíveis (escolha sempre um deles): ${pillarNames.join(', ')}

Para cada atividade identificada, crie um objeto com:
- "pillarName": nome exato do pilar da lista acima
- "durationMinutes": duração em minutos como número inteiro (0 se não mencionada)
- "note": resumo curto do que foi feito, máx 80 caracteres

Conversões de tempo: "1h"=60, "meia hora"=30, "2h30"=150, "45min"=45, "uma hora"=60
Se uma atividade cobre dois pilares diferentes, crie dois objetos.
Se a duração não for mencionada, use 0.

Texto do usuário: "${text.replace(/"/g, "'").replace(/\n/g, ' ')}"

Retorne APENAS um array JSON válido, sem texto adicional.`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:   ollamaModel,
        prompt,
        stream:  false,
        format:  'json',
        options: { temperature: 0.1 },
      }),
    });

    if (!res.ok) throw new Error(`Ollama retornou HTTP ${res.status}`);

    const body = await res.json() as { response: string };

    let activities: ParsedActivity[];
    try {
      const parsed = JSON.parse(body.response);
      if (Array.isArray(parsed)) {
        activities = parsed;
      } else {
        const inner = parsed?.activities ?? parsed?.data ?? parsed?.entries;
        activities = Array.isArray(inner) ? inner : [];
      }
    } catch {
      const match = body.response.match(/\[[\s\S]*?\]/);
      if (!match) throw new Error('IA não retornou JSON válido');
      activities = JSON.parse(match[0]);
    }

    return activities.filter(
      (a): a is ParsedActivity =>
        typeof a.pillarName === 'string' && a.pillarName.trim().length > 0,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function logMultipleActivities(
  activities: Array<{ pillarId: string; durationMinutes: number; note: string }>,
): Promise<{ totalXP: number; count: number }> {
  let totalXP = 0;
  for (const a of activities) {
    const result = await logActivity(a);
    totalXP += result.totalXP;
  }
  return { totalXP, count: activities.length };
}

export async function getActivityBonuses(pillarId: string): Promise<ActivityBonusType[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const bonuses: ActivityBonusType[] = [];
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  // first_of_day: nenhum registro hoje (qualquer pilar)
  const { count: todayCount } = await supabase
    .from('xp_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', todayStart);

  if ((todayCount ?? 0) === 0) bonuses.push('first_of_day');

  // forgotten_pillar: nenhum registro neste pilar nos últimos 5 dias
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from('xp_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('pillar_id', pillarId)
    .gte('created_at', fiveDaysAgo);

  if ((recentCount ?? 0) === 0) bonuses.push('forgotten_pillar');

  // active_streak: registro neste pilar em cada um dos 6 dias anteriores (7º dia consecutivo)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: streakRecords } = await supabase
    .from('xp_records')
    .select('created_at')
    .eq('user_id', user.id)
    .eq('pillar_id', pillarId)
    .gte('created_at', sevenDaysAgo)
    .lt('created_at', todayStart);

  const daysWithRecords = new Set(
    (streakRecords ?? []).map(r => r.created_at.slice(0, 10))
  );

  let hasStreak = true;
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const dayStr = d.toISOString().slice(0, 10);
    if (!daysWithRecords.has(dayStr)) { hasStreak = false; break; }
  }
  if (hasStreak) bonuses.push('active_streak');

  return bonuses;
}

export async function logActivity(data: {
  pillarId: string;
  durationMinutes: number;
  note: string;
}): Promise<{ totalXP: number; bonuses: ActivityBonusType[] }> {
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

  const bonuses = await getActivityBonuses(data.pillarId);
  const baseXP = Math.round(data.durationMinutes * pillar.xp_rate);
  const bonusMultiplier = calculateBonusMultiplier(bonuses);
  const totalXP = Math.round(baseXP * bonusMultiplier);

  const { error } = await supabase.from('xp_records').insert({
    user_id: user.id,
    pillar_id: data.pillarId,
    duration_minutes: data.durationMinutes,
    base_xp: baseXP,
    bonus_multiplier: bonusMultiplier,
    total_xp: totalXP,
    bonuses,
    note: data.note || null,
  });

  if (error) throw new Error(error.message);

  return { totalXP, bonuses };
}
