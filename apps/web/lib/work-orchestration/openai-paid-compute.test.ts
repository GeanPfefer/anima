/** @jest-environment node */
import type { PaidComputeAuthorizationV1 } from '@anima/core';
import { createOpenAIPaidCallAuthorizer, openAIProviderResourceClass } from './openai-paid-compute';
import { readActivePaidComputeAuthorization, reservePaidComputeBudget } from './paid-compute-authorization-store';

jest.mock('./paid-compute-authorization-store', () => ({
  readActivePaidComputeAuthorization: jest.fn(),
  reservePaidComputeBudget: jest.fn(),
}));

const read = readActivePaidComputeAuthorization as jest.MockedFunction<typeof readActivePaidComputeAuthorization>;
const reserve = reservePaidComputeBudget as jest.MockedFunction<typeof reservePaidComputeBudget>;
const input = { workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
  providerId: 'openai' as const, model: 'gpt-test', callIndex: 1, maxDurationMs: 60_000 };
const authorization = (overrides: Partial<PaidComputeAuthorizationV1> = {}): PaidComputeAuthorizationV1 => ({
  schemaVersion: 1, authorizationId: 'auth-1', authorizedBy: 'user-1', authorizedByAuthor: 'user',
  providerId: 'openai', nodeId: null, resourceClass: openAIProviderResourceClass('gpt-test'), workItemId: 'work-1',
  maxDurationMs: 60_000, maxCostEstimate: { currency: 'USD', amount: 0.25 },
  validFrom: '2020-01-01T00:00:00.000Z', validUntil: '2100-01-01T00:00:00.000Z', ...overrides,
});

describe('OpenAI paid compute admission', () => {
  beforeEach(() => { jest.clearAllMocks(); read.mockResolvedValue(authorization()); reserve.mockResolvedValue({ ok: true, action: 'reserved', reservationId: 'r1' }); });

  test('reserva o teto inteiro uma vez e revalida rodadas seguintes sem duplicar accounting', async () => {
    const authorize = createOpenAIPaidCallAuthorizer({} as never);
    await authorize(input);
    await authorize({ ...input, callIndex: 2 });
    expect(read).toHaveBeenCalledTimes(2);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      authorizationId: 'auth-1', idempotencyKey: 'openai-attempt:attempt-1', attemptId: 'attempt-1',
      resourceClass: 'provider_api:gpt-test', estimate: { currency: 'USD', amount: 0.25 },
    }));
  });

  test('ausência, provider/model/item divergente ou budget consumido recusam', async () => {
    read.mockResolvedValueOnce(null);
    await expect(createOpenAIPaidCallAuthorizer({} as never)(input)).rejects.toThrow(/authorization_missing/);
    read.mockResolvedValueOnce(authorization({ providerId: 'outro' }));
    await expect(createOpenAIPaidCallAuthorizer({} as never)(input)).rejects.toThrow(/provider_mismatch/);
    read.mockResolvedValueOnce(authorization({ resourceClass: 'provider_api:outro' }));
    await expect(createOpenAIPaidCallAuthorizer({} as never)(input)).rejects.toThrow(/resource_class_mismatch/);
    read.mockResolvedValueOnce(authorization({ workItemId: 'work-2' }));
    await expect(createOpenAIPaidCallAuthorizer({} as never)(input)).rejects.toThrow(/work_item_mismatch/);
    read.mockResolvedValueOnce(authorization()); reserve.mockResolvedValueOnce({ ok: false, code: 'aggregate_budget_exceeded', message: 'x' });
    await expect(createOpenAIPaidCallAuthorizer({} as never)(input)).rejects.toThrow(/aggregate_budget_exceeded/);
  });

  test('replay de reserva não dispara nova chamada paga', async () => {
    reserve.mockResolvedValueOnce({ ok: true, action: 'replayed', reservationId: 'r1' });
    await expect(createOpenAIPaidCallAuthorizer({} as never)(input)).rejects.toThrow(/já consumida/);
  });
});
