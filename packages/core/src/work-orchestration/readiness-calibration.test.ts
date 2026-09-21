import type { EnforcementReadinessDecisionV0, EnforcementReadinessDisposition } from './enforcement-readiness-policy';
import {
  READINESS_CALIBRATION_VERSION,
  classifyReadinessCalibration,
  correlateReadinessCalibration,
  rollupAttemptReadiness,
  summarizeReadinessCalibration,
  type ReadinessCalibrationRecordV0,
} from './readiness-calibration';
import { buildHostObservedGateEvidence } from './host-observed-gate-evidence';
import type { WorkEvent } from './types';
import type { Json } from '@anima/types';

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

// ---------- Correlação sobre o log ----------

const resultSubmitted = (id: string, attemptId: string, version: number, time: string): WorkEvent => ({
  id, workItemId: 'w1', type: 'result_submitted', author: 'executor', proposalVersion: version,
  payload: { schema_version: 1, data: { work_item_id: 'w1', attempt_id: attemptId, approved_proposal_version: version } } as unknown as Json,
  occurredAt: new Date(time),
});

const gateEvidenceEvent = (id: string, attemptId: string, version: number, evidence: Json, time: string): WorkEvent => ({
  id, workItemId: 'w1', type: 'host_observed_gate_evidence_recorded', author: 'system', proposalVersion: version,
  payload: { schema_version: 1, data: { work_item_id: 'w1', attempt_id: attemptId, approved_proposal_version: version, evidence } } as unknown as Json,
  occurredAt: new Date(time),
});

const acceptedEvent = (id: string, resultEventId: string, time: string): WorkEvent => ({
  id, workItemId: 'w1', type: 'result_accepted', author: 'user', proposalVersion: 2,
  payload: { schema_version: 1, data: { accepted_result_event_id: resultEventId } } as unknown as Json,
  occurredAt: new Date(time),
});

const changesRequestedEvent = (id: string, resultEventId: string, time: string): WorkEvent => ({
  id, workItemId: 'w1', type: 'changes_requested', author: 'user', proposalVersion: 2,
  payload: { schema_version: 1, data: { reviewed_result_event_id: resultEventId, requested_changes: 'x' } } as unknown as Json,
  occurredAt: new Date(time),
});

/** Evidência de gate host-observada com readiness ELIGIBLE (gate_assertion +
 * diferencial discriminating + change authorization verified). */
const eligibleEvidence = (attemptId: string): Json => {
  const built = buildHostObservedGateEvidence({
    workItemId: 'w1', attemptId, approvedProposalVersion: 2,
    gates: [{
      label: 'unit', command: 'npm test -- src/a.ts', exitCode: 0, durationMs: 100, timedOut: false, cancelled: false,
      claimKind: 'gate_assertion',
      baseline: {
        baseExitCode: 1, baseTimedOut: false, baseCancelled: false,
        targets: [{ path: 'src/a.ts', existedAtBase: true, changed: false }],
        scopeVerification: { status: 'verified', verifiedTargetPaths: ['src/a.ts'] },
      },
    }],
    changeAuthorization: { declaredScope: ['src/a.ts'], excludedScope: [], changedFiles: ['src/a.ts'] },
    observedAt: '2026-09-10T10:00:00Z',
  });
  if (!built.ok) throw new Error(built.explanation);
  return built.value as unknown as Json;
};

/** Evidência simples SEM baseline nem claim_kind ⇒ readiness insuficiente. */
const weakEvidence = (attemptId: string): Json => {
  const built = buildHostObservedGateEvidence({
    workItemId: 'w1', attemptId, approvedProposalVersion: 2,
    gates: [{ label: 'unit', command: 'npm test', exitCode: 0, durationMs: 100, timedOut: false, cancelled: false }],
    observedAt: '2026-09-10T10:00:00Z',
  });
  if (!built.ok) throw new Error(built.explanation);
  return built.value as unknown as Json;
};

describe('correlateReadinessCalibration', () => {
  it('sem eventos ⇒ nenhum registro', () => {
    expect(correlateReadinessCalibration([])).toEqual([]);
  });

  it('readiness eligible + aceite humano ⇒ confirmed_eligible (cadeia real de evidência)', () => {
    const events: WorkEvent[] = [
      gateEvidenceEvent('ev-gate', 'att-1', 2, eligibleEvidence('att-1'), '2026-09-10T10:00:00Z'),
      resultSubmitted('ev-result', 'att-1', 2, '2026-09-10T10:01:00Z'),
      acceptedEvent('ev-accept', 'ev-result', '2026-09-10T10:02:00Z'),
    ];
    const records = correlateReadinessCalibration(events);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ attemptId: 'att-1', rollup: 'eligible', review: 'accepted', outcome: 'confirmed_eligible' });
  });

  it('readiness eligible + pedido de mudanças ⇒ optimistic_miss (falso positivo capturado)', () => {
    const events: WorkEvent[] = [
      gateEvidenceEvent('ev-gate', 'att-1', 2, eligibleEvidence('att-1'), '2026-09-10T10:00:00Z'),
      resultSubmitted('ev-result', 'att-1', 2, '2026-09-10T10:01:00Z'),
      changesRequestedEvent('ev-cr', 'ev-result', '2026-09-10T10:02:00Z'),
    ];
    const records = correlateReadinessCalibration(events);
    expect(records[0]).toMatchObject({ rollup: 'eligible', review: 'changes_requested', outcome: 'optimistic_miss' });
  });

  it('revisão sem evidência de readiness ⇒ no_readiness/no_signal (lacuna honesta)', () => {
    const events: WorkEvent[] = [
      resultSubmitted('ev-result', 'att-1', 2, '2026-09-10T10:01:00Z'),
      acceptedEvent('ev-accept', 'ev-result', '2026-09-10T10:02:00Z'),
    ];
    const records = correlateReadinessCalibration(events);
    expect(records[0]).toMatchObject({ rollup: 'no_readiness', outcome: 'no_signal' });
  });

  it('a decisão terminal mais recente vence (append-only)', () => {
    const events: WorkEvent[] = [
      gateEvidenceEvent('ev-gate', 'att-1', 2, weakEvidence('att-1'), '2026-09-10T10:00:00Z'),
      resultSubmitted('ev-result', 'att-1', 2, '2026-09-10T10:01:00Z'),
      changesRequestedEvent('ev-cr', 'ev-result', '2026-09-10T10:02:00Z'),
      acceptedEvent('ev-accept', 'ev-result', '2026-09-10T10:03:00Z'),
    ];
    const records = correlateReadinessCalibration(events);
    expect(records).toHaveLength(1);
    expect(records[0]!.review).toBe('accepted');
  });

  it('duas tentativas distintas ⇒ dois registros; referência de resultado inválida é ignorada', () => {
    const events: WorkEvent[] = [
      gateEvidenceEvent('ev-gate-1', 'att-1', 2, eligibleEvidence('att-1'), '2026-09-10T10:00:00Z'),
      resultSubmitted('ev-result-1', 'att-1', 2, '2026-09-10T10:01:00Z'),
      acceptedEvent('ev-accept-1', 'ev-result-1', '2026-09-10T10:02:00Z'),
      gateEvidenceEvent('ev-gate-2', 'att-2', 2, weakEvidence('att-2'), '2026-09-11T10:00:00Z'),
      resultSubmitted('ev-result-2', 'att-2', 2, '2026-09-11T10:01:00Z'),
      changesRequestedEvent('ev-cr-2', 'ev-result-2', '2026-09-11T10:02:00Z'),
      // referência pendurada: não resolve para nenhum result_submitted ⇒ ignorada.
      acceptedEvent('ev-accept-x', 'ev-result-does-not-exist', '2026-09-12T10:00:00Z'),
    ];
    const records = correlateReadinessCalibration(events);
    expect(records).toHaveLength(2);
    expect(records.map(r => r.outcome).sort()).toEqual(['confirmed_eligible', 'conservative_confirmed']);
  });
});
