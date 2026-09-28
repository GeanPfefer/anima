// Produce-Change Evidence Projection V0 (2026-09-28) — TODAS as oportunidades reais.
//
// A derivação canônica de `agency.produce-change` (capability-proof-work-evidence.ts)
// só emite observação para a cadeia FORTE positiva: attempts que falharam, ficaram
// inconclusivas ou foram rejeitadas simplesmente não aparecem — viés de sobrevivência.
// Esta projeção começa pelo DENOMINADOR: toda lineage de programação em que a produção
// de mudança foi realmente exercida (≥1 attempt governada), e classifica cada uma como
//
//   qualified_positive | attributed_negative | inconclusive | not_attributable
//
// com causa explícita, carga de recuperação, classe de mudança, fingerprint operacional
// e proveniência da evidência técnica.
//
// Fronteira: produce-change termina no CANDIDATO materializado, identificável, dentro do
// escopo autorizado e pretendendo satisfazer o pedido. Merge/publicação/integração não
// entram. Aceite humano NÃO é requisito universal de positivo (verified basta, com
// evidência técnica confiável); a revisão humana pode, com causa estruturada, negar.
//
// NÃO É MATURIDADE: nada aqui alimenta registry, readiness, authority, auto-approval ou
// o predicado `operational` (inexistente nesta unidade). `agency.produce-change`
// continua no máximo `proven`. Puro, determinístico, sem I/O.

import { recoveryFailureCode, type RecoveryFailureKind } from './work-orchestration/recovery-decision';
import { projectWorktreeHandoff, type WorktreeHandoffV1 } from './work-orchestration/worktree-handoff';
import { projectHostObservedEvidence, type HostObservedGitEvidenceV1 } from './work-orchestration/host-observed-evidence';
import { projectHostObservedGateEvidence, terminalObservedGates, type HostObservedGateEvidenceV1 } from './work-orchestration/host-observed-gate-evidence';
import { projectHostObservedCoderEvidence, type HostObservedCoderEvidenceV1 } from './work-orchestration/host-observed-coder-evidence';
import { projectVerifierOpinionHistory, type VerifierOpinionV1 } from './work-orchestration/verifier-opinion';
import { validateWorkIntelligenceClassification, type WorkIntelligenceClassificationV1 } from './work-orchestration/work-intelligence-classification';
import { PENDING_VERIFICATION_RECOVERY_ORIGIN } from './work-orchestration/pending-verification-recovery';
import type { WorkEvent } from './work-orchestration/types';

export const PRODUCE_CHANGE_EVIDENCE_PROJECTION_VERSION = 'produce-change-evidence-v0' as const;

// ─── Vocabulário ──────────────────────────────────────────────────────────────

export type ProduceChangeOccasionOutcome =
  | 'qualified_positive'
  | 'attributed_negative'
  | 'inconclusive'
  | 'not_attributable';

/** Causas ATRIBUÍDAS à produção de mudança (o produtor falhou). */
export const PRODUCE_CHANGE_ATTRIBUTED_CAUSES = [
  'candidate_or_coder_failure',
  'scope_violation',
  'candidate_gate_failure',
  'invalid_candidate',
  'no_result_after_valid_execution',
  'verifier_rejected_candidate',
  'candidate_defect_from_human_review',
  'no_progress',
  'candidate_contract_violation',
] as const;

/** Causas de OUTRA camada — nunca atribuídas automaticamente a produce-change. */
export const PRODUCE_CHANGE_OTHER_LAYER_CAUSES = [
  'harness_failure',
  'provider_failure',
  'transport_failure',
  'toolchain_or_baseline_failure',
  'requirement_gap',
  'preference_change',
  'verifier_failure',
] as const;

/**
 * Causas INDETERMINADAS: produce-change foi exercida, mas a evidência não decide.
 * `unknown` mora aqui (não em outra camada): o que não se sabe não é atribuído a
 * ninguém — nem ao produtor, nem a uma camada alheia.
 */
export const PRODUCE_CHANGE_UNDETERMINED_CAUSES = [
  'unknown',
  'failure_unclassified',
  'gate_failure_unattributed',
  'verification_pending',
  'verifier_inconclusive',
  'technical_evidence_not_system_proven',
  'human_review_undetermined',
  'cancelled',
  'attempt_abandoned',
  'in_flight',
] as const;

export type ProduceChangeAttributedCause = typeof PRODUCE_CHANGE_ATTRIBUTED_CAUSES[number];
export type ProduceChangeOtherLayerCause = typeof PRODUCE_CHANGE_OTHER_LAYER_CAUSES[number];
export type ProduceChangeUndeterminedCause = typeof PRODUCE_CHANGE_UNDETERMINED_CAUSES[number];
export type ProduceChangeCause = ProduceChangeAttributedCause | ProduceChangeOtherLayerCause | ProduceChangeUndeterminedCause;

/** Contrato FECHADO da causa de uma revisão humana. Nunca inferido de texto livre. */
export const HUMAN_REVIEW_CAUSES = ['candidate_defect', 'verifier_miss', 'requirement_gap', 'preference_change', 'undetermined'] as const;
export type HumanReviewCause = typeof HUMAN_REVIEW_CAUSES[number];

export type ProduceChangeRecoveryBurden =
  | 'direct'
  | 'self_corrected'
  | 'recovered'
  | 'human_recovered'
  | 'scope_reduced'
  | 'unknown';

export type ProduceChangeEvidenceTrust = 'system_proven' | 'legacy_unproven';

export type ProduceChangeClass =
  | { readonly kind: 'structural'; readonly key: string }
  | { readonly kind: 'unknown' };

export type ProduceChangeGap =
  | 'change_class_taxonomy_missing'
  | 'change_class_missing'
  | 'human_review_cause_missing'
  | 'fingerprint_current_generation_uncovered'
  | 'negative_attribution_incomplete'
  | 'recovery_burden_incomplete'
  | 'trusted_evidence_generation_missing'
  | 'work_item_facts_missing'
  | 'operational_predicate_not_defined';

// ─── Entrada ──────────────────────────────────────────────────────────────────

/** Fatos mínimos do work item (a tabela, não o log): capability e intent. */
export interface ProduceChangeWorkItemFactsV0 {
  readonly id: string;
  readonly capability: string;
  readonly impactLevel: string | null;
  readonly intent: unknown;
}

/** Linha de `work_recovery_lineage` (original → sucessor). */
export interface ProduceChangeLineageLinkV0 {
  readonly originalWorkItemId: string;
  readonly successorWorkItemId: string;
  readonly recoverySequence: number;
}

export interface ProduceChangeHistoryV0 {
  readonly events: readonly WorkEvent[];
  readonly items: readonly ProduceChangeWorkItemFactsV0[];
  readonly lineageLinks: readonly ProduceChangeLineageLinkV0[];
  /**
   * Início VERIFICÁVEL da geração em que fatos técnicos (`author=system`) só podiam ser
   * gravados pelo Trusted System Writer no ambiente lido (writer provisionado e RPCs
   * restritas). O payload não carrega identidade do writer: sem esta fronteira NADA é
   * `system_proven` — o histórico antigo nunca é promovido retroativamente.
   */
  readonly trustedSystemEvidenceSince: string | null;
  /** Fingerprint da geração corrente (opcional) — para o gap de cobertura. */
  readonly currentFingerprint?: string | null;
}

// ─── Saída ────────────────────────────────────────────────────────────────────

export interface ProduceChangeAttemptFactV0 {
  readonly workItemId: string;
  readonly attemptId: string;
  readonly proposalVersion: number;
  readonly outcome: ProduceChangeOccasionOutcome;
  readonly cause: ProduceChangeCause | null;
  readonly humanReviewCause: HumanReviewCause | null;
  /** Positivo só barrado pela proveniência da evidência técnica. */
  readonly wouldQualifyWithTrustedEvidence: boolean;
  readonly evidenceTrust: ProduceChangeEvidenceTrust | null;
  readonly operationalFingerprint: string;
  readonly evidenceRefs: readonly string[];
}

export interface ProduceChangeOperationalOccasionV0 {
  /** Ocasião = LINEAGE (raiz): attempts sucessoras não são independência operacional. */
  readonly lineageId: string;
  readonly workItemIds: readonly string[];
  readonly proposalVersions: readonly string[];
  readonly attemptIds: readonly string[];
  readonly outcome: ProduceChangeOccasionOutcome;
  /** Causas de TODAS as attempts, em ordem (um sucessor não apaga a negativa anterior). */
  readonly causes: readonly ProduceChangeCause[];
  readonly attempts: readonly ProduceChangeAttemptFactV0[];
  readonly recoveryBurden: ProduceChangeRecoveryBurden;
  /** Positivo que conta como produção independente (direct/self_corrected/recovered). */
  readonly independentPositive: boolean;
  /** Positivo que prova apenas o escopo reduzido. */
  readonly provesReducedScopeOnly: boolean;
  readonly changeClass: ProduceChangeClass;
  readonly operationalFingerprint: string;
  readonly evidenceTrust: ProduceChangeEvidenceTrust | null;
  readonly evidenceRefs: readonly string[];
  readonly humanReviewCause: HumanReviewCause | null;
  readonly explanation: string;
}

export type ProduceChangeExclusionReason = 'not_programming' | 'not_exercised' | 'work_item_facts_missing';

export interface ProduceChangeOperationalEvidenceV0 {
  readonly projectionVersion: typeof PRODUCE_CHANGE_EVIDENCE_PROJECTION_VERSION;
  readonly capabilityId: 'agency.produce-change';
  /** Esta projeção NÃO promove: o teto segue o da derivação canônica. */
  readonly maturityCeiling: 'proven';
  readonly occasions: readonly ProduceChangeOperationalOccasionV0[];
  readonly excluded: readonly { readonly lineageId: string; readonly reason: ProduceChangeExclusionReason }[];
  readonly eligibleLineages: number;
  readonly positives: { readonly total: number; readonly independent: number; readonly humanRecovered: number; readonly scopeReduced: number };
  readonly negatives: number;
  readonly inconclusive: number;
  readonly notAttributable: number;
  /** Negativas atribuídas por attempt, inclusive em lineages que depois se recuperaram. */
  readonly attributedNegativeAttempts: number;
  readonly causes: Readonly<Partial<Record<ProduceChangeCause, number>>>;
  readonly coverageByChangeClass: Readonly<Record<string, ProduceChangeOutcomeCounts>>;
  readonly coverageByFingerprint: Readonly<Record<string, ProduceChangeOutcomeCounts>>;
  readonly recoveryBurden: Readonly<Record<ProduceChangeRecoveryBurden, number>>;
  readonly gaps: readonly ProduceChangeGap[];
}

export interface ProduceChangeOutcomeCounts {
  readonly qualified_positive: number;
  readonly attributed_negative: number;
  readonly inconclusive: number;
  readonly not_attributable: number;
}

// ─── Leitura de eventos ───────────────────────────────────────────────────────

type Data = Record<string, unknown>;
const object = (value: unknown): Data | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : null;
const dataOf = (event: WorkEvent): Data | null => object(object(event.payload)?.data);
const text = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;
const time = (event: WorkEvent): number => {
  const value = event.occurredAt.getTime();
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
};
const chronological = (left: WorkEvent, right: WorkEvent): number => time(left) - time(right) || left.id.localeCompare(right.id);

const TECHNICAL_EVENT_TYPES: ReadonlySet<WorkEvent['type']> = new Set([
  'host_observed_evidence_recorded',
  'host_observed_gate_evidence_recorded',
  'host_observed_coder_evidence_recorded',
  'verifier_opinion_recorded',
]);

/**
 * Códigos ESTRUTURADOS (`[token]` do backend ou código do sinal) além do allowlist do
 * `decideRecovery`, mapeados para a mesma família. Token fora do allowlist ⇒ nada
 * (prosa nunca classifica).
 */
const PRODUCER_CODE_KINDS: Readonly<Record<string, RecoveryFailureKind>> = {
  ollama_ambiguous_replacement: 'code_failure',
  ollama_invalid_response_schema: 'code_failure',
  ollama_submit_gate_unsatisfied: 'no_progress',
  ollama_context_budget_exceeded: 'context_limit',
};

type FailureClassification =
  | { readonly kind: 'attributed'; readonly cause: ProduceChangeAttributedCause }
  | { readonly kind: 'other_layer'; readonly cause: ProduceChangeOtherLayerCause }
  | { readonly kind: 'undetermined'; readonly cause: ProduceChangeUndeterminedCause }
  | { readonly kind: 'gate' };

function classifyFailureCode(code: string | null, message: string | null): FailureClassification {
  const normalized = recoveryFailureCode({ code, safeMessage: message });
  const bracketed = message?.match(/\[([a-z0-9_]{3,64})\]/i)?.[1]?.toLowerCase() ?? null;
  const producerKind = bracketed ? PRODUCER_CODE_KINDS[bracketed] : undefined;
  if (!normalized && producerKind) return fromKind(producerKind);
  switch (normalized) {
    case null: return { kind: 'undetermined', cause: 'failure_unclassified' };
    case 'gate_failed': return { kind: 'gate' };
    case 'code_failure': return { kind: 'attributed', cause: 'candidate_or_coder_failure' };
    case 'ollama_read_round_limit': return { kind: 'attributed', cause: 'candidate_or_coder_failure' };
    case 'no_progress': case 'loop_detected': case 'ollama_no_effective_edits': return { kind: 'attributed', cause: 'no_progress' };
    case 'contract_violation': return { kind: 'attributed', cause: 'candidate_contract_violation' };
    case 'ollama_transport_error': return { kind: 'other_layer', cause: 'transport_failure' };
    case 'provider_unavailable': case 'external_unavailable': return { kind: 'other_layer', cause: 'provider_failure' };
    case 'worktree_create_failed': case 'environment_unavailable':
    case 'resource_pressure': case 'insufficient_memory': case 'insufficient_vram':
      return { kind: 'other_layer', cause: 'toolchain_or_baseline_failure' };
    case 'invalid_request': case 'attempt_payload_conflict': return { kind: 'other_layer', cause: 'harness_failure' };
    case 'execution_cancelled': case 'cancelled': return { kind: 'undetermined', cause: 'cancelled' };
    default: return { kind: 'undetermined', cause: 'unknown' };
  }
}

function fromKind(kind: RecoveryFailureKind): FailureClassification {
  if (kind === 'code_failure') return { kind: 'attributed', cause: 'candidate_or_coder_failure' };
  if (kind === 'no_progress') return { kind: 'attributed', cause: 'no_progress' };
  // Orçamento de contexto do harness: nem o produtor nem outra camada inequivocamente.
  return { kind: 'undetermined', cause: 'unknown' };
}

/** Gate falho: só a baseline diferencial decide a quem pertence a falha. */
function classifyGateFailure(gates: HostObservedGateEvidenceV1 | null): FailureClassification {
  if (!gates) return { kind: 'undetermined', cause: 'gate_failure_unattributed' };
  const failed = terminalObservedGates(gates.gates).filter(gate => gate.outcome !== 'passed');
  if (failed.length === 0) return { kind: 'undetermined', cause: 'gate_failure_unattributed' };
  if (failed.some(gate => gate.timedOut || gate.cancelled)) return { kind: 'undetermined', cause: 'unknown' };
  if (failed.every(gate => gate.baseline?.baseOutcome === 'failed')) return { kind: 'other_layer', cause: 'toolchain_or_baseline_failure' };
  if (failed.some(gate => gate.baseline?.baseOutcome === 'passed' && !gate.baseline.baseTimedOut && !gate.baseline.baseCancelled)) {
    return { kind: 'attributed', cause: 'candidate_gate_failure' };
  }
  return { kind: 'undetermined', cause: 'gate_failure_unattributed' };
}

/** Violação estruturada do parecer → causa. Nenhum achado reconhecido ⇒ rejeição genérica. */
function causeFromRejectedOpinion(opinion: VerifierOpinionV1, gates: HostObservedGateEvidenceV1 | null): FailureClassification {
  const codes = new Set(opinion.findings.filter(finding => finding.severity === 'violation').map(finding => finding.code));
  if (codes.has('change_in_excluded_scope') || codes.has('change_out_of_included_scope')) return { kind: 'attributed', cause: 'scope_violation' };
  if (codes.has('attested_contradicts_observed')) return { kind: 'attributed', cause: 'candidate_contract_violation' };
  if (codes.has('correlation_mismatch') || codes.has('observed_correlation_mismatch') || codes.has('observed_gate_correlation_mismatch')) {
    return { kind: 'other_layer', cause: 'verifier_failure' };
  }
  if (codes.has('gate_exit_code_incoherent') || codes.has('attested_gate_contradicts_observed')) return { kind: 'attributed', cause: 'invalid_candidate' };
  if (codes.has('gate_failed') || codes.has('status_contradicts_gates')) {
    const gate = classifyGateFailure(gates);
    return gate.kind === 'gate' ? { kind: 'undetermined', cause: 'gate_failure_unattributed' } : gate;
  }
  if (codes.has('reported_failure')) return { kind: 'attributed', cause: 'candidate_or_coder_failure' };
  return { kind: 'attributed', cause: 'verifier_rejected_candidate' };
}

const isHumanReviewCause = (value: unknown): value is HumanReviewCause =>
  typeof value === 'string' && (HUMAN_REVIEW_CAUSES as readonly string[]).includes(value);

/** Causa humana PERSISTIDA e estruturada; ausente ⇒ `undetermined` (nunca retroativa). */
function readHumanReviewCause(event: WorkEvent): HumanReviewCause {
  const value = dataOf(event)?.human_review_cause;
  return isHumanReviewCause(value) ? value : 'undetermined';
}

// ─── Fingerprint ──────────────────────────────────────────────────────────────

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Contratos OBSERVÁVEIS da attempt — nunca HEAD/SHA global. */
function fingerprintOf(parts: {
  readonly executorId: string | null;
  readonly backendId: string | null;
  readonly verifierRequirement: string;
  readonly verifierVersion: string | null;
  readonly gateContract: string;
  readonly evidenceSchema: string;
  readonly changeClass: ProduceChangeClass;
}): string {
  const canonical = [
    `projection=${PRODUCE_CHANGE_EVIDENCE_PROJECTION_VERSION}`,
    `executor=${parts.executorId ?? 'unknown'}`,
    `coder=${parts.backendId ?? 'none'}`,
    `verifier=${parts.verifierRequirement}/${parts.verifierVersion ?? 'none'}`,
    `gates=${parts.gateContract}`,
    `evidence=${parts.evidenceSchema}`,
    'scope=exact_path_v1',
    'handoff=worktree_handoff_v1',
    `class=${parts.changeClass.kind === 'structural' ? parts.changeClass.key : 'unknown'}`,
  ].join('|');
  return `pcf0-${fnv1a(canonical)}`;
}

// ─── Estrutura da lineage ─────────────────────────────────────────────────────

function lineageRoots(items: readonly ProduceChangeWorkItemFactsV0[], links: readonly ProduceChangeLineageLinkV0[], extraIds: readonly string[]): Map<string, string> {
  const parent = new Map<string, string>();
  for (const link of links) parent.set(link.successorWorkItemId, link.originalWorkItemId);
  const root = (id: string): string => {
    let current = id;
    const seen = new Set<string>();
    while (parent.has(current) && !seen.has(current)) { seen.add(current); current = parent.get(current)!; }
    return current;
  };
  const roots = new Map<string, string>();
  for (const id of [...items.map(item => item.id), ...extraIds, ...links.flatMap(link => [link.originalWorkItemId, link.successorWorkItemId])]) {
    roots.set(id, root(id));
  }
  return roots;
}

const specOf = (item: ProduceChangeWorkItemFactsV0 | undefined): Data | null => object(object(item?.intent)?.execution_spec);

function changeClassOf(root: ProduceChangeWorkItemFactsV0 | undefined, events: readonly WorkEvent[]): ProduceChangeClass {
  const target = text(object(specOf(root)?.target)?.kind);
  const impact = root?.impactLevel ?? null;
  let classification: WorkIntelligenceClassificationV1 | null = null;
  for (const event of events) {
    if (event.type !== 'work_intelligence_classified') continue;
    const candidate = dataOf(event)?.classification;
    if (validateWorkIntelligenceClassification(candidate) === null) classification = candidate as WorkIntelligenceClassificationV1;
  }
  if (!target || !impact || !classification || classification.complexity === 'unknown' || classification.risk === 'unknown') {
    return { kind: 'unknown' };
  }
  return { kind: 'structural', key: `target=${target};impact=${impact};complexity=${classification.complexity};risk=${classification.risk}` };
}

// ─── Attempt ──────────────────────────────────────────────────────────────────

interface AttemptContext {
  readonly workItemId: string;
  readonly attemptId: string;
  readonly proposalVersion: number;
  readonly executorId: string | null;
  readonly started: WorkEvent;
  readonly itemEvents: readonly WorkEvent[];
  readonly harnessDefectFromSuccessor: boolean;
  readonly verifierRequirement: string;
  readonly changeClass: ProduceChangeClass;
  readonly trustedSince: number | null;
}

const byAttempt = (events: readonly WorkEvent[], attemptId: string): readonly WorkEvent[] =>
  events.filter(event => text(dataOf(event)?.attempt_id) === attemptId);

function latestOf<T>(events: readonly WorkEvent[], type: WorkEvent['type'], project: (event: WorkEvent) => T | null): { readonly event: WorkEvent; readonly value: T } | null {
  let found: { readonly event: WorkEvent; readonly value: T } | null = null;
  for (const event of events) {
    if (event.type !== type) continue;
    const value = project(event);
    if (value !== null) found = { event, value };
  }
  return found;
}

function scopeOf(itemEvents: readonly WorkEvent[], version: number): { readonly included: ReadonlySet<string>; readonly excluded: ReadonlySet<string> } | null {
  let scope: { included: ReadonlySet<string>; excluded: ReadonlySet<string> } | null = null;
  for (const event of itemEvents) {
    if ((event.type !== 'work_proposed' && event.type !== 'proposal_revised') || (event.proposalVersion ?? 1) > version) continue;
    const proposal = object(object(dataOf(event)?.proposal)?.data);
    const included = proposal?.included_scope;
    const excluded = proposal?.excluded_scope;
    if (!Array.isArray(included) || !Array.isArray(excluded)) continue;
    const norm = (value: unknown): string => String(value).replace(/\\/g, '/');
    scope = { included: new Set(included.map(norm)), excluded: new Set(excluded.map(norm)) };
  }
  return scope;
}

function classifyAttempt(context: AttemptContext): ProduceChangeAttemptFactV0 {
  const events = byAttempt(context.itemEvents, context.attemptId);
  const handoffResult = latestOf(events, 'result_submitted', event => projectWorktreeHandoff([event]));
  const resultEvent = latestOf(events, 'result_submitted', event => event);
  const failed = latestOf(events, 'execution_failed', event => event);
  const cancelled = latestOf(events, 'work_cancelled', event => event);
  const abandoned = latestOf(events, 'attempt_abandoned', event => event);
  const git = latestOf<HostObservedGitEvidenceV1>(events, 'host_observed_evidence_recorded', event => projectHostObservedEvidence([event]));
  const gates = latestOf<HostObservedGateEvidenceV1>(events, 'host_observed_gate_evidence_recorded', event => projectHostObservedGateEvidence([event]));
  const coder = latestOf<HostObservedCoderEvidenceV1>(events, 'host_observed_coder_evidence_recorded', event => projectHostObservedCoderEvidence([event]));

  const resultId = resultEvent?.event.id ?? null;
  const opinion = resultId === null ? null : latestOf<VerifierOpinionV1>(events, 'verifier_opinion_recorded', event => {
    const projected = projectVerifierOpinionHistory([event]);
    return projected.length === 1 && projected[0]!.evidenceBasis.resultEventId === resultId ? projected[0]! : null;
  });

  // Decisões humanas sobre ESTE resultado (review normal ou recuperação de pendente).
  const human = resultId === null ? [] : context.itemEvents.filter(event => {
    const data = dataOf(event);
    return (event.type === 'result_accepted' && text(data?.accepted_result_event_id) === resultId)
      || (event.type === 'changes_requested' && (text(data?.reviewed_result_event_id) === resultId || text(data?.resolved_result_event_id) === resultId))
      || (event.type === 'work_cancelled' && text(data?.resolved_result_event_id) === resultId);
  }).sort(chronological);
  const decision = human.at(-1) ?? null;
  const pendingRecovery = decision !== null && text(dataOf(decision)?.origin) === PENDING_VERIFICATION_RECOVERY_ORIGIN;

  const refs = [context.started, resultEvent?.event, failed?.event, git?.event, gates?.event, coder?.event, opinion?.event, decision]
    .filter((event): event is WorkEvent => event !== undefined && event !== null).map(event => event.id);
  const technical = [git?.event, gates?.event, coder?.event, opinion?.event].filter((event): event is WorkEvent => !!event);
  const trust: ProduceChangeEvidenceTrust | null = technical.length === 0 ? null
    : technical.every(event => event.author === 'system' && TECHNICAL_EVENT_TYPES.has(event.type)
        && context.trustedSince !== null && time(event) >= context.trustedSince) ? 'system_proven' : 'legacy_unproven';

  const fingerprint = fingerprintOf({
    executorId: context.executorId,
    backendId: handoffResult?.value.backendId ?? coder?.value.backendId ?? null,
    verifierRequirement: context.verifierRequirement,
    verifierVersion: opinion?.value.verifierVersion ?? null,
    gateContract: gates === null ? 'none' : gates.value.gates.some(gate => gate.baseline !== undefined) ? 'differential_v1' : 'observed_v1',
    evidenceSchema: [git ? 'git1' : '-', gates ? 'gate1' : '-', coder ? 'coder1' : '-'].join('+'),
    changeClass: context.changeClass,
  });

  const fact = (outcome: ProduceChangeOccasionOutcome, cause: ProduceChangeCause | null, extra: Partial<Pick<ProduceChangeAttemptFactV0, 'humanReviewCause' | 'wouldQualifyWithTrustedEvidence'>> = {}): ProduceChangeAttemptFactV0 => ({
    workItemId: context.workItemId, attemptId: context.attemptId, proposalVersion: context.proposalVersion,
    outcome, cause, humanReviewCause: extra.humanReviewCause ?? null,
    wouldQualifyWithTrustedEvidence: extra.wouldQualifyWithTrustedEvidence ?? false,
    evidenceTrust: trust, operationalFingerprint: fingerprint, evidenceRefs: refs,
  });
  const fromClassification = (classification: FailureClassification): ProduceChangeAttemptFactV0 => {
    if (classification.kind === 'gate') return fromClassification(classifyGateFailure(gates?.value ?? null));
    return classification.kind === 'attributed' ? fact('attributed_negative', classification.cause)
      : classification.kind === 'other_layer' ? fact('not_attributable', classification.cause)
        : fact('inconclusive', classification.cause);
  };

  // (1) Falha terminal sem candidato.
  if (!resultEvent) {
    if (failed) {
      const data = dataOf(failed.event);
      const signal = object(data?.executor_signal);
      const classification = classifyFailureCode(text(signal?.code) ?? text(data?.reason), text(data?.message));
      // Autoridade humana ESTRUTURADA (`harness_recovery.failureClass='harness'` no
      // sucessor) classificou a falha desta unidade como defeito do harness.
      if (context.harnessDefectFromSuccessor && classification.kind !== 'other_layer') return fact('not_attributable', 'harness_failure');
      // Sem código, mas o host OBSERVOU gate terminal reprovado nesta attempt: o fato
      // estruturado decide (regra de gate/baseline), não a prosa da mensagem.
      const observedGateFailure = gates !== null && terminalObservedGates(gates.value.gates).some(gate => gate.outcome !== 'passed');
      if (classification.kind === 'undetermined' && classification.cause === 'failure_unclassified' && observedGateFailure) {
        return fromClassification({ kind: 'gate' });
      }
      if (classification.kind === 'undetermined' && classification.cause === 'failure_unclassified'
          && coder?.value.outcome === 'succeeded' && !context.harnessDefectFromSuccessor) {
        // Coder concluiu (host-observed) e nenhum candidato foi entregue, sem causa de
        // outra camada identificada: a produção não materializou candidato.
        return fact('attributed_negative', 'no_result_after_valid_execution');
      }
      return fromClassification(classification);
    }
    if (cancelled) return fact('inconclusive', 'cancelled');
    if (abandoned) return fact('inconclusive', 'attempt_abandoned');
    return fact('inconclusive', 'in_flight');
  }

  // (2) Candidato entregue.
  const handoff: WorktreeHandoffV1 | null = handoffResult?.value ?? null;
  if (!handoff) return fact('attributed_negative', 'invalid_candidate');
  if (handoff.status !== 'succeeded') {
    const gateFailed = handoff.gates.some(gate => gate.outcome === 'failed');
    return gateFailed ? fromClassification({ kind: 'gate' }) : fact('attributed_negative', 'candidate_or_coder_failure');
  }
  if (git) {
    const declared = [...handoff.changedFiles].sort();
    const observed = [...git.value.observedChangedFiles].sort();
    if (git.value.observedCommitSha !== handoff.commitSha || declared.length !== observed.length || declared.some((path, index) => path !== observed[index])) {
      return fact('attributed_negative', 'candidate_contract_violation');
    }
    const scope = scopeOf(context.itemEvents, context.proposalVersion);
    const paths = git.value.observedChangedFilesSinceStart ?? git.value.observedChangedFiles;
    if (scope && paths.some(path => scope.excluded.has(path.replace(/\\/g, '/')) || !scope.included.has(path.replace(/\\/g, '/')))) {
      return fact('attributed_negative', 'scope_violation');
    }
  }
  if (gates && terminalObservedGates(gates.value.gates).some(gate => gate.outcome !== 'passed')) {
    const classification = classifyGateFailure(gates.value);
    if (classification.kind !== 'undetermined' || classification.cause !== 'gate_failure_unattributed') return fromClassification(classification);
  }

  // (3) Parecer do Verifier + decisão humana.
  const humanCause = decision && decision.type === 'changes_requested' ? readHumanReviewCause(decision) : pendingRecovery ? 'undetermined' as const : null;
  if (!opinion || opinion.value.verdict === 'inconclusive') {
    // Recuperação humana de candidato pendente: fato humano, NUNCA defeito automático.
    const pendingCause: ProduceChangeCause = opinion ? 'verifier_inconclusive' : 'verification_pending';
    if (decision && decision.type === 'changes_requested' && !pendingRecovery) return reviewOutcome(humanCause ?? 'undetermined');
    return fact('inconclusive', pendingCause, { humanReviewCause: humanCause });
  }
  if (opinion.value.verdict === 'rejected') {
    const classification = causeFromRejectedOpinion(opinion.value, gates?.value ?? null);
    const rejected = fromClassification(classification);
    return { ...rejected, humanReviewCause: humanCause };
  }

  // verified
  if (decision && decision.type === 'changes_requested') return reviewOutcome(humanCause ?? 'undetermined');
  if (!git || !gates || !coder || coder.value.outcome !== 'succeeded') return fact('inconclusive', 'verification_pending');
  if (trust !== 'system_proven') return fact('inconclusive', 'technical_evidence_not_system_proven', { wouldQualifyWithTrustedEvidence: true });
  return fact('qualified_positive', null);

  function reviewOutcome(cause: HumanReviewCause): ProduceChangeAttemptFactV0 {
    switch (cause) {
      case 'candidate_defect': case 'verifier_miss':
        return fact('attributed_negative', 'candidate_defect_from_human_review', { humanReviewCause: cause });
      case 'requirement_gap': case 'preference_change':
        return fact('not_attributable', cause, { humanReviewCause: cause });
      default:
        return fact('inconclusive', 'human_review_undetermined', { humanReviewCause: 'undetermined' });
    }
  }
}

// ─── Carga de recuperação ─────────────────────────────────────────────────────

function recoveryBurdenOf(
  workItemIds: readonly string[],
  itemsById: ReadonlyMap<string, ProduceChangeWorkItemFactsV0>,
  eventsByItem: ReadonlyMap<string, readonly WorkEvent[]>,
  attempts: readonly ProduceChangeAttemptFactV0[],
): ProduceChangeRecoveryBurden {
  if (workItemIds.some(id => !itemsById.has(id))) return 'unknown';
  if (attempts.length === 0) return 'unknown';
  const specs = workItemIds.map(id => specOf(itemsById.get(id)));
  const humanAuthority = specs.some(spec => spec !== null && ('human_resume' in spec || 'harness_recovery' in spec))
    || workItemIds.some(id => (eventsByItem.get(id) ?? []).some(event => {
      const data = dataOf(event);
      return (event.type === 'work_approved' && event.author === 'user' && (data?.authorization_id !== undefined || data?.additional_attempts !== undefined))
        || ((event.type === 'changes_requested' || event.type === 'work_cancelled') && text(data?.origin) === PENDING_VERIFICATION_RECOVERY_ORIGIN);
    }));
  if (humanAuthority) return 'human_recovered';
  if (specs.slice(1).some(spec => spec !== null && ('correction_scope' in spec || 'resume_from_checkpoint' in spec))) return 'scope_reduced';
  if (attempts.length === 1) return 'direct';
  if (workItemIds.length > 1) return 'recovered';
  // Mesma unidade, nova attempt: re-admissão humana (retry governado) ⇒ recovered;
  // re-admissão só de sistema ⇒ self_corrected.
  const readmissions = (eventsByItem.get(workItemIds[0]!) ?? []).filter(event => event.type === 'work_approved' && dataOf(event)?.failure_event_id !== undefined);
  if (readmissions.length === 0) return 'unknown';
  return readmissions.some(event => event.author === 'user') ? 'recovered' : 'self_corrected';
}

// ─── Projeção ─────────────────────────────────────────────────────────────────

const emptyCounts = (): { -readonly [K in keyof ProduceChangeOutcomeCounts]: number } =>
  ({ qualified_positive: 0, attributed_negative: 0, inconclusive: 0, not_attributable: 0 });

/**
 * Projeta TODAS as oportunidades de produce-change. Determinística: a ordem de entrada
 * não importa (eventos são canonicalizados por occurredAt + id).
 */
export function projectProduceChangeOperationalEvidence(history: ProduceChangeHistoryV0): ProduceChangeOperationalEvidenceV0 {
  const events = [...history.events].sort(chronological);
  const itemsById = new Map(history.items.map(item => [item.id, item] as const));
  const eventsByItem = new Map<string, WorkEvent[]>();
  for (const event of events) {
    const list = eventsByItem.get(event.workItemId) ?? [];
    list.push(event);
    eventsByItem.set(event.workItemId, list);
  }
  const trustedSince = history.trustedSystemEvidenceSince === null ? null : Date.parse(history.trustedSystemEvidenceSince);
  const roots = lineageRoots(history.items, history.lineageLinks, [...eventsByItem.keys()]);
  const members = new Map<string, string[]>();
  for (const [id, root] of roots) members.set(root, [...(members.get(root) ?? []), id]);
  const sequence = new Map(history.lineageLinks.map(link => [link.successorWorkItemId, link.recoverySequence] as const));

  const occasions: ProduceChangeOperationalOccasionV0[] = [];
  const excluded: { lineageId: string; reason: ProduceChangeExclusionReason }[] = [];
  let itemFactsMissing = false;

  for (const [root, ids] of [...members].sort(([left], [right]) => left.localeCompare(right))) {
    const workItemIds = [...new Set(ids)].sort((left, right) => (left === root ? -1 : right === root ? 1 : (sequence.get(left) ?? 0) - (sequence.get(right) ?? 0) || left.localeCompare(right)));
    const started = workItemIds.flatMap(id => (eventsByItem.get(id) ?? []).filter(event => event.type === 'execution_started' && text(dataOf(event)?.attempt_id) !== null));
    if (workItemIds.some(id => !itemsById.has(id))) {
      if (started.length > 0) itemFactsMissing = true;
      excluded.push({ lineageId: root, reason: 'work_item_facts_missing' });
      continue;
    }
    if (workItemIds.some(id => itemsById.get(id)!.capability !== 'programming')) { excluded.push({ lineageId: root, reason: 'not_programming' }); continue; }
    if (started.length === 0) { excluded.push({ lineageId: root, reason: 'not_exercised' }); continue; }

    const rootItem = itemsById.get(root);
    const changeClass = changeClassOf(rootItem, eventsByItem.get(root) ?? []);
    const harnessOriginals = new Set(history.lineageLinks
      .filter(link => { const spec = specOf(itemsById.get(link.successorWorkItemId)); return spec !== null && 'harness_recovery' in spec; })
      .map(link => link.originalWorkItemId));

    const attempts = started.sort(chronological).map(start => {
      const data = dataOf(start);
      const item = itemsById.get(start.workItemId)!;
      return classifyAttempt({
        workItemId: start.workItemId,
        attemptId: text(data?.attempt_id)!,
        proposalVersion: typeof data?.approved_proposal_version === 'number' ? data.approved_proposal_version : start.proposalVersion ?? 1,
        executorId: text(data?.executor_id),
        started: start,
        itemEvents: eventsByItem.get(start.workItemId) ?? [],
        harnessDefectFromSuccessor: harnessOriginals.has(start.workItemId),
        verifierRequirement: text(specOf(item)?.verifier_requirement) ?? 'advisory',
        changeClass,
        trustedSince: trustedSince !== null && Number.isFinite(trustedSince) ? trustedSince : null,
      });
    });

    const last = attempts.at(-1)!;
    const outcome: ProduceChangeOccasionOutcome = last.outcome === 'qualified_positive' ? 'qualified_positive'
      : attempts.some(attempt => attempt.outcome === 'attributed_negative') ? 'attributed_negative'
        : attempts.some(attempt => attempt.outcome === 'inconclusive') ? 'inconclusive'
          : 'not_attributable';
    const recoveryBurden = recoveryBurdenOf(workItemIds, itemsById, eventsByItem, attempts);
    const independentPositive = outcome === 'qualified_positive' && (recoveryBurden === 'direct' || recoveryBurden === 'self_corrected' || recoveryBurden === 'recovered');
    const humanReviewCause = [...attempts].reverse().find(attempt => attempt.humanReviewCause !== null)?.humanReviewCause ?? null;
    const causes = attempts.map(attempt => attempt.cause).filter((cause): cause is ProduceChangeCause => cause !== null);

    occasions.push({
      lineageId: root,
      workItemIds,
      proposalVersions: [...new Set(attempts.map(attempt => `${attempt.workItemId}:v${attempt.proposalVersion}`))],
      attemptIds: attempts.map(attempt => attempt.attemptId),
      outcome,
      causes,
      attempts,
      recoveryBurden,
      independentPositive,
      provesReducedScopeOnly: outcome === 'qualified_positive' && recoveryBurden === 'scope_reduced',
      changeClass,
      operationalFingerprint: last.operationalFingerprint,
      evidenceTrust: last.evidenceTrust,
      evidenceRefs: attempts.flatMap(attempt => attempt.evidenceRefs),
      humanReviewCause,
      explanation: explain(outcome, last, attempts.length, recoveryBurden),
    });
  }

  return summarize(occasions, excluded, history, itemFactsMissing);
}

function explain(outcome: ProduceChangeOccasionOutcome, last: ProduceChangeAttemptFactV0, attempts: number, burden: ProduceChangeRecoveryBurden): string {
  const scope = `${attempts} attempt(s), carga ${burden}`;
  switch (outcome) {
    case 'qualified_positive': return `Candidato verificado com evidência técnica system_proven (${scope}).`;
    case 'attributed_negative': return `Falha atribuída à produção de mudança (${scope}); última causa: ${last.cause ?? 'nenhuma'}.`;
    case 'not_attributable': return `Falha de outra camada (${last.cause ?? 'desconhecida'}); não pesa sobre produce-change (${scope}).`;
    default: return last.wouldQualifyWithTrustedEvidence
      ? `Cadeia forte presente, mas a evidência técnica não é system_proven: não qualifica (${scope}).`
      : `Produção exercida sem conclusão (${last.cause ?? 'indeterminado'}; ${scope}).`;
  }
}

function summarize(
  occasions: readonly ProduceChangeOperationalOccasionV0[],
  excluded: readonly { lineageId: string; reason: ProduceChangeExclusionReason }[],
  history: ProduceChangeHistoryV0,
  itemFactsMissing: boolean,
): ProduceChangeOperationalEvidenceV0 {
  const count = (outcome: ProduceChangeOccasionOutcome): number => occasions.filter(occasion => occasion.outcome === outcome).length;
  const positives = occasions.filter(occasion => occasion.outcome === 'qualified_positive');
  const causes: Partial<Record<ProduceChangeCause, number>> = {};
  for (const cause of occasions.flatMap(occasion => occasion.causes)) causes[cause] = (causes[cause] ?? 0) + 1;
  const byClass: Record<string, ReturnType<typeof emptyCounts>> = {};
  const byFingerprint: Record<string, ReturnType<typeof emptyCounts>> = {};
  for (const occasion of occasions) {
    // `unknown` NÃO cobre classe nenhuma: fica fora da cobertura por classe.
    if (occasion.changeClass.kind === 'structural') (byClass[occasion.changeClass.key] ??= emptyCounts())[occasion.outcome] += 1;
    (byFingerprint[occasion.operationalFingerprint] ??= emptyCounts())[occasion.outcome] += 1;
  }
  const burden: Record<ProduceChangeRecoveryBurden, number> = { direct: 0, self_corrected: 0, recovered: 0, human_recovered: 0, scope_reduced: 0, unknown: 0 };
  for (const occasion of occasions) burden[occasion.recoveryBurden] += 1;

  const attempts = occasions.flatMap(occasion => occasion.attempts);
  const gaps = new Set<ProduceChangeGap>(['change_class_taxonomy_missing', 'operational_predicate_not_defined']);
  if (occasions.some(occasion => occasion.changeClass.kind === 'unknown')) gaps.add('change_class_missing');
  if (attempts.some(attempt => attempt.humanReviewCause === 'undetermined')) gaps.add('human_review_cause_missing');
  const current = history.currentFingerprint ?? null;
  if (current === null || !positives.some(occasion => occasion.independentPositive && occasion.operationalFingerprint === current)) gaps.add('fingerprint_current_generation_uncovered');
  if (attempts.some(attempt => attempt.cause === 'failure_unclassified' || attempt.cause === 'gate_failure_unattributed' || attempt.cause === 'unknown')) gaps.add('negative_attribution_incomplete');
  if (burden.unknown > 0) gaps.add('recovery_burden_incomplete');
  if (history.trustedSystemEvidenceSince === null || !attempts.some(attempt => attempt.evidenceTrust === 'system_proven')) gaps.add('trusted_evidence_generation_missing');
  if (itemFactsMissing) gaps.add('work_item_facts_missing');

  return {
    projectionVersion: PRODUCE_CHANGE_EVIDENCE_PROJECTION_VERSION,
    capabilityId: 'agency.produce-change',
    maturityCeiling: 'proven',
    occasions,
    excluded,
    eligibleLineages: occasions.length,
    positives: {
      total: positives.length,
      independent: positives.filter(occasion => occasion.independentPositive).length,
      humanRecovered: positives.filter(occasion => occasion.recoveryBurden === 'human_recovered').length,
      scopeReduced: positives.filter(occasion => occasion.recoveryBurden === 'scope_reduced').length,
    },
    negatives: count('attributed_negative'),
    inconclusive: count('inconclusive'),
    notAttributable: count('not_attributable'),
    attributedNegativeAttempts: attempts.filter(attempt => attempt.outcome === 'attributed_negative').length,
    causes,
    coverageByChangeClass: byClass,
    coverageByFingerprint: byFingerprint,
    recoveryBurden: burden,
    gaps: [...gaps].sort(),
  };
}
