/** @jest-environment node */
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
