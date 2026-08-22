/**
 * @jest-environment node
 */
jest.mock('@/lib/supabase/request-auth', () => ({ authenticateRequest: jest.fn() }));
jest.mock('@/lib/work-orchestration/autonomous-backlog-read', () => ({ readAutonomousBacklogCandidates: jest.fn() }));
jest.mock('@/lib/work-orchestration/autonomous-backlog-driver', () => ({ runAutonomousBacklogCycle: jest.fn() }));
jest.mock('@/lib/work-orchestration/executor-selection', () => ({ readExecutionContract: jest.fn(), resolveExecutorRoute: jest.fn() }));
jest.mock('@/lib/work-orchestration/post-turn-observation', () => ({ persistPostTurnHostObservations: jest.fn() }));
jest.mock('@/lib/work-orchestration/supervisor', () => ({ runSupervisorTurn: jest.fn() }));
jest.mock('@/lib/work-orchestration/resource-governor', () => ({ readResourceAdmission: jest.fn() }));

import { POST } from './route';
import { authenticateRequest } from '@/lib/supabase/request-auth';
import { readAutonomousBacklogCandidates } from '@/lib/work-orchestration/autonomous-backlog-read';
import { runAutonomousBacklogCycle } from '@/lib/work-orchestration/autonomous-backlog-driver';
import { readExecutionContract, resolveExecutorRoute } from '@/lib/work-orchestration/executor-selection';
import { persistPostTurnHostObservations } from '@/lib/work-orchestration/post-turn-observation';
import { runSupervisorTurn } from '@/lib/work-orchestration/supervisor';
import { readResourceAdmission } from '@/lib/work-orchestration/resource-governor';

const auth = authenticateRequest as jest.Mock;
const readBacklog = readAutonomousBacklogCandidates as jest.Mock;
const cycle = runAutonomousBacklogCycle as jest.Mock;
const readContract = readExecutionContract as jest.Mock;
const resolveRoute = resolveExecutorRoute as jest.Mock;
const observe = persistPostTurnHostObservations as jest.Mock;
const turn = runSupervisorTurn as jest.Mock;
const admission = readResourceAdmission as jest.Mock;

const request = (body: unknown): Request => ({
  json: async () => body, signal: new AbortController().signal,
} as unknown as Request);

const cycleResult = {
  turnsExecuted: 2, itemsTouched: 2, stopReason: 'no_eligible_work',
  pending: { readyOccupied: 0, running: 0, awaitingHuman: 0, blocked: 0 }, lastOutcome: 'execution_completed', turns: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  admission.mockReturnValue({ verdict: 'permit', pressure: 'low', reason: 'host_ready' });
  cycle.mockResolvedValue(cycleResult);
});

test('sem autenticação → 401 e o driver não é chamado', async () => {
  auth.mockResolvedValue(null);
  const res = await POST(request({}));
  expect(res.status).toBe(401);
  expect(cycle).not.toHaveBeenCalled();
});

test('maxTurns inválido → 400 sem chamar o driver', async () => {
  auth.mockResolvedValue({ client: {}, userId: 'u' });
  const res = await POST(request({ maxTurns: 0 }));
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ ok: false, error: { code: 'invalid_max_turns' } });
  expect(cycle).not.toHaveBeenCalled();
});

test('autenticado → chama o driver com os portos e devolve o resultado tipado', async () => {
  auth.mockResolvedValue({ client: { tag: 'authed' }, userId: 'u' });
  const res = await POST(request({}));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, value: cycleResult });
  expect(cycle).toHaveBeenCalledTimes(1);
  const deps = cycle.mock.calls[0][0];
  expect(typeof deps.readBacklog).toBe('function');
  expect(typeof deps.runTurn).toBe('function');
  expect(deps.hostPermitsAutonomousWork()).toBe(true);
  expect(deps.maxTurns).toBe(3); // padrão pequeno
  // O porto de backlog usa o cliente autenticado.
  readBacklog.mockResolvedValue([]);
  await deps.readBacklog();
  expect(readBacklog).toHaveBeenCalledWith({ tag: 'authed' });
});

test('maxTurns é limitado ao teto estrutural', async () => {
  auth.mockResolvedValue({ client: {}, userId: 'u' });
  await POST(request({ maxTurns: 999 }));
  expect(cycle.mock.calls[0][0].maxTurns).toBe(10);
});

test('porto consulta o Resource Governor a cada admissao e bloqueia defer/fail-closed', async () => {
  auth.mockResolvedValue({ client: {}, userId: 'u' });
  await POST(request({ maxTurns: 2 }));
  const permits = cycle.mock.calls[0][0].hostPermitsAutonomousWork;
  admission
    .mockReturnValueOnce({ verdict: 'permit', pressure: 'low', reason: 'host_ready' })
    .mockReturnValueOnce({ verdict: 'defer', pressure: 'high', reason: 'resource_pressure' })
    .mockReturnValueOnce({ verdict: 'fail_closed', pressure: 'unknown', reason: 'resource_authority_unavailable' });
  expect(permits()).toBe(true);
  expect(permits()).toBe(false);
  expect(permits()).toBe(false);
  expect(admission).toHaveBeenCalledTimes(3);
});

test('o runTurn injetado resolve o executor de worktree, chama o Supervisor e observa a volta', async () => {
  const maybeSingle = jest.fn().mockResolvedValue({ data: { intent: { execution_spec: {} } }, error: null });
  const client = { from: jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })) };
  auth.mockResolvedValue({ client, userId: 'u' });
  readContract.mockReturnValue({ executor: 'worktree', targetReference: 'anima' });
  resolveRoute.mockReturnValue({ ok: true, route: { adapter: { id: 'worktree-v1' }, candidate: {} } });
  const turnResult = { outcome: 'execution_completed', reconciliation: [], selection: { workItemId: 'w', approvedProposalVersion: 2 }, attemptId: 'a', terminalKind: 'result' };
  turn.mockResolvedValue(turnResult);

  await POST(request({}));
  const runTurn = cycle.mock.calls[0][0].runTurn;
  const entry = { workItemId: 'w', approvedProposalVersion: 2, approvalSeq: 5, targetReference: 'anima', queuePosition: 1, targetOccupied: false };
  const out = await runTurn(entry, new AbortController().signal);

  expect(out).toBe(turnResult);
  expect(turn).toHaveBeenCalledTimes(1);
  expect(turn.mock.calls[0][0].requestedWork).toEqual({ workItemId: 'w', expectedProposalVersion: 2 });
  expect(turn.mock.calls[0][0].routes[0].adapter.id).toBe('worktree-v1');
  expect(observe).toHaveBeenCalledTimes(1);
  expect(observe.mock.calls[0][0]).toMatchObject({ result: turnResult, contract: { executor: 'worktree' } });
});

test('runTurn com executor não resolvível → selection_not_executable, sem Supervisor', async () => {
  const maybeSingle = jest.fn().mockResolvedValue({ data: { intent: {} }, error: null });
  const client = { from: jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })) };
  auth.mockResolvedValue({ client, userId: 'u' });
  readContract.mockReturnValue({ executor: null, targetReference: 'other' });
  resolveRoute.mockReturnValue({ ok: false, error: { code: 'executor_unknown', message: 'x' } });

  await POST(request({}));
  const runTurn = cycle.mock.calls[0][0].runTurn;
  const entry = { workItemId: 'w', approvedProposalVersion: 1, approvalSeq: 5, targetReference: 'other', queuePosition: 1, targetOccupied: false };
  const out = await runTurn(entry, new AbortController().signal);

  expect(out.outcome).toBe('selection_not_executable');
  expect(out.selection.workItemId).toBe('w');
  expect(turn).not.toHaveBeenCalled();
  expect(observe).not.toHaveBeenCalled();
});
