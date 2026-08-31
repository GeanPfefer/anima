/** @jest-environment node */
import type { NodeLifecycleEvidenceV1, NodeProvisioner, NodeProvisionRequest } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LocalProcessNodeProvisioner } from './local-process-node-provisioner';
import { prepareResidentOnDemandCoderNode, readResidentOnDemandNodeConfig, resolveOnDemandProvisioner, type ResidentOnDemandNodeConfig } from './resident-on-demand-node';
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
  resourceClass: 'local-cpu', billingMode, maxActiveDurationMs: 60_000, idleTimeoutMs: 1_000,
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

  test('node PAGO: lease é clampada à janela da autorização ao vivo (teto duro)', async () => {
    const now = new Date('2026-08-31T00:00:00.000Z');
    const validUntil = '2026-08-31T00:03:00.000Z'; // autoridade vence em 3 min
    const authRow = {
      id: 'auth-x', user_id: 'u', provider_id: 'local-process', node_id: null, resource_class: null, work_item_id: null,
      max_duration_ms: 60 * 60_000, max_cost_currency: null, max_cost_amount: null,
      valid_from: '2026-08-30T23:00:00.000Z', valid_until: validUntil, revoked_at: null, created_at: '2026-08-30T23:00:00.000Z',
    };
    const chain = { eq: () => chain, is: () => chain, lte: () => chain, gt: () => chain, order: () => chain, limit: async () => ({ data: [authRow], error: null }) };
    const client = { from: () => ({ select: () => chain }) } as unknown as SupabaseClient<Database>;
    let capturedLease: NodeProvisionRequest['lease'] | null = null;
    const provisioner: NodeProvisioner = {
      providerId: 'local-process',
      provision: async req => { capturedLease = req.lease; return { ok: false, reason: 'parar após capturar a lease' }; },
      inspect: async h => ({ nodeId: h.nodeId, reachable: false, healthy: false }),
      stop: async () => ({ ok: true }),
    };
    const prepared = await prepareResidentOnDemandCoderNode({
      client, config: { ...config('paid'), maxActiveDurationMs: 30 * 60_000 }, workItemId: 'work-1', proposalVersion: 1,
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
