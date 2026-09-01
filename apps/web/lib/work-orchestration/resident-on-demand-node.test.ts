/** @jest-environment node */
import type { NodeLifecycleEvidenceV1, NodeProvisioner, NodeProvisionRequest } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LocalProcessNodeProvisioner } from './local-process-node-provisioner';
import { leaseDeadlineSignal, prepareResidentOnDemandCoderNode, readResidentOnDemandNodeConfig, resolveOnDemandProvisioner, type ResidentOnDemandNodeConfig } from './resident-on-demand-node';
import { join } from 'node:path';

const RUNPOD_ENV = {
  ANIMA_ON_DEMAND_NODE_ENABLED: 'true', ANIMA_ON_DEMAND_NODE_PROVISIONER: 'runpod',
  ANIMA_ON_DEMAND_NODE_ID: 'burst-a', ANIMA_ON_DEMAND_NODE_BILLING_MODE: 'paid',
  ANIMA_RUNPOD_API_KEY: 'rp_key', ANIMA_RUNPOD_IMAGE: 'ollama/ollama', ANIMA_RUNPOD_GPU_TYPE_IDS: 'NVIDIA A40',
} as const;

const dummyClient = {} as SupabaseClient<Database>;
const FIXTURE = join(__dirname, '__fixtures__', 'fake-inference-node.cjs');
const config = (billingMode: 'owned' | 'paid' = 'owned'): ResidentOnDemandNodeConfig => ({
  nodeId: `node-${billingMode}`, providerId: 'local-process', model: 'qwen3-coder:latest',
  resourceClass: 'local-cpu', billingMode, maxActiveDurationMs: 60_000, idleTimeoutMs: 1_000, maxConcurrentPaidNodes: null, priceHint: null,
});

describe('Resident Host — node on-demand vivo', () => {
  test('configuração é opt-in e fail-closed', () => {
    expect(readResidentOnDemandNodeConfig('m', {})).toBeNull();
    expect(readResidentOnDemandNodeConfig('m', {
      ANIMA_ON_DEMAND_NODE_ENABLED: 'true', ANIMA_ON_DEMAND_NODE_PROVISIONER: 'local-process',
      ANIMA_ON_DEMAND_NODE_ID: 'owned-a', ANIMA_ON_DEMAND_NODE_BILLING_MODE: 'owned',
    })).toMatchObject({ nodeId: 'owned-a', billingMode: 'owned' });
  });

  test('seleção runpod: env-gate + paid + config do adapter → providerId runpod (Missão 9)', () => {
    expect(readResidentOnDemandNodeConfig('m', RUNPOD_ENV)).toMatchObject({ providerId: 'runpod', billingMode: 'paid' });
  });

  test('runpod fail-closed: owned NUNCA aluga cloud (só paid passa pelo gate financeiro)', () => {
    expect(readResidentOnDemandNodeConfig('m', { ...RUNPOD_ENV, ANIMA_ON_DEMAND_NODE_BILLING_MODE: 'owned' })).toBeNull();
  });

  test('runpod fail-closed: sem API key não há adapter (Missão 6)', () => {
    const { ANIMA_RUNPOD_API_KEY: _omit, ...noKey } = RUNPOD_ENV;
    expect(readResidentOnDemandNodeConfig('m', noKey)).toBeNull();
  });

  test('resolveOnDemandProvisioner escolhe o provisioner por config (Missão 9)', () => {
    const local = resolveOnDemandProvisioner(config(), {});
    expect(local).toBeInstanceOf(LocalProcessNodeProvisioner);
    expect(local.providerId).toBe('local-process');
    const runpod = resolveOnDemandProvisioner({ ...config('paid'), providerId: 'runpod' }, RUNPOD_ENV);
    expect(runpod.providerId).toBe('runpod');
  });

  test('owned offline provisiona processo real, observa lifecycle e desliga', async () => {
    const evidence: NodeLifecycleEvidenceV1[] = [];
    const provisioner = new LocalProcessNodeProvisioner({ command: process.execPath, args: [FIXTURE] });
    const prepared = await prepareResidentOnDemandCoderNode({
      client: dummyClient, config: config(), workItemId: 'work-1', proposalVersion: 1,
      leaseId: 'lease-owned-1', signal: new AbortController().signal,
      evidenceSink: { record: async value => { evidence.push(value); return { ok: true, action: 'recorded' }; } },
      provisionerFactory: () => provisioner,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.runtime).toMatchObject({ locality: 'remote', nodeId: 'node-owned' });
    await prepared.finish('ca000000-0000-0000-0000-00000000aa01');
    expect(evidence.map(value => value.transition.event)).toEqual([
      'provision_requested', 'health_confirmed', 'reserved', 'released', 'shutdown_requested', 'shutdown_confirmed',
    ]);
    expect((await provisioner.inspect({ nodeId: 'node-owned', providerId: 'local-process', endpoint: prepared.runtime.url, providerRef: 'missing' }, new AbortController().signal)).reachable).toBe(false);
  });

  test('finish ignora signal de workload abortado e confirma stop + destroy pelo providerRef', async () => {
    const workload = new AbortController();
    const events: NodeLifecycleEvidenceV1[] = [];
    const calls: string[] = [];
    const provisioner: NodeProvisioner = {
      providerId: 'local-process',
      provision: async req => ({ ok: true, handle: { nodeId: req.nodeId, providerId: req.providerId, endpoint: 'http://x', providerRef: 'pod-finish' } }),
      inspect: async h => ({ nodeId: h.nodeId, reachable: true, healthy: true }),
      stop: async (h, signal) => { expect(signal).not.toBe(workload.signal); expect(signal.aborted).toBe(false); calls.push(`stop:${h.providerRef}`); return { ok: true }; },
      destroy: async (h, signal) => { expect(signal.aborted).toBe(false); calls.push(`destroy:${h.providerRef}`); return { ok: true }; },
    };
    const prepared = await prepareResidentOnDemandCoderNode({
      client: dummyClient, config: { ...config(), nodeId: 'finish-aborted' }, workItemId: 'work-1', proposalVersion: 1,
      leaseId: 'lease-finish', signal: workload.signal,
      evidenceSink: { record: async value => { events.push(value); return { ok: true, action: 'recorded' }; } },
      provisionerFactory: () => provisioner,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    workload.abort();
    await prepared.finish(null);
    expect(calls).toEqual(['stop:pod-finish', 'destroy:pod-finish']);
    expect(events.at(-1)?.transition.event).toBe('shutdown_confirmed');
  });

  test('finish bounded não fabrica offline quando teardown trava', async () => {
    const events: NodeLifecycleEvidenceV1[] = [];
    const provisioner: NodeProvisioner = {
      providerId: 'local-process',
      provision: async req => ({ ok: true, handle: { nodeId: req.nodeId, providerId: req.providerId, endpoint: 'http://x', providerRef: 'pod-hung' } }),
      inspect: async h => ({ nodeId: h.nodeId, reachable: true, healthy: true }),
      stop: async () => await new Promise(() => undefined),
    };
    const prepared = await prepareResidentOnDemandCoderNode({
      client: dummyClient, config: { ...config(), nodeId: 'finish-hung' }, workItemId: 'work-1', proposalVersion: 1,
      leaseId: 'lease-hung', signal: new AbortController().signal, cleanupTimeoutMs: 15,
      evidenceSink: { record: async value => { events.push(value); return { ok: true, action: 'recorded' }; } },
      provisionerFactory: () => provisioner,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    await prepared.finish(null);
    expect(events.at(-1)?.transition.event).toBe('shutdown_failed');
    expect(events.at(-1)?.transition.to).toBe('shutdown_failed');
  });

  test('node PAGO: lease é clampada à janela da autorização ao vivo (teto duro)', async () => {
    const now = new Date('2026-08-31T00:00:00.000Z');
    const validUntil = '2026-08-31T00:03:00.000Z'; // autoridade vence em 3 min
    const authRow = {
      id: 'auth-x', user_id: 'u', provider_id: 'local-process', node_id: null, resource_class: null, work_item_id: null,
      max_duration_ms: 60 * 60_000, max_cost_currency: 'USD', max_cost_amount: 10,
      valid_from: '2026-08-30T23:00:00.000Z', valid_until: validUntil, revoked_at: null, created_at: '2026-08-30T23:00:00.000Z',
    };
    const chain = { eq: () => chain, is: () => chain, lte: () => chain, gt: () => chain, order: () => chain, limit: async () => ({ data: [authRow], error: null }) };
    const client = { from: () => ({ select: () => chain }), rpc: async () => ({ data: { action: 'reserved', reservation_id: 'reserve-x' }, error: null }) } as unknown as SupabaseClient<Database>;
    let capturedLease: NodeProvisionRequest['lease'] | null = null;
    const provisioner: NodeProvisioner = {
      providerId: 'local-process',
      provision: async req => { capturedLease = req.lease; return { ok: false, reason: 'parar após capturar a lease' }; },
      inspect: async h => ({ nodeId: h.nodeId, reachable: false, healthy: false }),
      stop: async () => ({ ok: true }),
    };
    const prepared = await prepareResidentOnDemandCoderNode({
      client, config: { ...config('paid'), maxActiveDurationMs: 30 * 60_000, priceHint: { currency: 'USD', perHour: 2 } }, workItemId: 'work-1', proposalVersion: 1,
      leaseId: 'lease-x', signal: new AbortController().signal, now: () => now,
      evidenceSink: { record: async () => ({ ok: true, action: 'recorded' }) }, provisionerFactory: () => provisioner,
    });
    expect(prepared.ok).toBe(false); // provision falha de propósito depois de capturar a lease
    expect(capturedLease).not.toBeNull();
    // Deadline clampado à autoridade (3 min), NÃO agora+30min; duração = min(30, 60) = 30min.
    expect(capturedLease!.leaseExpiresAt).toBe(validUntil);
    expect(capturedLease!.maxActiveDurationMs).toBe(30 * 60_000);
    expect(capturedLease!).toMatchObject({ billingMode: 'paid', authorizationRef: 'auth-x' });
  });

  test('config lê priceHint do env (fonte da estimativa de custo pré-provision)', () => {
    expect(readResidentOnDemandNodeConfig('m', {
      ANIMA_ON_DEMAND_NODE_ENABLED: 'true', ANIMA_ON_DEMAND_NODE_PROVISIONER: 'local-process',
      ANIMA_ON_DEMAND_NODE_ID: 'p-a', ANIMA_ON_DEMAND_NODE_BILLING_MODE: 'owned',
      ANIMA_ON_DEMAND_PRICE_PER_HOUR: '1.5', ANIMA_ON_DEMAND_PRICE_CURRENCY: 'USD',
    })).toMatchObject({ priceHint: { currency: 'USD', perHour: 1.5 } });
    expect(readResidentOnDemandNodeConfig('m', {
      ANIMA_ON_DEMAND_NODE_ENABLED: 'true', ANIMA_ON_DEMAND_NODE_PROVISIONER: 'local-process',
      ANIMA_ON_DEMAND_NODE_ID: 'p-a', ANIMA_ON_DEMAND_NODE_BILLING_MODE: 'owned',
    })).toMatchObject({ priceHint: null });
  });

  const paidAuthClient = (maxCost: { currency: string; amount: number } | null, providerId = 'local-process', onRpc?: (args: unknown) => void): SupabaseClient<Database> => {
    const authRow = {
      id: 'auth-x', user_id: 'u', provider_id: providerId, node_id: null, resource_class: null, work_item_id: null,
      max_duration_ms: 60 * 60_000, max_cost_currency: maxCost?.currency ?? null, max_cost_amount: maxCost?.amount ?? null,
      valid_from: '2026-08-30T23:00:00.000Z', valid_until: '2026-08-31T02:00:00.000Z', revoked_at: null, created_at: '2026-08-30T23:00:00.000Z',
    };
    const chain = { eq: () => chain, is: () => chain, lte: () => chain, gt: () => chain, order: () => chain, limit: async () => ({ data: [authRow], error: null }) };
    return { from: () => ({ select: () => chain }), rpc: async (_name: string, args: unknown) => { onRpc?.(args); return { data: { action: 'reserved', reservation_id: 'reserve-x' }, error: null }; } } as unknown as SupabaseClient<Database>;
  };

  test('RunPod usa max(configured, live) imediatamente antes da reserva; lookup falho não provisiona', async () => {
    let reservedAmount: number | undefined; let provisionCalls = 0;
    const provisioner: NodeProvisioner = { providerId: 'runpod', provision: async () => { provisionCalls += 1; return { ok: false, reason: 'fim' }; },
      inspect: async h => ({ nodeId: h.nodeId, reachable: false, healthy: false }), stop: async () => ({ ok: true }) };
    const base = { ...config('paid'), providerId: 'runpod' as const, resourceClass: 'gpu-a40', maxActiveDurationMs: 30 * 60_000,
      priceHint: { currency: 'USD', perHour: 0.4 } };
    const prepared = await prepareResidentOnDemandCoderNode({ client: paidAuthClient({ currency: 'USD', amount: 5 }, 'runpod', args => { reservedAmount = (args as { estimate_amount: number }).estimate_amount; }),
      config: base, workItemId: 'work-1', proposalVersion: 1, leaseId: 'lease-live', signal: new AbortController().signal,
      now: () => new Date('2026-08-31T00:00:30Z'), evidenceSink: { record: async () => ({ ok: true, action: 'recorded' }) }, provisionerFactory: () => provisioner,
      readLivePriceQuote: async () => ({ ok: true, quote: { providerId: 'runpod', resourceClass: 'gpu-a40', currency: 'USD', perHour: 0.7,
        quotedAt: '2026-08-31T00:00:00Z', validUntil: '2026-08-31T00:01:00Z', kind: 'lowest_available' } }) });
    expect(prepared).toMatchObject({ ok: false, reason: 'provision_failed' });
    expect(reservedAmount).toBe(0.35); expect(provisionCalls).toBe(1);

    provisionCalls = 0;
    const denied = await prepareResidentOnDemandCoderNode({ client: paidAuthClient({ currency: 'USD', amount: 5 }, 'runpod'), config: base,
      workItemId: 'work-1', proposalVersion: 1, leaseId: 'lease-no-quote', signal: new AbortController().signal,
      now: () => new Date('2026-08-31T00:00:30Z'), evidenceSink: { record: async () => ({ ok: true, action: 'recorded' }) }, provisionerFactory: () => provisioner,
      readLivePriceQuote: async () => ({ ok: false, reason: 'provider_unreachable' }) });
    expect(denied).toMatchObject({ ok: false, reason: 'aggregate_budget_denied', detail: 'live_price:provider_unreachable' });
    expect(provisionCalls).toBe(0);
  });

  test('RunPod: live price usado na reserva; budget denial impede qualquer chamada ao provider', async () => {
    let reservedAmount: number | undefined;
    let provisionCalls = 0;

    const provisioner: NodeProvisioner = {
      providerId: 'runpod',
      provision: async () => {
        provisionCalls += 1;
        return { ok: false, reason: 'nao_deveria_provisionar' };
      },
      inspect: async h => ({ nodeId: h.nodeId, reachable: false, healthy: false }),
      stop: async () => ({ ok: true }),
    };

    const prepared = await prepareResidentOnDemandCoderNode({
      client: paidAuthClient({ currency: 'USD', amount: 5 }, 'runpod'),
      config: {
        ...config('paid'),
        providerId: 'runpod',
        resourceClass: 'gpu-a40',
        maxActiveDurationMs: 30 * 60_000,
        priceHint: { currency: 'USD', perHour: 0.4 },
      },
      workItemId: 'work-1',
      proposalVersion: 1,
      leaseId: 'lease-live-budget-denied',
      signal: new AbortController().signal,
      now: () => new Date('2026-08-31T00:00:30Z'),
      evidenceSink: { record: async () => ({ ok: true, action: 'recorded' }) },
      provisionerFactory: () => provisioner,
      readLivePriceQuote: async () => ({
        ok: true,
        quote: {
          providerId: 'runpod',
          resourceClass: 'gpu-a40',
          currency: 'USD',
          perHour: 0.7,
          quotedAt: '2026-08-31T00:00:00Z',
          validUntil: '2026-08-31T00:01:00Z',
          kind: 'lowest_available',
        },
      }),
      reserveBudget: async (_client, args) => {
        reservedAmount = args.estimate.amount;
        return {
          ok: false,
          code: 'aggregate_budget_exceeded',
          message: 'aggregate_budget_exceeded',
        };
      },
    });

    expect(reservedAmount).toBe(0.35);
    expect(prepared).toMatchObject({
      ok: false,
      reason: 'aggregate_budget_denied',
      detail: 'aggregate_budget_exceeded',
    });
    expect(provisionCalls).toBe(0);
  });

  test('teto de CUSTO excedido pela estimativa pré-provision → nega fail-closed, provisioner não sobe', async () => {
    // priceHint $2/h × 0.5h (30min) = estimativa $1 > teto $0.50 → cost_exceeds_authorized.
    let provisionCalls = 0;
    const provisioner: NodeProvisioner = {
      providerId: 'local-process', provision: async () => { provisionCalls += 1; return { ok: false, reason: 'não deveria' }; },
      inspect: async h => ({ nodeId: h.nodeId, reachable: false, healthy: false }), stop: async () => ({ ok: true }),
    };
    const prepared = await prepareResidentOnDemandCoderNode({
      client: paidAuthClient({ currency: 'USD', amount: 0.5 }),
      config: { ...config('paid'), maxActiveDurationMs: 30 * 60_000, priceHint: { currency: 'USD', perHour: 2 } },
      workItemId: 'work-1', proposalVersion: 1, leaseId: 'lease-x', signal: new AbortController().signal,
      now: () => new Date('2026-08-31T00:00:00Z'), evidenceSink: { record: async () => ({ ok: true, action: 'recorded' }) },
      provisionerFactory: () => provisioner,
    });
    expect(prepared).toMatchObject({ ok: false, reason: 'waiting_authorization' });
    expect(provisionCalls).toBe(0);
  });

  test('estimativa dentro do teto de custo → procede; lease carrega o priceHint (custo na evidência)', async () => {
    let capturedLease: NodeProvisionRequest['lease'] | null = null;
    const provisioner: NodeProvisioner = {
      providerId: 'local-process', provision: async req => { capturedLease = req.lease; return { ok: false, reason: 'parar após capturar' }; },
      inspect: async h => ({ nodeId: h.nodeId, reachable: false, healthy: false }), stop: async () => ({ ok: true }),
    };
    await prepareResidentOnDemandCoderNode({
      client: paidAuthClient({ currency: 'USD', amount: 5 }), // teto $5 ≥ estimativa $1
      config: { ...config('paid'), maxActiveDurationMs: 30 * 60_000, priceHint: { currency: 'USD', perHour: 2 } },
      workItemId: 'work-1', proposalVersion: 1, leaseId: 'lease-x', signal: new AbortController().signal,
      now: () => new Date('2026-08-31T00:00:00Z'), evidenceSink: { record: async () => ({ ok: true, action: 'recorded' }) },
      provisionerFactory: () => provisioner,
    });
    expect(capturedLease).not.toBeNull();
    expect(capturedLease!.priceHint).toEqual({ currency: 'USD', perHour: 2 });
  });

  test('node PAGO no teto de concorrência → recusa concurrency_limit ANTES de provisionar', async () => {
    const authRow = {
      id: 'auth-x', user_id: 'u', provider_id: 'local-process', node_id: null, resource_class: null, work_item_id: null,
      max_duration_ms: 60 * 60_000, max_cost_currency: 'USD', max_cost_amount: 10,
      valid_from: '2026-08-30T23:00:00.000Z', valid_until: '2026-08-31T02:00:00.000Z', revoked_at: null, created_at: '2026-08-30T23:00:00.000Z',
    };
    const chain = { eq: () => chain, is: () => chain, lte: () => chain, gt: () => chain, order: () => chain, limit: async () => ({ data: [authRow], error: null }) };
    const client = { from: () => ({ select: () => chain }), rpc: async () => ({ data: { action: 'reserved', reservation_id: 'reserve-x' }, error: null }) } as unknown as SupabaseClient<Database>;
    let provisionCalls = 0;
    const provisioner: NodeProvisioner = {
      providerId: 'local-process', provision: async () => { provisionCalls += 1; return { ok: false, reason: 'não deveria chamar' }; },
      inspect: async h => ({ nodeId: h.nodeId, reachable: false, healthy: false }), stop: async () => ({ ok: true }),
    };
    const prepared = await prepareResidentOnDemandCoderNode({
      client, config: { ...config('paid'), maxConcurrentPaidNodes: 1, priceHint: { currency: 'USD', perHour: 2 } }, workItemId: 'work-1', proposalVersion: 1,
      leaseId: 'lease-x', signal: new AbortController().signal, now: () => new Date('2026-08-31T00:00:00Z'),
      evidenceSink: { record: async () => ({ ok: true, action: 'recorded' }) }, provisionerFactory: () => provisioner,
      readLivePaidNodeCount: async () => ({ ok: true, count: 1 }), // já no teto
    });
    expect(prepared).toMatchObject({ ok: false, reason: 'concurrency_limit' });
    expect(provisionCalls).toBe(0);
  });

  test('falha ao observar contagem paga nega antes de reserva, evidência e provider; retry saudável prossegue', async () => {
    let reserveCalls = 0; let evidenceCalls = 0; let provisionCalls = 0;
    const provisioner: NodeProvisioner = {
      providerId: 'local-process',
      provision: async () => { provisionCalls += 1; return { ok: false, reason: 'fim do retry' }; },
      inspect: async h => ({ nodeId: h.nodeId, reachable: false, healthy: false }), stop: async () => ({ ok: true }),
    };
    const common = {
      client: paidAuthClient({ currency: 'USD', amount: 10 }),
      config: { ...config('paid'), maxConcurrentPaidNodes: 1, priceHint: { currency: 'USD' as const, perHour: 1 } },
      workItemId: 'work-1', proposalVersion: 1, leaseId: 'lease-count', signal: new AbortController().signal,
      now: () => new Date('2026-08-31T00:00:00Z'),
      reserveBudget: (async () => { reserveCalls += 1; return { ok: true, reservationId: 'res-count' }; }) as unknown as PrepareInput['reserveBudget'],
      evidenceSink: { record: async () => { evidenceCalls += 1; return { ok: true as const, action: 'recorded' as const }; } },
      provisionerFactory: () => provisioner,
    };
    const denied = await prepareResidentOnDemandCoderNode({
      ...common, readLivePaidNodeCount: async () => ({ ok: false, reason: 'paid_node_count_unavailable' }),
    });
    expect(denied).toEqual({ ok: false, reason: 'paid_node_count_unavailable', detail: 'paid_node_count_unavailable' });
    expect({ reserveCalls, evidenceCalls, provisionCalls }).toEqual({ reserveCalls: 0, evidenceCalls: 0, provisionCalls: 0 });

    await prepareResidentOnDemandCoderNode({
      ...common, readLivePaidNodeCount: async () => ({ ok: true, count: 0 }),
    });
    expect({ reserveCalls, evidenceCalls, provisionCalls }).toEqual({ reserveCalls: 1, evidenceCalls: 2, provisionCalls: 1 });
  });

  type PrepareInput = Parameters<typeof prepareResidentOnDemandCoderNode>[0];
  const RESERVE_OK = (async () => ({ ok: true, reservationId: 'res-1' })) as unknown as PrepareInput['reserveBudget'];
  const paidPrepare = (over: Partial<PrepareInput>) => prepareResidentOnDemandCoderNode({
    client: paidAuthClient({ currency: 'USD', amount: 10 }), config: { ...config('paid'), priceHint: { currency: 'USD', perHour: 1 } },
    workItemId: 'work-1', proposalVersion: 1, leaseId: 'lease-x', signal: new AbortController().signal,
    now: () => new Date('2026-08-31T00:00:00Z'), reserveBudget: RESERVE_OK, ...over,
  });

  test('node PAGO: sequência inclui provider_identified antes de health_lost (sem ready fabricado)', async () => {
    const events: NodeLifecycleEvidenceV1[] = [];
    const workload = new AbortController();
    const cleanupSignals: AbortSignal[] = [];
    const provisioner: NodeProvisioner = {
      providerId: 'local-process',
      provision: async (req, _sig, observer) => {
        const ok = observer ? await observer.providerIdentified({ nodeId: req.nodeId, providerId: req.providerId, providerRef: 'pod-x' }) : true;
        if (!ok) return { ok: false, reason: 'provider_identity_unpersisted' };
        return { ok: true, handle: { nodeId: req.nodeId, providerId: req.providerId, endpoint: 'http://x', providerRef: 'pod-x' } };
      },
      inspect: async h => { workload.abort(); return { nodeId: h.nodeId, reachable: true, healthy: false }; }, // health FALHA junto do cancelamento
      stop: async (_h, signal) => { cleanupSignals.push(signal); return { ok: true }; },
    };
    const prepared = await paidPrepare({
      evidenceSink: { record: async (v: NodeLifecycleEvidenceV1) => { events.push(v); return { ok: true, action: 'recorded' }; } },
      provisionerFactory: () => provisioner, signal: workload.signal,
    });
    expect(prepared).toMatchObject({ ok: false, reason: 'health_failed' });
    expect(events.map(e => e.transition.event)).toEqual([
      'provision_requested', 'provider_identified', 'health_lost', 'shutdown_requested', 'shutdown_confirmed',
    ]);
    expect(events.find(e => e.transition.event === 'provider_identified')).toMatchObject({
      providerRef: 'pod-x', healthy: false, transition: { from: 'provisioning', to: 'provisioning' },
    });
    expect(cleanupSignals).toHaveLength(1);
    expect(cleanupSignals[0]).not.toBe(workload.signal);
    expect(cleanupSignals[0]!.aborted).toBe(false);
  });

  test('falha ao persistir provider_identified → teardown compensatório por providerRef, sem void, sem inspect/runtime', async () => {
    const stopped: string[] = []; const destroyed: string[] = []; const signals: AbortSignal[] = []; let inspects = 0; let voids = 0;
    const provisioner: NodeProvisioner = {
      providerId: 'local-process',
      provision: async (req, _sig, observer) => {
        const ok = observer ? await observer.providerIdentified({ nodeId: req.nodeId, providerId: req.providerId, providerRef: 'pod-y' }) : true;
        if (!ok) return { ok: false, reason: 'provider_identity_unpersisted' };
        return { ok: true, handle: { nodeId: req.nodeId, providerId: req.providerId, endpoint: 'http://x', providerRef: 'pod-y' } };
      },
      inspect: async h => { inspects += 1; return { nodeId: h.nodeId, reachable: false, healthy: false }; },
      stop: async (h, signal) => { stopped.push(h.providerRef); signals.push(signal); return { ok: true }; },
      destroy: async (h, signal) => { destroyed.push(h.providerRef); signals.push(signal); return { ok: true }; },
    };
    const prepared = await paidPrepare({
      // sink falha ESPECIFICAMENTE no provider_identified
      evidenceSink: { record: async (v: NodeLifecycleEvidenceV1) => v.transition.event === 'provider_identified' ? { ok: false, message: 'sink down' } : { ok: true, action: 'recorded' } },
      voidBudget: (async () => { voids += 1; }) as unknown as PrepareInput['voidBudget'],
      provisionerFactory: () => provisioner,
    });
    expect(prepared).toMatchObject({ ok: false, reason: 'provider_identity_unpersisted' });
    expect(stopped).toEqual(['pod-y']);   // stop pelo providerRef OBSERVADO
    expect(destroyed).toEqual(['pod-y']); // destroy pelo providerRef observado
    expect(inspects).toBe(0);             // NUNCA chamou inspect (não fabricou ready)
    expect(voids).toBe(0);                // NÃO voidou o orçamento (provider foi chamado)
    expect(signals).toHaveLength(2);
    expect(signals.every(signal => !signal.aborted)).toBe(true);
  });

  test('observer recusa identidade divergente de node/provider sem persistir provider_identified', async () => {
    const events: NodeLifecycleEvidenceV1[] = [];
    const provisioner: NodeProvisioner = {
      providerId: 'local-process',
      provision: async (req, _sig, observer) => {
        const ok = observer ? await observer.providerIdentified({ nodeId: 'outro-node', providerId: req.providerId, providerRef: 'pod-z' }) : true;
        return ok ? { ok: true, handle: { nodeId: req.nodeId, providerId: req.providerId, endpoint: 'http://x', providerRef: 'pod-z' } } : { ok: false, reason: 'provider_identity_unpersisted' };
      },
      inspect: async h => ({ nodeId: h.nodeId, reachable: false, healthy: false }),
      stop: async () => ({ ok: true }),
    };
    const prepared = await paidPrepare({
      evidenceSink: { record: async (v: NodeLifecycleEvidenceV1) => { events.push(v); return { ok: true, action: 'recorded' }; } },
      provisionerFactory: () => provisioner,
    });
    expect(prepared).toMatchObject({ ok: false, reason: 'provider_identity_unpersisted' });
    expect(events.some(e => e.transition.event === 'provider_identified')).toBe(false);
  });

  test('paid sem autorização persistida não chama provisioner', async () => {
    let provisionCalls = 0;
    const chain = { eq: () => chain, is: () => chain, lte: () => chain, gt: () => chain, order: () => chain, limit: async () => ({ data: [], error: null }) };
    const client = { from: () => ({ select: () => chain }) } as unknown as SupabaseClient<Database>;
    const provisioner: NodeProvisioner = {
      providerId: 'local-process',
      provision: async () => { provisionCalls += 1; return { ok: false, reason: 'não deveria chamar' }; },
      inspect: async handle => ({ nodeId: handle.nodeId, reachable: false, healthy: false }),
      stop: async () => ({ ok: true }),
    };
    const prepared = await prepareResidentOnDemandCoderNode({
      client, config: config('paid'), workItemId: 'work-1', proposalVersion: 1,
      leaseId: 'lease-paid-1', signal: new AbortController().signal,
      evidenceSink: { record: async () => ({ ok: true, action: 'recorded' }) },
      provisionerFactory: () => provisioner,
    });
    expect(prepared).toMatchObject({ ok: false, reason: 'waiting_authorization' });
    expect(provisionCalls).toBe(0);
  });

  test('idempotência: provisão em andamento não dispara segunda provisão (dois host turns próximos)', async () => {
    // O primeiro preparo trava dentro de `provision`; enquanto está no ar, um segundo
    // preparo do MESMO node observa o guard `inFlight` e recua — sem instanciar/chamar
    // um segundo provisioner. Prova a não-duplicação de processo entre voltas próximas.
    let firstProvisionCalls = 0;
    let release!: (value: { ok: false; reason: string }) => void;
    const hung = new Promise<{ ok: false; reason: string }>(resolve => { release = resolve; });
    const first: NodeProvisioner = {
      providerId: 'local-process',
      provision: async () => { firstProvisionCalls += 1; return hung; },
      inspect: async handle => ({ nodeId: handle.nodeId, reachable: false, healthy: false }),
      stop: async () => ({ ok: true }),
    };
    let secondProvisionCalls = 0;
    const second: NodeProvisioner = {
      providerId: 'local-process',
      provision: async () => { secondProvisionCalls += 1; return { ok: false, reason: 'não deveria ser chamado' }; },
      inspect: async handle => ({ nodeId: handle.nodeId, reachable: false, healthy: false }),
      stop: async () => ({ ok: true }),
    };
    const cfg: ResidentOnDemandNodeConfig = { ...config(), nodeId: 'idem-node-1' };
    const sink = { record: async () => ({ ok: true as const, action: 'recorded' as const }) };
    const inFlightPrep = prepareResidentOnDemandCoderNode({
      client: dummyClient, config: cfg, workItemId: 'work-1', proposalVersion: 1,
      leaseId: 'lease-idem-1', signal: new AbortController().signal,
      evidenceSink: sink, provisionerFactory: () => first,
    });
    // Deixa o primeiro preparo alcançar `inFlight.add` e travar dentro de provision.
    await new Promise(resolve => setTimeout(resolve, 20));
    const blocked = await prepareResidentOnDemandCoderNode({
      client: dummyClient, config: cfg, workItemId: 'work-1', proposalVersion: 1,
      leaseId: 'lease-idem-2', signal: new AbortController().signal,
      evidenceSink: sink, provisionerFactory: () => second,
    });
    expect(blocked).toMatchObject({ ok: false, reason: 'provision_failed' });
    expect(secondProvisionCalls).toBe(0);
    expect(firstProvisionCalls).toBe(1);
    // Libera o primeiro (falha limpa) para desfazer o guard e não vazar estado entre testes.
    release({ ok: false, reason: 'encerrado pelo teste' });
    await inFlightPrep;
  });

  test('falha viva antes de READY termina provision_failed sem fabricar runtime', async () => {
    const evidence: NodeLifecycleEvidenceV1[] = [];
    const prepared = await prepareResidentOnDemandCoderNode({
      client: dummyClient, config: { ...config(), nodeId: 'dead-node' }, workItemId: 'work-1', proposalVersion: 1,
      leaseId: 'lease-dead-1', signal: new AbortController().signal,
      evidenceSink: { record: async value => { evidence.push(value); return { ok: true, action: 'recorded' }; } },
      provisionerFactory: () => new LocalProcessNodeProvisioner({ command: process.execPath, args: ['-e', 'process.exit(1)'] }),
    });
    expect(prepared).toMatchObject({ ok: false, reason: 'provision_failed' });
    expect(evidence.map(value => value.transition.event)).toEqual(['provision_requested', 'provision_failed']);
  });
});

describe('leaseDeadlineSignal (watchdog best-effort do deadline da lease)', () => {
  test('deadline já vencido → aborta imediatamente', () => {
    const { signal, dispose } = leaseDeadlineSignal(new AbortController().signal, '2000-01-01T00:00:00.000Z');
    expect(signal.aborted).toBe(true); dispose();
  });
  test('sinal base já abortado → deriva abortado', () => {
    const c = new AbortController(); c.abort();
    const { signal, dispose } = leaseDeadlineSignal(c.signal, '2100-01-01T00:00:00.000Z');
    expect(signal.aborted).toBe(true); dispose();
  });
  test('abortar o base propaga ao derivado', () => {
    const c = new AbortController();
    const { signal, dispose } = leaseDeadlineSignal(c.signal, '2100-01-01T00:00:00.000Z');
    expect(signal.aborted).toBe(false); c.abort(); expect(signal.aborted).toBe(true); dispose();
  });
  test('deadline futuro dispara o abort no prazo', async () => {
    const { signal, dispose } = leaseDeadlineSignal(new AbortController().signal, new Date(Date.now() + 15).toISOString());
    expect(signal.aborted).toBe(false);
    await new Promise(r => setTimeout(r, 40));
    expect(signal.aborted).toBe(true); dispose();
  });
  test('dispose limpa o timer (não aborta o gasto do teardown depois)', async () => {
    const { signal, dispose } = leaseDeadlineSignal(new AbortController().signal, new Date(Date.now() + 50).toISOString());
    dispose();
    await new Promise(r => setTimeout(r, 80));
    expect(signal.aborted).toBe(false);
  });
});
