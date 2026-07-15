import { supabase } from './supabase';
import { detectActivities } from './detect-activity';
import { detectNotes, type DetectedNote } from './detect-note';
import { detectQuests } from './detect-quest';
import { detectPillarLinks } from './detect-pillar-link';
import { detectEntities } from './detect-entities';
import { linkEntitiesToPillars } from './link-entities';
import { createPendingPillar } from './create-pending-pillar';
import { inferAndSaveArchetype } from './infer-archetype';
import { getOrCreatePillar } from './activity';
import { logNotes } from './log-note';
import { routeWorkMessage, type MobileWorkRouting } from './mobile-work';

const OLLAMA_URL   = process.env.EXPO_PUBLIC_OLLAMA_URL   ?? 'http://100.68.239.78:11434';
const OLLAMA_MODEL = process.env.EXPO_PUBLIC_OLLAMA_MODEL ?? 'qwen2.5:14b';

const PLACEHOLDER = new Set(['Jogador', 'usuário', '']);

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function extractName(raw: string): string | null {
  const cleaned = raw.trim();
  const pick = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

  // Apelido explícito vence o nome formal, em qualquer posição da frase:
  // "Me chamo Gean, mas pode me chamar de Naeg" → Naeg
  const nick = cleaned.match(/(?:pode me chamar de|me chama de|me chame de|prefiro(?: que me chamem?)? de)\s+([\p{L}]{2,20})/iu)?.[1];
  if (nick) return pick(nick);

  let s = cleaned.replace(/[.!?]+$/, '');
  s = s.replace(/^(oi|olá|ola|opa|e a[ií]|eai)[\s,]+/i, '');
  s = s.replace(/^(meu nome (é|e)|me chamo|chamo-me|sou o|sou a|sou)[\s]+/i, '');
  s = s.trim();
  if (!s) return null;
  const first = s.split(/\s+/)[0]!.replace(/[^\p{L}]/gu, '');
  if (first.length < 2 || first.length > 20) return null;
  return pick(first);
}

function buildOnboardingSystemPrompt(name: string | null): string {
  const ref = name ?? 'esta pessoa';
  return `Você é o Anima. Esta é sua primeira conversa com ${ref}.

MISSÃO (nunca diga isso): ouvir e entender como é a vida de ${ref} agora.
Não aconselhar. Não planejar. Não ajudar. Só entender.
${!name ? '\nVocê ainda não sabe o nome da pessoa. Se surgir naturalmente, use-o nas próximas mensagens.' : ''}
PROIBIDO — estas respostas destroem a experiência:
❌ "Vamos focar em uma área específica"
❌ "Qual área da sua vida você quer melhorar?"
❌ Listar categorias como opções para o usuário escolher
❌ "Vamos criar um planejamento / plano de ação"
❌ "Qual é o seu maior desafio?"
❌ Dar conselhos ou sugestões não pedidos
❌ Mais de uma pergunta por mensagem
❌ Mencionar "pilares", "XP", "níveis", "dashboard" ou termos do sistema

SE o usuário perguntar "quais áreas existem?" ou "o que você rastreia?":
→ Diga algo como: "O sistema detecta sozinho o que é relevante pra você a partir das conversas — não tem uma lista fixa. Vai aparecendo no seu perfil conforme você conta mais."

PERMITIDO:
✅ Perguntas sobre o dia a dia, o que está acontecendo agora
✅ Curiosidade sobre o presente — não sobre metas futuras
✅ Resposta curta (máx 2 frases) + uma pergunta
✅ Tom de amigo que acabou de te conhecer — leve, sem pressão

Após 3+ trocas com contexto real da vida da pessoa, encerre naturalmente com algo como:
"Já tenho uma boa ideia de como é a sua vida agora. Pode explorar seu perfil quando quiser."

Idioma: português brasileiro informal.`;
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
    supabase.from('profiles').select('name, archetype, onboarding_completed_at').eq('id', userId).single(),
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

  const name        = profileRes.data?.name ?? 'usuário';
  const archetype   = profileRes.data?.archetype as Record<string, number> | null;
  const onboardingAt = profileRes.data?.onboarding_completed_at as string | null | undefined;
  const displayName  = !PLACEHOLDER.has(name) ? name : null;
  const isOnboarding = !onboardingAt;

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

  const systemPrompt = isOnboarding
    ? buildOnboardingSystemPrompt(displayName)
    : `Você é o Anima. Fala com ${name}.

Sua natureza:
- Você acompanha a vida de ${name} — atividades, padrões, pilares, o que está indo bem e o que não está
- Direto. Sem "Claro!", sem introduções, sem perguntas de encerramento
- Nunca abra frase com "Legal!", "Show!", "Ótimo!", "Parabéns!", "Que bom!" ou variação entusiasmada — não é torcida, é observação
- Humano. Como um amigo que presta atenção, não um assistente
- Sem perguntas de encerramento ("Como foi seu dia?", "Que tal...?") — encerre quando terminar
- Prosa em vez de listas quando o conteúdo for conversacional
- Sem emojis na maioria das respostas
- Nunca invente funcionalidades, telas ou processos que não existem
- Comida, bebida, gastos, humor e estados emocionais mencionados de passagem são registrados em segundo plano, silenciosamente — NUNCA comente, avalie, elogie, dê conselho ou questione esse conteúdo
${archetypeText}

== CONTEXTO DE ${name.toUpperCase()} ==
Pilares:
${pillarsText || '  (nenhum pilar ainda)'}

Quests ativas:
${questsText}

Atividades recentes:
${recentText}
== FIM DO CONTEXTO ==`;

  return { systemPrompt, pillars, activePillars: active, name, isOnboarding };
}

export type ChatMessage = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
};

export async function loadHistory(userId: string): Promise<ChatMessage[]> {
  const { data: session } = await supabase.from('conversation_sessions').select('id').eq('user_id',userId).is('archived_at',null).maybeSingle();
  if (!session) return [];
  const { data } = await supabase
    .from('ai_conversations')
    .select('id, role, content')
    .eq('session_id', session.id)
    .order('created_at', { ascending: false })
    .limit(20);
  return (data ?? []).reverse().map(m => ({ id:m.id, role: m.role as 'user' | 'assistant', content: m.content }));
}

export async function getOnboardingGreeting(userId: string): Promise<string | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('name, onboarding_completed_at')
    .eq('id', userId)
    .single();

  if (profile?.onboarding_completed_at) return null;

  const name = profile?.name;
  const displayName = name && !PLACEHOLDER.has(name) ? name : null;

  return displayName
    ? `O que tá rolando na sua vida ultimamente, ${displayName}?`
    : 'Oi! Antes da gente começar — como você quer que eu te chame?';
}

export async function sendChatMessage(
  userId: string,
  message: string,
  pastMessages: ChatMessage[],
  onToken: (token: string) => void,
): Promise<MobileWorkRouting | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { systemPrompt, pillars, activePillars, name, isOnboarding } = await buildContext(userId);

  // ── Onboarding: fluxo simplificado sem detecção de atividades ────
  if (isOnboarding) {
    const isFirstExchange = pastMessages.filter(m => m.role === 'user').length === 0;

    if (isFirstExchange) {
      // Persiste a saudação exibida localmente antes de salvar a mensagem do usuário
      const greeting = pastMessages.find(m => m.role === 'assistant');
      if (greeting) {
        await supabase.from('ai_conversations').insert({
          user_id: userId, role: 'assistant', content: greeting.content,
        });
      }
      // Tenta extrair o nome da primeira resposta do usuário
      const extracted = extractName(message);
      if (extracted) {
        await supabase.from('profiles').update({ name: extracted }).eq('id', userId);
      }
    }

    await supabase.from('ai_conversations').insert({ user_id: userId, role: 'user', content: message });

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
          // Sem isso o Ollama usa o padrão do runtime (2048-4096), que o
          // systemPrompt + histórico facilmente excede, gerando degeneração.
          options: { num_ctx: 8192 },
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
            if (json.done && fullResponse) {
              await supabase.from('ai_conversations').insert({
                user_id: userId,
                role:    'assistant',
                content: fullResponse,
              });
            }
          } catch { /* linha não é JSON válido — ignora */ }
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

    // Marca onboarding como concluído após primeira resposta bem-sucedida
    void supabase.from('profiles').update({
      onboarding_completed_at: new Date().toISOString(),
    }).eq('id', userId);

    return null;
  }

  // ── Chat regular ────────────────────────────────────────────────
  const { data: sourceMessage } = await supabase.from('ai_conversations').insert({ user_id: userId, role: 'user', content: message }).select('id, session_id').single();
  const workRouting: MobileWorkRouting | null = sourceMessage
    ? await routeWorkMessage(message, sourceMessage.id).catch((): MobileWorkRouting => ({ kind: 'none' }))
    : null;

  // Fire-and-forget: detecção completa (sequencial para não sobrecarregar Ollama)
  ;(async () => {
    const allNames    = pillars.map(p => p.name);
    const activeNames = activePillars.map(p => p.name);

    // Atividades e quests primeiro: o que capturam é excluído das notas (dedup).
    const activities   = await detectActivities(message, allNames, today);
    const quests       = await detectQuests(message, activeNames);

    const noteExclusions = [
      ...activities.map(a => a.note).filter((n): n is string => !!n?.trim()),
      ...quests.map(q => q.title),
    ];
    const notes        = await detectNotes(message, today, noteExclusions);
    const pillarLinks  = await detectPillarLinks(message, allNames);
    const entities     = await detectEntities(message, allNames);

    // ── Atividades ──────────────────────────────────────────────────
    const NON_ACTIVITY_NOTE_RE =
      /\b(decis[ãa]o|decidi|vou |pretendo|quero |meta\b|objetivo|planejo|faz(?:em)? parte|como parte|parte d[eo]|descobri|virei f[ãa]|sou f[ãa]|viciad)/i;

    for (const da of activities) {
      if (
        da.durationMinutes === 0 &&
        NON_ACTIVITY_NOTE_RE.test(da.note ?? '')
      ) {
        continue;
      }

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

    // ── Notas ───────────────────────────────────────────────────────
    // Dedup determinístico contra atividades: descarta notas que descrevem
    // uma atividade cronometrada (duração no texto) ou que repetem muito uma
    // nota de atividade — o detector de nota às vezes ignora a regra.
    // Prefixo de 4 letras em vez da palavra inteira: captura variações como
    // "corrida"/"correr" que descrevem o mesmo evento com palavras diferentes.
    const DURATION_RE = /\b\d+\s*(?:min|minutos?|h|horas?|hr)\b/i;
    const toTokens = (s: string) => new Set(
      norm(s).split(/\s+/).filter(w => w.length > 3).map(w => w.slice(0, 4)),
    );
    const activityTokenSets = activities
      .filter(a => a.note)
      .map(a => toTokens(`${a.pillarName} ${a.note}`));

    const notesToLog = notes.filter(dn => {
      if (DURATION_RE.test(dn.content)) return false;
      const nt = toTokens(dn.content);
      return !activityTokenSets.some(at => {
        let overlap = 0;
        for (const w of nt) if (at.has(w)) overlap++;
        return overlap >= 2;
      });
    });

    // Tipos de nota que sinalizam área de vida nova (não comida/gasto/humor,
    // cujo pillarHint costuma ser genérico demais para virar pilar).
    const PILLAR_WORTHY_NOTE_TYPES = new Set(['interest', 'idea', 'other']);
    for (const dn of notesToLog) {
      if (
        dn.pillarHint &&
        PILLAR_WORTHY_NOTE_TYPES.has(dn.noteType) &&
        !pillars.find(p => norm(p.name) === norm(dn.pillarHint!))
      ) {
        createPendingPillar(userId, dn.pillarHint).catch(() => {});
      }
    }

    if (notesToLog.length > 0) {
      logNotes(notesToLog as DetectedNote[], userId).catch(() => {});
    }

    // ── Entidades semânticas → teia entidade↔pilar ──────────────────
    if (entities.length > 0) {
      linkEntitiesToPillars(userId, entities).catch(() => {});
    }

    // ── Quests ──────────────────────────────────────────────────────
    if (quests.length > 0) {
      const { data: existingQuests } = await supabase
        .from('quests').select('title').eq('user_id', userId);
      const existing = new Set((existingQuests ?? []).map(q => norm(q.title)));

      for (const dq of quests) {
        if (existing.has(norm(dq.title))) continue;
        existing.add(norm(dq.title));

        // Cria a quest mesmo em pilar novo (vira pendente) — não descarta a meta.
        const pillarId = await createPendingPillar(userId, dq.pillarName);
        if (!pillarId) continue;

        void supabase.from('quests').insert({
          user_id:     userId,
          pillar_id:   pillarId,
          title:       dq.title,
          description: dq.description ?? null,
          type:        dq.type,
          xp_reward:   dq.xpReward,
          status:      'open',
        });
      }
    }

    // ── Links de pilar ──────────────────────────────────────────────
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

    // ── Inferência de arquétipo a cada ~15 mensagens ────────────────
    const totalMessages = pastMessages.length + 1;
    if (totalMessages > 0 && totalMessages % 15 === 0) {
      const recentWindow = [...pastMessages.slice(-20), { role: 'user', content: message }];
      inferAndSaveArchetype(userId, recentWindow, activePillars).catch(() => {});
    }
  })().catch(() => {});

  // ── Streaming do Ollama com timeout de 2 minutos ────────────────────
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
        options: { num_ctx: 8192 },
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
            // session_id explícito prende a resposta ao turno da pergunta e
            // impede fragmentação caso a sessão mude nesse meio tempo.
            await supabase.from('ai_conversations').insert({
              user_id: userId,
              role:    'assistant',
              content: fullResponse,
              session_id: sourceMessage?.session_id ?? undefined,
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

  void name;
  return workRouting;
}

export async function clearHistory(userId: string): Promise<void> {
  void userId;
  const { error } = await supabase.rpc('archive_current_conversation');
  if (error) throw error;
}
