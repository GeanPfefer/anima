import { jest } from '@jest/globals';

const settleOpenAIActualCostReservation = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const settlePaidComputeBudgetReservation = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.mock('./openai-actual-cost-settlement', () => ({ settleOpenAIActualCostReservation }));
jest.mock('./paid-compute-authorization-store', () => ({ settlePaidComputeBudgetReservation }));
jest.mock('./gate-evidence', () => ({ gateEvidenceSinkFor: jest.fn(), persistHostObservedGateEvidence: jest.fn() }));
jest.mock('./coder-evidence', () => ({ coderEvidenceSinkFor: jest.fn(), persistHostObservedCoderEvidence: jest.fn() }));
jest.mock('./host-evidence', () => ({ hostEvidenceSinkFor: jest.fn(), observeAndPersistHostGitEvidence: jest.fn() }));
jest.mock('./verifier-opinion', () => ({ computeAndPersistVerifierOpinion: jest.fn(), verifierOpinionSinkFor: jest.fn() }));
jest.mock('./server', () => ({ createWorkOrchestrationService: jest.fn() }));
jest.mock('./executor-selection', () => ({ projectRoot: jest.fn() }));
jest.mock('./worktree-executor', () => ({ worktreeBranchFor: jest.fn() }));

import { persistPostTurnHostObservations } from './post-turn-observation';

describe('persistPostTurnHostObservations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('liquida a reserva OpenAI pelo caller vivo pós-turno com o audit terminal explícito', async () => {
    const reservation = { reservationId: 'reservation-1' };
    const usage = { inputTokens: 10, outputTokens: 2, cachedInputTokens: 1 };
    const pricing = { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2, cachedInputUsdPerMillionTokens: 0.5 };

    await persistPostTurnHostObservations({
      client: {} as never,
      contract: { coderBackend: 'openai' } as never,
      gateObservations: [],
      coderObservations: [],
      result: {
        attemptId: 'attempt-1',
        selection: { workItemId: 'work-item-1', approvedProposalVersion: 1 },
        terminalKind: 'error',
        openAIActualCostSettlement: {
          reservation,
          attemptId: 'attempt-1',
          model: 'gpt-4.1-mini',
          cohort: 'paid-compute',
          usage,
          pricing,
        },
      } as never,
    });

    expect(settleOpenAIActualCostReservation).toHaveBeenCalledWith(expect.objectContaining({
      reservation,
      attemptId: 'attempt-1',
      model: 'gpt-4.1-mini',
      cohort: 'paid-compute',
      usage,
      pricing,
      settlePaidComputeBudgetReservation: expect.any(Function),
    }));
  });
});
