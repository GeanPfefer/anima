/** @jest-environment node */
import type { NodeProvisioner, ProvisionedNodeHandle } from '@anima/core';
import { teardownKnownNode } from './bounded-node-teardown';

const handle: ProvisionedNodeHandle = { nodeId: 'node-1', providerId: 'runpod', providerRef: 'pod-1', endpoint: '' };
const base = (over: Partial<NodeProvisioner>): NodeProvisioner => ({
  providerId: 'runpod',
  provision: async () => ({ ok: false, reason: 'unused' }),
  inspect: async h => ({ nodeId: h.nodeId, reachable: false, healthy: false }),
  stop: async () => ({ ok: true }),
  ...over,
});

describe('teardownKnownNode', () => {
  test('usa signal próprio inicialmente vivo e exige stop + destroy quando disponível', async () => {
    const calls: string[] = [];
    const outcome = await teardownKnownNode(base({
      stop: async (h, signal) => { expect(signal.aborted).toBe(false); calls.push(`stop:${h.providerRef}`); return { ok: true }; },
      destroy: async (h, signal) => { expect(signal.aborted).toBe(false); calls.push(`destroy:${h.providerRef}`); return { ok: true }; },
    }), handle, 100);
    expect(outcome).toEqual({ ok: true });
    expect(calls).toEqual(['stop:pod-1', 'destroy:pod-1']);
  });

  test('provider sem destroy converge somente com stop', async () => {
    expect(await teardownKnownNode(base({}), handle, 100)).toEqual({ ok: true });
  });

  test('stop falho não fabrica sucesso nem chama destroy', async () => {
    let destroys = 0;
    const outcome = await teardownKnownNode(base({
      stop: async () => ({ ok: false, reason: 'provider_unreachable' }),
      destroy: async () => { destroys += 1; return { ok: true }; },
    }), handle, 100);
    expect(outcome).toEqual({ ok: false, stage: 'stop', reason: 'provider_unreachable' });
    expect(destroys).toBe(0);
  });

  test('destroy falho mantém ausência não comprovada', async () => {
    expect(await teardownKnownNode(base({ destroy: async () => ({ ok: false, reason: 'destroy_failed' }) }), handle, 100))
      .toEqual({ ok: false, stage: 'destroy', reason: 'destroy_failed' });
  });

  test('provider travado termina pelo timeout próprio e aborta seu signal', async () => {
    let cleanupSignal: AbortSignal | null = null;
    const started = Date.now();
    const outcome = await teardownKnownNode(base({
      stop: async (_h, signal) => { cleanupSignal = signal; return await new Promise(() => undefined); },
    }), handle, 15);
    expect(outcome).toEqual({ ok: false, stage: 'timeout', reason: 'node_teardown_timeout' });
    expect(Date.now() - started).toBeLessThan(250);
    expect(cleanupSignal).not.toBeNull();
    expect(cleanupSignal!.aborted).toBe(true);
  });
});
