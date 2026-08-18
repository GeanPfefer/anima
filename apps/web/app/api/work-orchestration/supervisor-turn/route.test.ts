/**
 * @jest-environment node
 */
jest.mock('@/lib/supabase/request-auth', () => ({ authenticateRequest: jest.fn() }));
jest.mock('@/lib/work-orchestration/execution', () => ({ localRunnerRouteFromEnvironment: jest.fn() }));
jest.mock('@/lib/work-orchestration/supervisor', () => ({ runSupervisorTurn: jest.fn() }));
jest.mock('@/lib/work-orchestration/server', () => ({ createWorkOrchestrationService: jest.fn() }));
jest.mock('@/lib/work-orchestration/resource-governor', () => ({ composeSupervisorResourceAdvisory: jest.fn() }));

import { POST } from './route';
import { authenticateRequest } from '@/lib/supabase/request-auth';
import { localRunnerRouteFromEnvironment } from '@/lib/work-orchestration/execution';
import { runSupervisorTurn } from '@/lib/work-orchestration/supervisor';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { composeSupervisorResourceAdvisory } from '@/lib/work-orchestration/resource-governor';

const auth = authenticateRequest as jest.Mock;
const route = localRunnerRouteFromEnvironment as jest.Mock;
const turn = runSupervisorTurn as jest.Mock;
const service = createWorkOrchestrationService as jest.Mock;
const advisory = composeSupervisorResourceAdvisory as jest.Mock;

const request = (body: unknown): Request => ({
  json: async () => body, signal: new AbortController().signal,
} as unknown as Request);

beforeEach(() => {
  jest.clearAllMocks();
  route.mockReturnValue({ candidate: { routeId: 'r' }, adapter: { id: 'local-runner-v1' } });
  turn.mockResolvedValue({ outcome: 'execution_completed', reconciliation: [] });
  service.mockReturnValue({
    listEvents: jest.fn().mockResolvedValue({ ok: true, value: [] }),
    listEventsByType: jest.fn().mockResolvedValue({ ok: true, value: [] }),
    getItem: jest.fn().mockResolvedValue({ ok: true, value: {} }),
  });
  advisory.mockReturnValue(null);
});

test('sem autenticação → 401 e o Supervisor não é chamado', async () => {
  auth.mockResolvedValue(null);
  const res = await POST(request({ workItemId: 'w', expectedProposalVersion: 1 }));
  expect(res.status).toBe(401);
  expect(turn).not.toHaveBeenCalled();
});

test('autenticado → chama o MESMO runSupervisorTurn com o cliente autenticado; corpo não carrega identidade', async () => {
  const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  const client = {
    tag: 'authed-client',
    from: jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })),
  };
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

test('a execução iniciada não herda o cancelamento do request HTTP', async () => {
  const transport = new AbortController();
  const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  const client = {
    from: jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })),
  };
  auth.mockResolvedValue({ client, userId: 'user-1' });

  await POST({
    json: async () => ({ workItemId: 'w', expectedProposalVersion: 1 }),
    signal: transport.signal,
  } as unknown as Request);
  const executionSignal = turn.mock.calls[0][0].signal as AbortSignal;

  expect(executionSignal).not.toBe(transport.signal);
  transport.abort('client_disconnected');
  expect(transport.signal.aborted).toBe(true);
  expect(executionSignal.aborted).toBe(false);
});

test('proposta GPT aprovada e isolada recebe classificação antes do Supervisor', async () => {
  const maybeSingle = jest.fn().mockResolvedValue({
    error: null,
    data: {
      state: 'approved', proposal_version: 1, impact_level: 'low', capability: 'programming',
      intent: {
        planner: 'openai_project_tools_v1',
        execution_spec: {
          target: { kind: 'project', reference: 'anima' },
          executor: 'worktree', coder_backend: 'ollama', model: 'qwen3-coder:latest', base_sha: 'a'.repeat(40),
          permissions: ['workspace_read', 'workspace_write_isolated'],
          validation_criteria: [{ label: 'Typecheck', command: 'npm run typecheck' }],
          limits: { max_attempts: 3, max_duration_minutes: 30 },
        },
      },
    },
  });
  const rpc = jest.fn()
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({ data: { revision: 1 }, error: null });
  const client = {
    from: jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })), rpc,
  };
  auth.mockResolvedValue({ client, userId: 'user-1' });

  const res = await POST(request({ workItemId: 'work-gpt', expectedProposalVersion: 1 }));

  expect(res.status).toBe(200);
  expect(rpc).toHaveBeenNthCalledWith(1, 'current_work_intelligence_classification', {
    p_work_item_id: 'work-gpt',
  });
  expect(rpc).toHaveBeenNthCalledWith(2, 'record_work_intelligence_classification', expect.objectContaining({
    p_work_item_id: 'work-gpt', p_expected_proposal_version: 1,
    p_classification: expect.objectContaining({
      risk: 'low',
      provenance: expect.objectContaining({ kind: 'system_assessed', policyVersion: 'gpt-project-planner-v1' }),
    }),
  }));
  expect(turn).toHaveBeenCalledTimes(1);
  // Fiação: o alvo Anima resolve o executor de WORKTREE, não o runner Python.
  expect(turn.mock.calls[0][0].routes[0].adapter.id).toBe('worktree-v1');
});

test('proposta GPT fora do contrato isolado não recebe classificação', async () => {
  const maybeSingle = jest.fn().mockResolvedValue({
    error: null,
    data: {
      state: 'approved', proposal_version: 1, impact_level: 'low', capability: 'programming',
      intent: {
        planner: 'openai_project_tools_v1',
        execution_spec: {
          target: { kind: 'project', reference: 'anima' },
          executor: 'worktree', coder_backend: 'ollama', model: 'qwen3-coder:latest', base_sha: 'a'.repeat(40),
          permissions: ['workspace_read', 'workspace_write'],
          validation_criteria: [{ label: 'Typecheck', command: 'npm run typecheck' }],
          limits: { max_attempts: 3, max_duration_minutes: 30 },
        },
      },
    },
  });
  const rpc = jest.fn();
  const client = {
    from: jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })), rpc,
  };
  auth.mockResolvedValue({ client, userId: 'user-1' });

  await POST(request({ workItemId: 'work-wide', expectedProposalVersion: 1 }));

  expect(rpc).not.toHaveBeenCalled();
  expect(turn).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// Resource Governor V0: advisory read-only anexado ao read-model do turno.
// A fila autônoma pura (corpo sem workItemId) evita o executor de worktree e mantém
// o foco na fiação: o desfecho já é terminal e carrega attemptId+selection.
const terminalResult = (overrides: Record<string, unknown> = {}) => ({
  outcome: 'execution_failed', reconciliation: [], attemptId: 'att-1', terminalKind: 'error',
  selection: { workItemId: 'w', approvedProposalVersion: 2 }, ...overrides,
});

test('terminal com histórico → advisory read-only anexado AO LADO de value (result intocado)', async () => {
  auth.mockResolvedValue({ client: { from: jest.fn() }, userId: 'user-1' });
  const result = terminalResult();
  turn.mockResolvedValue(result);
  const listEventsByType = jest.fn().mockImplementation((type: string) =>
    Promise.resolve({ ok: true, value: type === 'host_observed_gate_evidence_recorded' ? [{ id: 'g1' }] : [{ id: 'c1' }] }));
  service.mockReturnValue({ listEventsByType, listEvents: jest.fn(), getItem: jest.fn() });
  const report = { snapshot: null, pressure: 'low', distribution: { count: 3, p50Ms: 1, p90Ms: 2, maxMs: 3 }, advisories: [] };
  advisory.mockReturnValue(report);

  const res = await POST(request({}));

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.value).toEqual(result);            // o resultado do Supervisor não é tocado
  expect(body.resourceGovernor).toEqual(report); // o advisory viaja ao lado, não dentro
  // Consumiu a evidência de gate E de coder MACHINE-WIDE (todos os itens), não só deste item.
  expect(listEventsByType).toHaveBeenCalledWith('host_observed_gate_evidence_recorded');
  expect(listEventsByType).toHaveBeenCalledWith('host_observed_coder_evidence_recorded');
  // Gate e coder concatenados numa única leitura machine-wide de custo.
  expect(advisory).toHaveBeenCalledWith({ events: [{ id: 'g1' }, { id: 'c1' }] });
});

test('advisory que lança é engolido (FAIL-OPEN): value e status inalterados, sem resourceGovernor', async () => {
  auth.mockResolvedValue({ client: { from: jest.fn() }, userId: 'user-1' });
  const result = terminalResult();
  turn.mockResolvedValue(result);
  service.mockReturnValue({ listEventsByType: jest.fn().mockResolvedValue({ ok: true, value: [] }), listEvents: jest.fn(), getItem: jest.fn() });
  advisory.mockImplementation(() => { throw new Error('telemetria falhou'); });

  const res = await POST(request({}));

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, value: result }); // nenhum campo extra, nada muda
});

test('histórico insuficiente (advisory null) → campo omitido, resposta limpa', async () => {
  auth.mockResolvedValue({ client: { from: jest.fn() }, userId: 'user-1' });
  const result = terminalResult();
  turn.mockResolvedValue(result);
  advisory.mockReturnValue(null);

  const res = await POST(request({}));

  const body = await res.json();
  expect(body).toEqual({ ok: true, value: result });
  expect('resourceGovernor' in body).toBe(false);
});

test('volta sem terminal (interrompida) → NENHUMA leitura de advisory; resposta 500 intocada', async () => {
  auth.mockResolvedValue({ client: { from: jest.fn() }, userId: 'user-1' });
  const result = terminalResult({ outcome: 'execution_interrupted', terminalKind: null });
  turn.mockResolvedValue(result);
  const listEventsByType = jest.fn();
  service.mockReturnValue({ listEventsByType, listEvents: jest.fn(), getItem: jest.fn() });

  const res = await POST(request({}));

  expect(res.status).toBe(500);
  expect(listEventsByType).not.toHaveBeenCalled();     // não contamina o caminho incompleto
  expect(advisory).not.toHaveBeenCalled();
  expect(await res.json()).toEqual({ ok: true, value: result });
});

test('alvo Anima sem executor declarado → 503, sem fallback silencioso e sem Supervisor', async () => {
  const maybeSingle = jest.fn().mockResolvedValue({
    error: null,
    data: {
      state: 'approved', proposal_version: 1, impact_level: 'low', capability: 'programming',
      intent: {
        execution_spec: {
          target: { kind: 'project', reference: 'anima' },
          permissions: ['workspace_read', 'workspace_write_isolated'],
          validation_criteria: [{ label: 'Typecheck', command: 'npm run typecheck' }],
          limits: { max_attempts: 3, max_duration_minutes: 30 },
        },
      },
    },
  });
  const client = { from: jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })), rpc: jest.fn() };
  auth.mockResolvedValue({ client, userId: 'user-1' });

  const res = await POST(request({ workItemId: 'work-no-exec', expectedProposalVersion: 1 }));

  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ ok: false, error: { code: 'anima_requires_worktree' } });
  expect(turn).not.toHaveBeenCalled();
});
