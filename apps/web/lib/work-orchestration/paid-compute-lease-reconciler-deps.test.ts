/** @jest-environment node */
import { buildNodeLifecycleEvidence, NODE_LIFECYCLE_EVIDENCE_EVENT_TYPE, type NodeLifecycleEvidenceV1 } from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildPaidComputeLeaseReconcilerDeps, readLivePaidNodeCount, readPaidComputeAudit } from './paid-compute-lease-reconciler-deps';
import { RunPodNodeProvisioner } from './runpod-node-provisioner';
import { LocalProcessNodeProvisioner } from './local-process-node-provisioner';

const evidence = (event: 'provision_requested' | 'health_confirmed', from: string, to: string): NodeLifecycleEvidenceV1 => {
  const built = buildNodeLifecycleEvidence({
    nodeId: 'burst-1', providerId: 'runpod', leaseId: 'lease-1', workItemId: 'item-1', attemptId: null,
    billingMode: 'paid', transition: { from: from as never, to: to as never, event }, healthy: to === 'ready',
    activeDurationMs: 0, authorizationRef: 'auth-1', observedAt: new Date().toISOString(),
  });
  if (!built.ok) throw new Error(built.defect);
  return built.value;
};

const evRow = (e: NodeLifecycleEvidenceV1) => ({
  event_type: NODE_LIFECYCLE_EVIDENCE_EVENT_TYPE,
  payload: { data: { work_item_id: e.workItemId, attempt_id: e.attemptId, evidence: e as unknown as Json } } as Json,
});

function fakeClient(over: {
  events?: unknown[]; eventsError?: boolean; items?: unknown[]; auth?: { revoked_at: string | null; valid_until: string } | null;
} = {}): SupabaseClient<Database> {
  const from = (table: string): unknown => {
    if (table === 'work_events') {
      const result = over.eventsError ? { data: null, error: { message: 'read failed' } } : { data: over.events ?? [], error: null };
      const chain: Record<string, unknown> = { select: () => chain, eq: () => chain, order: () => chain, limit: async () => result };
      return chain;
    }
    if (table === 'work_items') {
      const chain: Record<string, unknown> = { select: () => chain, in: async () => ({ data: over.items ?? [], error: null }) };
      return chain;
    }
    if (table === 'paid_compute_authorizations') {
      const chain: Record<string, unknown> = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: over.auth ?? null, error: null }) };
      return chain;
    }
    throw new Error(`tabela inesperada: ${table}`);
  };
  return { from } as unknown as SupabaseClient<Database>;
}

describe('buildPaidComputeLeaseReconcilerDeps', () => {
  test('readLeases projeta órfãos pagos e anexa a versão CORRENTE do item', async () => {
    const deps = buildPaidComputeLeaseReconcilerDeps(fakeClient({
      events: [evRow(evidence('provision_requested', 'offline', 'provisioning')), evRow(evidence('health_confirmed', 'provisioning', 'ready'))],
      items: [{ id: 'item-1', proposal_version: 4 }],
    }));
    const leases = await deps.readLeases();
    expect(leases).toHaveLength(1);
    expect(leases[0]).toMatchObject({ nodeId: 'burst-1', providerId: 'runpod', latestState: 'ready', proposalVersion: 4 });
  });

  test('readLeases descarta lease sem versão de item conhecida (fail-safe)', async () => {
    const deps = buildPaidComputeLeaseReconcilerDeps(fakeClient({
      events: [evRow(evidence('provision_requested', 'offline', 'provisioning'))], items: [],
    }));
    expect(await deps.readLeases()).toHaveLength(0);
  });

  test('readAuthorityValid: válida (não revogada, dentro do prazo) → true; revogada/expirada/ausente → false', async () => {
    const now = new Date('2026-08-31T00:00:00Z');
    const valid = buildPaidComputeLeaseReconcilerDeps(fakeClient({ auth: { revoked_at: null, valid_until: '2026-08-31T01:00:00Z' } }));
    expect(await valid.readAuthorityValid('auth-1', now)).toBe(true);
    const revoked = buildPaidComputeLeaseReconcilerDeps(fakeClient({ auth: { revoked_at: '2026-08-31T00:00:00Z', valid_until: '2026-08-31T01:00:00Z' } }));
    expect(await revoked.readAuthorityValid('auth-1', now)).toBe(false);
    const expired = buildPaidComputeLeaseReconcilerDeps(fakeClient({ auth: { revoked_at: null, valid_until: '2026-08-30T23:00:00Z' } }));
    expect(await expired.readAuthorityValid('auth-1', now)).toBe(false);
    expect(await buildPaidComputeLeaseReconcilerDeps(fakeClient({ auth: null })).readAuthorityValid('auth-1', now)).toBe(false);
    expect(await valid.readAuthorityValid(null, now)).toBe(false);
  });

  test('readPaidComputeAudit / readLivePaidNodeCount projetam do log durável', async () => {
    const client = fakeClient({ events: [evRow(evidence('provision_requested', 'offline', 'provisioning')), evRow(evidence('health_confirmed', 'provisioning', 'ready'))] });
    const audit = await readPaidComputeAudit(client);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ nodeId: 'burst-1', providerId: 'runpod', lastState: 'ready', outcome: 'active', orphanRisk: true });
    expect(await readLivePaidNodeCount(client)).toBe(1);
    // log vazio → sem registros nem contagem
    expect(await readPaidComputeAudit(fakeClient({ events: [] }))).toHaveLength(0);
    expect(await readLivePaidNodeCount(fakeClient({ events: [] }))).toBe(0);
  });

  test('readLivePaidNodeCount é FAIL-CLOSED: erro de leitura → Infinity (nega o gate de concorrência)', async () => {
    // Contar 0 em erro admitiria novo compute pago às cegas. Infinity ≥ qualquer teto → NEGA.
    expect(await readLivePaidNodeCount(fakeClient({ eventsError: true }))).toBe(Number.POSITIVE_INFINITY);
  });

  test('resolveProvisioner: runpod só com config; local-process sempre; desconhecido null', () => {
    const deps = buildPaidComputeLeaseReconcilerDeps(fakeClient(), {});
    expect(deps.resolveProvisioner('runpod')).toBeNull(); // sem env config
    const configured = buildPaidComputeLeaseReconcilerDeps(fakeClient(), { ANIMA_RUNPOD_API_KEY: 'k', ANIMA_RUNPOD_IMAGE: 'i', ANIMA_RUNPOD_GPU_TYPE_IDS: 'A40' });
    expect(configured.resolveProvisioner('runpod')).toBeInstanceOf(RunPodNodeProvisioner);
    expect(deps.resolveProvisioner('local-process')).toBeInstanceOf(LocalProcessNodeProvisioner);
    expect(deps.resolveProvisioner('other')).toBeNull();
  });
});
