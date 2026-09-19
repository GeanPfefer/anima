import type { WorkClaimKind } from './eligibility';
import type { ObservedGateOutcomeV1 } from './host-observed-gate-evidence';

/** Policy canônica da evidência diferencial. Mudanças semânticas exigem nova versão. */
export const DIFFERENTIAL_EVIDENCE_POLICY_VERSION = 'differential-evidence-policy-v0' as const;

export type DifferentialEvidenceDecisionKind =
  | 'allow'
  | 'require_review'
  | 'deny'
  | 'insufficient_evidence';

export type DifferentialEvidenceReasonCode =
  | 'unsupported_claim_kind'
  | 'baseline_missing'
  | 'scope_unverified'
  | 'scope_mismatch'
  | 'baseline_target_missing'
  | 'target_changed'
  | 'outside_scope_change'
  | 'baseline_pass_final_pass'
  | 'baseline_pass_final_fail'
  | 'baseline_fail_final_pass'
  | 'baseline_fail_final_fail';

export interface DifferentialEvidenceRelevantFactsV0 {
  readonly baselinePresent: boolean;
  readonly scopeVerification: 'verified' | 'mismatch' | 'unverified' | 'absent';
  readonly baselineOutcome: 'passed' | 'failed' | null;
  readonly finalOutcome: 'passed' | 'failed';
  readonly quadrant: 'pass_pass' | 'pass_fail' | 'fail_pass' | 'fail_fail' | null;
  readonly missingTargets: readonly string[];
  readonly changedTargets: readonly string[];
  readonly changedFilesOutsideTargetScope: readonly string[];
}

export interface DifferentialEvidencePolicyDecisionV0 {
  readonly policyVersion: typeof DIFFERENTIAL_EVIDENCE_POLICY_VERSION;
  readonly claimKind: string;
  readonly decision: DifferentialEvidenceDecisionKind;
  readonly reasonCode: DifferentialEvidenceReasonCode;
  readonly relevantFacts: DifferentialEvidenceRelevantFactsV0;
  readonly evidenceReference: { readonly label: string; readonly command: string };
}

export interface EvaluateDifferentialEvidencePolicyInput {
  readonly claimKind?: WorkClaimKind | string;
  readonly gate: ObservedGateOutcomeV1;
}

const quadrantOf = (
  base: 'passed' | 'failed' | null,
  final: 'passed' | 'failed',
): DifferentialEvidenceRelevantFactsV0['quadrant'] => {
  if (base === null) return null;
  if (base === 'passed') return final === 'passed' ? 'pass_pass' : 'pass_fail';
  return final === 'passed' ? 'fail_pass' : 'fail_fail';
};

const quadrantReason = (
  quadrant: Exclude<DifferentialEvidenceRelevantFactsV0['quadrant'], null>,
): DifferentialEvidenceReasonCode => ({
  pass_pass: 'baseline_pass_final_pass',
  pass_fail: 'baseline_pass_final_fail',
  fail_pass: 'baseline_fail_final_pass',
  fail_fail: 'baseline_fail_final_fail',
}[quadrant] as DifferentialEvidenceReasonCode);

/**
 * Interpreta fatos; não executa, bloqueia, promove, persiste ou consulta serviços.
 * A mesma entrada e a mesma versão sempre produzem a mesma decisão.
 */
export function evaluateDifferentialEvidencePolicy(
  input: EvaluateDifferentialEvidencePolicyInput,
): DifferentialEvidencePolicyDecisionV0 {
  const { gate } = input;
  const baseline = gate.baseline;
  const missingTargets = baseline?.targets?.filter(target => !target.existedAtBase).map(target => target.path) ?? [];
  const changedTargets = baseline?.targets?.filter(target => target.changed).map(target => target.path) ?? [];
  const outside = baseline?.changedFilesOutsideTargetScope ?? [];
  const baselineOutcome = baseline?.baseOutcome ?? null;
  const quadrant = quadrantOf(baselineOutcome, gate.outcome);
  const facts: DifferentialEvidenceRelevantFactsV0 = {
    baselinePresent: baseline !== undefined,
    scopeVerification: baseline?.scopeVerification?.status ?? 'absent',
    baselineOutcome,
    finalOutcome: gate.outcome,
    quadrant,
    missingTargets,
    changedTargets,
    changedFilesOutsideTargetScope: outside,
  };
  const claimKind = input.claimKind ?? 'unknown';
  const result = (
    decision: DifferentialEvidenceDecisionKind,
    reasonCode: DifferentialEvidenceReasonCode,
  ): DifferentialEvidencePolicyDecisionV0 => ({
    policyVersion: DIFFERENTIAL_EVIDENCE_POLICY_VERSION,
    claimKind,
    decision,
    reasonCode,
    relevantFacts: facts,
    evidenceReference: { label: gate.label, command: gate.command },
  });

  if (claimKind !== 'gate_assertion' && claimKind !== 'substantive') {
    return result('insufficient_evidence', 'unsupported_claim_kind');
  }
  // A evidência diferencial não existe ou não relaciona honestamente comando e alvo.
  if (!baseline) {
    return result(claimKind === 'gate_assertion' ? 'insufficient_evidence' : 'require_review', 'baseline_missing');
  }
  if (baseline.scopeVerification?.status === 'mismatch') {
    return result('insufficient_evidence', 'scope_mismatch');
  }
  if (baseline.scopeVerification?.status !== 'verified') {
    return result(claimKind === 'gate_assertion' ? 'insufficient_evidence' : 'require_review', 'scope_unverified');
  }
  if (gate.outcome === 'failed') {
    return result('deny', quadrantReason(quadrant!));
  }
  if (missingTargets.length > 0) return result('require_review', 'baseline_target_missing');
  if (changedTargets.length > 0) return result('require_review', 'target_changed');
  if (outside.length > 0) return result('require_review', 'outside_scope_change');

  // Um gate diferencial limpo pode provar a afirmação "o gate passa". Ele nunca
  // prova sozinho a semântica substantiva associada ao gate.
  return result(
    claimKind === 'gate_assertion' ? 'allow' : 'require_review',
    quadrantReason(quadrant!),
  );
}
