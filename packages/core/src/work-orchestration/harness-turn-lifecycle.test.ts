import {
  POC_HARNESS_STEP_BUDGET,
  HARNESS_STEP_BUDGET_BOUNDS,
  classifyHarnessTurnEnd,
  decideHarnessPreStep,
  harnessStepBudgetReason,
  harnessTurnOutcomeIsAuthoritativeSuccess,
  resolveHarnessStepBudget,
  type HarnessObservedTurnOutcome,
} from './index';

describe('resolveHarnessStepBudget', () => {
  test('mantém um inteiro positivo dentro dos limites', () => {
    expect(resolveHarnessStepBudget(12)).toBe(12);
    expect(resolveHarnessStepBudget(1)).toBe(HARNESS_STEP_BUDGET_BOUNDS.min);
    expect(resolveHarnessStepBudget(200)).toBe(HARNESS_STEP_BUDGET_BOUNDS.max);
  });

  test('clampa fora dos limites e cai no valor do POC para entrada malformada', () => {
    expect(resolveHarnessStepBudget(0)).toBe(HARNESS_STEP_BUDGET_BOUNDS.min);
    expect(resolveHarnessStepBudget(-5)).toBe(HARNESS_STEP_BUDGET_BOUNDS.min);
    expect(resolveHarnessStepBudget(9999)).toBe(HARNESS_STEP_BUDGET_BOUNDS.max);
    expect(resolveHarnessStepBudget(12.5)).toBe(POC_HARNESS_STEP_BUDGET);
    expect(resolveHarnessStepBudget('12' as unknown)).toBe(POC_HARNESS_STEP_BUDGET);
    expect(resolveHarnessStepBudget(null)).toBe(POC_HARNESS_STEP_BUDGET);
    expect(resolveHarnessStepBudget(undefined)).toBe(POC_HARNESS_STEP_BUDGET);
  });
});

describe('harnessStepBudgetReason', () => {
  test('reproduz o formato durável exato do POC', () => {
    expect(harnessStepBudgetReason(12)).toBe('step-budget-exhausted:12');
    // O motivo carrega o orçamento JÁ resolvido, nunca um valor malformado.
    expect(harnessStepBudgetReason(12.5)).toBe(`step-budget-exhausted:${POC_HARNESS_STEP_BUDGET}`);
  });
});

describe('decideHarnessPreStep', () => {
  test('continua enquanto o passo não ultrapassa o orçamento', () => {
    expect(decideHarnessPreStep({ step: 1, stepBudget: 12 })).toEqual({ cancel: false });
    expect(decideHarnessPreStep({ step: 12, stepBudget: 12 })).toEqual({ cancel: false });
  });

  test('cancela quando o passo ULTRAPASSA o orçamento, com o motivo do POC', () => {
    expect(decideHarnessPreStep({ step: 13, stepBudget: 12 })).toEqual({
      cancel: true, reason: 'step-budget-exhausted:12',
    });
  });

  test('o orçamento é configurável — o motivo reflete o orçamento efetivo', () => {
    expect(decideHarnessPreStep({ step: 4, stepBudget: 3 })).toEqual({
      cancel: true, reason: 'step-budget-exhausted:3',
    });
    expect(decideHarnessPreStep({ step: 4, stepBudget: 4 })).toEqual({ cancel: false });
  });

  test('fail-closed: passo malformado é tratado como acima de qualquer orçamento', () => {
    expect(decideHarnessPreStep({ step: Number.NaN, stepBudget: 12 })).toEqual({
      cancel: true, reason: 'step-budget-exhausted:12',
    });
    expect(decideHarnessPreStep({ step: 1.5, stepBudget: 12 })).toEqual({
      cancel: true, reason: 'step-budget-exhausted:12',
    });
  });

  test('orçamento malformado cai no valor do POC antes de decidir', () => {
    // step 13 ultrapassa o fallback (12) → cancela com o motivo do POC.
    expect(decideHarnessPreStep({ step: 13, stepBudget: Number.NaN })).toEqual({
      cancel: true, reason: `step-budget-exhausted:${POC_HARNESS_STEP_BUDGET}`,
    });
  });
});

describe('classifyHarnessTurnEnd', () => {
  test('completed NUNCA é sucesso — vira completed-unverified', () => {
    expect(classifyHarnessTurnEnd({ kind: 'completed' })).toBe('completed-unverified');
  });

  test('aborted pelo hook de orçamento é reconhecido pela razão estruturada', () => {
    expect(classifyHarnessTurnEnd({ kind: 'aborted', reasonKind: 'hook', reasonReason: 'step-budget-exhausted:12' }))
      .toBe('aborted-by-step-budget');
  });

  test('aborted por outra razão é aborted-other', () => {
    expect(classifyHarnessTurnEnd({ kind: 'aborted', reasonKind: 'signal', reasonReason: 'host-cancelled' }))
      .toBe('aborted-other');
    // reason.kind hook mas sem o prefixo de orçamento também é aborted-other.
    expect(classifyHarnessTurnEnd({ kind: 'aborted', reasonKind: 'hook', reasonReason: 'outra-coisa' }))
      .toBe('aborted-other');
    expect(classifyHarnessTurnEnd({ kind: 'aborted' })).toBe('aborted-other');
  });

  test('error é preservado', () => {
    expect(classifyHarnessTurnEnd({ kind: 'error' })).toBe('error');
  });
});

describe('harnessTurnOutcomeIsAuthoritativeSuccess', () => {
  test('nenhum desfecho de turno é sucesso — os gates do host decidem', () => {
    const outcomes: HarnessObservedTurnOutcome[] = [
      'completed-unverified', 'aborted-by-step-budget', 'aborted-other', 'error',
    ];
    for (const outcome of outcomes) {
      expect(harnessTurnOutcomeIsAuthoritativeSuccess(outcome)).toBe(false);
    }
  });
});
