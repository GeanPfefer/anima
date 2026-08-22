/**
 * @jest-environment node
 */
jest.mock('@/lib/supabase/request-auth', () => ({ authenticateRequest: jest.fn() }));
jest.mock('@/lib/work-orchestration/autonomous-backlog-deps', () => ({ buildProjectBacklogCycleDeps: jest.fn() }));
jest.mock('@/lib/work-orchestration/autonomous-backlog-driver', () => ({ runAutonomousBacklogCycle: jest.fn() }));
jest.mock('@/lib/work-orchestration/autonomous-backlog-host-turn', () => ({ runAutonomousBacklogHostTurn: jest.fn() }));
jest.mock('@anima/core', () => ({ planAutonomousBacklogTurn: jest.fn() }));

import { POST } from './route';
import { authenticateRequest } from '@/lib/supabase/request-auth';
import { buildProjectBacklogCycleDeps } from '@/lib/work-orchestration/autonomous-backlog-deps';
import { runAutonomousBacklogCycle } from '@/lib/work-orchestration/autonomous-backlog-driver';
import { runAutonomousBacklogHostTurn } from '@/lib/work-orchestration/autonomous-backlog-host-turn';
import { planAutonomousBacklogTurn } from '@anima/core';

const auth = authenticateRequest as jest.Mock;
const buildDeps = buildProjectBacklogCycleDeps as jest.Mock;
const cycle = runAutonomousBacklogCycle as jest.Mock;
const hostTurn = runAutonomousBacklogHostTurn as jest.Mock;
const plan = planAutonomousBacklogTurn as jest.Mock;

const request = (body: unknown): Request => ({
  json: async () => body, signal: new AbortController().signal,
} as unknown as Request);

const hostResult = {
  cyclesExecuted: 2, turnsExecuted: 2, itemsTouched: 2, stopReason: 'max_cycles_reached',
  continuation: 'continue', moreWorkAvailable: true, lastOutcome: 'execution_completed', cycles: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  hostTurn.mockResolvedValue(hostResult);
  buildDeps.mockReturnValue({
    readBacklog: jest.fn().mockResolvedValue([{ id: 'c' }]),
    hostPermitsAutonomousWork: () => true,
    runTurn: jest.fn(),
  });
  cycle.mockResolvedValue({ turnsExecuted: 1, stopReason: 'max_turns_reached', turns: [], lastOutcome: null, itemsTouched: 1, pending: {} });
});

test('sem autenticação → 401 e o host-turn não é chamado', async () => {
  auth.mockResolvedValue(null);
  const res = await POST(request({}));
  expect(res.status).toBe(401);
  expect(hostTurn).not.toHaveBeenCalled();
});

test('bounds inválidos → 400 sem chamar o host-turn', async () => {
  auth.mockResolvedValue({ client: {}, userId: 'u' });
  const res = await POST(request({ maxCycles: 0 }));
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ ok: false, error: { code: 'invalid_bounds' } });
  expect(hostTurn).not.toHaveBeenCalled();
});

test('autenticado → chama o host-turn e devolve o resultado tipado', async () => {
  auth.mockResolvedValue({ client: { tag: 'authed' }, userId: 'u' });
  const res = await POST(request({}));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, value: hostResult });
  expect(hostTurn).toHaveBeenCalledTimes(1);
  const deps = hostTurn.mock.calls[0][0];
  expect(typeof deps.runCycle).toBe('function');
  expect(typeof deps.peekMoreWork).toBe('function');
  expect(deps.maxCycles).toBe(2); // default
  expect(buildDeps).toHaveBeenCalledWith({ tag: 'authed' }, expect.any(String));
});

test('bounds são limitados aos tetos estruturais', async () => {
  auth.mockResolvedValue({ client: {}, userId: 'u' });
  await POST(request({ maxTurnsPerCycle: 999, maxCycles: 999 }));
  const deps = hostTurn.mock.calls[0][0];
  expect(deps.maxCycles).toBe(10);
  // runCycle usa maxTurnsPerCycle limitado a 10.
  await deps.runCycle(new AbortController().signal);
  expect(cycle.mock.calls[0][0].maxTurns).toBe(10);
});

test('runCycle injetado roda um ciclo bounded com maxTurnsPerCycle', async () => {
  auth.mockResolvedValue({ client: {}, userId: 'u' });
  await POST(request({ maxTurnsPerCycle: 1, maxCycles: 2 }));
  const deps = hostTurn.mock.calls[0][0];
  await deps.runCycle(new AbortController().signal);
  expect(cycle).toHaveBeenCalledTimes(1);
  expect(cycle.mock.calls[0][0].maxTurns).toBe(1);
});

test('peekMoreWork injetado consulta a política sobre o backlog fresco', async () => {
  auth.mockResolvedValue({ client: {}, userId: 'u' });
  plan.mockReturnValue({ action: 'execute_next', entry: {}, pending: {} });
  await POST(request({}));
  const deps = hostTurn.mock.calls[0][0];
  const more = await deps.peekMoreWork();
  expect(more).toBe(true);
  expect(plan).toHaveBeenCalledTimes(1);

  plan.mockReturnValue({ action: 'stop', reason: 'no_eligible_work', pending: {} });
  expect(await deps.peekMoreWork()).toBe(false);
});
