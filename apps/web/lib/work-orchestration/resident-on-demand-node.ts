import { join } from 'node:path';
import {
  admitConcurrentPaidNode,
  buildNodeLifecycleEvidence,
  decideCoderProvisioning,
  deriveBoundedLease,
  estimateLeaseCost,
  evaluatePaidComputeAuthorization,
  transitionNodeLifecycle,
  type NodeBillingMode,
  type NodeLeaseV0,
  type NodeLifecycleEvent,
  type NodeLifecycleState,
  type NodePriceHintV0,
  type NodeProvisioner,
  type ProvisionedNodeHandle,
} from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LocalProcessNodeProvisioner } from './local-process-node-provisioner';
import { RunPodNodeProvisioner, readRunPodProvisionerConfig } from './runpod-node-provisioner';
import { nodeLifecycleEvidenceSinkFor, type NodeLifecycleEvidenceSink } from './node-lifecycle-evidence';
import { readActivePaidComputeAuthorization } from './paid-compute-authorization-store';
import { remoteRuntimeFor, type CoderInferenceNodeV0 } from './coder-placement';
import { projectRoot } from './executor-selection';

export type OnDemandProvisionerId = 'local-process' | 'runpod';

// Caminho do provisioner fake-realista de prova, resolvido a partir da RAIZ do projeto
// (discovery por cwd). Deliberadamente NÃO usa `__dirname`: o Resident Host roda como ESM
// (`--experimental-transform-types`), onde `__dirname` é indefinido — só o jest (CommonJS)
// o teria. `projectRoot()` funciona nos dois runtimes.
const fakeInferenceNodeFixture = (): string =>
  join(projectRoot(), 'apps', 'web', 'lib', 'work-orchestration', '__fixtures__', 'fake-inference-node.cjs');

export interface ResidentOnDemandNodeConfig {
  readonly nodeId: string;
  readonly providerId: OnDemandProvisionerId;
  readonly model: string;
  readonly resourceClass: string;
  readonly billingMode: NodeBillingMode;
  readonly maxActiveDurationMs: number;
  readonly idleTimeoutMs: number;
  /** Teto de nodes PAGOS concorrentes (Milestone G). `null` = sem gate (default retrocompatível);
   * o gate só se aplica quando este teto está configurado E há um leitor de contagem viva. */
  readonly maxConcurrentPaidNodes: number | null;
  /** Palpite de preço CONFIGURADO pelo operador (do catálogo do provider), fonte da ESTIMATIVA
   * de custo PRÉ-provision. `null` = sem estimativa (uma autorização com teto de custo então
   * NEGA fail-closed). NUNCA é custo final — é hint para o gate financeiro. */
  readonly priceHint: NodePriceHintV0 | null;
}

export function readResidentOnDemandNodeConfig(
  model: string,
  env: Record<string, string | undefined> = process.env,
): ResidentOnDemandNodeConfig | null {
  if (env.ANIMA_ON_DEMAND_NODE_ENABLED?.trim().toLowerCase() !== 'true') return null;
  const provisioner = env.ANIMA_ON_DEMAND_NODE_PROVISIONER?.trim();
  if (provisioner !== 'local-process' && provisioner !== 'runpod') return null;
  const nodeId = env.ANIMA_ON_DEMAND_NODE_ID?.trim() ?? '';
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(nodeId)) return null;
  const billing = env.ANIMA_ON_DEMAND_NODE_BILLING_MODE?.trim();
  if (billing !== 'owned' && billing !== 'paid') return null;
  // RunPod é compute PAGO: só é elegível sob billingMode `paid` (passa pelo gate financeiro
  // humano) E com a config do adapter presente (API key/imagem/GPU). Sem isso, fail-closed —
  // o burst nem é admitido. Nunca `owned` (não se aluga cloud sem autorização de gasto).
  if (provisioner === 'runpod') {
    if (billing !== 'paid') return null;
    if (readRunPodProvisionerConfig(env) === null) return null;
  }
  const maxConcurrentRaw = Number(env.ANIMA_ON_DEMAND_MAX_CONCURRENT_PAID_NODES);
  const perHour = Number(env.ANIMA_ON_DEMAND_PRICE_PER_HOUR);
  const priceHint: NodePriceHintV0 | null = Number.isFinite(perHour) && perHour >= 0
    ? { currency: env.ANIMA_ON_DEMAND_PRICE_CURRENCY?.trim() || 'USD', perHour }
    : null;
  return {
    nodeId, providerId: provisioner, model,
    resourceClass: env.ANIMA_ON_DEMAND_NODE_RESOURCE_CLASS?.trim() || provisioner,
    billingMode: billing,
    maxActiveDurationMs: 30 * 60_000,
    idleTimeoutMs: 60_000,
    maxConcurrentPaidNodes: Number.isInteger(maxConcurrentRaw) && maxConcurrentRaw > 0 ? maxConcurrentRaw : null,
    priceHint,
  };
}

/** Seleciona o provisioner concreto atrás da porta `NodeProvisioner` conforme a config —
 * `local-process` (prova, processo real local) ou `runpod` (adapter real, env-gated). Só é
 * alcançado DEPOIS do gate financeiro (a decisão de provisionar); RunPod exige a config do
 * adapter presente (fail-closed). O `env` é o único portador da credencial (nunca banco/log). */
export function resolveOnDemandProvisioner(
  config: ResidentOnDemandNodeConfig,
  env: Record<string, string | undefined> = process.env,
): (NodeProvisioner & { disposeAll?: () => Promise<void> }) {
  if (config.providerId === 'runpod') {
    const runpod = readRunPodProvisionerConfig(env);
    if (runpod === null) throw new Error('runpod_config_unavailable'); // fail-closed (não deveria ocorrer: já validado)
    return new RunPodNodeProvisioner(runpod);
  }
  return new LocalProcessNodeProvisioner({
    command: process.execPath,
    args: [fakeInferenceNodeFixture()],
    env: {
      ...(env.ANIMA_ON_DEMAND_NODE_TARGET_PATH ? { FAKE_NODE_TARGET_PATH: env.ANIMA_ON_DEMAND_NODE_TARGET_PATH } : {}),
      ...(env.ANIMA_ON_DEMAND_NODE_TARGET_CONTENT ? { FAKE_NODE_TARGET_CONTENT: env.ANIMA_ON_DEMAND_NODE_TARGET_CONTENT } : {}),
      ...(env.ANIMA_ON_DEMAND_NODE_FAILURE_MODE === 'health' ? { FAKE_NODE_UNHEALTHY: '1' } : {}),
      ...(env.ANIMA_ON_DEMAND_NODE_FAILURE_MODE === 'crash' ? { FAKE_NODE_CRASH_ON_POST: '1' } : {}),
    },
  });
}

/**
 * Lever de PROVA/OPS, env-gated e fail-closed: força a pré-condição "local sem headroom"
 * para exercitar o burst on-demand quando a máquina TEM headroom (pressão `low`). Só afeta
 * o gatilho de pressão → placement; NÃO burla o gate financeiro (um node `paid` sem
 * autorização válida continua fechado). Ausente/≠'true' ⇒ comportamento normal por pressão.
 */
export function onDemandBurstForced(env: Record<string, string | undefined> = process.env): boolean {
  return env.ANIMA_ON_DEMAND_FORCE_BURST?.trim().toLowerCase() === 'true';
}

export type ResidentNodePreparation =
  | { readonly ok: false; readonly reason: 'waiting_authorization' | 'concurrency_limit' | 'provision_failed' | 'health_failed' | 'evidence_failed'; readonly detail: string }
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
  /** Contagem viva de nodes PAGOS (via projectReconcilableLeases). Só consultada quando há teto
   * de concorrência configurado; ausente ⇒ sem gate de concorrência (retrocompatível). */
  readonly readLivePaidNodeCount?: () => Promise<number>;
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
  // Estimativa de custo PRÉ-provision a partir do priceHint CONFIGURADO (do catálogo do
  // provider; sem chamada ao provider). Alimenta o gate financeiro: uma autorização com teto de
  // custo é conferida contra esta estimativa. Sem priceHint → null (autorização com teto de
  // custo NEGA fail-closed via `cost_estimate_required`). NUNCA é custo final.
  const estimatedCost = config.billingMode === 'paid' && config.priceHint
    ? estimateLeaseCost(config.priceHint, config.maxActiveDurationMs)
    : null;
  const financial = evaluatePaidComputeAuthorization({
    billingMode: config.billingMode, providerId: config.providerId, nodeId: config.nodeId,
    resourceClass: config.resourceClass, workItemId: input.workItemId,
    requestedDurationMs: config.maxActiveDurationMs, estimatedCost,
  }, authorization, clock());
  const decision = decideCoderProvisioning({ lifecycleState: 'offline', billingMode: config.billingMode, authorization: financial });
  if (decision.action === 'waiting_authorization') {
    return { ok: false, reason: 'waiting_authorization', detail: decision.reason };
  }
  if (decision.action !== 'provision') return { ok: false, reason: 'provision_failed', detail: `unexpected decision: ${decision.action}` };

  // Gate de CONCORRÊNCIA de nodes pagos (Milestone G, fail-closed quando configurado): antes de
  // subir um novo recurso faturável, não ultrapassar o teto de recursos simultâneos. Opt-in:
  // só quando há teto configurado E um leitor de contagem viva. Nunca amplia autoridade.
  if (config.billingMode === 'paid' && config.maxConcurrentPaidNodes !== null && input.readLivePaidNodeCount) {
    const liveCount = await input.readLivePaidNodeCount();
    const admission = admitConcurrentPaidNode({ liveCount, limit: config.maxConcurrentPaidNodes });
    if (!admission.admit) {
      return { ok: false, reason: 'concurrency_limit', detail: `nodes pagos vivos ${liveCount} ≥ teto ${config.maxConcurrentPaidNodes}` };
    }
  }

  const authorizationRef = financial.authorized && financial.requiresPayment ? financial.authorizationRef : null;
  // Node PAGO: a lease é derivada da AUTORIDADE (teto duro) — deadline nunca ultrapassa a
  // janela da autorização. Fail-closed se a janela já se esgotou entre a avaliação e aqui.
  // Node não-pago (owned): lease pelo envelope de config (sem autoridade financeira).
  let lease: NodeLeaseV0;
  if (config.billingMode === 'paid' && authorization !== null && financial.authorized && financial.requiresPayment) {
    const bounded = deriveBoundedLease({
      authorization, nodeId: config.nodeId, workItemId: input.workItemId, attemptId: input.leaseId,
      requestedDurationMs: config.maxActiveDurationMs, idleTimeoutMs: config.idleTimeoutMs,
      now: clock(), priceHint: config.priceHint,
    });
    if (!bounded.ok) return { ok: false, reason: 'waiting_authorization', detail: `authority_envelope:${bounded.reason}` };
    lease = bounded.lease;
  } else {
    lease = {
      schemaVersion: 1, nodeId: config.nodeId, providerId: config.providerId, billingMode: config.billingMode,
      workItemId: input.workItemId, attemptId: input.leaseId,
      maxActiveDurationMs: config.maxActiveDurationMs, idleTimeoutMs: config.idleTimeoutMs,
      leaseExpiresAt: new Date(clock().getTime() + config.maxActiveDurationMs).toISOString(),
      authorizationRef, priceHint: null,
    };
  }
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
  const provisioner = input.provisionerFactory?.() ?? resolveOnDemandProvisioner(config);
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
