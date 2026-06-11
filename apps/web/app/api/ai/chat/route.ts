import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { generateEmbedding } from '@/lib/generate-embedding';
import { detectActivities } from '@/lib/detect-activity';
import { detectNotes } from '@/lib/detect-note';
import { logActivity } from '@/lib/log-activity';
import { logNote } from '@/lib/log-note';
import { getOrCreatePendingPillar } from '@/lib/get-or-create-pending-pillar';
import { inferAndSaveArchetype } from '@/lib/infer-archetype';

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

type LoggedActivity = {
  pillar: string;
  durationMinutes: number;
  totalXP: number;
  note: string;
};

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
    supabase.from('user_pillars').select('id, name, xp_total, level, xp_rate, context').eq('user_id', user.id).eq('is_active', true).order('level', { ascending: false }),
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

  const pillarNames = pillars.map(p => p.name);

  // ── Detecção de atividades + notas + embedding em paralelo ───────
  const today = new Date().toISOString().slice(0, 10);
  const [detectedActivities, detectedNotes, queryEmbedding] = await Promise.all([
    detectActivities(message, pillarNames, today),
    detectNotes(message, today),
    generateEmbedding(message),
  ]);

  // ── Loga atividades detectadas ─────────────────────────────────
  const loggedActivities: LoggedActivity[] = [];

  for (const da of detectedActivities) {
    // Só registra se o pilar bater exatamente — evita jogar atividade no pilar errado
    const pillar = pillars.find(p => norm(p.name) === norm(da.pillarName));
    if (!pillar) {
      // Pilar não existe: cria como pendente para o usuário confirmar no dashboard
      getOrCreatePendingPillar({
        pillarName:      da.pillarName,
        durationMinutes: da.durationMinutes,
        note:            da.note,
      }).catch(() => {});
      continue;
    }

    try {
      const result = await logActivity({
        pillarId:        pillar.id,
        durationMinutes: da.durationMinutes,
        note:            da.note,
        activityDate:    da.activityDate,
      });
      loggedActivities.push({
        pillar:          pillar.name,
        durationMinutes: da.durationMinutes,
        totalXP:         result.totalXP,
        note:            da.note,
      });

      // Embedding + extração de entidades — fire-and-forget
      if (da.note) {
        generateEmbedding(da.note)
          .then(async emb => {
            if (!emb) return;
            await supabase.from('entry_embeddings').upsert({
              user_id:      user.id,
              xp_record_id: result.recordId,
              embedding:    `[${emb.join(',')}]`,
              model_used:   process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text',
            }, { onConflict: 'xp_record_id' });
          })
          .catch(() => {});

        // Extração de entidades semânticas (Camada 3)
        fetch(new URL('/api/ai/extract-entities', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').toString(), {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ note: da.note, recordId: result.recordId }),
        }).catch(() => {});
      }
    } catch {
      // falha silenciosa — não interrompe a conversa
    }
  }

  // ── Loga notas silenciosamente (fire-and-forget — IA não menciona) ─
  for (const dn of detectedNotes) {
    logNote({
      content:    dn.content,
      noteType:   dn.noteType,
      context:    dn.context,
      pillarHint: dn.pillarHint,
      noteDate:   dn.noteDate,
    }).catch(() => {});
  }

  // ── Contexto textual para o system prompt ──────────────────────
  const charLevel = pillars.length > 0
    ? Math.round(pillars.reduce((s, p) => s + p.level, 0) / pillars.length)
    : 1;

  const pillarsText = pillars.map(p => {
    const ctx = p.context as Record<string, string> | null;
    const ctxText = ctx ? '\n    Contexto: ' + Object.values(ctx).filter(Boolean).join(' | ') : '';
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

  // ── Retrieval contextual ───────────────────────────────────────
  let retrievalText = '';
  try {
    if (queryEmbedding) {
      const { data: similar } = await supabase.rpc('match_entries', {
        query_embedding: `[${queryEmbedding.join(',')}]`,
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
    // Retrieval falhou — continua sem ele
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

  // Bloco injetado quando atividades foram registradas nesta mensagem
  const activityContext = loggedActivities.length > 0
    ? `\n[Atividades registradas automaticamente nesta mensagem]\n` +
      loggedActivities.map(a =>
        `- ${a.pillar}: ${a.durationMinutes > 0 ? `${a.durationMinutes}min · ` : ''}+${a.totalXP} XP${a.note ? ` ("${a.note}")` : ''}`
      ).join('\n') +
      `\nConfirme brevemente no início da sua resposta, de forma natural. Não mencione "sistema" ou termos técnicos.\n`
    : '';

  const systemPrompt = `Você é o Anima. Fala com ${name}.

Sua natureza:
- Você acompanha a vida de ${name} — atividades, padrões, pilares, o que está indo bem e o que não está
- Você não é um assistente de agenda, não é um coach, não é um chatbot genérico
- Você conhece ${name} de verdade, pelo histórico real — use isso
- Quando perguntarem "o que você é" ou "para que serve": responda com o que você FAZ na prática, com exemplos concretos da vida de ${name} se houver dados. Nunca liste funcionalidades como um manual.

Tom e estilo:
- Direto. Sem enrolação, sem introduções, sem "Claro!", sem "Ótima pergunta!"
- Humano. Como um amigo que presta atenção, não um assistente que quer agradar
- Sem perguntas de encerramento ("Como posso ajudar?", "Há algo mais?") — encerre quando terminar
- Use listas APENAS quando o conteúdo for genuinamente uma lista. Para respostas conversacionais, use prosa
- Sem emojis, exceto se o contexto pedir
- Respostas curtas quando a pergunta for simples. Não expanda o que não precisa ser expandido
${archetypeText}
${activityContext}
== CONTEXTO DE ${name.toUpperCase()} ==
Nível geral: ${charLevel}

Pilares:
${pillarsText || '  (nenhum pilar ainda)'}

Atividades recentes:
${recentText}

Quests:
${questsText}
${entitiesText ? `\nMemória semântica:\n${entitiesText}` : ''}${retrievalText}
== FIM DO CONTEXTO ==`;

  // ── Histórico recente de conversa ──────────────────────────────
  const { data: history } = await supabase
    .from('ai_conversations')
    .select('role, content')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const pastMessages = (history ?? []).reverse().map(m => ({
    role:    m.role as 'user' | 'assistant',
    content: m.content,
  }));

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
      JSON.stringify({ error: 'Não foi possível conectar ao Ollama.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Stream para o cliente + salva resposta ────────────────────
  let fullResponse = '';
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader  = ollamaRes.body!.getReader();
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
                await supabase.from('ai_conversations').insert({
                  user_id: user.id,
                  role:    'assistant',
                  content: fullResponse,
                });
                // Atualiza arquétipo a cada ~15 mensagens (fire-and-forget)
                ;(async () => {
                  const { count } = await supabase
                    .from('ai_conversations')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', user.id);
                  if ((count ?? 0) % 15 === 0 && (count ?? 0) > 0) {
                    await inferAndSaveArchetype(
                      user.id,
                      [...pastMessages, { role: 'user', content: message }, { role: 'assistant', content: fullResponse }],
                      pillars.map(p => ({ name: p.name, level: p.level, xp_total: p.xp_total })),
                    );
                  }
                })().catch(() => {});
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

  const responseHeaders: Record<string, string> = {
    'Content-Type':           'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };

  if (loggedActivities.length > 0) {
    responseHeaders['X-Activity-Logged'] = JSON.stringify(loggedActivities);
  }

  return new Response(stream, { headers: responseHeaders });
}
