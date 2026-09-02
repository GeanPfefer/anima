import type { CanonicalBacklogCandidate } from './canonical-backlog';

// ============================================================
// Materialização de um candidato canônico em work_item — CONTRATO PURO (Level 6).
//
// Um item canônico de backlog é um OBJETIVO (fase), não uma tarefa executável única. A
// arquitetura ratificada é:
//   candidato → elegibilidade determinística → PLANNING BOUNDARY → UM slice executável
//   → proposta validada → work_item `proposed` → Supervisor/Executor/Verifier existentes.
//
// Este módulo define os contratos PUROS dessa ponte: a PROVENIÊNCIA durável (correlação
// ESTÁVEL sourceId ↔ work_item, por ID no `intent`, NUNCA por título), e as mensagens que
// alimentam o planner e registram o gatilho. NÃO cria nada, NÃO chama planner, NÃO toca
// banco — o driver (app) compõe isto com os efeitos reais.
//
// Invariantes: materialização ≠ aprovação (o desfecho é `proposed`, sob fronteira humana);
// o LLM recebe um candidato JÁ escolhido pelo domínio (nunca decide existência/elegibilidade);
// a saída do planner passa pelos MESMOS validadores de proposta/execution_spec existentes.
// ============================================================

/** Chave da proveniência canônica dentro do `intent` do work_item. Correlação estável. */
export const CANONICAL_PROVENANCE_KEY = 'canonical_provenance';

/**
 * Proveniência durável de um work_item materializado de um item canônico. Vive no
 * `intent.canonical_provenance` — correlação por `sourceId` (ID estável), nunca por título.
 */
export interface CanonicalMaterializationProvenance {
  readonly kind: 'canonical_backlog';
  /** ID canônico estável (ex.: 'SUP-01'). Chave de correlação. */
  readonly sourceId: string;
  readonly document: string;
  readonly heading: string;
  /** Objetivo canônico (título do item) — o OBJETIVO, não o slice. */
  readonly canonicalObjective: string;
  /** Geração de planejamento deste sourceId (1 = primeiro slice; 2 = próximo; …). */
  readonly planningGeneration: number;
  readonly materializationReason: string;
  /** work_item do slice ANTERIOR deste mesmo sourceId, quando houver (sequência). */
  readonly parentWorkItemId?: string;
}

export interface BuildCanonicalProvenanceInput {
  readonly candidate: CanonicalBacklogCandidate;
  readonly planningGeneration: number;
  readonly materializationReason: string;
  readonly parentWorkItemId?: string;
}

/** Monta a proveniência canônica — pura. */
export function buildCanonicalProvenance(input: BuildCanonicalProvenanceInput): CanonicalMaterializationProvenance {
  return {
    kind: 'canonical_backlog',
    sourceId: input.candidate.sourceId,
    document: input.candidate.sourceRef.document,
    heading: input.candidate.sourceRef.heading,
    canonicalObjective: input.candidate.title,
    planningGeneration: input.planningGeneration,
    materializationReason: input.materializationReason,
    ...(input.parentWorkItemId ? { parentWorkItemId: input.parentWorkItemId } : {}),
  };
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * Lê a proveniência canônica do `intent` de um work_item — pura. `null` quando o item NÃO
 * é canônico ou a proveniência é malformada (fail-safe). É a base da correlação estável.
 */
export function readCanonicalProvenanceFromIntent(intent: unknown): CanonicalMaterializationProvenance | null {
  const root = asObject(intent);
  const prov = root ? asObject(root[CANONICAL_PROVENANCE_KEY]) : null;
  if (!prov) return null;
  if (prov.kind !== 'canonical_backlog') return null;
  const sourceId = prov.sourceId;
  const document = prov.document;
  const heading = prov.heading;
  const canonicalObjective = prov.canonicalObjective;
  const planningGeneration = prov.planningGeneration;
  if (typeof sourceId !== 'string' || sourceId.length === 0) return null;
  if (typeof document !== 'string' || typeof heading !== 'string' || typeof canonicalObjective !== 'string') return null;
  if (typeof planningGeneration !== 'number' || !Number.isInteger(planningGeneration) || planningGeneration < 1) return null;
  const parentWorkItemId = typeof prov.parentWorkItemId === 'string' ? prov.parentWorkItemId : undefined;
  const materializationReason = typeof prov.materializationReason === 'string' ? prov.materializationReason : '';
  return {
    kind: 'canonical_backlog', sourceId, document, heading, canonicalObjective, planningGeneration,
    materializationReason,
    ...(parentWorkItemId ? { parentWorkItemId } : {}),
  };
}

/** Atalho: só o `sourceId` canônico do intent (para correlação), ou `null`. Puro. */
export function readCanonicalSourceIdFromIntent(intent: unknown): string | null {
  return readCanonicalProvenanceFromIntent(intent)?.sourceId ?? null;
}

/**
 * Conteúdo da MENSAGEM DE ORIGEM (provenance) da materialização — pura. NÃO é chat humano
 * fingido: é o PEDIDO DE MATERIALIZAÇÃO registrado sob a identidade do usuário (o resident
 * host age COMO o usuário), marcado explicitamente como gatilho canônico e auditável.
 */
export function buildCanonicalMaterializationMessage(candidate: CanonicalBacklogCandidate): string {
  return [
    `[backlog-canônico ${candidate.sourceId}] Materializar o próximo slice do objetivo canônico.`,
    `Objetivo (${candidate.sourceId} — ${candidate.title}).`,
    `Fonte: ${candidate.sourceRef.document} (${candidate.sourceRef.heading}).`,
  ].join('\n');
}

/**
 * Instrução de PLANEJAMENTO (o `message` para `planExecutableProjectWork`) — pura. Pede ao
 * planner EXATAMENTE UM próximo slice pequeno, causal, executável e verificável para avançar
 * o objetivo canônico, investigando o repositório real. O planner NUNCA decide elegibilidade;
 * recebe um candidato já escolhido pelo domínio.
 */
export function buildCanonicalSlicePlanningMessage(input: {
  readonly candidate: CanonicalBacklogCandidate;
  readonly planningGeneration: number;
  readonly priorSlicesSummary?: string;
}): string {
  const lines = [
    'Planeje EXATAMENTE UM próximo slice pequeno, causal, executável e verificável para AVANÇAR',
    'o objetivo canônico de backlog abaixo. NÃO tente completar o objetivo inteiro num único',
    'work_item. Investigue o repositório real antes de afirmar paths, defaults ou comportamento.',
    '',
    `Objetivo canônico (${input.candidate.sourceId} — ${input.candidate.title}).`,
    `Fonte: ${input.candidate.sourceRef.document} (${input.candidate.sourceRef.heading}).`,
    `Geração de planejamento: ${input.planningGeneration}.`,
  ];
  if (input.candidate.acceptanceCriteria.length > 0) {
    lines.push('', 'Aceite canônico obrigatório (não omita nem substitua por gates genéricos):',
      ...input.candidate.acceptanceCriteria.map(criterion => `- ${criterion}`));
  }
  if (input.priorSlicesSummary && input.priorSlicesSummary.trim().length > 0) {
    lines.push('', 'Slices anteriores deste objetivo (não repita o já feito):', input.priorSlicesSummary.trim());
  }
  return lines.join('\n');
}
