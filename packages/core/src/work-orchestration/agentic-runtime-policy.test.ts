import {
  AGENTIC_RUNTIME_POLICY_BOUNDS,
  DEFAULT_AGENTIC_RUNTIME_POLICY_V1,
  LOCAL_AGENTIC_RUNTIME_PROFILE_V1,
  MAX_READS_REQUESTED_PER_ROUND,
  STRONG_REMOTE_AGENTIC_RUNTIME_PROFILE_V1,
  availableRuntimeActions,
  deriveSubmitGateState,
  isSubmitAvailable,
  resolveAgenticRuntimePolicy,
  type SubmitGateSnapshotV1,
} from './agentic-runtime-policy';

describe('AgenticRuntimePolicyV1 — fronteiras do laço do Coding Harness V3', () => {
  test('default seguro preserva o comportamento numérico local histórico (8/3) em modo supervisionado', () => {
    expect(DEFAULT_AGENTIC_RUNTIME_POLICY_V1).toMatchObject({
      schemaVersion: 1,
      mode: 'supervised',
      readServingBudgetPerRound: 8,
      maxReadRounds: 3,
    });
    // Teto de sessão nunca menor que a rodada.
    expect(DEFAULT_AGENTIC_RUNTIME_POLICY_V1.maxTotalServedReads)
      .toBeGreaterThanOrEqual(DEFAULT_AGENTIC_RUNTIME_POLICY_V1.readServingBudgetPerRound);
  });

  test('perfil remoto forte amplia orçamento e rodadas (correção do gargalo pago), permanecendo bounded', () => {
    const strong = resolveAgenticRuntimePolicy({
      mode: 'supervised',
      profile: STRONG_REMOTE_AGENTIC_RUNTIME_PROFILE_V1,
    });
    expect(strong.readServingBudgetPerRound).toBeGreaterThan(LOCAL_AGENTIC_RUNTIME_PROFILE_V1.readServingBudgetPerRound);
    expect(strong.maxReadRounds).toBeGreaterThan(LOCAL_AGENTIC_RUNTIME_PROFILE_V1.maxReadRounds);
    expect(strong.readServingBudgetPerRound).toBeLessThanOrEqual(MAX_READS_REQUESTED_PER_ROUND);
  });

  test('clamp fail-closed: valores fora dos limites são forçados aos limites', () => {
    const clamped = resolveAgenticRuntimePolicy({
      mode: 'autonomous',
      overrides: { readServingBudgetPerRound: 9999, maxReadRounds: 9999, maxTotalServedReads: 999999 },
    });
    expect(clamped.readServingBudgetPerRound).toBe(AGENTIC_RUNTIME_POLICY_BOUNDS.readServingBudgetPerRound.max);
    expect(clamped.maxReadRounds).toBe(AGENTIC_RUNTIME_POLICY_BOUNDS.maxReadRounds.max);
    expect(clamped.maxTotalServedReads).toBe(AGENTIC_RUNTIME_POLICY_BOUNDS.maxTotalServedReads.max);
    expect(clamped.mode).toBe('autonomous');
  });

  test('entrada malformada cai no valor do perfil (nunca um orçamento inválido)', () => {
    const resolved = resolveAgenticRuntimePolicy({
      mode: 'supervised',
      profile: LOCAL_AGENTIC_RUNTIME_PROFILE_V1,
      overrides: { readServingBudgetPerRound: 2.5, maxReadRounds: Number.NaN } as never,
    });
    expect(resolved.readServingBudgetPerRound).toBe(LOCAL_AGENTIC_RUNTIME_PROFILE_V1.readServingBudgetPerRound);
    expect(resolved.maxReadRounds).toBe(LOCAL_AGENTIC_RUNTIME_PROFILE_V1.maxReadRounds);
  });

  test('invariante estrutural: teto de sessão nunca fica abaixo do orçamento por rodada', () => {
    const resolved = resolveAgenticRuntimePolicy({
      mode: 'supervised',
      overrides: { readServingBudgetPerRound: 20, maxTotalServedReads: 1 },
    });
    expect(resolved.maxTotalServedReads).toBeGreaterThanOrEqual(resolved.readServingBudgetPerRound);
  });
});

describe('SubmitGate — máquina de estados de submit (V3)', () => {
  const snap = (over: Partial<SubmitGateSnapshotV1> = {}): SubmitGateSnapshotV1 => ({
    editRevision: 0, passedValidationRevision: -1, failedValidationRevision: -1, diffReviewedRevision: -1,
    requiresValidation: true, ...over,
  });

  test('EXPLORING quando não há edição; SUBMIT indisponível', () => {
    const state = deriveSubmitGateState(snap({ editRevision: 0 }));
    expect(state).toBe('exploring');
    expect(isSubmitAvailable(state)).toBe(false);
  });

  test('DIRTY_UNVALIDATED após editar sem validação; SUBMIT indisponível', () => {
    const state = deriveSubmitGateState(snap({ editRevision: 1 }));
    expect(state).toBe('dirty_unvalidated');
    expect(isSubmitAvailable(state)).toBe(false);
  });

  test('TEST vermelho NÃO cria prova: permanece DIRTY_UNVALIDATED', () => {
    const state = deriveSubmitGateState(snap({ editRevision: 1, failedValidationRevision: 1 }));
    expect(state).toBe('dirty_unvalidated');
  });

  test('DIRTY_VALIDATED com validação verde e sem diff; SUBMIT ainda indisponível', () => {
    const state = deriveSubmitGateState(snap({ editRevision: 1, passedValidationRevision: 1 }));
    expect(state).toBe('dirty_validated');
    expect(isSubmitAvailable(state)).toBe(false);
  });

  test('READY_TO_SUBMIT só com validação verde E diff da revisão atual', () => {
    const state = deriveSubmitGateState(snap({ editRevision: 1, passedValidationRevision: 1, diffReviewedRevision: 1 }));
    expect(state).toBe('ready_to_submit');
    expect(isSubmitAvailable(state)).toBe(true);
  });

  test('nova edição INVALIDA provas antigas (revisão avança): volta a DIRTY_UNVALIDATED', () => {
    // Provas eram da revisão 1; a edição 2 as invalida por não casarem `=== editRevision`.
    const state = deriveSubmitGateState(snap({ editRevision: 2, passedValidationRevision: 1, diffReviewedRevision: 1 }));
    expect(state).toBe('dirty_unvalidated');
  });

  test('diff anterior à edição não conta: validado mas diff de revisão antiga = DIRTY_VALIDATED', () => {
    const state = deriveSubmitGateState(snap({ editRevision: 2, passedValidationRevision: 2, diffReviewedRevision: 1 }));
    expect(state).toBe('dirty_validated');
  });

  test('sem validação executável: editar já habilita submit (retrocompatível)', () => {
    const state = deriveSubmitGateState(snap({ editRevision: 1, requiresValidation: false }));
    expect(state).toBe('ready_to_submit');
    expect(isSubmitAvailable(state)).toBe(true);
  });

  test('availableRuntimeActions NÃO anuncia submit antes de READY_TO_SUBMIT', () => {
    const base = { searchEnabled: true, execEnabled: true, readRoundsLeft: 5 };
    expect(availableRuntimeActions({ ...base, state: 'exploring' })).not.toContain('submit');
    expect(availableRuntimeActions({ ...base, state: 'dirty_unvalidated' })).not.toContain('submit');
    expect(availableRuntimeActions({ ...base, state: 'dirty_validated' })).not.toContain('submit');
    expect(availableRuntimeActions({ ...base, state: 'ready_to_submit' })).toContain('submit');
  });

  test('DIRTY_UNVALIDATED anuncia exec e edit (TEST/DIFF acessíveis) mas não submit', () => {
    const actions = availableRuntimeActions({ state: 'dirty_unvalidated', searchEnabled: true, execEnabled: true, readRoundsLeft: 0 });
    expect(actions).toContain('exec');
    expect(actions).toContain('edit');
    expect(actions).not.toContain('submit');
    // Sem orçamento de leitura, read/search não são anunciados.
    expect(actions).not.toContain('read');
  });

  test('read/search só são anunciados enquanto há orçamento de investigação', () => {
    const withBudget = availableRuntimeActions({ state: 'exploring', searchEnabled: true, execEnabled: true, readRoundsLeft: 3 });
    expect(withBudget).toEqual(expect.arrayContaining(['read', 'search', 'glob']));
    const noBudget = availableRuntimeActions({ state: 'exploring', searchEnabled: true, execEnabled: true, readRoundsLeft: 0 });
    expect(noBudget).not.toContain('read');
    expect(noBudget).not.toContain('search');
  });
});
