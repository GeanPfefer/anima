import {
  buildNodeLifecycleEvidence,
  type BuildNodeLifecycleEvidenceInput,
} from './node-lifecycle-evidence';
import {
  admitConcurrentPaidNode,
  decidePaidLeaseReconciliation,
  projectReconcilableLeases,
  type NodeLifecycleEvidenceEventLike,
  type ObservedResourceStatus,
} from './index';
import type { NodeLifecycleEvent, NodeLifecycleState } from './node-lifecycle';
import type { Json } from '@anima/types';

// ---- projeção ----

let clock = 0;
const evidenceEvent = (
  from: NodeLifecycleState, to: NodeLifecycleState, event: NodeLifecycleEvent,
  over: Partial<BuildNodeLifecycleEvidenceInput> = {},
): NodeLifecycleEvidenceEventLike => {
  const built = buildNodeLifecycleEvidence({
    nodeId: 'burst-1', providerId: 'runpod', leaseId: 'lease-1', workItemId: 'item-1', attemptId: null,
    billingMode: 'paid', transition: { from, to, event }, healthy: to === 'ready' || to === 'busy' || to === 'idle',
    activeDurationMs: 0, authorizationRef: 'auth-1', observedAt: new Date(1_000 + clock++).toISOString(), ...over,
  });
  if (!built.ok) throw new Error(`evidência inválida: ${built.defect}`);
  return {
    type: 'host_observed_node_lifecycle_recorded',
    payload: { data: { work_item_id: built.value.workItemId, attempt_id: built.value.attemptId, evidence: built.value as unknown as Json } },
  };
};

describe('projectReconcilableLeases', () => {
  beforeEach(() => { clock = 0; });

  test('lease paga viva (última transição não-offline) vira candidata', () => {
    const leases = projectReconcilableLeases([
      evidenceEvent('offline', 'provisioning', 'provision_requested'),
      evidenceEvent('provisioning', 'ready', 'health_confirmed'),
    ]);
    expect(leases).toHaveLength(1);
    expect(leases[0]).toMatchObject({ nodeId: 'burst-1', providerId: 'runpod', leaseId: 'lease-1', latestState: 'ready', billingMode: 'paid', authorizationRef: 'auth-1' });
  });

  test('lease que chegou a offline (shutdown confirmado) NÃO é candidata (terminal-safe)', () => {
    expect(projectReconcilableLeases([
      evidenceEvent('offline', 'provisioning', 'provision_requested'),
      evidenceEvent('provisioning', 'ready', 'health_confirmed'),
      evidenceEvent('idle', 'shutting_down', 'shutdown_requested', { transition: { from: 'idle', to: 'shutting_down', event: 'shutdown_requested' } }),
      evidenceEvent('shutting_down', 'offline', 'shutdown_confirmed'),
    ])).toHaveLength(0);
  });

  test('providerRef projetado é o último NÃO-nulo (provision_requested traz null; health o preenche)', () => {
    const leases = projectReconcilableLeases([
      evidenceEvent('offline', 'provisioning', 'provision_requested'), // providerRef null
      evidenceEvent('provisioning', 'ready', 'health_confirmed', { providerRef: 'pod-42' }),
      evidenceEvent('ready', 'busy', 'reserved', { providerRef: 'pod-42' }),
    ]);
    expect(leases[0]).toMatchObject({ latestState: 'busy', providerRef: 'pod-42' });
  });

  test('recovery: provider_identified deixa a lease em provisioning reconciliável PELO providerRef', () => {
    // Crash logo após a criação do pod: só provision_requested + provider_identified no log.
    const leases = projectReconcilableLeases([
      evidenceEvent('offline', 'provisioning', 'provision_requested'), // providerRef null
      evidenceEvent('provisioning', 'provisioning', 'provider_identified', { providerRef: 'pod-created', healthy: false }),
    ]);
    expect(leases).toHaveLength(1);
    expect(leases[0]).toMatchObject({ latestState: 'provisioning', providerRef: 'pod-created', billingMode: 'paid' });
  });

  test('falha deixa recurso possivelmente pendurado → candidata (health_failed/provision_failed)', () => {
    expect(projectReconcilableLeases([evidenceEvent('provisioning', 'health_failed', 'health_lost')])).toHaveLength(1);
  });

  test('lease owned NÃO é candidata (recurso local morre com o host)', () => {
    expect(projectReconcilableLeases([
      evidenceEvent('offline', 'provisioning', 'provision_requested', { billingMode: 'owned', authorizationRef: null }),
    ])).toHaveLength(0);
  });

  test('agrupa por (item,node,lease) e usa a última transição', () => {
    const leases = projectReconcilableLeases([
      evidenceEvent('offline', 'provisioning', 'provision_requested', { nodeId: 'a', leaseId: 'la' }),
      evidenceEvent('offline', 'provisioning', 'provision_requested', { nodeId: 'b', leaseId: 'lb' }),
      evidenceEvent('provisioning', 'ready', 'health_confirmed', { nodeId: 'a', leaseId: 'la' }),
    ]);
    expect(leases).toHaveLength(2);
    expect(leases.find(l => l.nodeId === 'a')?.latestState).toBe('ready');
    expect(leases.find(l => l.nodeId === 'b')?.latestState).toBe('provisioning');
  });
});

// ---- decisão (tabela de casos do Milestone E) ----

describe('decidePaidLeaseReconciliation', () => {
  const decide = (over: Partial<Parameters<typeof decidePaidLeaseReconciliation>[0]> = {}) =>
    decidePaidLeaseReconciliation({ latestState: 'ready', observed: 'running', authorityStillValid: true, deadlinePassed: false, ...over });

  test('E: offline → none (terminal)', () => {
    expect(decide({ latestState: 'offline' })).toBe('none');
  });
  test('E1: lease ativa + provider ativo + dentro da autoridade → await', () => {
    expect(decide()).toBe('await');
  });
  test('E2: lease expirada (deadline) + provider ativo → stop', () => {
    expect(decide({ deadlinePassed: true })).toBe('stop');
  });
  test('E2b: autoridade esgotada/revogada + provider ativo → stop', () => {
    expect(decide({ authorityStillValid: false })).toBe('stop');
  });
  test('E3: teardown solicitado (shutting_down) + provider ativo → stop', () => {
    expect(decide({ latestState: 'shutting_down' })).toBe('stop');
  });
  test('estado de falha + provider ativo → stop mesmo com autoridade ainda válida', () => {
    for (const latestState of ['provision_failed', 'health_failed', 'shutdown_failed'] as const) {
      expect(decide({ latestState, authorityStillValid: true })).toBe('stop');
    }
  });
  test('E4/E6: provider ausente → confirm_offline (convergência observada)', () => {
    expect(decide({ observed: 'absent' })).toBe('confirm_offline');
    expect(decide({ observed: 'absent', latestState: 'shutting_down' })).toBe('confirm_offline');
  });
  test('E5: provider temporariamente inalcançável → retry_later (NÃO abandona)', () => {
    expect(decide({ observed: 'unreachable' })).toBe('retry_later');
    expect(decide({ observed: 'unreachable', authorityStillValid: false })).toBe('retry_later');
  });
  test('observação desconhecida → retry_later (não age sem informação)', () => {
    expect(decide({ observed: 'unknown' as ObservedResourceStatus })).toBe('retry_later');
  });
  test('E9: idempotente — mesma entrada, mesma decisão', () => {
    const input = { latestState: 'idle' as NodeLifecycleState, observed: 'running' as const, authorityStillValid: false, deadlinePassed: false };
    expect(decidePaidLeaseReconciliation(input)).toBe(decidePaidLeaseReconciliation(input));
  });
});

describe('admitConcurrentPaidNode (cap de recursos pagos concorrentes)', () => {
  test('abaixo do teto → admite', () => {
    expect(admitConcurrentPaidNode({ liveCount: 0, limit: 1 })).toEqual({ admit: true });
    expect(admitConcurrentPaidNode({ liveCount: 2, limit: 3 })).toEqual({ admit: true });
  });
  test('no teto ou acima → concurrency_limit', () => {
    expect(admitConcurrentPaidNode({ liveCount: 1, limit: 1 })).toEqual({ admit: false, reason: 'concurrency_limit' });
    expect(admitConcurrentPaidNode({ liveCount: 5, limit: 3 })).toEqual({ admit: false, reason: 'concurrency_limit' });
  });
  test('limite <= 0 → fail-closed (sem concorrência paga permitida)', () => {
    expect(admitConcurrentPaidNode({ liveCount: 0, limit: 0 })).toEqual({ admit: false, reason: 'concurrency_limit' });
  });
});
