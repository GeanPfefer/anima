import { planWorkRoutingAdjustment, type WorkRoutingAdjustmentContextV1 } from './work-routing-adjustment';

const context = (
  overrides: Partial<WorkRoutingAdjustmentContextV1> = {},
): WorkRoutingAdjustmentContextV1 => ({
  schemaVersion: 1,
  attempts: [],
  latestCheckpoint: null,
  ...overrides,
});

const failed = (attemptId: string, adjustment: 'none' | 'escalated' | 'reduced' = 'none') => ({
  attemptId,
  outcome: 'attempt_abandoned' as const,
  selectedEffort: 'standard' as const,
  adjustment,
});

describe('INTEL-03 — escalonamento e redução entre tentativas', () => {
  test('mantém o esforço-base sem duas falhas consecutivas', () => {
    expect(planWorkRoutingAdjustment({
      baselineEffort: 'light',
      context: context({ attempts: [failed('a1')] }),
    })).toMatchObject({
      kind: 'none', effectiveEffort: 'light', consecutiveFailures: 1,
      reason: 'baseline_sufficient',
    });
  });

  test.each([
    ['light', 'standard'],
    ['standard', 'strong'],
  ] as const)('escala %s para %s após duas falhas consecutivas', (baselineEffort, effectiveEffort) => {
    expect(planWorkRoutingAdjustment({
      baselineEffort,
      context: context({ attempts: [failed('a1'), failed('a2')] }),
    })).toMatchObject({
      kind: 'escalated', effectiveEffort, consecutiveFailures: 2,
      evidenceAttemptIds: ['a2', 'a1'], reason: 'two_consecutive_failures',
    });
  });

  test('não ultrapassa strong', () => {
    expect(planWorkRoutingAdjustment({
      baselineEffort: 'strong',
      context: context({ attempts: [failed('a1'), failed('a2')] }),
    })).toMatchObject({
      kind: 'none', effectiveEffort: 'strong', reason: 'already_at_strong',
    });
  });

  test.each(['result_submitted', 'work_cancelled'] as const)(
    '%s quebra a sequência de falhas',
    outcome => {
      expect(planWorkRoutingAdjustment({
        baselineEffort: 'light',
        context: context({
          attempts: [failed('a1'), failed('a2'), {
            attemptId: 'a3', outcome, selectedEffort: 'light', adjustment: 'none',
          }],
        }),
      })).toMatchObject({ kind: 'none', consecutiveFailures: 0 });
    },
  );

  test('reduz ao baseline quando a tentativa escalada deixou plano consolidado', () => {
    expect(planWorkRoutingAdjustment({
      baselineEffort: 'light',
      context: context({
        attempts: [failed('a1'), failed('a2', 'escalated')],
        latestCheckpoint: {
          attemptId: 'a2',
          nextStep: 'Executar testes',
          remainingSteps: ['Executar testes'],
          failures: [],
        },
      }),
    })).toMatchObject({
      kind: 'reduced', effectiveEffort: 'light',
      reason: 'consolidated_checkpoint_after_escalation',
      evidenceAttemptIds: ['a2'],
    });
  });

  test.each([
    { nextStep: '', remainingSteps: ['testar'], failures: [] },
    { nextStep: 'testar', remainingSteps: [], failures: [] },
    { nextStep: 'testar', remainingSteps: ['testar'], failures: ['erro'] },
  ])('não reduz com checkpoint inconclusivo: %o', latestCheckpoint => {
    expect(planWorkRoutingAdjustment({
      baselineEffort: 'light',
      context: context({
        attempts: [failed('a1'), failed('a2', 'escalated')],
        latestCheckpoint: { attemptId: 'a2', ...latestCheckpoint },
      }),
    })).toMatchObject({ kind: 'escalated', effectiveEffort: 'standard' });
  });
});
