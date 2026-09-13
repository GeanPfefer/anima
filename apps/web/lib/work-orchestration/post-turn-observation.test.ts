/** @jest-environment node */
import type { ComputeCohortKeyV1 } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('./paid-compute-authorization-store', () => ({
  settlePaidComputeBudgetReservation: jest.fn(async () => ({
    ok: true,
    action: 'settled',
    settledAmount: 0.003,
    releasedExcess: 0.997,
    currency: 'USD',
    costSource: 'estimated',
  })),
}));
jest.mock('./gate-evidence', () => ({ gateEvidenceSinkFor: jest.fn(), persistHostObservedGateEvidence: jest.fn() }));
jest.mock('./coder-evidence', () => ({ coderEvidenceSinkFor: jest.fn(), persistHostObservedCoderEvidence: jest.fn() }));
jest.mock('./host-evidence', () => ({ hostEvidenceSinkFor: jest.fn(), observeAndPersistHostGitEvidence: jest.fn() }));
jest.mock('./verifier-opinion', () => ({ computeAndPersistVerifierOpinion: jest.fn(), verifierOpinionSinkFor: jest.fn() }));
jest.mock('./server', () => ({ createWorkOrchestrationService: jest.fn() }));
jest.mock('./executor-selection', () => ({ projectRoot: jest.fn() }));
jest.mock('./worktree-executor', () => ({ worktreeBranchFor: jest.fn() }));

import { persistPostTurnHostObservations } from './post-turn-observation';
import { settlePaidComputeBudgetReservation } from './paid-compute-authorization-store';
import type { ExecutionContract } from './executor-selection';
import type { SupervisorTurnResult } from './supervisor';

const mockSettleStore = settlePaidComputeBudgetReservation as jest.MockedFunction<typeof settlePaidComputeBudgetReservation>;
const cohort: ComputeCohortKeyV1 = {
  provider: 'openai', model: 'gpt-test', capability: 'programming', taskClass: 'code', placement: 'provider_api',
};
const pricing = {
  schemaVersion: 1 as const,
  provider: 'openai',
  model: 'gpt-test',
  currency: 'USD',
  inputPerMillion: 1,
  outputPerMillion: 2,
  sourceRef: 'published-price-v1',
};
const reservation = { reservationId: 'reservation-1', attemptId: 'attempt-1', currency: 'USD', reservedAmount: 1 };
const usage = { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 1000, providerCallCount: 2, terminalEvidence: true as const };
const result = {
  outcome: 'execution_failed',
  reconciliation: [],
  selection: {
    workItemId: '00000000-0000-0000-0000-000000000001',
    approvedProposalVersion: 1,
    approvalSeq: 1,
    targetReference: 'anima',
    selectionPolicy: 'backlog_driver',
    queueSize: 1,
    runnerUpApprovalSeq: null,
    skippedOccupiedTargets: 0,
  },
  claimId: 'claim-1', attemptId: 'attempt-1', terminalKind: null,
  routingDecision: null, routingAdjustment: null, claimReleased: true,
  requiresAnotherTurn: false, refusal: null, gaps: [],
} as SupervisorTurnResult;
const contract = { coderBackend: 'openai', executor: null } as ExecutionContract;
const client = {} as SupabaseClient<Database>;

describe('persistPostTurnHostObservations — OpenAI actual-cost adapter', () => {
  beforeEach(() => jest.clearAllMocks());

  test('adapta o audit factual para o contrato estrito do store', async () => {
    await persistPostTurnHostObservations({
      client, result, contract, gateObservations: [], coderObservations: [],
      openAIActualCostSettlement: { reservation, attemptId: 'attempt-1', model: 'gpt-test', cohort, usage, pricing },
    });

    expect(mockSettleStore).toHaveBeenCalledTimes(1);
    expect(mockSettleStore).toHaveBeenCalledWith(client, {
      reservationId: 'reservation-1',
      settled: { currency: 'USD', amount: 0.003 },
      costSource: 'estimated',
    });
    expect(mockSettleStore.mock.calls[0]?.[1]).not.toHaveProperty('schemaVersion');
    expect(mockSettleStore.mock.calls[0]?.[1]).not.toHaveProperty('pricing');
    expect(mockSettleStore.mock.calls[0]?.[1]).not.toHaveProperty('usage');
  });

  test('pricing ausente falha fechado e não inventa liquidação', async () => {
    await persistPostTurnHostObservations({
      client, result, contract, gateObservations: [], coderObservations: [],
      openAIActualCostSettlement: { reservation, attemptId: 'attempt-1', model: 'gpt-5.6-terra', cohort: { ...cohort, model: 'gpt-5.6-terra' }, usage, pricing: null },
    });

    expect(mockSettleStore).not.toHaveBeenCalled();
  });
});
