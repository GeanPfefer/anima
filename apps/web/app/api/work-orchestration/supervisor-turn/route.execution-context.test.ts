/**
 * @jest-environment node
 */
// A2-0 R1 — a rota HTTP nunca declara contexto de execução, mesmo com ANIMA_EXECUTION_MODE no ambiente do servidor.
// Integração real rota → persistPostTurnHostObservations; só o sink de contexto e a infraestrutura são simulados.
jest.mock('@/lib/supabase/request-auth', () => ({ authenticateRequest: jest.fn() }));
jest.mock('@/lib/work-orchestration/execution', () => ({ localRunnerRouteFromEnvironment: jest.fn() }));
jest.mock('@/lib/work-orchestration/supervisor', () => ({ runSupervisorTurn: jest.fn() }));
jest.mock('@/lib/work-orchestration/server', () => ({ createWorkOrchestrationService: jest.fn() }));
jest.mock('@/lib/work-orchestration/resource-governor', () => ({ composeSupervisorResourceAdvisory: jest.fn() }));
jest.mock('@/lib/work-orchestration/execution-context-evidence', () => ({
  persistHostObservedExecutionContext: jest.fn(),
  resolveExecutionContextClaim: jest.fn(),
}));

import { POST } from './route';
import { authenticateRequest } from '@/lib/supabase/request-auth';
import { localRunnerRouteFromEnvironment } from '@/lib/work-orchestration/execution';
import { runSupervisorTurn } from '@/lib/work-orchestration/supervisor';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { persistHostObservedExecutionContext, resolveExecutionContextClaim } from '@/lib/work-orchestration/execution-context-evidence';

const request = (body: unknown): Request => ({ json: async () => body, signal: new AbortController().signal } as unknown as Request);
const savedEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  (authenticateRequest as jest.Mock).mockResolvedValue({ client: { from: jest.fn() }, userId: 'user-1' });
  (localRunnerRouteFromEnvironment as jest.Mock).mockReturnValue({ candidate: { routeId: 'r' }, adapter: { id: 'local-runner-v1' } });
  (createWorkOrchestrationService as jest.Mock).mockReturnValue({
    listEvents: jest.fn().mockResolvedValue({ ok: true, value: [] }),
    listEventsByType: jest.fn().mockResolvedValue({ ok: true, value: [] }),
    getItem: jest.fn().mockResolvedValue({ ok: true, value: {} }),
  });
  (persistHostObservedExecutionContext as jest.Mock).mockResolvedValue({ ok: false, stage: 'skipped', reason: 'execution mode not declared' });
  // Turno com attempt correlacionada em terminal de erro: percorre o passo (-1) e pula Git/Verifier.
  (runSupervisorTurn as jest.Mock).mockResolvedValue({
    outcome: 'execution_failed', reconciliation: [], attemptId: 'attempt-1', claimId: 'claim-1',
    selection: { workItemId: 'work-1', approvedProposalVersion: 2 }, terminalKind: 'error', claimReleased: true, requiresAnotherTurn: false,
  });
});
afterEach(() => { process.env = { ...savedEnv }; });

test.each(['unattended', 'supervised', 'manual', undefined])(
  'ANIMA_EXECUTION_MODE=%s no servidor web: a rota passa declaração null e não resolve declaração do ambiente',
  async (mode) => {
    if (mode === undefined) delete process.env.ANIMA_EXECUTION_MODE; else process.env.ANIMA_EXECUTION_MODE = mode;
    process.env.ANIMA_EXECUTION_RUNNER_KIND = 'resident_host';
    const res = await POST(request({}));
    expect(res.status).toBeLessThan(600);
    expect(resolveExecutionContextClaim).not.toHaveBeenCalled();
    expect(persistHostObservedExecutionContext).toHaveBeenCalledTimes(1);
    expect((persistHostObservedExecutionContext as jest.Mock).mock.calls[0]![0]).toEqual({ workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2 });
    expect((persistHostObservedExecutionContext as jest.Mock).mock.calls[0]![1]).toBeNull();
  },
);

test('corpo da requisição não consegue injetar contexto de execução', async () => {
  const hostile = { executionContext: { executionMode: 'unattended', actorKind: 'automated_runner', runner: { kind: 'resident_host', authenticatedUserId: '11111111-1111-4111-8111-111111111111', instanceId: 'x' } },
    executionMode: 'unattended', actorKind: 'automated_runner', runner: { authenticatedUserId: 'service_role' } };
  await POST(request(hostile));
  expect((persistHostObservedExecutionContext as jest.Mock).mock.calls[0]![1]).toBeNull();
});
