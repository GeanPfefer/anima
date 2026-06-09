'use server';

import { createClient } from '@/lib/supabase/server';
import { getActivityBonuses, logActivity } from '@/lib/log-activity';
import type { ActivityBonusType } from '@anima/types';

// Re-exporta para uso nos componentes client
export { getActivityBonuses, logActivity };

// ─── Pulso do dia ──────────────────────────────────────────────────────────────

export async function logPulso(
  text: string,
): Promise<{ pillarName: string; recordId: string }> {
  if (!text.trim()) throw new Error('Texto vazio');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Não autenticado');

  const { data: pillarsData } = await supabase
    .from('user_pillars')
    .select('id, name')
    .eq('user_id', user.id)
    .eq('is_active', true);

  const pillars = pillarsData ?? [];
  if (pillars.length === 0) throw new Error('Nenhum pilar ativo');

  const ollamaUrl   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
  const ollamaModel = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

  let pillarId   = pillars[0]!.id;
  let pillarName = pillars[0]!.name;

  try {
    const prompt = `Classifique o texto abaixo em exatamente um pilar de vida.

Pilares disponíveis: ${pillars.map(p => p.name).join(', ')}

Texto: "${text.replace(/"/g, "'").slice(0, 200)}"

Retorne APENAS o nome de um pilar da lista, sem explicação.`;

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${ollamaUrl}/api/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  controller.signal,
        body: JSON.stringify({ model: ollamaModel, prompt, stream: false, options: { temperature: 0.1 } }),
      });
      if (res.ok) {
        const body  = await res.json() as { response: string };
        const match = pillars.find(p => body.response.trim().toLowerCase().includes(p.name.toLowerCase()));
        if (match) { pillarId = match.id; pillarName = match.name; }
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // fallback: primeiro pilar
  }

  const activityDate = new Date().toISOString().slice(0, 10);
  const { data: record, error } = await supabase
    .from('xp_records')
    .insert({
      user_id:          user.id,
      pillar_id:        pillarId,
      duration_minutes: 0,
      base_xp:          0,
      bonus_multiplier: 1.00,
      total_xp:         0,
      bonuses:          [],
      note:             text.trim().slice(0, 500),
      activity_date:    activityDate,
    })
    .select('id')
    .single();

  if (error || !record) throw new Error(error?.message ?? 'Erro ao salvar pulso');

  return { pillarName, recordId: record.id };
}

// ─── Parsing e log em lote (usado pelo modal) ──────────────────────────────────

export type ParsedActivity = {
  pillarName: string;
  durationMinutes: number;
  note: string;
};

export async function parseActivities(
  text: string,
  pillarNames: string[],
): Promise<ParsedActivity[]> {
  const ollamaUrl   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
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
      body: JSON.stringify({ model: ollamaModel, prompt, stream: false, format: 'json', options: { temperature: 0.1 } }),
    });

    if (!res.ok) throw new Error(`Ollama retornou HTTP ${res.status}`);

    const body = await res.json() as { response: string };

    let activities: ParsedActivity[];
    try {
      const parsed = JSON.parse(body.response);
      activities = Array.isArray(parsed) ? parsed : (parsed?.activities ?? parsed?.data ?? parsed?.entries ?? []);
    } catch {
      const match = body.response.match(/\[[\s\S]*?\]/);
      if (!match) throw new Error('IA não retornou JSON válido');
      activities = JSON.parse(match[0]);
    }

    return activities.filter(
      (a): a is ParsedActivity => typeof a.pillarName === 'string' && a.pillarName.trim().length > 0,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function logMultipleActivities(
  activities: Array<{ pillarId: string; durationMinutes: number; note: string; activityDate?: string }>,
): Promise<{ totalXP: number; count: number; entries: Array<{ recordId: string; note: string }> }> {
  const entries: Array<{ recordId: string; note: string }> = [];
  let totalXP = 0;
  for (const a of activities) {
    const result = await logActivity(a);
    totalXP += result.totalXP;
    entries.push({ recordId: result.recordId, note: a.note });
  }
  return { totalXP, count: activities.length, entries };
}
