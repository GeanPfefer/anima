import {
  DIFFERENTIAL_EVIDENCE_POLICY_VERSION,
  evaluateDifferentialEvidencePolicy,
  type ObservedGateOutcomeV1,
} from './index';

const gate = (over: Partial<ObservedGateOutcomeV1> = {}): ObservedGateOutcomeV1 => ({
  label: 'unit', command: 'npm test -- src/unit.test.ts', exitCode: 0,
  durationMs: 10, timedOut: false, cancelled: false, outcome: 'passed',
  baseline: {
    baseExitCode: 1, baseTimedOut: false, baseCancelled: false, baseOutcome: 'failed',
    targetExistedAtBase: true, changeTouchedGateTargets: false,
    targets: [{ path: 'src/unit.test.ts', existedAtBase: true, changed: false, kindAtBase: 'file' }],
    changedFiles: [], changedFilesWithinTargetScope: [], changedFilesOutsideTargetScope: [],
    scopeVerification: { status: 'verified', verifiedTargetPaths: ['src/unit.test.ts'] },
  },
  ...over,
});

const decide = (claimKind: string | undefined, value = gate()) =>
  evaluateDifferentialEvidencePolicy({ claimKind, gate: value });

const withBaseline = (
  value: ObservedGateOutcomeV1,
  over: Partial<NonNullable<ObservedGateOutcomeV1['baseline']>>,
): ObservedGateOutcomeV1 => ({ ...value, baseline: { ...value.baseline!, ...over } });

describe('Differential Evidence Policy V0', () => {
  test('é determinística para a mesma evidência', () => {
    expect(decide('gate_assertion')).toEqual(decide('gate_assertion'));
  });

  test('registra a versão canônica', () => {
    expect(decide('gate_assertion').policyVersion).toBe(DIFFERENTIAL_EVIDENCE_POLICY_VERSION);
  });

  test('claim_kind desconhecido falha conservadoramente', () => {
    expect(decide('future_kind')).toMatchObject({ decision: 'insufficient_evidence', reasonCode: 'unsupported_claim_kind' });
  });

  test('scope unverified nunca autoriza decisão forte', () => {
    const value = withBaseline(gate(), { scopeVerification: { status: 'unverified', verifiedTargetPaths: [], reason: 'gate_scope_not_concrete' } });
    expect(decide('gate_assertion', value)).toMatchObject({ decision: 'insufficient_evidence', reasonCode: 'scope_unverified' });
    expect(decide('substantive', value)).toMatchObject({ decision: 'require_review', reasonCode: 'scope_unverified' });
  });

  test('scope mismatch tem razão própria e não vale como evidência', () => {
    const value = withBaseline(gate(), { scopeVerification: { status: 'mismatch', verifiedTargetPaths: ['src/other.test.ts'], reason: 'declared_scope_differs_from_gate' } });
    expect(decide('gate_assertion', value)).toMatchObject({ decision: 'insufficient_evidence', reasonCode: 'scope_mismatch' });
  });

  test.each([
    ['passed', 'passed', 'allow', 'baseline_pass_final_pass'],
    ['passed', 'failed', 'deny', 'baseline_pass_final_fail'],
    ['failed', 'passed', 'allow', 'baseline_fail_final_pass'],
    ['failed', 'failed', 'deny', 'baseline_fail_final_fail'],
  ] as const)('quadrante %s → %s é explícito para gate_assertion', (base, final, decision, reasonCode) => {
    const value = withBaseline(gate({ outcome: final, exitCode: final === 'passed' ? 0 : 1 }), { baseOutcome: base, baseExitCode: base === 'passed' ? 0 : 1 });
    expect(decide('gate_assertion', value)).toMatchObject({ decision, reasonCode });
  });

  test('target novo pede revisão, sem presumir fraude nem validade', () => {
    const value = withBaseline(gate(), {
      targetExistedAtBase: false,
      targets: [{ path: 'src/unit.test.ts', existedAtBase: false, changed: false, kindAtBase: 'missing' }],
    });
    expect(decide('gate_assertion', value)).toMatchObject({ decision: 'require_review', reasonCode: 'baseline_target_missing' });
  });

  test('target alterado pede revisão', () => {
    const value = withBaseline(gate(), {
      changeTouchedGateTargets: true,
      targets: [{ path: 'src/unit.test.ts', existedAtBase: true, changed: true, kindAtBase: 'file' }],
      changedFiles: ['src/unit.test.ts'], changedFilesWithinTargetScope: ['src/unit.test.ts'],
    });
    expect(decide('gate_assertion', value)).toMatchObject({ decision: 'require_review', reasonCode: 'target_changed' });
  });

  test('outside-scope isolado pede revisão para gate_assertion', () => {
    const value = withBaseline(gate(), { changedFiles: ['src/impl.ts'], changedFilesOutsideTargetScope: ['src/impl.ts'] });
    expect(decide('gate_assertion', value)).toMatchObject({ decision: 'require_review', reasonCode: 'outside_scope_change' });
  });

  test('target + outside-scope preserva ambos os fatos e prioriza target alterado', () => {
    const value = withBaseline(gate(), {
      changeTouchedGateTargets: true,
      targets: [{ path: 'src/unit.test.ts', existedAtBase: true, changed: true, kindAtBase: 'file' }],
      changedFiles: ['src/unit.test.ts', 'src/impl.ts'], changedFilesWithinTargetScope: ['src/unit.test.ts'], changedFilesOutsideTargetScope: ['src/impl.ts'],
    });
    expect(decide('gate_assertion', value)).toMatchObject({
      decision: 'require_review', reasonCode: 'target_changed',
      relevantFacts: { changedTargets: ['src/unit.test.ts'], changedFilesOutsideTargetScope: ['src/impl.ts'] },
    });
  });

  test('gate legado sem baseline continua suportado sem decisão forte', () => {
    expect(decide('gate_assertion', gate({ baseline: undefined }))).toMatchObject({ decision: 'insufficient_evidence', reasonCode: 'baseline_missing' });
  });

  test('claim substantivo nunca é autorizado só porque o gate passou', () => {
    expect(decide('substantive')).toMatchObject({ decision: 'require_review', reasonCode: 'baseline_fail_final_pass' });
  });

  test('a policy é somente retorno puro: não altera o outcome operacional recebido', () => {
    const original = gate();
    const before = JSON.stringify(original);
    const decision = decide('substantive', original);
    expect(decision.decision).toBe('require_review');
    expect(original.outcome).toBe('passed');
    expect(JSON.stringify(original)).toBe(before);
  });
});
