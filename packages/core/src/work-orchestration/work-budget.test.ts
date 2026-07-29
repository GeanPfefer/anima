import {
  DEFAULT_AUTONOMOUS_WORK_BUDGET_V1,
  evaluateWorkBudgetAdmission,
  type WorkBudgetUsageV1,
} from './work-budget';

const usage = (overrides: Partial<WorkBudgetUsageV1> = {}): WorkBudgetUsageV1 => ({
  schemaVersion: 1,
  itemAttempts24Hours: 0,
  userAttempts24Hours: 0,
  userRuntimeSeconds24Hours: 0,
  autonomousRuntimeSeconds60Minutes: 0,
  ...overrides,
});
describe('INTEL-04 — orçamento e reserva de capacidade', () => {
  test('expõe exatamente os padrões aprovados', () => {
    expect(DEFAULT_AUTONOMOUS_WORK_BUDGET_V1).toEqual({
      schemaVersion: 1,
      policyVersion: 'autonomous-work-budget-v1',
      itemAttempts24Hours: 3,
      userAttempts24Hours: 6,
      userRuntimeSeconds24Hours: 7200,
      autonomousRuntimeSeconds60Minutes: 2700,
      interactiveReserveSeconds60Minutes: 900,
    });
  });

  test('admite dentro do orçamento e devolve o menor tempo restante', () => {
    expect(evaluateWorkBudgetAdmission({
      usage: usage({
        itemAttempts24Hours: 1,
        userAttempts24Hours: 4,
        userRuntimeSeconds24Hours: 7000,
        autonomousRuntimeSeconds60Minutes: 2600,
      }),
    })).toEqual({
      outcome: 'admitted',
      effectiveItemAttemptLimit: 3,
      remainingUserAttempts: 2,
      remainingRuntimeSeconds24Hours: 200,
      remainingAutonomousRuntimeSeconds60Minutes: 100,
      maxRuntimeSeconds: 100,
    });
  });

  test('respeita um limite declarado menor por item', () => {
    expect(evaluateWorkBudgetAdmission({
      usage: usage({ itemAttempts24Hours: 1 }),
      declaredMaxAttempts: 1,
    })).toMatchObject({
      outcome: 'interrupted',
      reason: 'item_attempt_budget_exhausted',
      reachedLimit: 'attempts',
    });
  });

  test('o teto do item continua três mesmo quando a proposta declara mais', () => {
    expect(evaluateWorkBudgetAdmission({
      usage: usage({ itemAttempts24Hours: 3 }),
      declaredMaxAttempts: 20,
    })).toMatchObject({ outcome: 'interrupted', reason: 'item_attempt_budget_exhausted' });
  });

  test('interrompe no limite global de tentativas', () => {
    expect(evaluateWorkBudgetAdmission({
      usage: usage({ userAttempts24Hours: 6 }),
    })).toMatchObject({ outcome: 'interrupted', reason: 'user_attempt_budget_exhausted' });
  });

  test('interrompe no limite global de duração', () => {
    expect(evaluateWorkBudgetAdmission({
      usage: usage({ userRuntimeSeconds24Hours: 7200 }),
    })).toMatchObject({ outcome: 'interrupted', reason: 'user_runtime_budget_exhausted' });
  });

  test('preserva a reserva interativa da janela de uma hora', () => {
    expect(evaluateWorkBudgetAdmission({
      usage: usage({ autonomousRuntimeSeconds60Minutes: 2700 }),
    })).toMatchObject({
      outcome: 'interrupted',
      reason: 'interactive_reserve_protected',
      reachedLimit: 'resources',
    });
  });

  test('falha fechado diante de consumo inválido', () => {
    expect(() => evaluateWorkBudgetAdmission({
      usage: usage({ userAttempts24Hours: -1 }),
    })).toThrow('invalid work budget usage');
  });
});
