/** @jest-environment node */
import * as sqlBoundary from './single-item-sql-boundary';
import type { AutonomousQueueEntry, ProposalVersion, WorkItemId } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// Preflight do node CLOUD: roda DEPOIS do node pronto e ANTES de `runSupervisorTurn` (que cria
// claim/attempt). A preparação do node é mockada (a via real é provada nos testes do node).
jest.mock('./resource-governor', () => ({
  readResourceAdmission: jest.fn(() => ({ verdict: 'defer', pressure: 'high' as const })),
  readMachinePressure: jest.fn(() => 'high' as const),
}));
const finish = jest.fn(async () => undefined);
jest.mock('./resident-on-demand-node', () => {
  const actual = jest.requireActual('./resident-on-demand-node');
  return {
    ...actual,
    readResidentOnDemandNodeConfig: jest.fn(() => ({
      nodeId: 'cloud-1', providerId: 'runpod', model: 'qwen3-coder:latest', resourceClass: 'gpu-48gb', billingMode: 'paid',
      maxActiveDurationMs: 90 * 60_000, idleTimeoutMs: 60_000, maxConcurrentPaidNodes: 1, priceHint: null,
    })),
    prepareCloudCoderNode: jest.fn(async () => ({
      ok: true, providerRef: 'pod-1', leaseExpiresAt: new Date(Date.now() + 90 * 60_000).toISOString(), finish,
      runtime: { url: 'http://127.0.0.1:59999', backendId: 'ollama:remote/cloud-1:qwen3-coder:latest', locality: 'remote', nodeId: 'cloud-1' },
    })),
  };
});
jest.mock('./paid-compute-lease-reconciler-deps', () => ({ readLivePaidNodeCount: jest.fn(async () => ({ ok: true, count: 0 })) }));
jest.mock('./supervisor', () => ({ runSupervisorTurn: jest.fn(async () => { throw new Error('stop-after-preflight'); }) }));

import { buildProjectBacklogCycleDeps } from './autonomous-backlog-deps';
import { runSupervisorTurn } from './supervisor';

const entry: AutonomousQueueEntry = {
  workItemId: '00000000-0000-0000-0000-0000000000a1' as WorkItemId, approvedProposalVersion: 1 as ProposalVersion,
  approvalSeq: 1, approvedAt: new Date(), capability: 'programming', targetReference: 'anima', queuePosition: 0, targetOccupied: false,
};
const intent = { execution_spec: { executor: 'worktree', coder_backend: 'ollama', model: 'qwen3-coder:latest',
  base_sha: 'f94bc5a2dc8076be40471d5f7810d81518cb8bfa', target: { kind: 'project', reference: 'anima' },
  validation_criteria: [{ label: 'testes', command: 'npm test' }] } };
const client = {
  from: (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain, eq: () => chain, order: () => chain,
      maybeSingle: async () => ({ data: table === 'work_items' ? { intent } : null, error: null }),
      limit: async () => ({ data: [], error: null }),
    };
    return chain;
  },
  rpc: async () => ({ data: null, error: null }),
} as unknown as SupabaseClient<Database>;

describe('buildProjectBacklogCycleDeps — preflight do node cloud antes da attempt', () => {
  const routerSaved = process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED;
  beforeEach(() => { jest.clearAllMocks(); delete process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED; });
  afterAll(() => { if (routerSaved === undefined) delete process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED; else process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED = routerSaved; });

  test('preflight reprovado: finish (teardown+settlement) e NENHUMA attempt', async () => {
    const preflight = jest.fn(async () => ({ ok: false as const, detail: 'num_ctx não confirmado' }));
    const deps = buildProjectBacklogCycleDeps(client, 'owner', { coderNodePreflight: preflight });
    expect(deps.hostPermitsAutonomousWork()).toBe(true); // mesma sequência do driver (mede a pressão)
    const turn = await deps.runTurn(entry, new AbortController().signal);
    expect(preflight).toHaveBeenCalledWith(expect.objectContaining({ locality: 'remote', url: 'http://127.0.0.1:59999' }));
    expect(turn.outcome).toBe('selection_not_executable');
    expect(turn.refusal?.code).toBe('coder_node_preflight_failed');
    expect(turn.attemptId).toBeNull();
    expect(finish).toHaveBeenCalledWith(null);
    expect(runSupervisorTurn).not.toHaveBeenCalled();
  });

  test('preflight que LANÇA é tratado como reprovado (fail-closed), sem attempt', async () => {
    const deps = buildProjectBacklogCycleDeps(client, 'owner', { coderNodePreflight: async () => { throw new Error('túnel caiu'); } });
    expect(deps.hostPermitsAutonomousWork()).toBe(true); // mesma sequência do driver (mede a pressão)
    const turn = await deps.runTurn(entry, new AbortController().signal);
    expect(turn.refusal?.code).toBe('coder_node_preflight_failed');
    expect(turn.refusal?.message).toContain('túnel caiu');
    expect(finish).toHaveBeenCalledTimes(1);
    expect(runSupervisorTurn).not.toHaveBeenCalled();
  });

  test('preflight aprovado: segue para runSupervisorTurn no MESMO node; finish continua obrigatório', async () => {
    const preflight = jest.fn(async () => ({ ok: true as const }));
    const deps = buildProjectBacklogCycleDeps(client, 'owner', { coderNodePreflight: preflight });
    expect(deps.hostPermitsAutonomousWork()).toBe(true); // mesma sequência do driver (mede a pressão)
    await expect(deps.runTurn(entry, new AbortController().signal)).rejects.toThrow('stop-after-preflight');
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(runSupervisorTurn).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1); // teardown no finally mesmo quando o turno lança
  });

  test('sem preflight configurado: comportamento inalterado (vai direto ao turno)', async () => {
    const deps = buildProjectBacklogCycleDeps(client, 'owner');
    expect(deps.hostPermitsAutonomousWork()).toBe(true); // mesma sequência do driver (mede a pressão)
    await expect(deps.runTurn(entry, new AbortController().signal)).rejects.toThrow('stop-after-preflight');
    expect(runSupervisorTurn).toHaveBeenCalledTimes(1);
  });
});


describe('single-item — barreira antes de compute, cloud, eventos e Supervisor', () => {
  test.each([1, 2])('versão observada %s nunca cria efeitos', async version => {
    jest.clearAllMocks();
    const rpc = jest.fn(async () => ({ data: null, error: null }));
    const scopedClient = { rpc, from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { intent, state: 'approved', proposal_version: version }, error: null }) };
      return chain;
    } } as unknown as SupabaseClient<Database>;
    const deps = buildProjectBacklogCycleDeps(scopedClient, 'single', { singleItem: { workItemId: entry.workItemId, expectedProposalVersion: 1 } });
    const result = await deps.runTurn(entry, new AbortController().signal);
    expect(result.refusal?.code).toBe(version === 1 ? 'single_item_atomic_claim_unavailable' : 'single_item_changed');
    // Única RPC permitida antes dos efeitos: a sonda sem efeitos da RPC scoped (apenas quando o gate é alcançado).
    expect(rpc.mock.calls.map(call => (call as unknown[])[0])).toEqual(version === 1 ? ['acquire_single_item_work_claim'] : []);
    expect(runSupervisorTurn).not.toHaveBeenCalled();
    expect(jest.requireMock('./resident-on-demand-node').prepareCloudCoderNode).not.toHaveBeenCalled();
  });
  test('pressão high não admite fallback cloud/API no modo single-item', () => {
    expect(buildProjectBacklogCycleDeps(client, 'single', { singleItem: { workItemId: entry.workItemId, expectedProposalVersion: 1 } }).hostPermitsAutonomousWork()).toBe(false);
  });
});


describe('Single-Item V1 — compute e retomada antes de efeitos (SQL simulado)', () => {
  const environment = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(sqlBoundary, 'singleItemSqlBoundaryRefusal').mockResolvedValue(null);
    delete process.env.ANIMA_WORKTREE_OLLAMA_URL;
    delete process.env.ANIMA_WORKTREE_OLLAMA_LOCALITY;
    delete process.env.OLLAMA_URL;
  });
  afterEach(() => { jest.restoreAllMocks(); process.env = { ...environment }; });
  const run = (executionSpec: Record<string, unknown>, events: readonly Record<string, unknown>[] = []) => {
    const rpc = jest.fn(async () => ({ data: null, error: null }));
    const scoped = { rpc, from: (table: string) => {
      let eventType: string | undefined;
      const chain = { select: () => chain, eq: (key: string, value: string) => { if (key === 'event_type') eventType = value; return chain; }, order: () => chain,
        maybeSingle: async () => ({ data: { intent: { execution_spec: executionSpec }, state: 'approved', proposal_version: 1 }, error: null }),
        limit: async () => ({ data: table === 'work_events' ? events.filter(event => !eventType || event.event_type === eventType) : [], error: null }) };
      return chain;
    } } as unknown as SupabaseClient<Database>;
    return { rpc, result: buildProjectBacklogCycleDeps(scoped, 'single', { singleItem: { workItemId: entry.workItemId, expectedProposalVersion: 1 } }).runTurn(entry, new AbortController().signal) };
  };
  test.each(['openai', 'unknown', null])('backend %s não chama provider/cloud/SQL mutante', async backend => {
    process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED = '1';
    const { rpc, result } = run({ ...intent.execution_spec, coder_backend: backend });
    expect((await result).refusal?.code).toBe('single_item_compute_not_allowed');
    expect(rpc).not.toHaveBeenCalled(); expect(runSupervisorTurn).not.toHaveBeenCalled();
    expect(jest.requireMock('./resident-on-demand-node').prepareCloudCoderNode).not.toHaveBeenCalled();
  });
  test('Codex com modelo não autorizado recusa antes de cloud/SQL/Supervisor', async () => {
    const { rpc, result } = run({ ...intent.execution_spec, coder_backend: 'codex-cli' });
    expect((await result).refusal?.code).toBe('single_item_codex_contract_invalid');
    expect(rpc).not.toHaveBeenCalled(); expect(runSupervisorTurn).not.toHaveBeenCalled();
    expect(jest.requireMock('./resident-on-demand-node').prepareCloudCoderNode).not.toHaveBeenCalled();
  });
  test.each([null, { commit_sha: 'invalid' }])('checkpoint %j recusa sem reiniciar', async checkpoint => {
    const { rpc, result } = run({ ...intent.execution_spec, resume_from_checkpoint: checkpoint });
    expect((await result).refusal?.code).toBe('single_item_resumption_unproved'); expect(rpc).not.toHaveBeenCalled();
  });
  test('histórico de attempt recusa antes de Router/cloud', async () => {
    const { rpc, result } = run(intent.execution_spec, [{ event_type: 'execution_started', payload: {} }]);
    expect((await result).refusal?.code).toBe('single_item_resumption_unproved'); expect(rpc).not.toHaveBeenCalled();
  });
  test.each(['0', '1'])('preferência paga recusa com Router=%s, sem lookup de authority', async enabled => {
    process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED = enabled;
    const { rpc, result } = run(intent.execution_spec, [{ event_type: 'compute_preference_recorded', payload: { schema_version: 1, data: { preference: { schemaVersion: 1, strategy: 'provider_api', provider: 'openai', model: 'fixture-model' } } } }]);
    expect((await result).refusal?.code).toBe('single_item_paid_compute_forbidden');
    expect(rpc).not.toHaveBeenCalled(); expect(runSupervisorTurn).not.toHaveBeenCalled();
    expect(jest.requireMock('./resident-on-demand-node').prepareCloudCoderNode).not.toHaveBeenCalled();
  });
  test('endpoint remoto não vira runtime local', async () => {
    process.env.OLLAMA_URL = 'https://remote.invalid';
    const { rpc, result } = run(intent.execution_spec);
    expect((await result).refusal?.code).toBe('single_item_remote_compute_forbidden'); expect(rpc).not.toHaveBeenCalled();
  });
});
