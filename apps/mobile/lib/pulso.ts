// Pulso do dia — entrada ultra-leve sem duração (PRD §1b, Camada de input 1)

import { supabase } from './supabase';

const OLLAMA_URL   = process.env.EXPO_PUBLIC_OLLAMA_URL   ?? 'http://100.68.239.78:11434';
const OLLAMA_MODEL = process.env.EXPO_PUBLIC_OLLAMA_MODEL ?? 'qwen2.5:14b';

export async function logPulso(
  text: string,
  userId: string,
  pillars: Array<{ id: string; name: string }>,
): Promise<{ pillarName: string; recordId: string }> {
  if (!text.trim()) throw new Error('Texto vazio');
  if (pillars.length === 0) throw new Error('Nenhum pilar ativo');

  // Classifica o texto em um pilar via Ollama (rápido, temperature=0.1)
  let pillarId   = pillars[0]!.id;
  let pillarName = pillars[0]!.name;

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  controller.signal,
        body: JSON.stringify({
          model:   OLLAMA_MODEL,
          prompt:  `Classifique o texto abaixo em exatamente um pilar de vida.\n\nPilares disponíveis: ${pillars.map(p => p.name).join(', ')}\n\nTexto: "${text.replace(/"/g, "'").slice(0, 200)}"\n\nRetorne APENAS o nome de um pilar da lista, sem explicação.`,
          stream:  false,
          options: { temperature: 0.1 },
        }),
      });
      if (res.ok) {
        const body  = await res.json() as { response: string };
        const raw   = body.response.trim();
        const match = pillars.find(p => raw.toLowerCase().includes(p.name.toLowerCase()));
        if (match) { pillarId = match.id; pillarName = match.name; }
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Usa o primeiro pilar como fallback
  }

  const activityDate = new Date().toISOString().slice(0, 10);
  const { data: record, error } = await supabase
    .from('xp_records')
    .insert({
      user_id:          userId,
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
