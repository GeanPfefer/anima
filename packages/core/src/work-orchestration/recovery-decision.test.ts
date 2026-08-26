import { decideRecovery, recoveryFailureCode, type RecoveryFailureEvidence } from './recovery-decision';

const evidence = (overrides: Partial<RecoveryFailureEvidence> = {}): RecoveryFailureEvidence => ({
  code: null, safeMessage: null, retryable: true, attemptsUsed: 1, maxAttempts: 3,
  repeatedSameFailure: false, ...overrides,
});

describe('recoveryFailureCode', () => {
  test('prefere código estruturado allowlisted', () => {
    expect(recoveryFailureCode(evidence({ code: 'resource_pressure', safeMessage: '[ollama_timeout]' }))).toBe('resource_pressure');
  });
  test('recupera o token sanitizado hoje persistido pelo coder', () => {
    expect(recoveryFailureCode(evidence({ code: 'execution_failed', safeMessage: 'backend: [ollama_read_round_limit] sem edição' }))).toBe('ollama_read_round_limit');
  });
  test('não classifica prosa ou token desconhecido', () => {
    expect(recoveryFailureCode(evidence({ safeMessage: 'tente novamente porque talvez funcione [inventado]' }))).toBeNull();
    expect(recoveryFailureCode(evidence({ code: 'execution_failed', safeMessage: 'falha genérica' }))).toBeNull();
  });
});

describe('decideRecovery', () => {
  test.each(['ollama_read_round_limit', 'context_limit', 'no_progress', 'loop_detected'])(
    '%s decompõe sem retry cego', code => {
      expect(decideRecovery(evidence({ code }))).toMatchObject({ action: 'decompose', reason: 'task_should_be_decomposed' });
    });
  test.each(['resource_pressure', 'insufficient_memory', 'insufficient_vram'])(
    '%s espera capacidade', code => {
      expect(decideRecovery(evidence({ code }))).toMatchObject({ action: 'environment_wait', reason: 'resource_capacity_unavailable' });
    });
  test('timeout transitório tenta uma vez dentro do budget, repetição exige mudar ambiente', () => {
    expect(decideRecovery(evidence({ code: 'ollama_timeout' }))).toMatchObject({ action: 'retry' });
    expect(decideRecovery(evidence({ code: 'ollama_timeout', repeatedSameFailure: true }))).toMatchObject({ action: 'environment_wait' });
  });
  test('falha de código repetida decompõe em vez de consumir retries', () => {
    expect(decideRecovery(evidence({ code: 'code_failure', repeatedSameFailure: true }))).toMatchObject({ action: 'decompose' });
  });
  test('falha retryable conhecida sem repetição respeita o budget', () => {
    expect(decideRecovery(evidence({ code: 'gate_failed' }))).toMatchObject({ action: 'retry' });
    expect(decideRecovery(evidence({ code: 'gate_failed', attemptsUsed: 3, maxAttempts: 3 }))).toMatchObject({ action: 'human_required' });
  });
  test.each(['invalid_request', 'contract_violation', 'attempt_payload_conflict'])(
    '%s exige revisão de contrato/autoridade', code => {
      expect(decideRecovery(evidence({ code }))).toMatchObject({ action: 'human_required', reason: 'contract_or_authority_review_required' });
    });
  test('desconhecido falha fechado, mesmo marcado retryable', () => {
    expect(decideRecovery(evidence({ code: 'qualquer_coisa' }))).toEqual({
      failureKind: 'unknown', normalizedCode: null, action: 'human_required', reason: 'failure_not_classified',
    });
  });
});
