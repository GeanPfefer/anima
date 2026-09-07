import { evaluateTechnicalApprovalReadiness, readAutonomousExecutionSpec } from './eligibility';
import type { WorkCapability, WorkImpactLevel, WorkIntent, WorkItem, WorkProposal } from './types';
import type { WorkRecoveryAssessment } from './recovery-successor-types';

export interface RecoverySuccessorCandidate {
  readonly impactLevel: WorkImpactLevel;
  readonly capability: WorkCapability;
  readonly intent: WorkIntent;
  readonly proposal: WorkProposal;
  readonly recoveryReason: string;
  readonly recoverySequence: number;
  readonly idempotencyKey: string;
}

export type RecoverySuccessorGap =
  | 'original_not_failed'
  | 'original_not_changes_requested'
  | 'assessment_mismatch'
  | 'decomposition_not_recommended'
  | 'candidate_not_technically_ready'
  | 'scope_not_strictly_smaller'
  | 'correction_scope_invalid'
  | 'target_changed'
  | 'permission_expanded'
  | 'attempt_budget_expanded'
  | 'capability_changed'
  | 'impact_expanded'
  | 'depends_on_failed_original'
  | 'financial_authority_introduced'
  | 'lineage_input_invalid';

export type RecoverySuccessorValidation =
  | { readonly valid: true; readonly candidate: RecoverySuccessorCandidate }
  | { readonly valid: false; readonly gaps: readonly RecoverySuccessorGap[] };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const impactOrder: readonly WorkImpactLevel[] = ['low', 'significant', 'structural', 'strategic', 'financial', 'irreversible', 'external'];
const normalized = (values: readonly string[]): Set<string> => new Set(values.map(value => value.trim().toLowerCase()));
const maxAttempts = (item: WorkItem): number | null => readAutonomousExecutionSpec(item.intent)?.limits.maxAttempts ?? null;

/**
 * Envelope compartilhado por TODOS os sucessores governados (decomposição de
 * falha e correção por retomada): manter escopo dentro do original (estritamente
 * menor na recovery; subconjunto não vazio e explicitamente composto na correction) sem ampliar
 * capacidade, impacto, alvo, permissões, budget ou autoridade financeira, e ser
 * tecnicamente pronto. Independente do ESTADO/gatilho do original — o precondition
 * de estado é do chamador. Não persiste nada.
 */
function validateSuccessorEnvelope(
  original: WorkItem,
  candidate: RecoverySuccessorCandidate,
  scopeRule: 'strict_subset' | 'nonempty_subset',
): RecoverySuccessorGap[] {
  const gaps: RecoverySuccessorGap[] = [];
  if (!candidate.recoveryReason.trim() || !Number.isInteger(candidate.recoverySequence)
      || candidate.recoverySequence < 1 || !uuid.test(candidate.idempotencyKey)) gaps.push('lineage_input_invalid');
  if (candidate.capability !== original.capability) gaps.push('capability_changed');
  if (impactOrder.indexOf(candidate.impactLevel) > impactOrder.indexOf(original.impactLevel)) gaps.push('impact_expanded');

  const synthetic: WorkItem = {
    ...original, id: `recovery:${original.id}`, state: 'proposed', impactLevel: candidate.impactLevel,
    capability: candidate.capability, intent: candidate.intent, proposal: candidate.proposal, proposalVersion: 1,
  };
  const readiness = evaluateTechnicalApprovalReadiness(synthetic);
  if (!readiness.eligible) gaps.push('candidate_not_technically_ready');
  const originalSpec = readAutonomousExecutionSpec(original.intent);
  const candidateSpec = readAutonomousExecutionSpec(candidate.intent);
  if (!originalSpec || !candidateSpec) {
    if (!gaps.includes('candidate_not_technically_ready')) gaps.push('candidate_not_technically_ready');
  } else {
    if (candidateSpec.target.kind !== originalSpec.target.kind || candidateSpec.target.reference !== originalSpec.target.reference) gaps.push('target_changed');
    if (candidateSpec.permissions.some(permission => !originalSpec.permissions.includes(permission))) gaps.push('permission_expanded');
    const originalAttempts = maxAttempts(original);
    const candidateAttempts = maxAttempts(synthetic);
    if (originalAttempts !== null && (candidateAttempts === null || candidateAttempts > originalAttempts)) gaps.push('attempt_budget_expanded');
    if (candidateSpec.dependsOnWorkItemIds.includes(original.id)) gaps.push('depends_on_failed_original');
  }

  const originalScope = normalized(original.proposal.data.includedScope);
  const candidateScope = normalized(candidate.proposal.data.includedScope);
  const subset = candidateScope.size > 0 && [...candidateScope].every(entry => originalScope.has(entry));
  const allowedScope = subset && (scopeRule === 'nonempty_subset' || candidateScope.size < originalScope.size);
  if (!allowedScope) gaps.push('scope_not_strictly_smaller');
  if (/financial_authorization|paid_compute|auto.?provision/i.test(JSON.stringify({ intent: candidate.intent, proposal: candidate.proposal }))) {
    gaps.push('financial_authority_introduced');
  }
  return gaps;
}

/**
 * Valida somente decomposição: original FALHO cuja política recomenda `decompose`,
 * successor reduzindo escopo sem ampliar o envelope. Não persiste nada.
 */
export function validateRecoverySuccessor(
  original: WorkItem,
  assessment: WorkRecoveryAssessment,
  candidate: RecoverySuccessorCandidate,
): RecoverySuccessorValidation {
  const gaps: RecoverySuccessorGap[] = [];
  if (original.state !== 'failed') gaps.push('original_not_failed');
  if (assessment.workItemId !== original.id || assessment.proposalVersion !== original.proposalVersion) gaps.push('assessment_mismatch');
  if (assessment.decision.action !== 'decompose') gaps.push('decomposition_not_recommended');
  gaps.push(...validateSuccessorEnvelope(original, candidate, 'strict_subset'));
  return gaps.length ? { valid: false, gaps: [...new Set(gaps)] } : { valid: true, candidate };
}

/**
 * Valida a correção por RETOMADA de uma revisão: original em `changes_requested`,
 * successor com escopo efetivo (rework explícito U restante) e retomando do checkpoint, sem ampliar o
 * envelope. Mesmas invariantes de envelope da decomposição — só o precondition de
 * ESTADO difere (revisão em vez de falha). Não persiste nada.
 */
export function validateCorrectionSuccessor(
  original: WorkItem,
  candidate: RecoverySuccessorCandidate,
): RecoverySuccessorValidation {
  const gaps: RecoverySuccessorGap[] = [];
  if (original.state !== 'changes_requested') gaps.push('original_not_changes_requested');
  // Correction pode reabrir explicitamente todo o escopo original; ainda exige
  // subconjunto não vazio e todas as demais garantias do envelope. Recovery
  // comum permanece estritamente menor.
  gaps.push(...validateSuccessorEnvelope(original, candidate, 'nonempty_subset'));
  const rawSpec = candidate.intent['execution_spec'];
  const rawCorrection = typeof rawSpec === 'object' && rawSpec !== null && !Array.isArray(rawSpec)
    ? (rawSpec as Record<string, unknown>)['correction_scope'] : null;
  const correction = typeof rawCorrection === 'object' && rawCorrection !== null && !Array.isArray(rawCorrection)
    ? rawCorrection as Record<string, unknown> : null;
  const strings = (value: unknown): readonly string[] | null =>
    Array.isArray(value) && value.every(entry => typeof entry === 'string') ? value as string[] : null;
  const rework = strings(correction?.['rework_scope']);
  const remaining = strings(correction?.['remaining_scope']);
  const effective = strings(correction?.['effective_scope']);
  const originalScope = normalized(original.proposal.data.includedScope);
  const candidateScope = normalized(candidate.proposal.data.includedScope);
  const reworkSet = rework ? normalized(rework) : null;
  const remainingSet = remaining ? normalized(remaining) : null;
  const effectiveSet = effective ? normalized(effective) : null;
  const sameSet = (left: Set<string>, right: Set<string>): boolean =>
    left.size === right.size && [...left].every(value => right.has(value));
  const union = reworkSet && remainingSet ? new Set([...reworkSet, ...remainingSet]) : null;
  if (!reworkSet || !remainingSet || !effectiveSet || !union
      || ![...reworkSet].every(value => originalScope.has(value))
      || ![...remainingSet].every(value => originalScope.has(value))
      || !sameSet(union, effectiveSet) || !sameSet(effectiveSet, candidateScope)) {
    gaps.push('correction_scope_invalid');
  }
  return gaps.length ? { valid: false, gaps: [...new Set(gaps)] } : { valid: true, candidate };
}
