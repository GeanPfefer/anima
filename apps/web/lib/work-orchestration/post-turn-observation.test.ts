/** @jest-environment node */
import type { SupabaseClient } from '@supabase/supabase-js';

const persistGate = jest.fn(async () => undefined);
const persistCoder = jest.fn(async () => undefined);
const observeGit = jest.fn(async () => undefined);
const computeOpinion = jest.fn(async () => undefined);
const getItem = jest.fn();
const listEvents = jest.fn();

jest.mock('./gate-evidence', () => ({
  gateEvidenceSinkFor: jest.fn(() => ({})),
  persistHostObservedGateEvidence: persistGate,
}));
jest.mock('./coder-evidence', () => ({
  coderEvidenceSinkFor: jest.fn(() => ({})),
  persistHostObservedCoderEvidence: persistCoder,
}));
jest.mock('./host-evidence', () => ({
  hostEvidenceSinkFor: jest.fn(() => ({})),
  observeAndPersistHostGitEvidence: observeGit,
}));
jest.mock('./verifier-opinion', () => ({
  verifierOpinionSinkFor: jest.fn(() => ({})),
  computeAndPersistVerifierOpinion: computeOpinion,
}));
jest.mock('./server', () => ({
  createWorkOrchestrationService: jest.fn(() => ({ getItem, listEvents })),
}));

import { persistPostTurnHostObservations } from './post-turn-observation';

const client = {} as SupabaseClient<any>;
const result = {
  attemptId: 'attempt-1',
  selection: { workItemId: 'item-1', approvedProposalVersion: 1 },
  terminalKind: 'result',
} as any;

describe('persistPostTurnHostObservations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getItem.mockResolvedValue({ ok: true, value: { id: 'item-1' } });
    listEvents.mockResolvedValue({ ok: true, value: [] });
  });

  test('não persiste nada sem tentativa correlacionada', async () => {
    await persistPostTurnHostObservations({
      client,
      result: { ...result, attemptId: null },
      contract: null,
      gateObservations: [],
      coderObservations: [],
    });

    expect(persistGate).not.toHaveBeenCalled();
    expect(persistCoder).not.toHaveBeenCalled();
    expect(computeOpinion).not.toHaveBeenCalled();
  });

  test('persiste observações do host e parecer fresco após resultado', async () => {
    await persistPostTurnHostObservations({
      client,
      result,
      contract: null,
      gateObservations: [{ gate: 'lint', durationMs: 12, outcome: 'passed' }] as any,
      coderObservations: [{ provider: 'ollama', model: 'qwen', durationMs: 34 }] as any,
    });

    expect(persistGate).toHaveBeenCalledTimes(1);
    expect(persistCoder).toHaveBeenCalledTimes(1);
    expect(getItem).toHaveBeenCalledWith('item-1');
    expect(listEvents).toHaveBeenCalledWith('item-1');
    expect(computeOpinion).toHaveBeenCalledTimes(1);
    expect(observeGit).not.toHaveBeenCalled();
  });

  test('falha de leitura do parecer permanece fail-open', async () => {
    getItem.mockRejectedValueOnce(new Error('store unavailable'));

    await expect(persistPostTurnHostObservations({
      client,
      result,
      contract: null,
      gateObservations: [],
      coderObservations: [],
    })).resolves.toBeUndefined();

    expect(computeOpinion).not.toHaveBeenCalled();
  });
});
