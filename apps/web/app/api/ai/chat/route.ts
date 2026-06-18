import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { generateEmbedding } from '@/lib/generate-embedding';
import { detectActivities } from '@/lib/detect-activity';
import { detectNotes } from '@/lib/detect-note';
import { detectQuests } from '@/lib/detect-quest';
import { detectPillarLinks } from '@/lib/detect-pillar-link';
import { detectEntities } from '@/lib/detect-entities';
import { extractEntities } from '@/lib/extract-entities';
import { linkEntitiesToPillars } from '@/lib/link-entities';
import { logActivity } from '@/lib/log-activity';
import { logNote } from '@/lib/log-note';
import { getOrCreatePendingPillar } from '@/lib/get-or-create-pending-pillar';
import { createPendingPillar } from '@/lib/create-pending-pillar';
import { inferAndSaveArchetype } from '@/lib/infer-archetype';
import { inferAndSaveIdentity } from '@/lib/infer-identity';

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

  // ── Detecção sequencial (evita sobrecarga do Ollama com chamadas simultâneas) ─
  // Atividades e quests primeiro: o que elas capturam é excluído das notas (dedup).
  const today = new Date().toISOString().slice(0, 10);
  const detectedActivities = await detectActivities(message, pillarNames, today);
  const detectedQuests     = await detectQuests(message, pillarNames);

  const noteExclusions = [
    ...detectedActivities.map(a => a.note).filter((n): n is string => !!n?.trim()),
    ...detectedQuests.map(q => q.title),
  ];
  const detectedNotes      = await detectNotes(message, today, noteExclusions);
  const detectedLinks      = await detectPillarLinks(message, pillarNames);
  const detectedEntities   = await detectEntities(message, pillarNames);
  const queryEmbedding     = await generateEmbedding(message);

  console.log('[chat/detect] activities:', detectedActivities.length, detectedActivities.map(a => `${a.pillarName}/${a.durationMinutes}min`));
  console.log('[chat/detect] notes:', detectedNotes.length, detectedNotes.map(n => n.noteType));
  console.log('[chat/detect] quests:', detectedQuests.length, detectedQuests.map(q => q.title));
  console.log('[chat/detect] links:', detectedLinks.length, detectedLinks.map(l => `${l.childName}→${l.parentName}`));
  console.log('[chat/detect] entities:', detectedEntities.length, detectedEntities.map(e => `${e.name}→${e.pillarHint ?? '?'}`));

  // ── Loga atividades detectadas ─────────────────────────────────
  const loggedActivities: LoggedActivity[] = [];
  const seenActivities = new Set<string>(); // dedup dentro da própria mensagem

  // Reforço determinístico: notas que são meta/decisão futura, organização de
  // pilar ou gosto/descoberta não são atividade (o detector às vezes as captura
  // como 0-min). Evita "atividade fantasma" no histórico de XP.
  const NON_ACTIVITY_NOTE_RE = /\b(decis[ãa]o|decidi|vou |pretendo|quero |meta\b|objetivo|planejo|faz(?:em)? parte|como parte|parte d[eo]|descobri|virei f[ãa]|sou f[ãa]|viciad)/i;

  for (const da of detectedActivities) {
    // Só descarta como "fantasma" se for 0-min — atividade cronometrada real
    // nunca é meta/link/interesse, mesmo que a nota mencione "vou"/"quero".
    if (da.durationMinutes === 0 && NON_ACTIVITY_NOTE_RE.test(da.note ?? '')) continue;

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

    const activityDate = da.activityDate ?? today;
    const dupeKey = `${pillar.id}|${activityDate}|${norm(da.note ?? '')}`;
    if (seenActivities.has(dupeKey)) continue;
    seenActivities.add(dupeKey);

    // Dedup contra o banco: mesmo pilar + data + nota já registrados (re-envio)
    const { data: existing } = await supabase
      .from('xp_records')
      .select('note')
      .eq('user_id', user.id)
      .eq('pillar_id', pillar.id)
      .eq('activity_date', activityDate);
    if ((existing ?? []).some(r => norm(r.note ?? '') === norm(da.note ?? ''))) continue;

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

        // Extração de entidades semânticas (Camada 3) — chamada direta,
        // sem fetch interno (que caía em 401 por não repassar os cookies)
        extractEntities(supabase, user.id, da.note, result.recordId).catch(() => {});
      }
    } catch {
      // falha silenciosa — não interrompe a conversa
    }
  }

  // ── Loga notas silenciosamente (fire-and-forget) ─────────────────
  // Dedup determinístico contra atividades: descarta notas que descrevem uma
  // atividade cronometrada (duração no texto) ou que repetem muito uma nota
  // de atividade já registrada — o detector de nota às vezes ignora a regra.
  const DURATION_RE = /\b\d+\s*(?:min|minutos?|h|horas?|hr)\b/i;
  const toTokens = (s: string) => new Set(norm(s).split(/\s+/).filter(w => w.length > 3));
  const activityTokenSets = detectedActivities
    .filter(a => a.note)
    .map(a => toTokens(`${a.pillarName} ${a.note}`));

  const notesToLog = detectedNotes.filter(dn => {
    if (DURATION_RE.test(dn.content)) return false;
    const nt = toTokens(dn.content);
    return !activityTokenSets.some(at => {
      let overlap = 0;
      for (const w of nt) if (at.has(w)) overlap++;
      return overlap >= 2;
    });
  });

  for (const dn of notesToLog) {
    logNote({
      content:    dn.content,
      noteType:   dn.noteType,
      context:    dn.context,
      pillarHint: dn.pillarHint,
      noteDate:   dn.noteDate,
    }).catch(() => {});
  }

  // ── Entidades semânticas da mensagem → teia entidade↔pilar (fire-and-forget) ─
  linkEntitiesToPillars(supabase, user.id, detectedEntities).catch(() => {});

  // ── Cria quests detectadas ─────────────────────────────────────
  type CreatedQuest = { title: string; pillar: string; type: string };
  const createdQuests: CreatedQuest[] = [];

  // Dedup de quests: títulos já existentes (qualquer status) + dentro da mensagem
  const { data: existingQuests } = await supabase
    .from('quests')
    .select('title')
    .eq('user_id', user.id);
  const existingQuestTitles = new Set((existingQuests ?? []).map(q => norm(q.title)));
  const seenQuests = new Set<string>();

  for (const dq of detectedQuests) {
    const qKey = norm(dq.title);
    if (existingQuestTitles.has(qKey) || seenQuests.has(qKey)) continue;
    seenQuests.add(qKey);

    // Cria a quest mesmo em pilar novo (vira pendente) — não descarta a meta.
    const pillarId = await createPendingPillar(supabase, user.id, dq.pillarName);
    if (!pillarId) continue;

    try {
      const { error } = await supabase.from('quests').insert({
        user_id:     user.id,
        pillar_id:   pillarId,
        title:       dq.title,
        description: dq.description ?? null,
        type:        dq.type,
        xp_reward:   dq.xpReward,
        status:      'open',
      });
      if (!error) createdQuests.push({ title: dq.title, pillar: dq.pillarName, type: dq.type });
    } catch { /* silencioso */ }
  }

  // ── Propõe agrupamentos de pilar (confirmação inline no chat) ────
  type ProposedLink = {
    childId: string; childName: string;
    parentId: string | null; parentName: string;
  };
  const proposedLinks: ProposedLink[] = [];

  if (detectedLinks.length > 0) {
    // Re-busca todos os pilares (inclui pendentes criados nesta mensagem)
    const { data: allPillars } = await supabase
      .from('user_pillars')
      .select('id, name')
      .eq('user_id', user.id);
    const all = allPillars ?? [];

    const { data: existingRels } = await supabase
      .from('pillar_relationships')
      .select('parent_id, child_id');
    const existingLinkSet = new Set((existingRels ?? []).map(r => `${r.parent_id}|${r.child_id}`));

    const seenLinks = new Set<string>();
    for (const dl of detectedLinks) {
      const child = all.find(p => norm(p.name) === norm(dl.childName));
      if (!child) continue; // filho não existe como pilar — nada a vincular

      const parent = all.find(p => norm(p.name) === norm(dl.parentName));
      if (parent && parent.id === child.id) continue;

      // Já vinculado? não propõe de novo
      if (parent && existingLinkSet.has(`${parent.id}|${child.id}`)) continue;

      const key = `${norm(dl.childName)}|${norm(dl.parentName)}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);

      proposedLinks.push({
        childId:    child.id,
        childName:  child.name,
        parentId:   parent?.id ?? null,
        parentName: parent?.name ?? dl.parentName,
      });
    }
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

  // Bloco injetado quando algo foi registrado nesta mensagem
  const registeredLines: string[] = [
    ...loggedActivities.map(a =>
      `- Atividade ${a.pillar}: ${a.durationMinutes > 0 ? `${a.durationMinutes}min · ` : ''}+${a.totalXP} XP${a.note ? ` ("${a.note}")` : ''}`
    ),
    ...createdQuests.map(q =>
      `- Quest criada "${q.title}" [${q.type}] em ${q.pillar}`
    ),
  ];
  const activityContext = registeredLines.length > 0
    ? `\n[Registrado automaticamente nesta mensagem]\n${registeredLines.join('\n')}\nConfirme brevemente no início da resposta, de forma natural. Não mencione "sistema" ou termos técnicos.\n`
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
                // Arquétipo + Identidade Emergente em cadência (fire-and-forget).
                // Conta só mensagens do USUÁRIO (passo de 1) — gatilho confiável;
                // contar user+assistant (passo de 2) podia nunca bater no módulo.
                ;(async () => {
                  const { count } = await supabase
                    .from('ai_conversations')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', user.id)
                    .eq('role', 'user');
                  const n = count ?? 0;
                  const window = [...pastMessages, { role: 'user', content: message }, { role: 'assistant', content: fullResponse }];
                  if (n > 0 && n % 10 === 0) {
                    await inferAndSaveArchetype(
                      user.id,
                      window,
                      pillars.map(p => ({ name: p.name, level: p.level, xp_total: p.xp_total })),
                    );
                  }
                  if (n > 0 && n % 5 === 0) {
                    await inferAndSaveIdentity(user.id, window);
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

  if (proposedLinks.length > 0) {
    responseHeaders['X-Pillar-Links'] = JSON.stringify(proposedLinks);
  }

  return new Response(stream, { headers: responseHeaders });
}
