/**
 * @jest-environment node
 */
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/work-orchestration/server', () => ({ createWorkOrchestrationService: jest.fn() }));
jest.mock('@/lib/work-orchestration/execution', () => ({
  ...jest.requireActual('@/lib/work-orchestration/execution'),
  localRunnerFromEnvironment: jest.fn(),
  runExecutorOnce: jest.fn(),
  recordExecutionTerminal: jest.fn(),
}));
jest.mock('@anima/core', () => ({
  ...jest.requireActual('@anima/core'),
  evaluateAutonomousEligibility: jest.fn(),
}));

import { POST } from './route';
import { createClient } from '@/lib/supabase/server';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { localRunnerFromEnvironment, runExecutorOnce, recordExecutionTerminal } from '@/lib/work-orchestration/execution';
import { evaluateAutonomousEligibility } from '@anima/core';

const runOnce = runExecutorOnce as jest.Mock;
const WID = '11111111-1111-4111-8111-111111111111';
const AID = '22222222-2222-4222-8222-222222222222';

const spec = {
  schemaVersion: 1,
  target: { kind: 'project', reference: 'anima' },
  permissions: ['workspace_read', 'workspace_write_isolated'],
  validationCriteria: [{ label: 'testes', command: 'npm test' }],
  limits: { maxAttempts: 3, maxDurationMinutes: 30 },
};
const item = {
  id: WID, proposalVersion: 1, capability: 'programming',
  proposal: { data: { objective: 'x', includedScope: ['a.ts'], excludedScope: ['b.ts'] } },
};

beforeEach(() => {
  jest.clearAllMocks();
  (localRunnerFromEnvironment as jest.Mock).mockReturnValue({ id: 'local-runner-v1' });
  (evaluateAutonomousEligibility as jest.Mock).mockReturnValue({ eligible: true, spec });
  (createClient as jest.Mock).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    rpc: jest.fn(async () => ({ error: null })),
  });
  (createWorkOrchestrationService as jest.Mock).mockReturnValue({
    getItem: async () => ({ ok: true, value: item }),
    listEvents: async () => ({ ok: true, value: [] }),
    listContexts: async () => ({ ok: true, value: [] }),
  });
  runOnce.mockResolvedValue({ ok: true, terminal: { kind: 'result' } });
  (recordExecutionTerminal as jest.Mock).mockResolvedValue({ error: null });
});

const request = (signal: AbortSignal): Request => ({
  json: async () => ({ workItemId: WID, expectedProposalVersion: 1, attemptId: AID }),
  signal,
} as unknown as Request);

test('a execução comandada não herda o cancelamento do request HTTP (mesmo desacople de 3c9ac70)', async () => {
  const transport = new AbortController();
  await POST(request(transport.signal));

  expect(runOnce).toHaveBeenCalledTimes(1);
  const executionSignal = runOnce.mock.calls[0]![2] as AbortSignal;
  expect(executionSignal).not.toBe(transport.signal);

  // Abandonar a conexão HTTP aborta o transporte, jamais a execução já iniciada.
  transport.abort('client_disconnected');
  expect(transport.signal.aborted).toBe(true);
  expect(executionSignal.aborted).toBe(false);
});
