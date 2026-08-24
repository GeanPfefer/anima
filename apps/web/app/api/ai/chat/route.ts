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
import { interpretWorkRequest } from '@/lib/work-orchestration/interpret';
import { configureUx02DeterministicProof } from '@/lib/work-orchestration/execution';
import {
  buildWorkOrchestrationReply,
  type WorkOrchestrationChatKind,
} from '@/lib/work-orchestration/chat-guidance';
import { isWorkContinuation, isWorkHistoryQuery, resolveWorkFocus } from '@anima/core';
import { mapWorkEvent, mapWorkItem } from '@anima/supabase';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { serializeReconstructedWorkPresentation, serializeWorkPresentation } from '@/lib/work-orchestration/serialize';
import {
  ChatProviderError,
  parseChatProvider,
  streamChatProvider,
} from '@/lib/ai/chat-provider';
import { planExecutableProjectWork, shouldRunProjectPlanner } from '@/lib/ai/project-work-planner';
import { isDevelopmentChatAuthorized, resolveChatDevelopmentMode } from '@/lib/ai/chat-surface';
import { shouldReuseOrphanUserMessage } from '@/lib/ai/chat-turn';
import {
  buildOperationalProjectSnapshot,
  buildProjectItemDrilldownProjection,
  derivePresentedItemReferences,
  isConversationalItemReferenceQuestion,
  isProjectAdvisorQuestion,
  isProjectItemDrilldownQuestion,
  operationalEvidenceForContext,
  operationalProjectSnapshotAudit,
  operationalStateForContext,
  projectItemDrilldownEvidenceForContext,
  projectResolvedItemQuestion,
  projectItemDrilldownStateForContext,
  parsePresentedItemReferences,
  resolveConversationalItemReference,
  resolveProjectItemReference,
} from '@anima/core';
import { buildProjectAdvisorContext } from '@/lib/ai/project-context-builder';
import { createProjectAdvisor, renderProjectAdvisory } from '@/lib/ai/project-advisor';

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const isFocusedWorkStatusQuestion = (message: string): boolean =>
  /\b(deu certo|funcionou|terminou|concluiu|qual (?:e|é|o) estado|como (?:esta|está) o trabalho)\b/i.test(message);

const focusedWorkStatusReply = (state: string, summary: string): string => {
  const subject = summary.trim() || 'O trabalho em foco';
  switch (state) {
    case 'completed': return `${subject} foi concluído e o resultado foi aceito.`;
    case 'review': return `${subject} terminou a execução e está aguardando sua revisão.`;
    case 'blocked': return `${subject} está pausado e precisa da sua decisão para continuar.`;
    case 'in_progress': return `${subject} está em execução.`;
    case 'approved': return `${subject} foi aprovado, mas a execução ainda não começou.`;
    case 'failed': return `${subject} falhou; nenhum resultado foi aceito.`;
    case 'cancelled': return `${subject} foi cancelado.`;
    case 'changes_requested': return `${subject} está aguardando as correções solicitadas.`;
    case 'rejected': return `${subject} foi rejeitado.`;
    default: return `${subject} está no estado ${state}.`;
  }
};

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

  const { message, provider: requestedProvider, developmentMode: requestedDevelopmentMode, retryMessageId: requestedRetryMessageId, presentedItemReferences: requestedPresentedItemReferences } = await req.json() as {
    message: string;
    provider?: unknown;
    developmentMode?: unknown;
    retryMessageId?: unknown;
    presentedItemReferences?: unknown;
  };
  if (!message?.trim()) return new Response('Mensagem vazia', { status: 400 });
  const provider = parseChatProvider(requestedProvider);
  // Superfície: chat pessoal por padrão. Ferramentas de repositório e o
  // planejador que investiga o código só entram com ação explícita
  // (developmentMode) E autorização persistida (allowlist dedicado). O texto da
  // mensagem nunca habilita nada. Ver lib/ai/chat-surface.
  const developmentMode = resolveChatDevelopmentMode({
    requested: requestedDevelopmentMode === true,
    authorized: isDevelopmentChatAuthorized(user.id),
  });

  // Drill-down operacional read-only: resolve uma única referência antes de ler
  // payloads e só deixa a projeção tipada/minimizada atravessar para o Advisor.
  // Ambiguidade falha fechado sem chamar provider e sem criar memória paralela.
  if (isProjectItemDrilldownQuestion(message) || isConversationalItemReferenceQuestion(message)) {
    try {
      const observedAt = new Date().toISOString();
      const [{ data: candidates }, { data: focus }] = await Promise.all([
        supabase.from('work_items').select('id, state, capability, updated_at')
          .eq('user_id', user.id).order('updated_at', { ascending: false }).limit(100),
        supabase.from('work_focus').select('work_item_id').eq('user_id', user.id).maybeSingle(),
      ]);
      const candidateProjection = (candidates ?? []).map(candidate => ({
          id: candidate.id, state: candidate.state, capability: candidate.capability, updatedAt: candidate.updated_at,
        }));
      const presented = parsePresentedItemReferences(requestedPresentedItemReferences);
      const contextual = resolveConversationalItemReference(message, presented);
      if (contextual.kind === 'clarification_required') {
        const choices = contextual.references.map(reference => {
          const current = candidateProjection.find(candidate => candidate.id === reference.workItemId);
          return `- ${reference.ordinal}º: ${reference.workItemId}${current ? ` — ${current.capability}, estado ${current.state}` : ''}`;
        }).join('\n');
        return new Response(`Não consigo determinar com segurança qual item você quis dizer. Escolha um dos itens apresentados:\n${choices}`, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Anima-Capability': 'project-advisor-conversational-item-reference-v0', 'X-Anima-Mutation': 'none' },
        });
      }
      const resolution = contextual.kind === 'resolved'
        ? { kind: 'resolved' as const, itemId: contextual.itemId, basis: 'conversational_reference' as const }
        : resolveProjectItemReference({ message, candidates: candidateProjection, currentFocusId: focus?.work_item_id ?? null });
      if (resolution.kind === 'clarification_required') {
        const choices = resolution.candidates.map(candidate =>
          `- ${candidate.itemRef} — ${candidate.capability}, estado ${candidate.state}`).join('\n');
        return new Response(`Há mais de um item compatível. Indique o ID exato:\n${choices}`, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Anima-Capability': 'project-advisor-item-drilldown-v0', 'X-Anima-Mutation': 'none' },
        });
      }
      if (resolution.kind === 'not_found') {
        return Response.json({ error: 'Não encontrei um item visível e inequívoco para essa referência. Informe o ID exato de um item acessível nesta conta.' }, {
          status: 404,
          headers: { 'X-Anima-Capability': 'project-advisor-item-drilldown-v0', 'X-Anima-Mutation': 'none' },
        });
      }
      const [itemRead, eventRead] = await Promise.all([
        supabase.from('work_items').select('*').eq('user_id', user.id).eq('id', resolution.itemId).single(),
        supabase.from('work_events').select('*').eq('work_item_id', resolution.itemId)
          .order('created_at', { ascending: false }).limit(200),
      ]);
      if (!itemRead.data && itemRead.error?.code === 'PGRST116') {
        return Response.json({ error: 'O item referenciado não está mais visível para esta conta.' }, {
          status: 404, headers: { 'X-Anima-Capability': 'project-advisor-conversational-item-reference-v0', 'X-Anima-Mutation': 'none' },
        });
      }
      if (!itemRead.data || eventRead.error) throw new Error('project_item_drilldown_item_unavailable');
      const projection = buildProjectItemDrilldownProjection({
        item: mapWorkItem(itemRead.data), events: (eventRead.data ?? []).map(mapWorkEvent), observedAt,
      });
      const context = await buildProjectAdvisorContext(projectResolvedItemQuestion(projection.itemRef), [
        {
          id: 'item-operational-state', authority: 'observed_state', temporalRole: 'current_projection',
          provenance: 'Supabase RLS read-only projection: one resolved work_item; personal fields omitted',
          observedAt, content: projectItemDrilldownStateForContext(projection),
        },
        {
          id: 'item-operational-evidence', authority: 'evidence', temporalRole: 'event_sequence',
          provenance: 'Supabase RLS read-only projection: typed summaries for one item; raw payload omitted',
          observedAt, content: projectItemDrilldownEvidenceForContext(projection),
        },
      ]);
      const answer = await createProjectAdvisor(provider).advise(context);
      const role = projection.latestFailure?.unresolved ? 'unresolved_failure'
        : projection.currentState === 'review' ? 'review_item'
        : projection.currentState === 'blocked' ? 'blocked_item' : 'active_item';
      const continuingReferences = resolution.basis === 'conversational_reference' && presented.length > 0
        ? presented : [{ workItemId: projection.itemRef, ordinal: 1, role }];
      return new Response(renderProjectAdvisory(answer), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8', 'X-AI-Provider': provider,
          'X-AI-Model': 'project-advisor-item-drilldown-v0',
          'X-Anima-Capability': 'project-advisor-item-drilldown-v0', 'X-Anima-Mutation': 'none',
          'X-Anima-Presented-Items': encodeURIComponent(JSON.stringify(continuingReferences)),
        },
      });
    } catch (error) {
      console.warn('[project-advisor-item-drilldown] fail-closed', {
        code: error instanceof Error ? error.message.split(':', 1)[0] : 'unknown_error',
      });
      return Response.json({ error: 'Não há evidência governada suficiente para detalhar esse item com segurança agora.' }, { status: 503 });
    }
  }

  // SELF_UNDERSTANDING / PROJECT_ADVISOR_V0. Esta bifurcação acontece antes de
  // todos os detectores e gravadores do chat: consultar o estado do projeto não
  // pode criar nota, XP, quest, work_item, classificação, decisão ou ação.
  // O único insumo do provider é o contexto governado e allowlisted construído
  // no host; as ferramentas genéricas de repositório permanecem desligadas.
  if (isProjectAdvisorQuestion(message)) {
    try {
      console.info('[project-advisor] request received', { provider, userScoped: true });
      // Observação viva, isolada pela sessão/RLS e reduzida a metadados não
      // pessoais. Payloads, pedidos originais e contexto de execução não saem.
      const generatedAt = new Date().toISOString();
      const { data: projectItems } = await supabase.from('work_items')
        .select('id, state, capability, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(50);
      const itemIds = (projectItems ?? []).map(item => item.id);
      const { data: projectEvents } = itemIds.length > 0
        ? await supabase.from('work_events')
          .select('work_item_id, event_type, author, created_at')
          .in('work_item_id', itemIds)
          .order('created_at', { ascending: false })
          .limit(200)
        : { data: [] };
      const { data: projectFocus } = await supabase.from('work_focus')
        .select('work_item_id, updated_at')
        .eq('user_id', user.id)
        .maybeSingle();
      const snapshot = buildOperationalProjectSnapshot({
        generatedAt,
        items: (projectItems ?? []).map(item => ({
          id: item.id, state: item.state, capability: item.capability, updatedAt: item.updated_at,
        })),
        events: (projectEvents ?? []).map(event => ({
          workItemId: event.work_item_id,
          eventType: event.event_type,
          author: event.author,
          occurredAt: event.created_at,
        })),
        focus: projectFocus ? { workItemId: projectFocus.work_item_id, updatedAt: projectFocus.updated_at } : null,
        itemsTruncated: (projectItems?.length ?? 0) === 50,
        eventsTruncated: (projectEvents?.length ?? 0) === 200,
      });
      console.info('[project-advisor] operational snapshot ready', operationalProjectSnapshotAudit(snapshot));
      const context = await buildProjectAdvisorContext(message, [
        {
          id: 'live-operational-state',
          authority: 'observed_state',
          provenance: 'Supabase RLS read-only projection: work_items + work_focus; bounded host synthesis',
          observedAt: generatedAt,
          temporalRole: 'current_projection',
          content: operationalStateForContext(snapshot),
        },
        {
          id: 'live-operational-evidence',
          authority: 'evidence',
          provenance: 'Supabase RLS read-only projection: typed work_events metadata; payload omitted',
          observedAt: generatedAt,
          temporalRole: 'event_sequence',
          content: operationalEvidenceForContext(snapshot),
        },
      ]);
      console.info('[project-advisor] governed context ready', {
        sources: context.sources.length,
        sourceIds: context.sources.map(source => source.id).sort(),
        authorities: [...new Set(context.sources.map(source => source.authority))].sort(),
        characters: context.sources.reduce((total, source) => total + source.content.length, 0),
      });
      const answer = await createProjectAdvisor(provider).advise(context);
      const presentedItems = derivePresentedItemReferences(answer, snapshot);
      console.info('[project-advisor] advisory presented', { sections: 6, mutation: 'none' });
      return new Response(renderProjectAdvisory(answer), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-AI-Provider': provider,
          'X-AI-Model': 'project-advisor-v0',
          'X-Anima-Capability': 'project-advisor-v0',
          'X-Anima-Mutation': 'none',
          'X-Anima-Presented-Items': encodeURIComponent(JSON.stringify(presentedItems)),
        },
      });
    } catch (error) {
      // Não registra conteúdo nem contexto: somente a classe/código local que
      // permite distinguir contexto, parse e validação numa prova posterior.
      console.warn('[project-advisor] fail-closed', {
        code: error instanceof Error ? error.message.split(':', 1)[0] : 'unknown_error',
      });
      const providerError = error instanceof ChatProviderError
        ? error
        : new ChatProviderError('Não há evidência governada suficiente para responder com segurança agora.', 503);
      return Response.json({ error: providerError.message }, { status: providerError.status });
    }
  }

  // ── Contexto do usuário ────────────────────────────────────────
  const [profileRes, pillarsRes, recentRes, questsRes, entitiesRes, identityRes] = await Promise.all([
    supabase.from('profiles').select('name, archetype').eq('id', user.id).single(),
    supabase.from('user_pillars').select('id, name, xp_total, level, xp_rate, context').eq('user_id', user.id).eq('is_active', true).order('level', { ascending: false }),
    supabase.from('xp_records').select('note, total_xp, duration_minutes, activity_date, user_pillars(name)').eq('user_id', user.id).order('activity_date', { ascending: false }).order('created_at', { ascending: false }).limit(10),
    supabase.from('quests').select('title, type, status, pillar_id, user_pillars(name)').eq('user_id', user.id).in('status', ['open', 'in_progress']).limit(5),
    supabase.from('semantic_entities').select('name, entity_type, context, occurrence_count').eq('user_id', user.id).order('occurrence_count', { ascending: false }).limit(20),
    supabase.from('identity_hypotheses').select('type, label, description, confidence').eq('user_id', user.id).eq('status', 'confirmed').order('confidence', { ascending: false }).limit(8),
  ]);

  const name              = profileRes.data?.name ?? 'usuário';
  const archetype         = profileRes.data?.archetype as Record<string, number> | null;
  const pillars           = pillarsRes.data   ?? [];
  const recent            = recentRes.data    ?? [];
  const quests            = questsRes.data    ?? [];
  const entities          = entitiesRes.data  ?? [];
  const confirmedIdentity = identityRes.data  ?? [];

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

  const NON_ACTIVITY_NOTE_RE =
    /\b(decis[ãa]o|decidi|vou |pretendo|quero |meta\b|objetivo|planejo|faz(?:em)? parte|como parte|parte d[eo]|descobri|virei f[ãa]|sou f[ãa]|viciad)/i;

  for (const da of detectedActivities) {
    if (
      da.durationMinutes === 0 &&
      NON_ACTIVITY_NOTE_RE.test(da.note ?? '')
    ) {
      continue;
    }

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
  // Prefixo de 4 letras em vez da palavra inteira: captura variações como
  // "corrida"/"correr" ou "estudei"/"estudo" que descrevem o mesmo evento
  // com palavras diferentes, sem precisar de matching semântico de verdade.
  const DURATION_RE = /\b\d+\s*(?:min|minutos?|h|horas?|hr)\b/i;
  const toTokens = (s: string) => new Set(
    norm(s).split(/\s+/).filter(w => w.length > 3).map(w => w.slice(0, 4)),
  );
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

  // Tipos de nota que sinalizam área de vida nova (não comida/gasto/humor,
  // cujo pillarHint costuma ser genérico demais para virar pilar).
  const PILLAR_WORTHY_NOTE_TYPES = new Set(['interest', 'idea', 'other']);

  for (const dn of notesToLog) {
    if (
      dn.pillarHint &&
      PILLAR_WORTHY_NOTE_TYPES.has(dn.noteType) &&
      !pillars.find(p => norm(p.name) === norm(dn.pillarHint!))
    ) {
      createPendingPillar(supabase, user.id, dn.pillarHint).catch(() => {});
    }

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
      let child = all.find(p => norm(p.name) === norm(dl.childName));
      if (!child) {
        // Filho ainda não existe como pilar (ex: "skate é sub-área de lazer"
        // mencionando Skate por nome pela primeira vez) — cria como pendente
        // para que o link tenha o que vincular; usuário confirma os dois juntos.
        const newId = await createPendingPillar(supabase, user.id, dl.childName);
        if (!newId) continue;
        child = { id: newId, name: dl.childName };
        all.push(child);
      }

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

  const identityTypeSections: Record<string, string> = {
    value:      'Valores',
    goal:       'Objetivos',
    belief:     'Crenças',
    motivation: 'Motivações',
    fear:       'Preocupações recorrentes',
    interest:   'Interesses',
    pattern:    'Padrões de comportamento',
  };

  const identityText = (() => {
    if (confirmedIdentity.length === 0) return '';

    const byType = new Map<string, string[]>();
    for (const h of confirmedIdentity) {
      const section = identityTypeSections[h.type] ?? h.type;
      if (!byType.has(section)) byType.set(section, []);
      byType.get(section)!.push(h.label);
    }

    const sections = [...byType.entries()]
      .map(([section, labels]) => `${section}:\n${labels.map(l => `- ${l}`).join('\n')}`)
      .join('\n\n');

    return `
Há evidências observadas de que os seguintes temas parecem importantes para ${name} neste momento:

${sections}

Quando utilizar essas informações:
- Trate-as como observações, não como definições
- Não assuma que continuam válidas — a identidade muda com o tempo
- Use-as apenas quando ajudarem a contextualizar a resposta
- Nunca force interpretações a partir delas`;
  })();

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

  const contextBlock = `== CONTEXTO DE ${name.toUpperCase()} ==
Nível geral: ${charLevel}

Pilares:
${pillarsText || '  (nenhum pilar ainda)'}

Atividades recentes:
${recentText}

Quests:
${questsText}
${entitiesText ? `\nMemória semântica:\n${entitiesText}` : ''}${retrievalText}
== FIM DO CONTEXTO ==`;

  const systemPrompt = `Você é o Anima. Fala com ${name}.

Sua natureza:
- Você acompanha a vida de ${name} — atividades, padrões, pilares, o que está indo bem e o que não está
- Você não é um assistente de agenda, não é um coach, não é um chatbot genérico
- Você conhece ${name} de verdade, pelo histórico real — use isso
- Quando perguntarem "o que você é" ou "para que serve": responda com o que você FAZ na prática, com exemplos concretos da vida de ${name} se houver dados. Nunca liste funcionalidades como um manual.

Tom e estilo:
- Direto. Sem enrolação, sem introduções, sem "Claro!", sem "Ótima pergunta!"
- Nunca abra frase com "Legal!", "Show!", "Ótimo!", "Parabéns!", "Que bom!" ou qualquer variação entusiasmada — não é torcida, é observação
- Humano. Como um amigo que presta atenção, não um assistente que quer agradar
- Sem perguntas de encerramento ("Como posso ajudar?", "Há algo mais?", "Como foi seu dia?", "Que tal...?") — encerre quando terminar, não force continuação
- Use listas APENAS quando o conteúdo for genuinamente uma lista. Para respostas conversacionais, use prosa
- Sem emojis, exceto se o contexto pedir
- Respostas curtas quando a pergunta for simples. Não expanda o que não precisa ser expandido
- Nunca invente funcionalidades, telas ou processos que não existem (ex: "área de sugestões", "ticket"). Se não souber, não responda como se soubesse
- Comida, bebida, gastos, humor e estados emocionais mencionados de passagem são registrados em segundo plano, silenciosamente — NUNCA comente, avalie, elogie, dê conselho ou questione esse conteúdo (nada de "cuidado com o orçamento", "equilibre com verduras", "respira fundo"). Reaja só ao que a pessoa trouxe como assunto da conversa
${archetypeText}
${identityText}
${activityContext}
${contextBlock}`;

  // ── Histórico recente de conversa ──────────────────────────────
  const { data: activeSession } = await supabase
    .from('conversation_sessions')
    .select('id')
    .eq('user_id', user.id)
    .is('archived_at', null)
    .maybeSingle();
  const { data: history } = await supabase
    .from('ai_conversations')
    .select('id, role, content, session_id')
    .eq('session_id', activeSession?.id ?? '00000000-0000-0000-0000-000000000000')
    .order('created_at', { ascending: false })
    .limit(10);

  // history vem em ordem DESC; a última mensagem da sessão é a primeira aqui.
  const latestMessage = history?.[0] ?? null;
  const pastMessages = [...(history ?? [])].reverse().map(m => ({
    role:    m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // Idempotência de retry (correção 3): reaproveita uma mensagem de usuário órfã
  // idêntica em vez de gravar uma segunda. Cobre o retry explícito
  // (retryMessageId) e o reenvio do mesmo texto — o duplicado visto na demo.
  let sourceMessage: { id: string; session_id: string | null };
  if (shouldReuseOrphanUserMessage({
    latest: latestMessage,
    incomingContent: message,
    retryMessageId: typeof requestedRetryMessageId === 'string' ? requestedRetryMessageId : null,
  })) {
    sourceMessage = { id: latestMessage!.id, session_id: latestMessage!.session_id };
  } else {
    const { data: inserted, error: sourceMessageError } = await supabase
      .from('ai_conversations')
      .insert({ user_id: user.id, role: 'user', content: message })
      .select('id, session_id')
      .single();
    if (sourceMessageError || !inserted) return Response.json({ error: 'Não foi possível preservar a mensagem.' }, { status: 503 });
    sourceMessage = inserted;
  }

  // Perguntas curtas de estado não podem ser respondidas pela memória textual
  // do modelo. O foco e o work_item persistido são a fonte autoritativa.
  let authoritativeStatusReply: string | null = null;
  if (isFocusedWorkStatusQuestion(message)) {
    const { data: focus } = await supabase.from('work_focus')
      .select('work_item_id').eq('user_id', user.id).maybeSingle();
    if (focus?.work_item_id) {
      const { data: focused } = await supabase.from('work_items')
        .select('state, proposal').eq('id', focus.work_item_id).maybeSingle();
      if (focused) {
        const proposal = focused.proposal as { data?: { summary?: string } };
        authoritativeStatusReply = focusedWorkStatusReply(focused.state, proposal.data?.summary ?? 'O trabalho em foco');
      }
    }
  }

  const rawInterpretation = interpretWorkRequest(message, sourceMessage.id);
  let interpretation = rawInterpretation.kind === 'work_candidate'
    ? { ...rawInterpretation, command: configureUx02DeterministicProof(message, rawInterpretation.command) }
    : rawInterpretation;
  let projectPlanningError: string | null = null;
  if (
    shouldRunProjectPlanner(developmentMode, provider)
    && rawInterpretation.kind === 'work_candidate'
    && interpretation.kind === 'work_candidate'
    && interpretation.command.intent['execution_spec'] === undefined
  ) {
    // O planejador investiga o repositório real; só roda na superfície de
    // desenvolvimento. No chat pessoal um pedido de trabalho segue o fluxo
    // honesto de proposta/indisponibilidade, sem tocar o código.
    const planned = await planExecutableProjectWork(message, interpretation.command);
    if (planned.ok) interpretation = { ...interpretation, command: planned.command };
    else projectPlanningError = planned.message;
  }
  let orchestrationMetadata: unknown = interpretation.kind === 'clarification_required'
    ? { kind: interpretation.kind, sourceMessageId: sourceMessage.id, question: interpretation.question }
    : { kind: 'conversation', sourceMessageId: sourceMessage.id };
  if (interpretation.kind === 'work_candidate') {
    if (projectPlanningError) {
      orchestrationMetadata = {
        kind: 'work_error',
        sourceMessageId: sourceMessage.id,
        error: { code: 'project_planning_failed', message: projectPlanningError },
      };
    } else {
    const startedAt = Date.now();
    const result = await createWorkOrchestrationService(supabase).createProposal(interpretation.command);
    console.info('[work-orchestration]', { operation: 'createProposalFromChat', sourceMessageId: sourceMessage.id, result: result.ok ? 'success' : result.error.code, durationMs: Date.now() - startedAt });
    if (result.ok) {
      await supabase.rpc('set_work_focus',{work_item_id:result.value.id});
      const events=await createWorkOrchestrationService(supabase).listEvents(result.value.id);
      orchestrationMetadata = { kind: 'work_proposal', sourceMessageId: sourceMessage.id, presentation: serializeWorkPresentation(result.value,events.ok?events.value:[]) };
    }
    // Capacidade ausente é mostrada honestamente (UX-00 §9), não em silêncio: a
    // Orquestração não habilitada para a conta vira um sinal tipado, não um
    // fallback mudo que deixaria o modelo inventar uma proposta.
    else if (result.error.code === 'orchestration_not_enabled') orchestrationMetadata = { kind: 'work_unavailable', sourceMessageId: sourceMessage.id, reason: 'orchestration_not_enabled' };
    else orchestrationMetadata = { kind: 'work_error', sourceMessageId: sourceMessage.id, error: { code: result.error.code, message: result.error.message } };
    }
  } else if(interpretation.kind==='conversation'&&isWorkHistoryQuery(message)){
    // UX-04 — reencontrar o próprio trabalho aberto pela conversa. A lista é a
    // MESMA reconstrução autoritativa dos cartões (fonte persistida), isolada por
    // RLS. Precede a continuação: um pedido genérico de listar/retomar mostra tudo
    // em aberto em vez de focar um referente específico.
    const workService=createWorkOrchestrationService(supabase);
    const resumable=await workService.findResumableWorkItems();
    const presentations:ReturnType<typeof serializeReconstructedWorkPresentation>[]=[];
    if(resumable.ok){for(const item of resumable.value){const events=await workService.listEvents(item.id);const contexts=await workService.listContexts(item.id);if(events.ok&&contexts.ok)presentations.push(serializeReconstructedWorkPresentation(item,events.value,contexts.value));}}
    orchestrationMetadata={kind:'work_history',sourceMessageId:sourceMessage.id,presentations};
  } else if(interpretation.kind==='conversation'&&isWorkContinuation(message)){
    const{data:focus}=await supabase.from('work_focus').select('work_item_id').eq('user_id',user.id).maybeSingle();
    const{data:candidates}=await supabase.from('work_items').select('*').eq('user_id',user.id).in('state',['proposed','approved','in_progress','blocked','review','changes_requested']).order('updated_at',{ascending:false}).limit(5);
    const resolution=resolveWorkFocus((candidates??[]).map(item=>item.id),focus?.work_item_id??undefined);
    if(resolution.kind==='focused'){const focused=candidates!.find(item=>item.id===resolution.itemId)!;await supabase.rpc('set_work_focus',{work_item_id:focused.id});const attached=await createWorkOrchestrationService(supabase).attachContext({workItemId:focused.id,expectedProposalVersion:focused.proposal_version,references:[{kind:'message',id:sourceMessage.id}]});orchestrationMetadata=attached.ok?{kind:'work_continuation',sourceMessageId:sourceMessage.id,workItemId:focused.id}:{kind:'work_error',sourceMessageId:sourceMessage.id,workItemId:focused.id,error:{code:attached.error.code,message:attached.error.message}};}
    else if(resolution.kind==='confirmation_required')orchestrationMetadata={kind:'focus_confirmation_required',sourceMessageId:sourceMessage.id,candidates:candidates!.filter(item=>resolution.itemIds.includes(item.id)).map(item=>({id:item.id,summary:(item.proposal as {data?:{summary?:string}}).data?.summary??item.original_request}))};
  }

  // O cartão real é a fonte da verdade e já foi persistido pelo servidor.
  // Prompting reduz alegações falsas, mas a garantia continua sendo determinística.
  const metaKind = (orchestrationMetadata as { kind?: string; presentations?: unknown[] })?.kind;
  const chatKind: WorkOrchestrationChatKind =
    metaKind === 'work_proposal' || metaKind === 'work_unavailable'
      ? metaKind
      : metaKind === 'work_history'
        ? (((orchestrationMetadata as { presentations?: unknown[] }).presentations?.length ?? 0) > 0 ? 'work_history' : 'work_history_empty')
        : 'none';
  const deterministicWorkReply = buildWorkOrchestrationReply(chatKind)
    ?? authoritativeStatusReply
    ?? (projectPlanningError ? `Não consegui preparar uma proposta executável: ${projectPlanningError}` : null);

  // Respostas determinísticas nunca saem da máquina. Somente uma resposta livre
  // usa o provedor explicitamente escolhido pelo usuário no compositor do chat.
  let providerResult: Awaited<ReturnType<typeof streamChatProvider>>;
  if (deterministicWorkReply) {
    providerResult = {
      provider,
      model: 'anima-deterministic',
      stream: new Response(deterministicWorkReply).body!,
    };
  } else {
    try {
      providerResult = await streamChatProvider({
        provider,
        systemPrompt,
        messages: [...pastMessages, { role: 'user', content: message }],
        developmentMode,
      });
    } catch (error) {
      const providerError = error instanceof ChatProviderError
        ? error
        : new ChatProviderError('Não foi possível conectar ao provedor de IA.', 502);
      return Response.json({ error: providerError.message }, { status: providerError.status });
    }
  }

  // ── Stream para o cliente + salva resposta ────────────────────
  let fullResponse = '';
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader  = providerResult.stream.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const token = decoder.decode(value, { stream: true });
          fullResponse += token;
          controller.enqueue(encoder.encode(token));
        }
      } catch (streamError) {
        // Interrupção mid-stream: NÃO persiste nada (não inventa resposta do
        // assistente). O turno fica órfão e retryável; o cliente vê a falha.
        controller.error(streamError instanceof Error ? streamError : new Error('Geração interrompida.'));
        return;
      }

      // Só persiste o assistente numa conclusão REAL e não vazia. Uma conclusão
      // vazia deixa o turno órfão/retryável em vez de gravar uma resposta em branco.
      if (fullResponse.trim().length > 0) {
        // session_id explícito: a resposta pertence ao turno da pergunta.
        await supabase.from('ai_conversations').insert({
          user_id: user.id,
          role: 'assistant',
          content: fullResponse,
          session_id: sourceMessage.session_id,
        });
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
          if (n > 0 && n % 5 === 0) await inferAndSaveIdentity(user.id, window);
        })().catch(() => {});
      }
      controller.close();
    },
  });

  const responseHeaders: Record<string, string> = {
    'Content-Type':           'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-AI-Provider':          providerResult.provider,
    'X-AI-Model':             providerResult.model,
  };
  responseHeaders['X-Source-Message-Id'] = sourceMessage.id;
  responseHeaders['X-Work-Orchestration'] = encodeURIComponent(JSON.stringify(orchestrationMetadata));

  // Headers HTTP são latin1: JSON com acentos (pilares em pt-BR) corromperia
  // o valor. encodeURIComponent deixa o conteúdo ASCII-safe; o cliente decodifica.

  if (loggedActivities.length > 0) {
    responseHeaders['X-Activity-Logged'] = encodeURIComponent(JSON.stringify(loggedActivities));
  }

  if (proposedLinks.length > 0) {
    responseHeaders['X-Pillar-Links'] = encodeURIComponent(JSON.stringify(proposedLinks));
  }

  return new Response(stream, { headers: responseHeaders });
}
