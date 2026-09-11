import { describe, expect, test } from 'vitest';
import { settleOpenAIActualCost } from './openai-actual-cost-settlement';

const pricing = {
  schemaVersion: 1 as const, provider: 'openai', model: 'gpt-test', currency: 'USD',
  inputPerMillion: 2, cachedInputPerMillion: 1, outputPerMillion: 4, sourceRef: 'pricing/v1',
};

const input = () => ({
  attemptId: 'attempt-1', reservationId: 'reservation-1', terminalEvidencePersisted: true,
  provider: 'openai' as const, model: 'gpt-test', pricing, reservedAmount: { currency: 'USD', amount: 1 },
  usage: { inputTokens: 100_000, cachedInputTokens: 20_000, outputTokens: 50_000, providerCallCount: 3 },
});

describe('OpenAI actual-cost settlement', () => {
  test('settles one correlated aggregate with a reproducible versioned trail', async () => {
    const calls: unknown[] = [];
    const result = await settleOpenAIActualCost(input(), async call => { calls.push(call); });
    expect(result.status).toBe('settled');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ reservationId: 'reservation-1', idempotencyKey: 'openai-actual-cost:reservation-1', actualCost: { currency: 'USD', amount: 0.4 }, trail: { schemaVersion: 1, attemptId: 'attempt-1' } });
  });

  test('does not settle absent terminal evidence, inconsistent usage, or an overage', async () => {
    const settle = async () => { throw new Error('must not settle'); };
    await expect(settleOpenAIActualCost({ ...input(), terminalEvidencePersisted: false }, settle)).resolves.toEqual({ status: 'not_settled', reason: 'terminal_evidence_incomplete' });
    await expect(settleOpenAIActualCost({ ...input(), usage: { ...input().usage, cachedInputTokens: 100_001 } }, settle)).resolves.toEqual({ status: 'not_settled', reason: 'usage_incomplete' });
    await expect(settleOpenAIActualCost({ ...input(), reservedAmount: { currency: 'USD', amount: 0.39 } }, settle)).resolves.toEqual({ status: 'not_settled', reason: 'reservation_exceeded' });
  });
});
