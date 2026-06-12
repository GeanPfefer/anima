import { supabase } from './supabase';
import { detectActivities } from './detect-activity';
import { detectNotes, type DetectedNote } from './detect-note';
import { detectQuests } from './detect-quest';
import { detectPillarLinks } from './detect-pillar-link';
import { inferAndSaveArchetype } from './infer-archetype';
import { getOrCreatePillar } from './activity';
import { logNotes } from './log-note';

const OLLAMA_URL   = process.env.EXPO_PUBLIC_OLLAMA_URL   ?? 'http://100.68.239.78:11434';
const OLLAMA_MODEL = process.env.EXPO_PUBLIC_OLLAMA_MODEL ?? 'qwen2.5:14b';

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

type PillarContext = {
  id:        string;
  name:      string;
  xp_rate:   number;
  level:     number;
  xp_total:  number;
  isPending: boolean;
};

async function buildContext(userId: string) {
  const [profileRes, activePillarsRes, pendingPillarsRes, recentRes, questsRes] = await Promise.all([
    supabase.from('profiles').select('name, archetype').eq('id', userId).single(),
    supabase.from('user_pillars').select('id, name, xp_total, level, xp_rate')
      .eq('user_id', userId).eq('is_active', true).order('level', { ascending: false }),
    supabase.from('user_pillars').select('id, name, xp_rate')
      .eq('user_id', userId).eq('status', 'pending'),
    supabase.from('xp_records')
      .select('note, total_xp, duration_minutes, activity_date, user_pillars(name)')
      .eq('user_id', userId)
      .order('activity_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10),
    supabase.from('quests')
      .select('title, type, status, user_pillars(name)')
      .eq('user_id', userId)
      .in('status', ['open', 'in_progress'])
      .limit(5),
  ]);

  const name      = profileRes.data?.name ?? 'usuário';
  const archetype = profileRes.data?.archetype as Record<string, number> | null;
  const active    = activePillarsRes.data  ?? [];
  const pending   = pendingPillarsRes.data ?? [];
  const recent    = recentRes.data         ?? [];
  const quests    = questsRes.data         ?? [];

  const pillars: PillarContext[] = [
    ...active.map(p => ({ ...p, isPending: false })),
    ...pending.map(p => ({ id: p.id, name: p.name, xp_rate: p.xp_rate, level: 0, xp_total: 0, isPending: true })),
  ];

  const pillarsText = active.map(p => `  • ${p.name}: Nível ${p.level} | ${p.xp_total} XP total`).join('\n');

  const recentText = recent.length > 0
    ? recent.map(r => {
        const up = r.user_pillars as { name: string } | { name: string }[] | null;
        const pillarName = (Array.isArray(up) ? up[0]?.name : up?.name) ?? '?';
        const date = r.activity_date ?? '?';
        return `  • [${date}] ${pillarName} — ${r.duration_minutes}min → ${r.total_xp} XP${r.note ? ` ("${r.note}")` : ''}`;
      }).join('\n')
    : '  (sem registros recentes)';

  const questsText = quests.length > 0
    ? quests.map(q => {
        const up = q.user_pillars as { name: string } | { name: string }[] | null;
        const pillarName = (Array.isArray(up) ? up[0]?.name : up?.name) ?? '?';
        return `  • ${q.title} [${q.type}] — ${pillarName} (${q.status})`;
      }).join('\n')
    : '  (sem quests ativas)';

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

Quests ativas:
${questsText}

Atividades recentes:
${recentText}
== FIM DO CONTEXTO ==`;

  return { systemPrompt, pillars, activePillars: active, name };
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
    .limit(20);
  return (data ?? []).reverse().map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

export async function sendChatMessage(
  userId: string,
  message: string,
  pastMessages: ChatMessage[],
  onToken: (token: string) => void,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { systemPrompt, pillars, activePillars, name } = await buildContext(userId);

  await supabase.from('ai_conversations').insert({ user_id: userId, role: 'user', content: message });

  // Fire-and-forget: detecção completa (sequencial para não sobrecarregar Ollama)
  ;(async () => {
    const allNames    = pillars.map(p => p.name);
    const activeNames = activePillars.map(p => p.name);

    const activities   = await detectActivities(message, allNames, today);
    const notes        = await detectNotes(message, today);
    const quests       = await detectQuests(message, activeNames);
    const pillarLinks  = await detectPillarLinks(message, allNames);

    // ── Atividades ──────────────────────────────────────────────
    for (const da of activities) {
      const normName = norm(da.pillarName);

      const activePillar = activePillars.find(p => norm(p.name) === normName);
      if (activePillar) {
        const { logActivity } = await import('./activity');
        logActivity({
          userId,
          pillarId:        activePillar.id,
          durationMinutes: da.durationMinutes,
          note:            da.note,
          activityDate:    da.activityDate,
        }).catch(() => {});
        continue;
      }

      const pendingPillar = pillars.find(p => p.isPending && norm(p.name) === normName);
      if (pendingPillar) {
        if (da.durationMinutes > 0 || da.note) {
          void supabase.from('user_pillars')
            .update({ pending_activity: { durationMinutes: da.durationMinutes, note: da.note, activityDate: da.activityDate } })
            .eq('id', pendingPillar.id);
        }
        continue;
      }

      if (da.pillarName) {
        getOrCreatePillar(userId, da.pillarName)
          .then(p => {
            if (p.isNew && (da.durationMinutes > 0 || da.note)) {
              void supabase.from('user_pillars')
                .update({ pending_activity: { durationMinutes: da.durationMinutes, note: da.note, activityDate: da.activityDate } })
                .eq('id', p.id);
            }
          })
          .catch(() => {});
      }
    }

    // ── Notas ───────────────────────────────────────────────────
    if (notes.length > 0) {
      logNotes(notes as DetectedNote[], userId).catch(() => {});
    }

    // ── Quests ──────────────────────────────────────────────────
    if (quests.length > 0) {
      const { data: existingQuests } = await supabase
        .from('quests').select('title').eq('user_id', userId);
      const existing = new Set((existingQuests ?? []).map(q => norm(q.title)));

      for (const dq of quests) {
        if (existing.has(norm(dq.title))) continue;
        existing.add(norm(dq.title));

        const pillar = activePillars.find(p => norm(p.name) === norm(dq.pillarName));
        if (!pillar) continue;

        void supabase.from('quests').insert({
          user_id:     userId,
          pillar_id:   pillar.id,
          title:       dq.title,
          description: dq.description ?? null,
          type:        dq.type,
          xp_reward:   dq.xpReward,
          status:      'open',
        });
      }
    }

    // ── Links de pilar ──────────────────────────────────────────
    if (pillarLinks.length > 0) {
      const { data: allPillarRows } = await supabase
        .from('user_pillars').select('id, name').eq('user_id', userId);
      const all = allPillarRows ?? [];

      const { data: existingRels } = await supabase
        .from('pillar_relationships').select('parent_id, child_id');
      const existingSet = new Set((existingRels ?? []).map(r => `${r.parent_id}|${r.child_id}`));

      for (const dl of pillarLinks) {
        const child  = all.find(p => norm(p.name) === norm(dl.childName));
        const parent = all.find(p => norm(p.name) === norm(dl.parentName));
        if (!child || !parent || child.id === parent.id) continue;
        if (existingSet.has(`${parent.id}|${child.id}`)) continue;

        void supabase.from('pillar_relationships').insert({
          parent_id: parent.id,
          child_id:  child.id,
        });
        existingSet.add(`${parent.id}|${child.id}`);
      }
    }

    // ── Inferência de arquétipo a cada ~15 mensagens ────────────
    const totalMessages = pastMessages.length + 1;
    if (totalMessages > 0 && totalMessages % 15 === 0) {
      const recentWindow = [...pastMessages.slice(-20), { role: 'user', content: message }];
      inferAndSaveArchetype(userId, recentWindow, activePillars).catch(() => {});
    }
  })().catch(() => {});

  // ── Streaming do Ollama com timeout de 2 minutos ────────────────
  const controller  = new AbortController();
  const chatTimeout = setTimeout(() => controller.abort(), 120_000);

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
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
  } catch (err) {
    clearTimeout(chatTimeout);
    if (err instanceof Error && err.name === 'AbortError') throw new Error('timeout');
    throw new Error('connection');
  }

  if (!res.ok || !res.body) {
    clearTimeout(chatTimeout);
    throw new Error(`http_${res.status}`);
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
          // linha não é JSON válido — ignora
        }
      }
    }
  } catch (err) {
    clearTimeout(chatTimeout);
    if (err instanceof Error && err.name === 'AbortError') throw new Error('timeout');
    throw err;
  } finally {
    clearTimeout(chatTimeout);
    reader.releaseLock();
  }

  // Persiste o nome inferido da conversa (onboarding retroativo)
  void name;
}

export async function clearHistory(userId: string): Promise<void> {
  await supabase.from('ai_conversations').delete().eq('user_id', userId);
}
