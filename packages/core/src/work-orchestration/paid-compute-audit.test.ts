import { buildNodeLifecycleEvidence, type BuildNodeLifecycleEvidenceInput } from './node-lifecycle-evidence';
import { projectPaidComputeAudit, type NodeLifecycleEvidenceEventLike } from './index';
import type { NodeLifecycleEvent, NodeLifecycleState } from './node-lifecycle';
import type { Json } from '@anima/types';

let clock = 0;
const ev = (from: NodeLifecycleState, to: NodeLifecycleState, event: NodeLifecycleEvent, over: Partial<BuildNodeLifecycleEvidenceInput> = {}): NodeLifecycleEvidenceEventLike => {
  const built = buildNodeLifecycleEvidence({
    nodeId: 'burst-1', providerId: 'runpod', leaseId: 'lease-1', workItemId: 'item-1', attemptId: null,
    billingMode: 'paid', transition: { from, to, event }, healthy: to === 'ready' || to === 'busy' || to === 'idle',
    activeDurationMs: 0, authorizationRef: 'auth-1', observedAt: `2026-08-31T00:0${clock++}:00.000Z`, ...over,
  });
  if (!built.ok) throw new Error(built.defect);
  return { type: 'host_observed_node_lifecycle_recorded', payload: { data: { work_item_id: built.value.workItemId, attempt_id: built.value.attemptId, evidence: built.value as unknown as Json } } };
};

describe('projectPaidComputeAudit (observabilidade — Milestone J)', () => {
  beforeEach(() => { clock = 0; });

  test('lifecycle completo → registro com marcos, providerRef, custo e desfecho terminated', () => {
    const [rec] = projectPaidComputeAudit([
      ev('offline', 'provisioning', 'provision_requested'),
      ev('provisioning', 'ready', 'health_confirmed', { providerRef: 'pod-1', estimatedCost: { currency: 'USD', amount: 0.5 } }),
      ev('ready', 'busy', 'reserved', { providerRef: 'pod-1' }),
      ev('busy', 'idle', 'released', { providerRef: 'pod-1' }),
      ev('idle', 'shutting_down', 'shutdown_requested', { providerRef: 'pod-1' }),
      ev('shutting_down', 'offline', 'shutdown_confirmed', { providerRef: 'pod-1', estimatedCost: { currency: 'USD', amount: 0.9 } }),
    ]);
    expect(rec).toMatchObject({
      nodeId: 'burst-1', providerId: 'runpod', authorizationRef: 'auth-1', providerRef: 'pod-1',
      startedAt: '2026-08-31T00:00:00.000Z', readyAt: '2026-08-31T00:01:00.000Z',
      shutdownRequestedAt: '2026-08-31T00:04:00.000Z', offlineAt: '2026-08-31T00:05:00.000Z',
      lastState: 'offline', outcome: 'terminated', orphanRisk: false, failed: false,
      estimatedCost: { currency: 'USD', amount: 0.9 }, transitions: 6,
    });
  });

  test('lease paga viva (não desligada) → outcome active E orphanRisk true', () => {
    const [rec] = projectPaidComputeAudit([
      ev('offline', 'provisioning', 'provision_requested'),
      ev('provisioning', 'ready', 'health_confirmed', { providerRef: 'pod-9' }),
    ]);
    expect(rec).toMatchObject({ lastState: 'ready', outcome: 'active', orphanRisk: true, readyAt: '2026-08-31T00:01:00.000Z' });
  });

  test('falha → failed=true, outcome failed, orphanRisk (paga, não offline)', () => {
    const [rec] = projectPaidComputeAudit([
      ev('offline', 'provisioning', 'provision_requested'),
      ev('provisioning', 'provision_failed', 'provision_failed'),
    ]);
    expect(rec).toMatchObject({ lastState: 'provision_failed', outcome: 'failed', failed: true, orphanRisk: true });
  });

  test('owned viva → orphanRisk false (recurso local morre com o host)', () => {
    const [rec] = projectPaidComputeAudit([
      ev('offline', 'provisioning', 'provision_requested', { billingMode: 'owned', authorizationRef: null }),
    ]);
    expect(rec).toMatchObject({ billingMode: 'owned', outcome: 'active', orphanRisk: false });
  });

  test('agrupa por lease e usa a última transição', () => {
    const recs = projectPaidComputeAudit([
      ev('offline', 'provisioning', 'provision_requested', { nodeId: 'a', leaseId: 'la' }),
      ev('offline', 'provisioning', 'provision_requested', { nodeId: 'b', leaseId: 'lb' }),
      ev('provisioning', 'ready', 'health_confirmed', { nodeId: 'a', leaseId: 'la', providerRef: 'pa' }),
    ]);
    expect(recs).toHaveLength(2);
    expect(recs.find(r => r.nodeId === 'a')).toMatchObject({ lastState: 'ready', providerRef: 'pa' });
    expect(recs.find(r => r.nodeId === 'b')).toMatchObject({ lastState: 'provisioning', providerRef: null });
  });
});
