import { supabase } from './supabase';
import { detectActivities } from './detect-activity';
import { detectNotes, type DetectedNote } from './detect-note';
import { getOrCreatePillar } from './activity';
import { logNotes } from './log-note';

const OLLAMA_URL   = process.env.EXPO_PUBLIC_OLLAMA_URL   ?? 'http://100.68.239.78:11434';
const OLLAMA_MODEL = process.env.EXPO_PUBLIC_OLLAMA_MODEL ?? 'qwen2.5:14b';

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

async function buildContext(userId: string) {
  const [profileRes, pillarsRes, recentRes] = await Promise.all([
    supabase.from('profiles').select('name, archetype').eq('id', userId).single(),
    supabase.from('user_pillars').select('id, name, xp_total, level, xp_rate').eq('user_id', userId).eq('is_active', true).order('level', { ascending: false }),
    supabase.from('xp_records').select('note, total_xp, duration_minutes, activity_date, user_pillars(name)').eq('user_id', userId).order('activity_date', { ascending: false }).order('created_at', { ascending: false }).limit(10),
  ]);

  const name      = profileRes.data?.name ?? 'usuário';
  const archetype = profileRes.data?.archetype as Record<string, number> | null;
  const pillars   = pillarsRes.data ?? [];
  const recent    = recentRes.data  ?? [];

  const pillarsText = pillars.map(p => `  • ${p.name}: Nível ${p.level} | ${p.xp_total} XP total`).join('\n');

  const recentText = recent.length > 0
    ? recent.map(r => {
        const up = r.user_pillars as { name: string } | { name: string }[] | null;
        const pillarName = (Array.isArray(up) ? up[0]?.name : up?.name) ?? '?';
        const date = r.activity_date ?? '?';
        return `  • [${date}] ${pillarName} — ${r.duration_minutes}min → ${r.total_xp} XP${r.note ? ` ("${r.note}")` : ''}`;
      }).join('\n')
    : '  (sem registros recentes)';

  const archetypeMap: Record<string, string> = {
    explorer:  'Explorador: muda de interesse facilmente, se motiva por novidade.',
    focused:   'Focado: prefere ir fundo em poucos pilares. Valorize profundidade.',
    builder:   'Construtor: motivado por consistência e progresso gradual.',
    visionary: 'Visionário: pensa em objetivos grandes e longo prazo.',
  };
  const archetypeText = archetype
    ? '\nPerfil: ' + Object.entries(archetype).sort((a, b) => b[1] - a[1])
        .map(([id, pct]) => `${archetypeMap[id] ?? id} (${pct}%)`).join(', ')
    : '';

  const systemPrompt = `Você é o Anima. Fala com ${name}.

Sua natureza:
- Você acompanha a vida de ${name} — atividades, padrões, pilares, o que está indo bem e o que não está
- Direto. Sem "Claro!", sem introduções, sem perguntas de encerramento
- Humano. Como um amigo que presta atenção, não um assistente
- Prosa em vez de listas quando o conteúdo for conversacional
- Sem emojis na maioria das respostas
${archetypeText}

== CONTEXTO DE ${name.toUpperCase()} ==
Pilares:
${pillarsText || '  (nenhum pilar ainda)'}

Atividades recentes:
${recentText}
== FIM DO CONTEXTO ==`;

  return { systemPrompt, pillars, name };
}

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export async function loadHistory(userId: string): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('ai_conversations')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(12);
  return (data ?? []).reverse().map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

export async function sendChatMessage(
  userId: string,
  message: string,
  pastMessages: ChatMessage[],
  onToken: (token: string) => void,
): Promise<void> {
  const { systemPrompt, pillars } = await buildContext(userId);

  // Save user message
  await supabase.from('ai_conversations').insert({ user_id: userId, role: 'user', content: message });

  // Fire-and-forget: activity + note detection
  ;(async () => {
    const pillarNames   = pillars.map(p => p.name);
    const [activities, notes] = await Promise.all([
      detectActivities(message, pillarNames),
      detectNotes(message),
    ]);

    for (const da of activities) {
      const pillar = pillars.find(p => norm(p.name) === norm(da.pillarName));
      if (pillar) {
        const { logActivity } = await import('./activity');
        logActivity({ userId, pillarId: pillar.id, durationMinutes: da.durationMinutes, note: da.note }).catch(() => {});
      } else if (da.pillarName) {
        getOrCreatePillar(userId, da.pillarName)
          .then(p => {
            if (p.isNew && (da.durationMinutes > 0 || da.note)) {
              ;(async () => {
                await supabase.from('user_pillars')
                  .update({ pending_activity: { durationMinutes: da.durationMinutes, note: da.note } })
                  .eq('id', p.id);
              })().catch(() => {});
            }
          })
          .catch(() => {});
      }
    }

    if (notes.length > 0) {
      logNotes(notes as DetectedNote[], userId).catch(() => {});
    }
  })().catch(() => {});

  // Call Ollama streaming
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:   OLLAMA_MODEL,
      stream:  true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...pastMessages,
        { role: 'user', content: message },
      ],
    }),
  });

  if (!res.ok || !res.body) {
    throw new Error('Não foi possível conectar ao Ollama.');
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = '';

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
            onToken(token);
          }
          if (json.done) {
            await supabase.from('ai_conversations').insert({
              user_id: userId,
              role:    'assistant',
              content: fullResponse,
            });
          }
        } catch {
          // linha não é JSON válido
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function clearHistory(userId: string): Promise<void> {
  await supabase.from('ai_conversations').delete().eq('user_id', userId);
}
