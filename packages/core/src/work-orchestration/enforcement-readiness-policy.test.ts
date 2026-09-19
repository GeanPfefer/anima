import {
  ENFORCEMENT_READINESS_POLICY_VERSION,
  evaluateEnforcementReadiness,
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

const decide = (
  claimKind: string | undefined,
  value = gate(),
  changeAuthorization?: EvaluateEnforcementReadinessInput['changeAuthorization'],
) => evaluateEnforcementReadiness({ claimKind, gate: value, changeAuthorization });

describe('Enforcement Readiness V0 (shadow)', () => {
  test('determinismo: mesma evidência ⇒ mesma readiness', () => {
    expect(decide('gate_assertion')).toEqual(decide('gate_assertion'));
  });

  test('versionamento: carrega a versão canônica da readiness e referencia a Policy V0', () => {
    const d = decide('gate_assertion');
    expect(d.policyVersion).toBe(ENFORCEMENT_READINESS_POLICY_VERSION);
    expect(d.policyReference.policyVersion).toBe('differential-evidence-policy-v0');
  });

  test('claim_kind desconhecido degrada conservadoramente', () => {
    expect(decide('future_kind')).toMatchObject({
      disposition: 'insufficient_evidence', reasonCode: 'unsupported_claim_kind',
    });
  });

  test('FAIL→PASS verified com target intacto ⇒ discriminating/candidato (gate_assertion)', () => {
    expect(decide('gate_assertion')).toMatchObject({
      disposition: 'eligible', reasonCode: 'discriminating_gate_candidate',
      evidenceStrength: { differentialStatus: 'discriminating', quadrant: 'fail_pass', finalOutcome: 'passed' },
    });
  });

  test('substantive nunca é elegível só por um gate diferencial limpo', () => {
    expect(decide('substantive')).toMatchObject({
      disposition: 'requires_review', reasonCode: 'substantive_requires_composite_proof',
    });
  });

  test('PASS→PASS: non_discriminating ⇒ NÃO elegível por efeito causal (Readiness != Policy)', () => {
    const value = withBaseline(gate(), { baseExitCode: 0, baseOutcome: 'passed' });
    const d = decide('gate_assertion', value);
    // A Policy V0 diria allow para pass_pass; a Readiness distingue "policy allow" de
    // "evidência suficiente para enforcement autônomo".
    expect(d.policyReference.decision).toBe('allow');
    expect(d).toMatchObject({
      disposition: 'requires_review', reasonCode: 'non_discriminating_gate',
      evidenceStrength: { differentialStatus: 'non_discriminating', quadrant: 'pass_pass' },
    });
  });

  test('PASS→FAIL: regressão observada ⇒ blocked', () => {
    const value = withBaseline(gate({ exitCode: 1, outcome: 'failed' }), { baseExitCode: 0, baseOutcome: 'passed' });
    expect(decide('gate_assertion', value)).toMatchObject({
      disposition: 'blocked', reasonCode: 'regression_observed',
      evidenceStrength: { quadrant: 'pass_fail', finalOutcome: 'failed' },
    });
  });

  test('FAIL→FAIL: critério não satisfeito ⇒ blocked', () => {
    const value = withBaseline(gate({ exitCode: 1, outcome: 'failed' }), { baseExitCode: 1, baseOutcome: 'failed' });
    expect(decide('gate_assertion', value)).toMatchObject({
      disposition: 'blocked', reasonCode: 'criterion_unsatisfied',
      evidenceStrength: { quadrant: 'fail_fail' },
    });
  });

  test('target alterado ⇒ confounded/revisão (não fraude automática)', () => {
    const value = withBaseline(gate(), {
      changeTouchedGateTargets: true,
      targets: [{ path: 'src/unit.test.ts', existedAtBase: true, changed: true, kindAtBase: 'file' }],
      changedFiles: ['src/unit.test.ts'], changedFilesWithinTargetScope: ['src/unit.test.ts'],
    });
    expect(decide('gate_assertion', value)).toMatchObject({
      disposition: 'requires_review', reasonCode: 'differential_confounded',
      evidenceStrength: { differentialStatus: 'confounded' },
    });
  });

  test('target novo ⇒ confounded/revisão por padrão', () => {
    const value = withBaseline(gate(), {
      targetExistedAtBase: false,
      targets: [{ path: 'src/unit.test.ts', existedAtBase: false, changed: false, kindAtBase: 'missing' }],
    });
    expect(decide('gate_assertion', value)).toMatchObject({
      disposition: 'requires_review', reasonCode: 'differential_confounded',
    });
  });

  test('outside GATE target sozinho é NEUTRO: não rebaixa um discriminating', () => {
    const value = withBaseline(gate(), {
      changedFiles: ['src/impl.ts'], changedFilesOutsideTargetScope: ['src/impl.ts'],
    });
    // Mudança fora do gate target NÃO implica violação: segue candidato.
    expect(decide('gate_assertion', value)).toMatchObject({
      disposition: 'eligible', reasonCode: 'discriminating_gate_candidate',
    });
  });

  test('Change Authorization Scope disponível: mudança FORA do autorizado ⇒ revisão', () => {
    // discriminating gate_assertion, mas o coder alterou arquivo fora do includedScope.
    const d = decide('gate_assertion', gate(), {
      authorizedScope: ['src/foo.ts'],
      observedChangedFiles: ['src/foo.ts', 'src/nao-autorizado.ts'],
    });
    expect(d).toMatchObject({
      disposition: 'requires_review', reasonCode: 'unauthorized_change_detected',
      evidenceStrength: {
        changeAuthorization: {
          status: 'verified',
          authorizedChangedFiles: ['src/foo.ts'],
          unauthorizedChangedFiles: ['src/nao-autorizado.ts'],
        },
      },
    });
  });

  test('Change Authorization Scope disponível: só mudanças autorizadas ⇒ candidato', () => {
    const d = decide('gate_assertion', gate(), {
      authorizedScope: ['src/foo.ts', 'src/bar.ts'],
      observedChangedFiles: ['src/foo.ts'],
    });
    expect(d).toMatchObject({
      disposition: 'eligible', reasonCode: 'discriminating_gate_candidate',
      evidenceStrength: { changeAuthorization: { status: 'verified', unauthorizedChangedFiles: [] } },
    });
  });

  test('Change Authorization Scope AUSENTE ⇒ unavailable (não inventa autorização do gate target)', () => {
    expect(decide('gate_assertion').evidenceStrength.changeAuthorization).toEqual({ status: 'unavailable' });
  });

  test('scope unverified ⇒ inconclusivo/insuficiente (nunca decisão forte)', () => {
    const value = withBaseline(gate(), {
      scopeVerification: { status: 'unverified', verifiedTargetPaths: [], reason: 'gate_scope_not_concrete' },
    });
    expect(decide('gate_assertion', value)).toMatchObject({
      disposition: 'insufficient_evidence', reasonCode: 'differential_inconclusive',
    });
    expect(decide('substantive', value)).toMatchObject({ disposition: 'insufficient_evidence' });
  });

  test('scope mismatch ⇒ inconclusivo/insuficiente', () => {
    const value = withBaseline(gate(), {
      scopeVerification: { status: 'mismatch', verifiedTargetPaths: ['src/other.test.ts'], reason: 'declared_scope_differs_from_gate' },
    });
    expect(decide('gate_assertion', value)).toMatchObject({
      disposition: 'insufficient_evidence', reasonCode: 'differential_inconclusive',
    });
  });

  test('gate legado sem baseline ⇒ inconclusivo/insuficiente (retrocompatível)', () => {
    expect(decide('gate_assertion', gate({ baseline: undefined }))).toMatchObject({
      disposition: 'insufficient_evidence', reasonCode: 'differential_inconclusive',
    });
  });

  test('gate legado sem baseline mas VERMELHO ⇒ blocked/gate_failed', () => {
    expect(decide('gate_assertion', gate({ baseline: undefined, exitCode: 1, outcome: 'failed' }))).toMatchObject({
      disposition: 'blocked', reasonCode: 'gate_failed',
    });
  });

  test('shadow-only: a readiness é retorno puro e NÃO altera o outcome operacional recebido', () => {
    const original = gate();
    const before = JSON.stringify(original);
    const d = decide('gate_assertion', original);
    expect(d.disposition).toBe('eligible');
    expect(original.outcome).toBe('passed');
    expect(JSON.stringify(original)).toBe(before);
  });
});
