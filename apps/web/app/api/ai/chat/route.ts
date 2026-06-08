import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { generateEmbedding } from '@/lib/generate-embedding';

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Não autorizado', { status: 401 });

  const { message } = await req.json() as { message: string };
  if (!message?.trim()) return new Response('Mensagem vazia', { status: 400 });

  // ── Contexto do usuário ────────────────────────────────────────
  const [profileRes, pillarsRes, recentRes, questsRes, entitiesRes] = await Promise.all([
    supabase.from('profiles').select('name, archetype').eq('id', user.id).single(),
    supabase.from('user_pillars').select('name, xp_total, level, xp_rate, context').eq('user_id', user.id).eq('is_active', true).order('level', { ascending: false }),
    supabase.from('xp_records').select('note, total_xp, duration_minutes, activity_date, user_pillars(name)').eq('user_id', user.id).order('activity_date', { ascending: false }).order('created_at', { ascending: false }).limit(10),
    supabase.from('quests').select('title, type, status, pillar_id, user_pillars(name)').eq('user_id', user.id).in('status', ['open', 'in_progress']).limit(5),
    supabase.from('semantic_entities').select('name, entity_type, context, occurrence_count').eq('user_id', user.id).order('occurrence_count', { ascending: false }).limit(20),
  ]);

  const name      = profileRes.data?.name ?? 'usuário';
  const archetype = profileRes.data?.archetype as Record<string, number> | null;
  const pillars   = pillarsRes.data   ?? [];
  const recent    = recentRes.data    ?? [];
  const quests    = questsRes.data    ?? [];
  const entities  = entitiesRes.data  ?? [];

  const charLevel = pillars.length > 0
    ? Math.round(pillars.reduce((s, p) => s + p.level, 0) / pillars.length)
    : 1;

  const pillarsText = pillars.map(p => {
    const ctx = p.context as Record<string, string> | null;
    const ctxText = ctx
      ? '\n    Contexto: ' + Object.values(ctx).filter(Boolean).join(' | ')
      : '';
    return `  • ${p.name}: Nível ${p.level} | ${p.xp_total} XP total${ctxText}`;
  }).join('\n');

  const recentText = recent.length > 0
    ? recent.map(r => {
        const up = r.user_pillars as { name: string } | { name: string }[] | null;
        const pillarName = (Array.isArray(up) ? up[0]?.name : up?.name) ?? '?';
        const ad = (r as unknown as { activity_date?: string }).activity_date;
        const date = ad ? new Date(ad + 'T12:00:00').toLocaleDateString('pt-BR') : '?';
        return `  • [${date}] ${pillarName} — ${r.duration_minutes}min → ${r.total_xp} XP${r.note ? ` ("${r.note}")` : ''}`;
      }).join('\n')
    : '  (sem registros recentes)';

  const entitiesText = entities.length > 0
    ? entities.map(e => {
        const ctx = e.context ? ` — ${e.context}` : '';
        return `  • ${e.name} [${e.entity_type}]${ctx} (${e.occurrence_count}x)`;
      }).join('\n')
    : '';

  const questsText = quests.length > 0
    ? quests.map(q => {
        const up = q.user_pillars as { name: string } | { name: string }[] | null;
        const pillarName = (Array.isArray(up) ? up[0]?.name : up?.name) ?? '?';
        return `  • ${q.title} [${q.type}] — ${pillarName} (${q.status})`;
      }).join('\n')
    : '  (sem quests ativas)';

  // ── Retrieval contextual: busca entradas semanticamente similares à mensagem
  let retrievalText = '';
  try {
    const queryEmbedding = await generateEmbedding(message);
    if (queryEmbedding) {
      const vectorStr = `[${queryEmbedding.join(',')}]`;
      const { data: similar } = await supabase.rpc('match_entries', {
        query_embedding: vectorStr,
        match_threshold: 0.55,
        match_count:     4,
      });
      if (similar && similar.length > 0) {
        retrievalText = '\nMemórias relevantes para esta conversa:\n' +
          (similar as Array<{ note: string; activity_date: string; pillar_name: string; similarity: number }>)
            .map(s => {
              const date = new Date(s.activity_date + 'T12:00:00').toLocaleDateString('pt-BR');
              return `  • [${date}] ${s.pillar_name}: "${s.note}"`;
            })
            .join('\n');
      }
    }
  } catch {
    // Retrieval falhou (embedding ou DB) — continua sem ele
  }

  const archetypeMap: Record<string, string> = {
    explorer:  'Explorador: muda de interesse com facilidade, se motiva por novidade. Nunca pressione consistência ou streak. Sugira experimentar coisas novas.',
    focused:   'Focado: prefere ir fundo em poucos pilares de cada vez. Valorize conclusões e profundidade. Sugira 1-2 áreas prioritárias.',
    builder:   'Construtor: motivado por consistência e progresso gradual. Valorize regularidade, hábitos e sequências.',
    visionary: 'Visionário: pensa em objetivos grandes e longo prazo. Conecte ações à visão de futuro. Sugira quests de longo prazo.',
  };

  const archetypeText = archetype
    ? '\nPerfil de personalidade:\n' + Object.entries(archetype)
        .sort((a, b) => b[1] - a[1])
        .map(([id, pct]) => `  ${archetypeMap[id] ?? id} (${pct}%)`)
        .join('\n')
    : '';

  const systemPrompt = `Você é o Anima, o assistente pessoal de ${name}.
Você conhece a vida do usuário através dos pilares, histórico de atividades e memória semântica.
Seja direto, honesto e útil. Fale em português. Não seja excessivamente animado ou use muitos emojis.
Quando perceber padrões ou desequilíbrios, aponte com naturalidade.
${archetypeText}

Formatação:
- Use markdown diretamente: **negrito**, listas com -, títulos com ##
- NUNCA envolva sua resposta em blocos de código (\`\`\`). Blocos de código só para exemplos de código real.
- Respostas curtas e diretas quando a pergunta for simples.

== PERFIL DE ${name.toUpperCase()} ==
Nível geral do personagem: ${charLevel}

Pilares ativos:
${pillarsText}

Últimas atividades registradas:
${recentText}

Quests em andamento:
${questsText}
${entitiesText ? `\nEntidades conhecidas do usuário (memória semântica):\n${entitiesText}` : ''}${retrievalText}
== FIM DO PERFIL ==

Responda à mensagem do usuário levando em conta o contexto acima quando relevante.`;

  // ── Histórico recente de conversa (últimas 10 mensagens) ───────
  const { data: history } = await supabase
    .from('ai_conversations')
    .select('role, content')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const pastMessages = (history ?? []).reverse().map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // ── Salva mensagem do usuário ──────────────────────────────────
  await supabase.from('ai_conversations').insert({ user_id: user.id, role: 'user', content: message });

  // ── Chama Ollama (streaming) ───────────────────────────────────
  const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...pastMessages,
        { role: 'user', content: message },
      ],
    }),
  }).catch(() => null);

  if (!ollamaRes?.ok) {
    return new Response(
      JSON.stringify({ error: 'Não foi possível conectar ao Ollama. Verifique se ele está rodando na Goma.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Stream de volta para o cliente + coleta resposta completa ──
  let fullResponse = '';
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = ollamaRes.body!.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n').filter(Boolean)) {
            try {
              const json = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
              const token = json.message?.content ?? '';
              if (token) {
                fullResponse += token;
                controller.enqueue(encoder.encode(token));
              }
              if (json.done) {
                // Salva resposta completa no histórico
                await supabase.from('ai_conversations').insert({
                  user_id: user.id,
                  role: 'assistant',
                  content: fullResponse,
                });
              }
            } catch {
              // linha não é JSON válido, ignora
            }
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  });
}
