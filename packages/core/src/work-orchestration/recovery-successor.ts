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
  | 'assessment_mismatch'
  | 'decomposition_not_recommended'
  | 'candidate_not_technically_ready'
  | 'scope_not_strictly_smaller'
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
 * Valida somente decomposição: o successor deve reduzir escopo sem ampliar
 * capacidade, impacto, alvo, permissões, budget ou autoridade. Não persiste nada.
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
  const strictSubset = candidateScope.size > 0 && candidateScope.size < originalScope.size
    && [...candidateScope].every(entry => originalScope.has(entry));
  if (!strictSubset) gaps.push('scope_not_strictly_smaller');
  if (/financial_authorization|paid_compute|auto.?provision/i.test(JSON.stringify({ intent: candidate.intent, proposal: candidate.proposal }))) {
    gaps.push('financial_authority_introduced');
  }
  return gaps.length ? { valid: false, gaps: [...new Set(gaps)] } : { valid: true, candidate };
}

