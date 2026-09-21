import type { EnforcementReadinessDecisionV0, EnforcementReadinessDisposition } from './enforcement-readiness-policy';
import {
  READINESS_CALIBRATION_VERSION,
  classifyReadinessCalibration,
  rollupAttemptReadiness,
  summarizeReadinessCalibration,
  type ReadinessCalibrationRecordV0,
} from './readiness-calibration';

// Só fatos estruturais das decisões importam ao rollup; o resto do parecer é preenchido
// com um esqueleto válido mínimo (nunca lido pelo rollup/classificação).
const decision = (disposition: EnforcementReadinessDisposition): EnforcementReadinessDecisionV0 => ({
  policyVersion: 'enforcement-readiness-v0',
  claimKind: 'gate_assertion',
  disposition,
  reasonCode: 'discriminating_gate_candidate',
  evidenceStrength: {
    differentialStatus: 'discriminating',
    policyDecision: 'allow',
    quadrant: 'fail_pass',
    finalOutcome: 'passed',
    changeAuthorization: { status: 'verified', authorizedChangedFiles: [], unauthorizedChangedFiles: [] },
  },
  policyReference: { policyVersion: 'differential-evidence-policy-v0', decision: 'allow', reasonCode: 'baseline_fail_final_pass' },
  evidenceReference: { label: 'unit', command: 'npm test' },
});

describe('rollupAttemptReadiness', () => {
  it('sem decisões ⇒ no_readiness', () => {
    expect(rollupAttemptReadiness([])).toBe('no_readiness');
  });

  it('todas eligible ⇒ eligible', () => {
    expect(rollupAttemptReadiness([decision('eligible'), decision('eligible')])).toBe('eligible');
  });

  it('um único gate não-elegível domina (conservador): eligible + requires_review ⇒ requires_review', () => {
    expect(rollupAttemptReadiness([decision('eligible'), decision('requires_review')])).toBe('requires_review');
  });

  it('a disposição mais conservadora vence: requires_review + blocked ⇒ blocked', () => {
    expect(rollupAttemptReadiness([decision('requires_review'), decision('blocked'), decision('eligible')])).toBe('blocked');
  });

  it('insufficient_evidence supera requires_review mas não blocked', () => {
    expect(rollupAttemptReadiness([decision('requires_review'), decision('insufficient_evidence')])).toBe('insufficient_evidence');
  });
});

describe('classifyReadinessCalibration', () => {
  it('eligible + accepted ⇒ confirmed_eligible', () => {
    expect(classifyReadinessCalibration('eligible', 'accepted')).toBe('confirmed_eligible');
  });
  it('eligible + changes_requested ⇒ optimistic_miss (falso positivo)', () => {
    expect(classifyReadinessCalibration('eligible', 'changes_requested')).toBe('optimistic_miss');
  });
  it('requires_review + changes_requested ⇒ conservative_confirmed', () => {
    expect(classifyReadinessCalibration('requires_review', 'changes_requested')).toBe('conservative_confirmed');
  });
  it('blocked + accepted ⇒ conservative_overruled', () => {
    expect(classifyReadinessCalibration('blocked', 'accepted')).toBe('conservative_overruled');
  });
  it('no_readiness ⇒ no_signal em qualquer desfecho', () => {
    expect(classifyReadinessCalibration('no_readiness', 'accepted')).toBe('no_signal');
    expect(classifyReadinessCalibration('no_readiness', 'changes_requested')).toBe('no_signal');
  });
});

describe('summarizeReadinessCalibration', () => {
  const record = (
    outcome: ReadinessCalibrationRecordV0['outcome'],
    rollup: ReadinessCalibrationRecordV0['rollup'],
    review: ReadinessCalibrationRecordV0['review'],
  ): ReadinessCalibrationRecordV0 => ({
    workItemId: 'w', attemptId: `a-${outcome}-${review}`, approvedProposalVersion: 2, rollup, review, outcome,
  });

  it('amostra vazia ⇒ zeros e precisão null (nunca fabrica confiança)', () => {
    const summary = summarizeReadinessCalibration([]);
    expect(summary.version).toBe(READINESS_CALIBRATION_VERSION);
    expect(summary.total).toBe(0);
    expect(summary.eligibleAttempts).toBe(0);
    expect(summary.eligiblePrecision).toBeNull();
  });

  it('precisão de eligible = confirmados / (confirmados + otimistas)', () => {
    const summary = summarizeReadinessCalibration([
      record('confirmed_eligible', 'eligible', 'accepted'),
      record('confirmed_eligible', 'eligible', 'accepted'),
      record('confirmed_eligible', 'eligible', 'accepted'),
      record('optimistic_miss', 'eligible', 'changes_requested'),
      record('conservative_confirmed', 'requires_review', 'changes_requested'),
      record('no_signal', 'no_readiness', 'accepted'),
    ]);
    expect(summary.total).toBe(6);
    expect(summary.byOutcome.confirmed_eligible).toBe(3);
    expect(summary.byOutcome.optimistic_miss).toBe(1);
    expect(summary.byOutcome.conservative_confirmed).toBe(1);
    expect(summary.byOutcome.no_signal).toBe(1);
    expect(summary.eligibleAttempts).toBe(4);
    expect(summary.eligiblePrecision).toBeCloseTo(0.75, 5);
  });
});
