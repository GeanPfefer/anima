// Camada 4 — geração de insights automáticos
// Critérios (PRD §1d): raros, específicos, contextualizados, honestos.
// Sem coaching, sem motivação artificial, sem frases genéricas.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

// Mínimo de dias sem insight antes de gerar outro
const MIN_DAYS_BETWEEN_INSIGHTS = 3;
// Mínimo de novas entradas desde o último insight para valer a pena
const MIN_NEW_ENTRIES = 5;

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Não autorizado', { status: 401 });

  // Verifica se já existe insight recente
  const { data: latestInsight } = await supabase
    .from('insights')
    .select('id, generated_at')
    .eq('user_id', user.id)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestInsight) {
    const daysSince = (Date.now() - new Date(latestInsight.generated_at).getTime()) / 86400_000;
    if (daysSince < MIN_DAYS_BETWEEN_INSIGHTS) {
      return Response.json({ skipped: true, reason: 'recente' });
    }
  }

  // Conta novas entradas desde o último insight
  const since = latestInsight?.generated_at ?? new Date(0).toISOString();
  const { count: newEntries } = await supabase
    .from('xp_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gt('created_at', since);

  if ((newEntries ?? 0) < MIN_NEW_ENTRIES) {
    return Response.json({ skipped: true, reason: 'poucos_dados' });
  }

  // ── Coleta dados dos últimos 30 dias para o insight ───────────────────────
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const [pillarsRes, recordsRes, entitiesRes] = await Promise.all([
    supabase
      .from('user_pillars')
      .select('id, name')
      .eq('user_id', user.id)
      .eq('is_active', true),
    supabase
      .from('xp_records')
      .select('pillar_id, duration_minutes, total_xp, note, activity_date, bonuses')
      .eq('user_id', user.id)
      .gte('activity_date', thirtyDaysAgo)
      .order('activity_date', { ascending: false })
      .limit(100),
    supabase
      .from('semantic_entities')
      .select('name, entity_type, context, occurrence_count')
      .eq('user_id', user.id)
      .order('occurrence_count', { ascending: false })
      .limit(15),
  ]);

  const pillarNames = new Map((pillarsRes.data ?? []).map(p => [p.id, p.name]));
  const records     = recordsRes.data  ?? [];
  const entities    = entitiesRes.data ?? [];

  if (records.length < MIN_NEW_ENTRIES) {
    return Response.json({ skipped: true, reason: 'poucos_dados' });
  }

  // ── Prepara estatísticas por pilar ───────────────────────────────────────
  const pillarStats = new Map<string, { count: number; mins: number; days: Set<string> }>();
  for (const r of records) {
    const name = pillarNames.get(r.pillar_id) ?? r.pillar_id;
    const s = pillarStats.get(name) ?? { count: 0, mins: 0, days: new Set() };
    s.count++;
    s.mins += r.duration_minutes;
    s.days.add(r.activity_date);
    pillarStats.set(name, s);
  }

  const pillarStatsText = Array.from(pillarStats.entries())
    .sort((a, b) => b[1].mins - a[1].mins)
    .map(([name, s]) => {
      const h = Math.floor(s.mins / 60);
      const m = s.mins % 60;
      const durStr = h > 0 ? `${h}h${m > 0 ? `${m}min` : ''}` : `${m}min`;
      return `  • ${name}: ${s.count} entradas · ${durStr} · ${s.days.size} dias distintos`;
    }).join('\n');

  // ── Padrões por dia da semana ───────────────────────────────────────────
  const weekdayCount: number[] = new Array(7).fill(0);
  const weekdayNames = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  for (const r of records) {
    const day = new Date(r.activity_date + 'T12:00:00').getDay();
    weekdayCount[day as number]!++;
  }
  const weekdayText = weekdayNames
    .map((d, i) => `${d}:${weekdayCount[i]}`)
    .join(' ');

  // ── Últimas notas (para insights qualitativos) ─────────────────────────
  const notesText = records
    .filter(r => r.note)
    .slice(0, 12)
    .map(r => `  [${r.activity_date}] ${pillarNames.get(r.pillar_id) ?? '?'}: "${r.note}"`)
    .join('\n');

  const entitiesText = entities.length > 0
    ? entities.map(e => `  ${e.name} [${e.entity_type}]${e.context ? ': ' + e.context : ''} (${e.occurrence_count}x)`).join('\n')
    : '  (sem entidades registradas ainda)';

  // ── Prompt cuidadosamente projetado para insights de qualidade ────────
  const profileRes = await supabase.from('profiles').select('name').eq('id', user.id).single();
  const name = profileRes.data?.name ?? 'usuário';

  const prompt = `Você é um observador analítico dos dados de vida de ${name} nos últimos 30 dias.

== DADOS ==
Atividade por pilar:
${pillarStatsText || '  (sem dados)'}

Frequência por dia da semana (${records.length} entradas total):
${weekdayText}

Últimas notas registradas:
${notesText || '  (sem notas)'}

Entidades recorrentes na escrita:
${entitiesText}

== TAREFA ==
Identifique UM padrão objetivo, específico e interessante nesses dados.

REGRAS RÍGIDAS (violá-las invalida o insight):
1. Mencione números reais dos dados acima (dias, horas, percentuais, frequências)
2. Observação factual — proibido conselho, sugestão, elogio, motivação
3. Proibido qualquer variação de: "continue assim", "parabéns", "você está indo bem", "que tal", "é importante", "tente", "lembre-se"
4. A frase deve ser impossível de aplicar a outra pessoa sem mudar os dados concretos
5. Máximo 2 frases. Pode ser 1.
6. Se não houver padrão claro, retorne null

Bons exemplos:
- "Nas últimas 3 semanas, 11 das 14 entradas de Saúde foram registradas no fim de semana."
- "O Anima concentra 67% do tempo de Trabalho registrado, com sessões médias de 95min."
- "Nas últimas 4 semanas não houve nenhum registro de Mente, mas Trabalho teve 18 entradas."

Retorne APENAS JSON válido: {"text": "insight aqui"} ou {"text": null}`;

  // ── Chama Ollama ──────────────────────────────────────────────────────
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 45_000);

  try {
    const ollamaRes = await fetch(`${OLLAMA_URL}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:   OLLAMA_MODEL,
        prompt,
        stream:  false,
        format:  'json',
        options: { temperature: 0.3 },
      }),
    });

    if (!ollamaRes.ok) return Response.json({ skipped: true, reason: 'ollama_error' });

    const body = await ollamaRes.json() as { response: string };
    const parsed = JSON.parse(body.response) as { text?: string | null };
    const insightText = parsed?.text?.trim();

    if (!insightText) {
      return Response.json({ skipped: true, reason: 'sem_padrao' });
    }

    // Salva o insight
    const { data: saved } = await supabase
      .from('insights')
      .insert({ user_id: user.id, text: insightText })
      .select('id, text, generated_at')
      .single();

    return Response.json({ insight: saved });

  } catch {
    return Response.json({ skipped: true, reason: 'erro' });
  } finally {
    clearTimeout(timeout);
  }
}
