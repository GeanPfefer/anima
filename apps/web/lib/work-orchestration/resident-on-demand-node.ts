import { join } from 'node:path';
import {
  buildNodeLifecycleEvidence,
  decideCoderProvisioning,
  estimateLeaseCost,
  evaluatePaidComputeAuthorization,
  transitionNodeLifecycle,
  type NodeBillingMode,
  type NodeLeaseV0,
  type NodeLifecycleEvent,
  type NodeLifecycleState,
  type NodeProvisioner,
  type ProvisionedNodeHandle,
} from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LocalProcessNodeProvisioner } from './local-process-node-provisioner';
import { nodeLifecycleEvidenceSinkFor, type NodeLifecycleEvidenceSink } from './node-lifecycle-evidence';
import { readActivePaidComputeAuthorization } from './paid-compute-authorization-store';
import { remoteRuntimeFor, type CoderInferenceNodeV0 } from './coder-placement';

export interface ResidentOnDemandNodeConfig {
  readonly nodeId: string;
  readonly providerId: 'local-process';
  readonly model: string;
  readonly resourceClass: string;
  readonly billingMode: NodeBillingMode;
  readonly maxActiveDurationMs: number;
  readonly idleTimeoutMs: number;
}

export function readResidentOnDemandNodeConfig(
  model: string,
  env: Record<string, string | undefined> = process.env,
): ResidentOnDemandNodeConfig | null {
  if (env.ANIMA_ON_DEMAND_NODE_ENABLED?.trim().toLowerCase() !== 'true') return null;
  if (env.ANIMA_ON_DEMAND_NODE_PROVISIONER?.trim() !== 'local-process') return null;
  const nodeId = env.ANIMA_ON_DEMAND_NODE_ID?.trim() ?? '';
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(nodeId)) return null;
  const billing = env.ANIMA_ON_DEMAND_NODE_BILLING_MODE?.trim();
  if (billing !== 'owned' && billing !== 'paid') return null;
  return {
    nodeId, providerId: 'local-process', model,
    resourceClass: env.ANIMA_ON_DEMAND_NODE_RESOURCE_CLASS?.trim() || 'local-process',
    billingMode: billing,
    maxActiveDurationMs: 30 * 60_000,
    idleTimeoutMs: 60_000,
  };
}

export type ResidentNodePreparation =
  | { readonly ok: false; readonly reason: 'waiting_authorization' | 'provision_failed' | 'health_failed' | 'evidence_failed'; readonly detail: string }
  | { readonly ok: true; readonly runtime: ReturnType<typeof remoteRuntimeFor>; finish(attemptId: string | null): Promise<void> };

const inFlight = new Set<string>();

export async function prepareResidentOnDemandCoderNode(input: {
  readonly client: SupabaseClient<Database>;
  readonly config: ResidentOnDemandNodeConfig;
  readonly workItemId: string;
  readonly proposalVersion: number;
  readonly leaseId: string;
  readonly signal: AbortSignal;
  readonly now?: () => Date;
  readonly evidenceSink?: NodeLifecycleEvidenceSink;
  readonly provisionerFactory?: () => NodeProvisioner & { disposeAll?: () => Promise<void> };
}): Promise<ResidentNodePreparation> {
  const clock = input.now ?? (() => new Date());
  const config = input.config;
  if (inFlight.has(config.nodeId)) return { ok: false, reason: 'provision_failed', detail: 'node lifecycle already in flight' };
  const authorization = config.billingMode === 'paid'
    ? await readActivePaidComputeAuthorization(input.client, {
        providerId: config.providerId, nodeId: config.nodeId, resourceClass: config.resourceClass,
        workItemId: input.workItemId, now: clock(),
      })
    : null;
  const financial = evaluatePaidComputeAuthorization({
    billingMode: config.billingMode, providerId: config.providerId, nodeId: config.nodeId,
    resourceClass: config.resourceClass, workItemId: input.workItemId,
    requestedDurationMs: config.maxActiveDurationMs,
  }, authorization, clock());
  const decision = decideCoderProvisioning({ lifecycleState: 'offline', billingMode: config.billingMode, authorization: financial });
  if (decision.action === 'waiting_authorization') {
    return { ok: false, reason: 'waiting_authorization', detail: decision.reason };
  }
  if (decision.action !== 'provision') return { ok: false, reason: 'provision_failed', detail: `unexpected decision: ${decision.action}` };

  const authorizationRef = financial.authorized && financial.requiresPayment ? financial.authorizationRef : null;
  const lease: NodeLeaseV0 = {
    schemaVersion: 1, nodeId: config.nodeId, providerId: config.providerId, billingMode: config.billingMode,
    workItemId: input.workItemId, attemptId: input.leaseId,
    maxActiveDurationMs: config.maxActiveDurationMs, idleTimeoutMs: config.idleTimeoutMs,
    leaseExpiresAt: new Date(clock().getTime() + config.maxActiveDurationMs).toISOString(),
    authorizationRef, priceHint: null,
  };
  const sink = input.evidenceSink ?? nodeLifecycleEvidenceSinkFor(input.client);
  const activeSince = clock();
  let state: NodeLifecycleState = 'offline';
  const persist = async (event: NodeLifecycleEvent, healthy: boolean, attemptId: string | null): Promise<boolean> => {
    const transition = transitionNodeLifecycle(state, event);
    if (!transition.ok) return false;
    if (transition.kind === 'noop') return true;
    const duration = Math.max(0, clock().getTime() - activeSince.getTime());
    const built = buildNodeLifecycleEvidence({
      nodeId: config.nodeId, providerId: config.providerId, leaseId: input.leaseId,
      workItemId: input.workItemId, attemptId, billingMode: config.billingMode,
      transition, healthy, activeDurationMs: duration, authorizationRef,
      estimatedCost: estimateLeaseCost(lease.priceHint, duration), observedAt: clock().toISOString(),
    });
    if (!built.ok) return false;
    const saved = await sink.record(built.value, input.proposalVersion);
    if (!saved.ok) return false;
    state = transition.to;
    return true;
  };

  if (!await persist('provision_requested', false, null)) return { ok: false, reason: 'evidence_failed', detail: 'provision_requested evidence failed' };
  inFlight.add(config.nodeId);
  const provisioner = input.provisionerFactory?.() ?? new LocalProcessNodeProvisioner({
    command: process.execPath,
    args: [join(__dirname, '__fixtures__', 'fake-inference-node.cjs')],
    env: {
      ...(process.env.ANIMA_ON_DEMAND_NODE_TARGET_PATH ? { FAKE_NODE_TARGET_PATH: process.env.ANIMA_ON_DEMAND_NODE_TARGET_PATH } : {}),
      ...(process.env.ANIMA_ON_DEMAND_NODE_TARGET_CONTENT ? { FAKE_NODE_TARGET_CONTENT: process.env.ANIMA_ON_DEMAND_NODE_TARGET_CONTENT } : {}),
      ...(process.env.ANIMA_ON_DEMAND_NODE_FAILURE_MODE === 'health' ? { FAKE_NODE_UNHEALTHY: '1' } : {}),
      ...(process.env.ANIMA_ON_DEMAND_NODE_FAILURE_MODE === 'crash' ? { FAKE_NODE_CRASH_ON_POST: '1' } : {}),
    },
  });
  const provisioned = await provisioner.provision({
    nodeId: config.nodeId, providerId: config.providerId, model: config.model,
    resourceClass: config.resourceClass, lease,
  }, input.signal);
  if (!provisioned.ok) {
    await persist('provision_failed', false, null);
    inFlight.delete(config.nodeId);
    return { ok: false, reason: 'provision_failed', detail: provisioned.reason };
  }
  const handle: ProvisionedNodeHandle = provisioned.handle;
  const health = await provisioner.inspect(handle, input.signal);
  if (!health.healthy) {
    await persist('health_lost', false, null);
    await provisioner.stop(handle, input.signal);
    inFlight.delete(config.nodeId);
    return { ok: false, reason: 'health_failed', detail: health.detail ?? 'node unhealthy' };
  }
  if (!await persist('health_confirmed', true, null)) {
    await provisioner.stop(handle, input.signal);
    inFlight.delete(config.nodeId);
    return { ok: false, reason: 'evidence_failed', detail: 'ready evidence failed' };
  }

  const node: CoderInferenceNodeV0 = {
    id: config.nodeId, endpoint: handle.endpoint, locality: 'remote', enabled: true, healthy: true,
    capabilities: ['coder_inference'], models: [config.model], resourceClass: config.resourceClass, billingMode: config.billingMode,
  };
  return {
    ok: true,
    runtime: remoteRuntimeFor(node, config.model),
    finish: async (attemptId) => {
      try {
        if (attemptId !== null) {
          await persist('reserved', true, attemptId);
          await persist('released', true, attemptId);
        }
        await persist('shutdown_requested', false, attemptId);
        const stopped = await provisioner.stop(handle, input.signal);
        await persist(stopped.ok ? 'shutdown_confirmed' : 'shutdown_failed', false, attemptId);
      } finally {
        await provisioner.disposeAll?.();
        inFlight.delete(config.nodeId);
      }
    },
  };
}
