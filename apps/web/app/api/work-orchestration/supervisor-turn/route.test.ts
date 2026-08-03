/**
 * @jest-environment node
 */
jest.mock('@/lib/supabase/request-auth', () => ({ authenticateRequest: jest.fn() }));
jest.mock('@/lib/work-orchestration/execution', () => ({ localRunnerRouteFromEnvironment: jest.fn() }));
jest.mock('@/lib/work-orchestration/supervisor', () => ({ runSupervisorTurn: jest.fn() }));

import { POST } from './route';
import { authenticateRequest } from '@/lib/supabase/request-auth';
import { localRunnerRouteFromEnvironment } from '@/lib/work-orchestration/execution';
import { runSupervisorTurn } from '@/lib/work-orchestration/supervisor';

const auth = authenticateRequest as jest.Mock;
const route = localRunnerRouteFromEnvironment as jest.Mock;
const turn = runSupervisorTurn as jest.Mock;

const request = (body: unknown): Request => ({
  json: async () => body, signal: new AbortController().signal,
} as unknown as Request);

beforeEach(() => {
  jest.clearAllMocks();
  route.mockReturnValue({ candidate: { routeId: 'r' }, adapter: { id: 'local-runner-v1' } });
  turn.mockResolvedValue({ outcome: 'execution_completed', reconciliation: [] });
});

test('sem autenticação → 401 e o Supervisor não é chamado', async () => {
  auth.mockResolvedValue(null);
  const res = await POST(request({ workItemId: 'w', expectedProposalVersion: 1 }));
  expect(res.status).toBe(401);
  expect(turn).not.toHaveBeenCalled();
});

test('autenticado → chama o MESMO runSupervisorTurn com o cliente autenticado; corpo não carrega identidade', async () => {
  const client = { tag: 'authed-client' };
  auth.mockResolvedValue({ client, userId: 'user-1' });
  const res = await POST(request({ workItemId: 'w', expectedProposalVersion: 2, user_id: 'ATACANTE' }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, value: { outcome: 'execution_completed', reconciliation: [] } });
  expect(turn).toHaveBeenCalledTimes(1);
  const passed = turn.mock.calls[0][0];
  expect(passed.client).toBe(client);
  expect(passed.requestedWork).toEqual({ workItemId: 'w', expectedProposalVersion: 2 });
  // A identidade nunca vem do corpo — só workItemId/versão são repassados.
  expect(JSON.stringify(passed.requestedWork)).not.toContain('ATACANTE');
});
