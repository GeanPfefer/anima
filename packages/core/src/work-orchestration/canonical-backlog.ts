// ============================================================
// Descoberta READ-ONLY do backlog CANÔNICO/DOCUMENTAL (primeiro recorte).
//
// O backlog OPERACIONAL do Anima já são `work_items` (runtime). Há também um backlog
// CANÔNICO em documentos — `docs/planos/002-modo-autonomo-v0-backlog.md` é a fonte única
// dos itens do Modo Autônomo V0, com IDs ESTÁVEIS (`ORQ-01`, `AUTO-02`, `SUP-04`, …),
// dependências explícitas e estado por item. Hoje um humano ainda traduz "essa linha do
// roadmap" → work_item.
//
// Este módulo é o PRIMEIRO passo dessa ponte: uma função PURA e DETERMINÍSTICA que
// responde "quais candidatos canônicos existem?" — SEM LLM (a estrutura é suficiente),
// SEM criar trabalho, SEM tabela nova. Só LÊ o documento e projeta candidatos tipados.
// A eligibilidade/materialização são recortes seguintes; aqui NÃO se decide nem se cria
// nada. A autoridade continua sendo o domínio (work_items) — isto é uma projeção de leitura.
// ============================================================

/** Estado do candidato inferido do documento — deterministicamente, por palavra-chave.
 * `unknown` é honesto: o documento não deixou o estado explícito no corpo do item. */
export type CanonicalBacklogStatus = 'done' | 'awaiting_review' | 'not_started' | 'unknown';

export interface CanonicalBacklogSourceRef {
  /** Documento de origem (ex.: 'docs/planos/002-modo-autonomo-v0-backlog.md'). */
  readonly document: string;
  /** Texto do heading do item (ex.: 'ORQ-01 — Resultado e evidências visíveis'). */
  readonly heading: string;
  /** Linha 1-based do heading no documento. */
  readonly line: number;
}

export interface CanonicalBacklogCandidate {
  /** ID canônico ESTÁVEL do item no documento (ex.: 'ORQ-01'). */
  readonly sourceId: string;
  readonly title: string;
  readonly status: CanonicalBacklogStatus;
  /** Trecho bruto da linha de estado que dirigiu a classificação (auditoria); `null` se ausente. */
  readonly statusEvidence: string | null;
  /** IDs canônicos dos quais este item depende (só os com forma de ID; refs de fase são ignoradas). */
  readonly dependencies: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly sourceRef: CanonicalBacklogSourceRef;
}

export interface ParseCanonicalBacklogInput {
  readonly document: string;
  readonly markdown: string;
}

const HEADING_RE = /^###\s+([A-Z]{2,6}-\d{2})\s+—\s+(.+?)\s*$/;
const H2_RE = /^##\s+/;
const H3_RE = /^###\s+/;
// Campo EXPLÍCITO de estado (machine-readable + human-readable), preferido sobre a
// heurística de prosa. Ex.: `**Status:** not_started` ou `**Status:** concluído`.
const STATUS_RE = /^\s*[-*]?\s*\*\*Status:\*\*\s*(.+?)\s*$/;
const STATE_RE = /^\s*\*\*(?:Estado|Atualiza[^:]*)[^:]*:\*\*\s*(.+?)\s*$/;
const DEP_RE = /\*\*Depend[^:]*:\*\*\s*([^*]*)/;
const ACCEPTANCE_RE = /^\s*[-*]?\s*\*\*Aceite:\*\*\s*(.+?)\s*$/;
const ID_RE = /\b[A-Z]{2,6}-\d{2}\b/g;

// Tokens diretos aceitos no campo `**Status:**` (além das palavras-chave em prosa).
const EXPLICIT_STATUS_TOKENS: Readonly<Record<string, CanonicalBacklogStatus>> = {
  done: 'done', not_started: 'not_started', awaiting_review: 'awaiting_review', unknown: 'unknown',
};

/**
 * Classifica o valor de um campo `**Status:**` EXPLÍCITO — aceita tokens diretos
 * (`done`/`not_started`/`awaiting_review`/`unknown`) e cai na heurística de palavra-chave
 * (concluído/aceito/…) caso contrário. Determinística.
 */
export function classifyExplicitStatus(value: string): CanonicalBacklogStatus {
  const token = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return EXPLICIT_STATUS_TOKENS[token] ?? classifyCanonicalBacklogStatus(value);
}

// Marcadores de estado ordenados por PRIORIDADE de posição: a linha de estado é prosa e
// pode citar o estado de OUTROS itens ("...ratificou... Próxima fase: Fase F, não iniciada").
// O estado do PRÓPRIO item costuma vir PRIMEIRO, então classificamos pelo marcador que
// aparece MAIS CEDO no texto — não por prioridade de categoria (que confundiria a citação
// tardia com o estado do item). Negação de ratificação é tratada no ponto de match.
const STATUS_MARKERS: readonly { readonly needle: string; readonly status: CanonicalBacklogStatus }[] = [
  { needle: 'não iniciad', status: 'not_started' },
  { needle: 'nao iniciad', status: 'not_started' },
  { needle: 'pronto para revis', status: 'awaiting_review' },
  { needle: 'aguardando', status: 'awaiting_review' },
  { needle: 'conclu', status: 'done' },
  { needle: 'ratific', status: 'done' }, // negação ("não ratificad") tratada abaixo
  { needle: 'aceit', status: 'done' },
];

/**
 * Classifica o estado do item a partir do texto da linha de estado — PURA e determinística.
 * Usa o marcador de estado que aparece MAIS CEDO no texto (o estado do próprio item costuma
 * ser declarado antes de citações a outros itens). `ratific` precedido de "não " → awaiting.
 */
export function classifyCanonicalBacklogStatus(stateText: string | null): CanonicalBacklogStatus {
  if (stateText === null) return 'unknown';
  const t = stateText.toLowerCase();
  let best: { index: number; status: CanonicalBacklogStatus } | null = null;
  for (const marker of STATUS_MARKERS) {
    const index = t.indexOf(marker.needle);
    if (index < 0) continue;
    let status = marker.status;
    // "não ratificado" / "nao ratificado" logo antes de um match de `ratific` → awaiting.
    if (marker.needle === 'ratific') {
      const prefix = t.slice(Math.max(0, index - 5), index);
      if (prefix.includes('não ') || prefix.includes('nao ')) status = 'awaiting_review';
    }
    if (best === null || index < best.index) best = { index, status };
  }
  return best?.status ?? 'unknown';
}

/** Extrai IDs canônicos distintos de um texto (ex.: da linha de dependências). Puro. */
function extractIds(text: string): readonly string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(ID_RE)) ids.add(match[0]);
  return [...ids];
}

interface Building {
  sourceId: string;
  title: string;
  heading: string;
  line: number;
  explicitStatus: string | null;
  stateText: string | null;
  dependencies: string[];
  acceptanceCriteria: string[];
}

/**
 * Projeta os candidatos canônicos de um documento de backlog — PURA e determinística.
 * Para cada `### <ID> — <Título>`, colhe (dentro da seção, até o próximo `##`/`###`): a
 * PRIMEIRA linha de estado (convenção novo-no-topo) e a linha de dependências. Não decide
 * elegibilidade nem materializa — só lê e projeta. Itens duplicados (mesmo ID) mantêm a
 * PRIMEIRA ocorrência (o heading canônico), ignorando repetições em prosa.
 */
export function parseCanonicalBacklog(input: ParseCanonicalBacklogInput): readonly CanonicalBacklogCandidate[] {
  const lines = input.markdown.split(/\r?\n/);
  const candidates: CanonicalBacklogCandidate[] = [];
  const seen = new Set<string>();
  let current: Building | null = null;

  const finalize = (b: Building): void => {
    if (seen.has(b.sourceId)) return; // primeira ocorrência vence
    seen.add(b.sourceId);
    candidates.push({
      sourceId: b.sourceId,
      title: b.title,
      // Campo `**Status:**` explícito PREFERIDO; senão, a heurística de prosa (Estado/Atualização).
      status: b.explicitStatus !== null ? classifyExplicitStatus(b.explicitStatus) : classifyCanonicalBacklogStatus(b.stateText),
      statusEvidence: b.explicitStatus ?? b.stateText,
      dependencies: b.dependencies.filter(id => id !== b.sourceId),
      acceptanceCriteria: b.acceptanceCriteria,
      sourceRef: { document: input.document, heading: b.heading, line: b.line },
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const heading = HEADING_RE.exec(line);
    if (heading) {
      if (current) finalize(current);
      current = {
        sourceId: heading[1]!,
        title: heading[2]!.trim(),
        heading: `${heading[1]} — ${heading[2]!.trim()}`,
        line: i + 1,
        explicitStatus: null,
        stateText: null,
        dependencies: [],
        acceptanceCriteria: [],
      };
      continue;
    }
    // Um novo heading de grupo (##) ou outro item (###) fecha a seção corrente.
    if (current && (H2_RE.test(line) || H3_RE.test(line))) {
      finalize(current);
      current = null;
      continue;
    }
    if (!current) continue;
    if (current.explicitStatus === null) {
      const explicit = STATUS_RE.exec(line);
      if (explicit) current.explicitStatus = explicit[1]!.trim();
    }
    if (current.stateText === null) {
      const state = STATE_RE.exec(line);
      if (state) current.stateText = state[1]!.trim();
    }
    if (current.dependencies.length === 0) {
      const dep = DEP_RE.exec(line);
      if (dep) current.dependencies = [...extractIds(dep[1]!)];
    }
    const acceptance = ACCEPTANCE_RE.exec(line);
    if (acceptance) current.acceptanceCriteria.push(acceptance[1]!.trim());
  }
  if (current) finalize(current);
  return candidates;
}

// ============================================================
// Elegibilidade DETERMINÍSTICA → próximo candidato materializável (segundo recorte).
//
// Ainda NÃO executa e NÃO cria nada: decide, de forma PURA e conservadora, qual candidato
// canônico poderia virar um `work_item proposed` a seguir. Conservador de propósito:
// - `done`/`awaiting_review` NÃO reaparecem (já resolvidos);
// - já ligado a um work_item NÃO duplica;
// - `unknown` NÃO materializa (poderia estar concluído — o doc não auto-declarou; exige
//   resolução de estado antes, não um palpite);
// - `not_started` só materializa com TODAS as dependências `done` (satisfeitas);
// - dependência não satisfeita → BLOQUEADO, mas NÃO congela os outros (um pronto depois
//   na ordem canônica ainda é escolhido).
// A ordem é a DO DOCUMENTO (FIFO/canônica). Materialização ≠ aprovação: mesmo o escolhido
// só viraria uma PROPOSTA, sujeita às fronteiras humanas existentes.
// ============================================================

/** Por que um candidato NÃO é materializável agora (auditoria). */
export type CanonicalCandidateBlock =
  | 'settled'            // done / awaiting_review
  | 'already_materialized'
  | 'status_unknown'
  | 'dependency_unresolved'
  | 'ready';

export interface CanonicalMaterializationPending {
  readonly settled: number;
  readonly alreadyMaterialized: number;
  readonly statusUnknown: number;
  readonly blocked: number;
  readonly ready: number;
}

export type CanonicalMaterializationStop =
  | 'no_candidates'
  | 'all_settled'
  | 'awaiting_dependencies'
  | 'status_unresolved';

export type CanonicalMaterializationDecision =
  | { readonly action: 'materialize'; readonly candidate: CanonicalBacklogCandidate }
  | { readonly action: 'none'; readonly reason: CanonicalMaterializationStop; readonly pending: CanonicalMaterializationPending };

export interface PlanCanonicalMaterializationInput {
  /** Candidatos em ORDEM CANÔNICA (do documento). */
  readonly candidates: readonly CanonicalBacklogCandidate[];
  /** IDs canônicos já ligados a um work_item (não duplicar). */
  readonly materializedSourceIds?: ReadonlySet<string>;
}

/** Classifica um candidato quanto à materializabilidade — puro. Uma dependência é
 * satisfeita apenas quando seu status é `done` (conservador). */
export function classifyCandidateForMaterialization(
  candidate: CanonicalBacklogCandidate,
  statusById: ReadonlyMap<string, CanonicalBacklogStatus>,
  materialized: ReadonlySet<string>,
): CanonicalCandidateBlock {
  if (materialized.has(candidate.sourceId)) return 'already_materialized';
  if (candidate.status === 'done' || candidate.status === 'awaiting_review') return 'settled';
  if (candidate.status === 'unknown') return 'status_unknown';
  // status === 'not_started': materializável só com todas as dependências `done`.
  for (const dep of candidate.dependencies) {
    if (statusById.get(dep) !== 'done') return 'dependency_unresolved';
  }
  return 'ready';
}

/**
 * Decide o PRÓXIMO candidato materializável — puro e determinístico. Escolhe o PRIMEIRO
 * `ready` na ordem canônica; se nenhum, devolve `none` com a razão e o detalhamento. Um
 * item bloqueado/unknown NUNCA congela um pronto posterior.
 */
export function planCanonicalBacklogMaterialization(
  input: PlanCanonicalMaterializationInput,
): CanonicalMaterializationDecision {
  const materialized = input.materializedSourceIds ?? new Set<string>();
  const statusById = new Map<string, CanonicalBacklogStatus>(input.candidates.map(c => [c.sourceId, c.status]));

  // Acumulador mutável; o resultado tipado (readonly) é estruturalmente compatível.
  const pending = { settled: 0, alreadyMaterialized: 0, statusUnknown: 0, blocked: 0, ready: 0 };
  let chosen: CanonicalBacklogCandidate | null = null;

  for (const candidate of input.candidates) {
    const block = classifyCandidateForMaterialization(candidate, statusById, materialized);
    switch (block) {
      case 'settled': pending.settled++; break;
      case 'already_materialized': pending.alreadyMaterialized++; break;
      case 'status_unknown': pending.statusUnknown++; break;
      case 'dependency_unresolved': pending.blocked++; break;
      case 'ready':
        pending.ready++;
        if (chosen === null) chosen = candidate; // primeiro pronto na ordem canônica
        break;
    }
  }

  if (chosen !== null) return { action: 'materialize', candidate: chosen };
  if (input.candidates.length === 0) return { action: 'none', reason: 'no_candidates', pending };
  if (pending.blocked > 0) return { action: 'none', reason: 'awaiting_dependencies', pending };
  if (pending.statusUnknown > 0) return { action: 'none', reason: 'status_unresolved', pending };
  return { action: 'none', reason: 'all_settled', pending };
}
