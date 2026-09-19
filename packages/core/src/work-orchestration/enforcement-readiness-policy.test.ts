import {
  ENFORCEMENT_READINESS_POLICY_VERSION,
  classifyChangeAuthorization,
  evaluateEnforcementReadiness,
  type ChangeAuthorizationEvidenceV1,
  type EvaluateEnforcementReadinessInput,
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

const withBaseline = (
  value: ObservedGateOutcomeV1,
  over: Partial<NonNullable<ObservedGateOutcomeV1['baseline']>>,
): ObservedGateOutcomeV1 => ({ ...value, baseline: { ...value.baseline!, ...over } });

// Autorização VERIFICADA e limpa: implementação em src/impl.ts autorizada e alterada.
const verifiedAuth = (
  declaredScope: readonly string[] = ['src/impl.ts'],
  changedFiles: readonly string[] = ['src/impl.ts'],
): ChangeAuthorizationEvidenceV1 => classifyChangeAuthorization({ declaredScope, changedFiles });

const decide = (
  claimKind: string | undefined,
  value = gate(),
  changeAuthorization?: EvaluateEnforcementReadinessInput['changeAuthorization'],
) => evaluateEnforcementReadiness({ claimKind, gate: value, changeAuthorization });

describe('Enforcement Readiness V0 (shadow)', () => {
  test('determinismo: mesma evidência ⇒ mesma readiness', () => {
    expect(decide('gate_assertion', gate(), verifiedAuth())).toEqual(decide('gate_assertion', gate(), verifiedAuth()));
  });

  test('versionamento: versão canônica da readiness + referência à Policy V0', () => {
    const d = decide('gate_assertion', gate(), verifiedAuth());
    expect(d.policyVersion).toBe(ENFORCEMENT_READINESS_POLICY_VERSION);
    expect(d.policyReference.policyVersion).toBe('differential-evidence-policy-v0');
  });

  test('claim_kind desconhecido degrada conservadoramente', () => {
    expect(decide('future_kind', gate(), verifiedAuth())).toMatchObject({
      disposition: 'insufficient_evidence', reasonCode: 'unsupported_claim_kind',
    });
  });

  test('FAIL→PASS discriminating + autorização VERIFICADA e limpa ⇒ eligible (gate_assertion)', () => {
    expect(decide('gate_assertion', gate(), verifiedAuth())).toMatchObject({
      disposition: 'eligible', reasonCode: 'discriminating_gate_candidate',
      evidenceStrength: {
        differentialStatus: 'discriminating', quadrant: 'fail_pass',
        changeAuthorization: { status: 'verified', unauthorizedChangedFiles: [] },
      },
    });
  });

  test('discriminating + autorização AUSENTE ⇒ degrada (change_scope_unverified)', () => {
    expect(decide('gate_assertion')).toMatchObject({
      disposition: 'requires_review', reasonCode: 'change_scope_unverified',
      evidenceStrength: { differentialStatus: 'discriminating', changeAuthorization: { status: 'unavailable' } },
    });
  });

  test('discriminating + autorização PARCIALMENTE verificável ⇒ degrada', () => {
    const partial = classifyChangeAuthorization({ declaredScope: ['src/impl.ts', 'migrar tela X'], changedFiles: ['src/impl.ts'] });
    expect(partial.status).toBe('partially_verifiable');
    expect(decide('gate_assertion', gate(), partial)).toMatchObject({
      disposition: 'requires_review', reasonCode: 'change_scope_unverified',
    });
  });

  test('discriminating + mudança NÃO autorizada observada ⇒ revisão (unauthorized_change_detected)', () => {
    const violating = classifyChangeAuthorization({ declaredScope: ['src/impl.ts'], changedFiles: ['src/impl.ts', 'src/nao-autorizado.ts'] });
    expect(decide('gate_assertion', gate(), violating)).toMatchObject({
      disposition: 'requires_review', reasonCode: 'unauthorized_change_detected',
      evidenceStrength: { changeAuthorization: { unauthorizedChangedFiles: ['src/nao-autorizado.ts'] } },
    });
  });

  test('substantive nunca é elegível só por um gate limpo, mesmo com autorização verificada', () => {
    expect(decide('substantive', gate(), verifiedAuth())).toMatchObject({
      disposition: 'requires_review', reasonCode: 'substantive_requires_composite_proof',
    });
  });

  test('PASS→PASS: non_discriminating ⇒ NÃO elegível (Readiness != Policy)', () => {
    const value = withBaseline(gate(), { baseExitCode: 0, baseOutcome: 'passed' });
    const d = decide('gate_assertion', value, verifiedAuth());
    expect(d.policyReference.decision).toBe('allow');
    expect(d).toMatchObject({ disposition: 'requires_review', reasonCode: 'non_discriminating_gate' });
  });

  test('PASS→FAIL ⇒ blocked/regression_observed', () => {
    const value = withBaseline(gate({ exitCode: 1, outcome: 'failed' }), { baseExitCode: 0, baseOutcome: 'passed' });
    expect(decide('gate_assertion', value, verifiedAuth())).toMatchObject({ disposition: 'blocked', reasonCode: 'regression_observed' });
  });

  test('FAIL→FAIL ⇒ blocked/criterion_unsatisfied', () => {
    const value = withBaseline(gate({ exitCode: 1, outcome: 'failed' }), { baseExitCode: 1, baseOutcome: 'failed' });
    expect(decide('gate_assertion', value, verifiedAuth())).toMatchObject({ disposition: 'blocked', reasonCode: 'criterion_unsatisfied' });
  });

  test('target alterado ⇒ confounded/revisão', () => {
    const value = withBaseline(gate(), {
      changeTouchedGateTargets: true,
      targets: [{ path: 'src/unit.test.ts', existedAtBase: true, changed: true, kindAtBase: 'file' }],
    });
    expect(decide('gate_assertion', value, verifiedAuth())).toMatchObject({ disposition: 'requires_review', reasonCode: 'differential_confounded' });
  });

  test('target novo ⇒ confounded/revisão', () => {
    const value = withBaseline(gate(), {
      targetExistedAtBase: false,
      targets: [{ path: 'src/unit.test.ts', existedAtBase: false, changed: false, kindAtBase: 'missing' }],
    });
    expect(decide('gate_assertion', value, verifiedAuth())).toMatchObject({ disposition: 'requires_review', reasonCode: 'differential_confounded' });
  });

  test('INVARIANTE: outside GATE target mas DENTRO do Change Authorization Scope ⇒ eligible', () => {
    // Gate target = unit.test.ts; a mudança fora do gate target é src/impl.ts, que ESTÁ
    // autorizada. Não é violação; o diferencial segue discriminating ⇒ candidato.
    const value = withBaseline(gate(), { changedFiles: ['src/impl.ts'], changedFilesOutsideTargetScope: ['src/impl.ts'] });
    expect(decide('gate_assertion', value, verifiedAuth(['src/impl.ts'], ['src/impl.ts']))).toMatchObject({
      disposition: 'eligible', reasonCode: 'discriminating_gate_candidate',
    });
  });

  test('mudança fora do Change Authorization Scope ⇒ requires_review (mesmo discriminating)', () => {
    const value = withBaseline(gate(), { changedFiles: ['src/impl.ts'], changedFilesOutsideTargetScope: ['src/impl.ts'] });
    const violating = classifyChangeAuthorization({ declaredScope: ['src/foo.ts'], changedFiles: ['src/impl.ts'] });
    expect(decide('gate_assertion', value, violating)).toMatchObject({
      disposition: 'requires_review', reasonCode: 'unauthorized_change_detected',
    });
  });

  test('scope unverified ⇒ inconclusivo/insuficiente', () => {
    const value = withBaseline(gate(), {
      scopeVerification: { status: 'unverified', verifiedTargetPaths: [], reason: 'gate_scope_not_concrete' },
    });
    expect(decide('gate_assertion', value, verifiedAuth())).toMatchObject({
      disposition: 'insufficient_evidence', reasonCode: 'differential_inconclusive',
    });
  });

  test('scope mismatch ⇒ inconclusivo/insuficiente', () => {
    const value = withBaseline(gate(), {
      scopeVerification: { status: 'mismatch', verifiedTargetPaths: ['src/other.test.ts'], reason: 'declared_scope_differs_from_gate' },
    });
    expect(decide('gate_assertion', value, verifiedAuth())).toMatchObject({
      disposition: 'insufficient_evidence', reasonCode: 'differential_inconclusive',
    });
  });

  test('gate legado sem baseline ⇒ inconclusivo/insuficiente', () => {
    expect(decide('gate_assertion', gate({ baseline: undefined }), verifiedAuth())).toMatchObject({
      disposition: 'insufficient_evidence', reasonCode: 'differential_inconclusive',
    });
  });

  test('gate legado sem baseline mas VERMELHO ⇒ blocked/gate_failed', () => {
    expect(decide('gate_assertion', gate({ baseline: undefined, exitCode: 1, outcome: 'failed' }), verifiedAuth())).toMatchObject({
      disposition: 'blocked', reasonCode: 'gate_failed',
    });
  });

  test('shadow-only: readiness é retorno puro e NÃO altera o outcome recebido', () => {
    const original = gate();
    const before = JSON.stringify(original);
    const d = decide('gate_assertion', original, verifiedAuth());
    expect(d.disposition).toBe('eligible');
    expect(original.outcome).toBe('passed');
    expect(JSON.stringify(original)).toBe(before);
  });
});
