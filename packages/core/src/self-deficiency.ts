// ============================================================
// SELF-DEFICIENCY V0 — detecção DETERMINÍSTICA de deficiência PRÓPRIA (PURO).
//
// Primeiro passo do Self-Development Continuous Loop: em vez de o humano dizer
// EXATAMENTE o que corrigir, o ANIMA observa o PRÓPRIO funcionamento (evidência
// já persistida: work_events + assessments de capacidade DERIVADOS desses mesmos
// eventos), identifica uma deficiência ancorada em EVIDÊNCIA, e a representa de
// forma tipada e DEDUPLICADA — sem inventar defeitos, sem LLM, sem provider, sem
// tabela nova.
//
// Fronteiras epistemológicas (ratificadas neste V0):
//   - DEFICIÊNCIA ≠ PROPOSTA DE MELHORIA ≠ WORK ITEM (três coisas distintas;
//     `self-improvement.ts` cobre as outras duas);
//   - texto livre de modelo / memória textual NÃO é fonte autoritativa;
//   - uma FALHA ÚNICA não é, por padrão, deficiência estrutural;
//   - toda deficiência carrega PROVENIÊNCIA (evidenceRefs → ids reais);
//   - a detecção é PURA: duas execuções sobre o MESMO histórico produzem o MESMO
//     resultado (idempotente), e um payload inválido/incompatível FALHA FECHADO
//     (não vira deficiência, não derruba o scan).
//
// Este módulo NÃO cria trabalho, NÃO aprova, NÃO persiste — só LÊ e projeta.
// ============================================================

import type { Capability } from './capability-map';
import type { CapabilityEvidenceObservation } from './capability-proof-engine';
import { ANIMA_CAPABILITY_REGISTRY_V0 } from './capability-registry';
import { deriveCapabilityAssessmentsFromWorkHistory } from './capability-proof-assessment';
import { deriveSupervisedSelfDevelopmentEvidenceFromEvents } from './capability-proof-work-evidence';
import { recoveryFailureCode } from './work-orchestration/recovery-decision';
import type { WorkEvent, WorkState } from './work-orchestration/types';
import type { Json } from '@anima/types';

/**
 * Classes de deficiência do V0 — poucas e FORTES, cada uma ancorada num sinal
 * persistido DISTINTO e reutilizando uma primitiva canônica já ratificada:
 *   - `repeated_failure`: a MESMA causa estrutural de `execution_failed` recorre
 *     em ≥N work_items distintos (sinal: falhas de execução; primitiva:
 *     `recoveryFailureCode`, a taxonomia canônica de causa);
 *   - `capability_regression`: uma capability antes comprovada regrediu e
 *     permanece sem recovery (sinal: assessments; primitiva: o Proof Engine,
 *     `basis:'regression'`/`maturity:'degraded'`);
 *   - `verifier_recurrent_issue`: a revisão humana REJEITOU repetidamente uma
 *     auto-modificação já verificada (sinal: verifier + revisão; primitiva:
 *     `deriveSupervisedSelfDevelopmentEvidenceFromEvents`, ocasiões negativas —
 *     o padrão do falso-positivo seq4→seq5).
 */
export type SelfDeficiencyKind =
  | 'repeated_failure'
  | 'capability_regression'
  | 'verifier_recurrent_issue';

/**
 * Ciclo de vida de uma deficiência relativo ao trabalho governado que a cobre.
 * A DETECÇÃO pura sempre nasce `open`; `resolveSelfDeficiencyLifecycle` promove o
 * estado cruzando com os work_items que carregam a proveniência da deficiência:
 *   - `open`     : detectada, sem trabalho ativo nem resolução;
 *   - `covered`  : já existe work_item ATIVO/aguardando cobrindo-a (não duplicar);
 *   - `resolved` : um work_item COMPLETADO a cobriu e não houve sinal posterior;
 *   - `reopened` : houve resolução, mas o sinal RECORREU depois (semântica
 *                  explícita de recorrência pós-resolução).
 */
export type SelfDeficiencyStatus = 'open' | 'covered' | 'resolved' | 'reopened';

/** Ponteiro de proveniência para um fato REAL que sustenta a deficiência. */
export interface SelfDeficiencyEvidenceRef {
  readonly kind: 'work_event' | 'attempt' | 'work_item' | 'capability_assessment';
  readonly ref: string;
  readonly note?: string;
}

/**
 * Deficiência própria — estrutura MÍNIMA, tipada e durável (projeção, não linha
 * de tabela). `id` é a chave de DEDUP estável (`selfDeficiencyDedupeKey`): a
 * mesma deficiência observada de novo NÃO cria outra — reforça a mesma.
 */
export interface SelfDeficiencyV0 {
  readonly schemaVersion: 1;
  /** Identidade estável = chave de dedup (`${kind}|${subject}`). */
  readonly id: string;
  readonly kind: SelfDeficiencyKind;
  /** Assunto normalizado (causa de falha canônica, ou capabilityId). */
  readonly subject: string;
  /** O QUE está deficiente (uma frase). */
  readonly summary: string;
  /** POR QUE isso é uma deficiência (o critério que a torna estrutural). */
  readonly rationale: string;
  readonly evidenceRefs: readonly SelfDeficiencyEvidenceRef[];
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  /** Total de sinais equivalentes observados (quão repetido). */
  readonly occurrences: number;
  /** Ocasiões INDEPENDENTES distintas (attempts/work_items) — quão forte. */
  readonly occasions: number;
  readonly status: SelfDeficiencyStatus;
}

/** Limiares conservadores (poucos detectores fortes; recorrência exigida). */
export interface SelfDeficiencyThresholds {
  /** `repeated_failure`: mínimo de work_items DISTINTOS com a mesma causa. */
  readonly repeatedFailureMinWorkItems: number;
  /** `verifier_recurrent_issue`: mínimo de ocasiões (attempts) negativas. */
  readonly verifierRecurrentMinOccasions: number;
}

export const DEFAULT_SELF_DEFICIENCY_THRESHOLDS: SelfDeficiencyThresholds = {
  repeatedFailureMinWorkItems: 2,
  verifierRecurrentMinOccasions: 2,
};

export interface DetectSelfDeficienciesInput {
  /** Histórico canônico de eventos (append-only) do escopo observado. */
  readonly events: readonly WorkEvent[];
  /** Registry de capacidades (default: V0). Injetável para teste/versões. */
  readonly capabilities?: readonly Capability[];
  readonly thresholds?: Partial<SelfDeficiencyThresholds>;
}

/** Chave de DEDUP/identidade — determinística. `kind + subject` (a causa
 * normalizada). Causas diferentes → deficiências diferentes; equivalentes →
 * a mesma. */
export function selfDeficiencyDedupeKey(kind: SelfDeficiencyKind, subject: string): string {
  return `${kind}|${subject}`;
}

// ---------- Leitura fail-safe de payload (espelha recovery-assessment) ----------

const asRecord = (value: Json | undefined): Record<string, Json | undefined> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, Json | undefined>)
    : null;
const asText = (value: Json | undefined): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
const payloadData = (payload: Json): Record<string, Json | undefined> | null =>
  asRecord(asRecord(payload)?.['data']);

/** Evidência de falha lida de um `execution_failed`, na MESMA régua de
 * recovery-assessment (código = `executor_signal.code` ?? `reason`; mensagem
 * sanitizada e limitada). Fail-safe: campos ausentes viram `null`. */
function failureEvidenceOf(event: WorkEvent): { code: string | null; safeMessage: string | null; attemptId: string | null } {
  const root = payloadData(event.payload);
  const signal = asRecord(root?.['executor_signal']);
  const message = asText(root?.['message']);
  const safeMessage = message && message.length <= 600
    && !/(?:token|password|secret|api[_-]?key)\s*[:=]/i.test(message)
    ? message : null;
  return {
    code: asText(signal?.['code']) ?? asText(root?.['reason']),
    safeMessage,
    attemptId: asText(root?.['attempt_id']),
  };
}

const validInstant = (value: Date): boolean => value instanceof Date && Number.isFinite(value.getTime());

// ---------- Detector A: repeated_failure ----------

interface FailureGroup {
  code: string;
  eventIds: string[];
  attemptIds: Set<string>;
  workItemIds: Set<string>;
  firstMs: number;
  lastMs: number;
  occurrences: number;
}

/**
 * A MESMA causa estrutural de `execution_failed` (código canônico via
 * `recoveryFailureCode`) recorrendo em ≥N work_items DISTINTOS. Exigir MÚLTIPLOS
 * work_items é o que a torna ESTRUTURAL (um padrão que atravessa tarefas), e não
 * uma falha pontual de uma tarefa (que o recovery per-item já trata). Causa
 * não-classificável (código `null`) NUNCA vira deficiência (fail-closed: sem
 * causa identificada, não há afirmação de deficiência).
 */
function detectRepeatedFailures(
  events: readonly WorkEvent[],
  minWorkItems: number,
): SelfDeficiencyV0[] {
  const groups = new Map<string, FailureGroup>();

  for (const event of events) {
    if (event.type !== 'execution_failed') continue;
    if (!validInstant(event.occurredAt)) continue; // evento incompatível: fail-closed
    const evidence = failureEvidenceOf(event);
    const code = recoveryFailureCode({ code: evidence.code, safeMessage: evidence.safeMessage });
    if (code === null) continue; // causa não-classificável não sustenta deficiência

    const ms = event.occurredAt.getTime();
    const group = groups.get(code) ?? {
      code, eventIds: [], attemptIds: new Set<string>(), workItemIds: new Set<string>(),
      firstMs: ms, lastMs: ms, occurrences: 0,
    };
    group.eventIds.push(event.id);
    if (evidence.attemptId) group.attemptIds.add(evidence.attemptId);
    if (event.workItemId) group.workItemIds.add(event.workItemId);
    group.firstMs = Math.min(group.firstMs, ms);
    group.lastMs = Math.max(group.lastMs, ms);
    group.occurrences += 1;
    groups.set(code, group);
  }

  const deficiencies: SelfDeficiencyV0[] = [];
  for (const group of groups.values()) {
    if (group.workItemIds.size < minWorkItems) continue; // não é estrutural ainda
    const evidenceRefs: SelfDeficiencyEvidenceRef[] = [
      ...[...group.eventIds].sort().map((id): SelfDeficiencyEvidenceRef => ({ kind: 'work_event', ref: id })),
      ...[...group.attemptIds].sort().map((id): SelfDeficiencyEvidenceRef => ({ kind: 'attempt', ref: id })),
      ...[...group.workItemIds].sort().map((id): SelfDeficiencyEvidenceRef => ({ kind: 'work_item', ref: id })),
    ];
    deficiencies.push({
      schemaVersion: 1,
      id: selfDeficiencyDedupeKey('repeated_failure', group.code),
      kind: 'repeated_failure',
      subject: group.code,
      summary: `A causa de falha "${group.code}" recorre em ${group.workItemIds.size} work_items distintos.`,
      rationale:
        'A mesma causa estrutural de execução falha atravessa múltiplas tarefas — não é um incidente pontual, '
        + 'e o recovery por-item não a resolve, o que indica uma lacuna estrutural, não transitória.',
      evidenceRefs,
      firstObservedAt: new Date(group.firstMs).toISOString(),
      lastObservedAt: new Date(group.lastMs).toISOString(),
      occurrences: group.occurrences,
      occasions: group.workItemIds.size,
      status: 'open',
    });
  }
  return deficiencies;
}

// ---------- Detector B: capability_regression ----------

/**
 * Uma capability antes comprovada REGREDIU e permanece sem recovery. Não é
 * reinterpretação de texto: é exatamente o veredito do Proof Engine
 * (`basis:'regression'`, `maturity:'degraded'`), derivado dos MESMOS eventos.
 * Fail-closed: qualquer erro na derivação (histórico incompatível, timestamp
 * inválido) produz NENHUMA deficiência de regressão — não derruba o scan.
 */
function detectCapabilityRegressions(
  events: readonly WorkEvent[],
  capabilities: readonly Capability[],
): SelfDeficiencyV0[] {
  let projection: ReturnType<typeof deriveCapabilityAssessmentsFromWorkHistory>;
  try {
    projection = deriveCapabilityAssessmentsFromWorkHistory(events, capabilities);
  } catch {
    return []; // event_history_invalid → fail-closed
  }

  const deficiencies: SelfDeficiencyV0[] = [];
  for (const assessment of projection.assessments) {
    if (assessment.derivedMaturity !== 'degraded' || assessment.assessment.basis !== 'regression') continue;

    const negativeIds = new Set(assessment.assessment.contradictingEvidenceIds);
    const negatives = assessment.evidence.filter(obs => negativeIds.has(obs.id));
    if (negatives.length === 0) continue; // sem prova negativa concreta: fail-closed

    const times = negatives.map(obs => Date.parse(obs.observedAt)).filter(Number.isFinite);
    if (times.length === 0) continue;
    const occasions = new Set(negatives.map(obs => obs.occasionId).filter((id): id is string => typeof id === 'string')).size;

    const supportingRefs = assessment.assessment.supportingEvidenceIds
      .map((id): SelfDeficiencyEvidenceRef => ({ kind: 'capability_assessment', ref: id, note: 'prova forte anterior (agora sob regressão)' }));
    const negativeRefs = negatives
      .map(obs => obs.id).sort()
      .map((id): SelfDeficiencyEvidenceRef => ({ kind: 'capability_assessment', ref: id, note: 'evidência negativa que contradisse a capacidade' }));

    deficiencies.push({
      schemaVersion: 1,
      id: selfDeficiencyDedupeKey('capability_regression', assessment.capabilityId),
      kind: 'capability_regression',
      subject: assessment.capabilityId,
      summary: `A capacidade "${assessment.capabilityId}" regrediu (antes comprovada) e não se recuperou.`,
      rationale:
        'Havia prova forte anterior e a observação forte mais recente a contradisse, sem recuperação posterior. '
        + 'O Proof Engine classifica isso como regressão (degraded) — a capacidade precisa ser re-comprovada.',
      evidenceRefs: [...negativeRefs, ...supportingRefs],
      firstObservedAt: new Date(Math.min(...times)).toISOString(),
      lastObservedAt: new Date(Math.max(...times)).toISOString(),
      occurrences: negatives.length,
      occasions: occasions > 0 ? occasions : negatives.length,
      status: 'open',
    });
  }
  return deficiencies;
}

// ---------- Detector C: verifier_recurrent_issue ----------

/**
 * A revisão humana REJEITOU repetidamente (`changes_requested`) uma
 * auto-modificação já VERIFICADA de forma independente — o padrão do
 * falso-positivo seq4→seq5. Reutiliza a derivação canônica de
 * supervised-self-development e conta as OCASIÕES NEGATIVAS distintas. Uma única
 * rejeição é governança normal; a RECORRÊNCIA (≥N ocasiões) é a deficiência.
 */
function detectVerifierRecurrentIssues(
  events: readonly WorkEvent[],
  minOccasions: number,
): SelfDeficiencyV0[] {
  let observations: ReturnType<typeof deriveSupervisedSelfDevelopmentEvidenceFromEvents>;
  try {
    observations = deriveSupervisedSelfDevelopmentEvidenceFromEvents(events);
  } catch {
    return [];
  }

  const negativesByCapability = new Map<string, CapabilityEvidenceObservation[]>();
  for (const obs of observations) {
    if (obs.outcome !== 'negative') continue;
    const list = negativesByCapability.get(obs.capabilityId) ?? [];
    list.push(obs);
    negativesByCapability.set(obs.capabilityId, list);
  }

  const deficiencies: SelfDeficiencyV0[] = [];
  for (const [capabilityId, negatives] of negativesByCapability) {
    const occasions = new Set(negatives.map(obs => obs.occasionId).filter((id): id is string => typeof id === 'string'));
    // Sem occasionId não há como afirmar ocasiões independentes: fail-closed.
    if (occasions.size < minOccasions) continue;

    const times = negatives.map(obs => Date.parse(obs.observedAt)).filter(Number.isFinite);
    if (times.length === 0) continue;

    const evidenceRefs: SelfDeficiencyEvidenceRef[] = [
      ...negatives.map(obs => obs.id).sort().map((id): SelfDeficiencyEvidenceRef => ({ kind: 'capability_assessment', ref: id, note: 'ocasião de revisão que pediu mudanças' })),
      ...[...occasions].sort().map((id): SelfDeficiencyEvidenceRef => ({ kind: 'attempt', ref: id })),
    ];

    deficiencies.push({
      schemaVersion: 1,
      id: selfDeficiencyDedupeKey('verifier_recurrent_issue', capabilityId),
      kind: 'verifier_recurrent_issue',
      subject: capabilityId,
      summary: `A revisão humana pediu mudanças em ${occasions.size} auto-modificações já verificadas de "${capabilityId}".`,
      rationale:
        'A cadeia forte (mudança produzida + verificada de forma independente) passou, mas a revisão humana '
        + 'pediu mudanças em múltiplas ocasiões — um padrão recorrente de qualidade que a verificação automática '
        + 'não captura (falso-positivo verificado).',
      evidenceRefs,
      firstObservedAt: new Date(Math.min(...times)).toISOString(),
      lastObservedAt: new Date(Math.max(...times)).toISOString(),
      occurrences: negatives.length,
      occasions: occasions.size,
      status: 'open',
    });
  }
  return deficiencies;
}

/**
 * Detecta as deficiências próprias de um histórico — PURA, determinística e
 * fail-closed. Sempre devolve deficiências `open` (o ciclo de vida relativo ao
 * trabalho é resolvido à parte por `resolveSelfDeficiencyLifecycle`). Ordem
 * estável por `id` para saída idempotente.
 */
export function detectSelfDeficiencies(input: DetectSelfDeficienciesInput): readonly SelfDeficiencyV0[] {
  const thresholds = { ...DEFAULT_SELF_DEFICIENCY_THRESHOLDS, ...input.thresholds };
  const capabilities = input.capabilities ?? ANIMA_CAPABILITY_REGISTRY_V0;

  const all = [
    ...detectRepeatedFailures(input.events, thresholds.repeatedFailureMinWorkItems),
    ...detectCapabilityRegressions(input.events, capabilities),
    ...detectVerifierRecurrentIssues(input.events, thresholds.verifierRecurrentMinOccasions),
  ];
  return all.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------- Ciclo de vida relativo ao trabalho governado ----------

/**
 * Um work_item que carrega a proveniência de UMA deficiência (correlação estável
 * por `self_deficiency_provenance.deficiencyId`, lida do intent pelo chamador).
 */
export interface SelfDeficiencyCoverage {
  readonly deficiencyId: string;
  readonly workItemId: string;
  readonly state: WorkState;
  /** Última atualização do work_item (ISO) — âncora temporal da resolução. */
  readonly updatedAt: string;
}

const ACTIVE_OR_WAITING: ReadonlySet<WorkState> = new Set<WorkState>([
  'proposed', 'approved', 'in_progress', 'blocked', 'review', 'changes_requested',
]);

/**
 * Cruza deficiências detectadas com o trabalho governado que as cobre e promove o
 * `status`. Puro e determinístico:
 *   - work ATIVO/aguardando cobrindo a deficiência → `covered` (não duplicar);
 *   - senão, work `completed` cobrindo-a e SEM sinal posterior → `resolved`;
 *   - work `completed` cobrindo-a MAS com sinal posterior (lastObservedAt >
 *     updatedAt) → `reopened` (recorrência pós-resolução, semântica explícita);
 *   - cobertura só terminal-negativa (failed/rejected/cancelled) ou ausente →
 *     permanece `open` (a deficiência segue sem tratamento efetivo).
 */
export function resolveSelfDeficiencyLifecycle(
  deficiencies: readonly SelfDeficiencyV0[],
  coverage: readonly SelfDeficiencyCoverage[],
): readonly SelfDeficiencyV0[] {
  const byDeficiency = new Map<string, SelfDeficiencyCoverage[]>();
  for (const entry of coverage) {
    const list = byDeficiency.get(entry.deficiencyId) ?? [];
    list.push(entry);
    byDeficiency.set(entry.deficiencyId, list);
  }

  return deficiencies.map((deficiency): SelfDeficiencyV0 => {
    const covers = byDeficiency.get(deficiency.id) ?? [];
    if (covers.some(entry => ACTIVE_OR_WAITING.has(entry.state))) {
      return { ...deficiency, status: 'covered' };
    }
    const completed = covers.filter(entry => entry.state === 'completed');
    if (completed.length > 0) {
      const lastCompletionMs = Math.max(...completed.map(entry => Date.parse(entry.updatedAt)).filter(Number.isFinite));
      const lastSignalMs = Date.parse(deficiency.lastObservedAt);
      if (Number.isFinite(lastCompletionMs) && Number.isFinite(lastSignalMs) && lastSignalMs > lastCompletionMs) {
        return { ...deficiency, status: 'reopened' };
      }
      return { ...deficiency, status: 'resolved' };
    }
    // Cobertura só por estados terminais negativos (failed/rejected/cancelled)
    // não resolve nem bloqueia — a deficiência segue sem tratamento efetivo.
    return { ...deficiency, status: 'open' };
  });
}

/** Deficiências que MERECEM uma proposta de melhoria agora: sinal ativo e SEM
 * trabalho ativo/resolvido cobrindo-as (dedup contra work existente). */
export function selfDeficienciesAwaitingProposal(
  deficiencies: readonly SelfDeficiencyV0[],
): readonly SelfDeficiencyV0[] {
  return deficiencies.filter(d => d.status === 'open' || d.status === 'reopened');
}
