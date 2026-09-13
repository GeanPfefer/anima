import { describe, expect, test } from '@jest/globals';
import { settleOpenAIActualCostReservation } from './openai-actual-cost-settlement';

const cohort = { provider: 'openai', model: 'gpt-test', capability: 'coder', taskClass: 'code' };
const pricing = { schemaVersion: 1 as const, provider: 'openai', model: 'gpt-test', currency: 'USD', inputPerMillion: 1, outputPerMillion: 2, sourceRef: 'published-price-v1' };
const reservation = { reservationId: 'reservation-1', attemptId: 'attempt-1', currency: 'USD', reservedAmount: 1 };
const usage = { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 1000, providerCallCount: 2, terminalEvidence: true as const };

describe('OpenAI actual-cost settlement', () => {
  test('settles one correlated reservation from aggregate terminal provider usage', async () => {
    const settled: unknown[] = [];
    const result = await settleOpenAIActualCostReservation({ reservation, attemptId: 'attempt-1', model: 'gpt-test', cohort, usage, pricing, settlePaidComputeBudgetReservation: async audit => { settled.push(audit); } });
    expect(result.settled).toBe(true);
    expect(settled).toHaveLength(1);
  });

  test('fails closed without terminal evidence, on mismatch, or above reserve', async () => {
    const settle = async () => undefined;
    await expect(settleOpenAIActualCostReservation({ reservation, attemptId: 'other', model: 'gpt-test', cohort, usage, pricing, settlePaidComputeBudgetReservation: settle })).resolves.toEqual({ settled: false, reason: 'attempt_mismatch' });
    await expect(settleOpenAIActualCostReservation({ reservation, attemptId: 'attempt-1', model: 'gpt-test', cohort, usage: { ...usage, terminalEvidence: false as never }, pricing, settlePaidComputeBudgetReservation: settle })).resolves.toEqual({ settled: false, reason: 'terminal_evidence_missing' });
    await expect(settleOpenAIActualCostReservation({ reservation: { ...reservation, reservedAmount: 0.0001 }, attemptId: 'attempt-1', model: 'gpt-test', cohort, usage, pricing, settlePaidComputeBudgetReservation: settle })).resolves.toEqual({ settled: false, reason: 'reservation_exceeded' });
  });
});
