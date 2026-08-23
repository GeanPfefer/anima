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
  readonly sourceRef: CanonicalBacklogSourceRef;
}

export interface ParseCanonicalBacklogInput {
  readonly document: string;
  readonly markdown: string;
}

const HEADING_RE = /^###\s+([A-Z]{2,6}-\d{2})\s+—\s+(.+?)\s*$/;
const H2_RE = /^##\s+/;
const H3_RE = /^###\s+/;
const STATE_RE = /^\s*\*\*(?:Estado|Atualiza[^:]*)[^:]*:\*\*\s*(.+?)\s*$/;
const DEP_RE = /\*\*Depend[^:]*:\*\*\s*([^*]*)/;
const ID_RE = /\b[A-Z]{2,6}-\d{2}\b/g;

/**
 * Classifica o estado do item a partir do texto da linha de estado — PURA e determinística.
 * Ordem cuidadosa: negações ("não ratificado", "não iniciado") ANTES do positivo homônimo,
 * para não classificar "não ratificado" como `done` por conter "ratificad".
 */
export function classifyCanonicalBacklogStatus(stateText: string | null): CanonicalBacklogStatus {
  if (stateText === null) return 'unknown';
  const t = stateText.toLowerCase();
  const negRatified = t.includes('não ratificad') || t.includes('nao ratificad');
  if (negRatified) return 'awaiting_review';
  if (t.includes('não iniciad') || t.includes('nao iniciad') || t.includes('not started')) return 'not_started';
  if (t.includes('pronto para revis') || t.includes('aguardando')) return 'awaiting_review';
  if (t.includes('conclu') || t.includes('ratific') || t.includes('aceit') || t.includes('implementad')) return 'done';
  return 'unknown';
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
  stateText: string | null;
  dependencies: string[];
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
      status: classifyCanonicalBacklogStatus(b.stateText),
      statusEvidence: b.stateText,
      dependencies: b.dependencies.filter(id => id !== b.sourceId),
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
        stateText: null,
        dependencies: [],
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
    if (current.stateText === null) {
      const state = STATE_RE.exec(line);
      if (state) current.stateText = state[1]!.trim();
    }
    if (current.dependencies.length === 0) {
      const dep = DEP_RE.exec(line);
      if (dep) current.dependencies = [...extractIds(dep[1]!)];
    }
  }
  if (current) finalize(current);
  return candidates;
}
