import { join } from 'node:path';
import {
  admitConcurrentPaidNode,
  buildNodeLifecycleEvidence,
  decideCoderProvisioning,
  deriveCloudSessionEnvelope,
  deriveQwen3CoderCloudRequirements,
  deriveBoundedLease,
  estimateLeaseCost,
  evaluatePaidComputeAuthorization,
  selectConservativePaidComputePrice,
  settleNodeLeaseCost,
  transitionNodeLifecycle,
  type NodeCostSourceV1,
  type NodeBillingMode,
  type NodeLeaseV0,
  type NodeLifecycleEvent,
  type NodeLifecycleState,
  type NodePriceHintV0,
  type NodeProvisioner,
  type NodeProvisionObserver,
  type ProvisionedNodeHandle,
  type LiveNodePriceQuoteV0,
  type RequirementMoneyV1,
  type CloudSessionStopReasonV1,
} from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LocalProcessNodeProvisioner } from './local-process-node-provisioner';
import { RunPodNodeProvisioner, readRunPodProvisionerConfig } from './runpod-node-provisioner';
import { readRunPodLivePriceQuote } from './runpod-price-quote';
import { readRunPodResourceInventory, type RunPodInventoryResult } from './runpod-price-quote';
import { planCloudResourceProvisioning } from './cloud-resource-plan';
import { runResilientCloudSession, type ResilientCloudSessionOutcome, type ResilientCloudSessionPorts } from './resilient-cloud-session';
import { nodeLifecycleEvidenceSinkFor, type NodeLifecycleEvidenceSink } from './node-lifecycle-evidence';
import { readActivePaidComputeAuthorization, readPaidComputeBudgetAudit, reservePaidComputeBudget, settlePaidComputeBudgetReservation, voidPaidComputeBudgetReservation } from './paid-compute-authorization-store';
import { remoteRuntimeFor, type CoderInferenceNodeV0 } from './coder-placement';
import { projectRoot } from './executor-selection';
import { DEFAULT_NODE_TEARDOWN_TIMEOUT_MS, teardownKnownNode } from './bounded-node-teardown';

export type OnDemandProvisionerId = 'local-process' | 'runpod';

export type LivePaidNodeCountResult =
  | { readonly ok: true; readonly count: number }
  | { readonly ok: false; readonly reason: 'paid_node_count_unavailable' };

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
  const priceHint: NodePriceHintV0 | null = Number.isFinite(perHour) && perHour > 0
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
  selectedGpuTypeId?: string,
): (NodeProvisioner & { disposeAll?: () => Promise<void> }) {
  if (config.providerId === 'runpod') {
    const runpod = readRunPodProvisionerConfig(env);
    if (runpod === null) throw new Error('runpod_config_unavailable'); // fail-closed (não deveria ocorrer: já validado)
    return new RunPodNodeProvisioner(selectedGpuTypeId ? { ...runpod, gpuTypeIds: [selectedGpuTypeId] } : runpod);
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

export type ResidentNodePreparationFailure = { readonly ok: false; readonly reason: 'waiting_authorization' | 'aggregate_budget_denied' | 'concurrency_limit' | 'paid_node_count_unavailable' | 'provision_failed' | 'provider_identity_unpersisted' | 'health_failed' | 'evidence_failed' | 'no_compatible_cloud_resource' | 'all_exceed_budget' | 'authority_scope_insufficient' | 'provider_inventory_unavailable'; readonly detail: string;
  /** Referência do recurso no provider quando um Pod chegou a ser criado (para trace/exclusão). */
  readonly providerRef?: string | null;
  /** Custo liquidado no teardown desta tentativa (quando o Pod faturável foi criado e liquidado). */
  readonly settledCost?: { readonly currency: string; readonly amount: number } | null };
export type ResidentNodePreparation =
  | ResidentNodePreparationFailure
  | { readonly ok: true; readonly runtime: ReturnType<typeof remoteRuntimeFor>; readonly leaseExpiresAt: string; readonly providerRef: string; finish(attemptId: string | null): Promise<void> };

/**
 * Sinal derivado que aborta no DEADLINE da lease (ou quando o sinal base abortar) — watchdog
 * BEST-EFFORT em memória para interromper uma volta paga que ultrapasse o teto temporal, parando
 * o gasto MAIS CEDO. NÃO é o mecanismo de segurança durável (esse é o reconciler + o deadline
 * persistido): se o processo morre, o timer some, mas o reconciler ainda converge. Devolve o
 * sinal e um `dispose` para limpar o timer. Deadline já vencido → aborta imediatamente.
 */
export function leaseDeadlineSignal(base: AbortSignal, leaseExpiresAt: string, now: () => number = Date.now): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onBase = () => controller.abort();
  if (base.aborted) controller.abort();
  else base.addEventListener('abort', onBase, { once: true });
  const deadlineMs = Date.parse(leaseExpiresAt);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const MAX_TIMER_MS = 2_147_483_647;
  const arm = (): void => {
    const remaining = deadlineMs - now();
    if (remaining <= 0) { controller.abort(); return; }
    // Node converte delays > 2^31-1 em 1 ms. Reagenda em parcelas para preservar deadlines
    // distantes sem abort prematuro; cada parcela recalcula o relógio (mudanças de clock inclusas).
    timer = setTimeout(arm, Math.min(remaining, MAX_TIMER_MS));
  };
  if (Number.isFinite(deadlineMs)) arm();
  return {
    signal: controller.signal,
    dispose: () => { if (timer) clearTimeout(timer); base.removeEventListener('abort', onBase); },
  };
}

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
  readonly readLivePaidNodeCount?: () => Promise<LivePaidNodeCountResult>;
  /** Override de teste para descoberta read-only. Em produção RunPod usa o GraphQL gpuTypes;
   * outros provisioners mantêm o preço configurado até possuírem client concreto. */
  readonly readLivePriceQuote?: () => Promise<{ readonly ok: true; readonly quote: LiveNodePriceQuoteV0 } | { readonly ok: false; readonly reason: string }>;
  /** Inventário read-only injetável. Usado somente por authority capability-based RunPod. */
  readonly readResourceInventory?: () => Promise<RunPodInventoryResult>;
  /** Revalidação fresca da mesma autoridade paga antes de entregar runtime. Override de teste;
   * produção relê a autorização persistida e exige o mesmo authorizationRef. */
  readonly revalidatePaidAuthority?: () => Promise<boolean>;
  readonly reserveBudget?: typeof reservePaidComputeBudget;
  readonly voidBudget?: typeof voidPaidComputeBudgetReservation;
  readonly settleBudget?: typeof settlePaidComputeBudgetReservation;
  /** Placements (`providerId:gpuTypeId`) que a sessão resiliente já excluiu — filtrados do
   * inventário ANTES do matcher, para que esta tentativa escolha OUTRA máquina. Vazio ⇒ sem filtro
   * (retrocompatível). Só aplica ao caminho capability-based (RunPod). */
  readonly excludedPlacements?: ReadonlySet<string>;
  /** Timeout próprio do teardown de segurança. Override existe para provas determinísticas. */
  readonly cleanupTimeoutMs?: number;
}): Promise<ResidentNodePreparation> {
  const clock = input.now ?? (() => new Date());
  let config = input.config;
  if (inFlight.has(config.nodeId)) return { ok: false, reason: 'provision_failed', detail: 'node lifecycle already in flight' };
  const authorization = config.billingMode === 'paid'
    ? await readActivePaidComputeAuthorization(input.client, {
        providerId: config.providerId, nodeId: config.nodeId, resourceClass: config.resourceClass,
        workItemId: input.workItemId, now: clock(),
      })
    : null;
  let selectedGpuTypeId: string | undefined;
  let selectedCapabilities: { readonly vramGiB: number; readonly gpuFeatures: readonly string[]; readonly perHour: { readonly currency: string; readonly amount: number } | null } | null = null;
  let capabilityMatched = false;
  if (config.providerId === 'runpod' && authorization?.capabilityScope != null) {
    const runpod = readRunPodProvisionerConfig();
    const readRawInventory = input.readResourceInventory ?? (() => runpod === null
      ? Promise.resolve({ ok: false as const, reason: 'inventory_invalid' as const })
      : readRunPodResourceInventory({
          graphqlBase: process.env.ANIMA_RUNPOD_GRAPHQL_BASE?.trim() || 'https://api.runpod.io/graphql',
          apiKey: runpod.apiKey, gpuTypeIds: runpod.gpuTypeIds, gpuCount: runpod.gpuCount, cloudType: runpod.cloudType,
        }, input.signal));
    // Exclusão de placement da sessão resiliente: remove os candidatos já falhados ANTES do
    // matcher, para que o ranking determinístico escolha a próxima máquina elegível.
    const excludedPlacements = input.excludedPlacements ?? new Set<string>();
    const readInventory = excludedPlacements.size === 0 ? readRawInventory : async (): Promise<RunPodInventoryResult> => {
      const inv = await readRawInventory();
      if (!inv.ok) return inv;
      return { ok: true, candidates: inv.candidates.filter(c => !excludedPlacements.has(`${c.providerId}:${c.gpuTypeId}`)) };
    };
    const requirements = deriveQwen3CoderCloudRequirements({
      model: config.model,
      maxHourlyPrice: authorization.capabilityScope.maxHourlyPrice,
      maxEstimatedCost: authorization.maxCostEstimate,
      maxNodes: Math.min(authorization.capabilityScope.maxNodes, config.maxConcurrentPaidNodes ?? authorization.capabilityScope.maxNodes),
      providerConstraints: { allowedProviderIds: ['runpod'], cloudType: runpod?.cloudType ?? null },
    });
    const plan = await planCloudResourceProvisioning({
      requirements, authorization, leaseDurationMs: config.maxActiveDurationMs, readInventory,
    });
    if (!plan.ok) return { ok: false, reason: plan.blocker, detail: plan.detail };
    selectedGpuTypeId = plan.chosen.candidate.gpuTypeId;
    selectedCapabilities = {
      vramGiB: plan.chosen.candidate.vramGiB,
      gpuFeatures: plan.chosen.candidate.gpuFeatures,
      perHour: plan.chosen.candidate.perHour,
    };
    capabilityMatched = true;
    config = {
      ...config,
      resourceClass: plan.chosen.candidate.resourceClass,
      priceHint: plan.chosen.candidate.perHour === null ? null : {
        currency: plan.chosen.candidate.perHour.currency,
        perHour: plan.chosen.candidate.perHour.amount,
      },
    };
  }
  // Estimativa de custo PRÉ-provision a partir do priceHint CONFIGURADO (do catálogo do
  // provider; sem chamada ao provider). Alimenta o gate financeiro: uma autorização com teto de
  // custo é conferida contra esta estimativa. Sem priceHint → null (autorização com teto de
  // custo NEGA fail-closed via `cost_estimate_required`). NUNCA é custo final.
  let admissionPrice = config.priceHint;
  if (config.billingMode === 'paid' && config.providerId === 'runpod' && !capabilityMatched) {
    const readQuote = input.readLivePriceQuote ?? (() => {
      const runpod = readRunPodProvisionerConfig();
      if (runpod === null) return Promise.resolve({ ok: false as const, reason: 'runpod_config_unavailable' });
      return readRunPodLivePriceQuote({
        graphqlBase: process.env.ANIMA_RUNPOD_GRAPHQL_BASE?.trim() || 'https://api.runpod.io/graphql',
        apiKey: runpod.apiKey, gpuTypeIds: runpod.gpuTypeIds, gpuCount: runpod.gpuCount,
        cloudType: runpod.cloudType, resourceClass: config.resourceClass, freshnessMs: 60_000,
      }, input.signal);
    });
    const live = await readQuote();
    if (!live.ok) return { ok: false, reason: 'aggregate_budget_denied', detail: `live_price:${live.reason}` };
    const selected = selectConservativePaidComputePrice({ configured: config.priceHint, live: live.quote,
      expectedProviderId: 'runpod', expectedResourceClass: config.resourceClass, now: clock() });
    if (!selected.ok) return { ok: false, reason: 'aggregate_budget_denied', detail: `live_price:${selected.reason}` };
    admissionPrice = selected.priceHint;
  }
  const estimatedCost = config.billingMode === 'paid' && admissionPrice
    ? estimateLeaseCost(admissionPrice, config.maxActiveDurationMs)
    : null;
  const financial = evaluatePaidComputeAuthorization({
    billingMode: config.billingMode, providerId: config.providerId, nodeId: config.nodeId,
    resourceClass: config.resourceClass, workItemId: input.workItemId,
    requestedDurationMs: config.maxActiveDurationMs, estimatedCost,
    ...(capabilityMatched ? { resourceCapabilities: selectedCapabilities } : {}),
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
    const observed = await input.readLivePaidNodeCount();
    if (!observed.ok) {
      return { ok: false, reason: observed.reason, detail: observed.reason };
    }
    const admission = admitConcurrentPaidNode({ liveCount: observed.count, limit: config.maxConcurrentPaidNodes });
    if (!admission.admit) {
      return { ok: false, reason: 'concurrency_limit', detail: `nodes pagos vivos ${observed.count} ≥ teto ${config.maxConcurrentPaidNodes}` };
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
      now: clock(), priceHint: admissionPrice,
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

  // WRITE GATE financeiro autoritativo: reserva durável, agregada e serializada ANTES de
  // qualquer evidência de provisão ou chamada ao provider. A leaseId é a chave idempotente:
  // replay da mesma admissão recupera a reserva; uma nova lease consome novo envelope.
  let budgetReservationId: string | null = null;
  if (config.billingMode === 'paid') {
    if (authorizationRef === null || estimatedCost === null || estimatedCost.amount <= 0) {
      return { ok: false, reason: 'aggregate_budget_denied', detail: 'positive_cost_estimate_required' };
    }
    const reserve = input.reserveBudget ?? reservePaidComputeBudget;
    const reservation = await reserve(input.client, {
      authorizationId: authorizationRef, idempotencyKey: input.leaseId,
      providerId: config.providerId, nodeId: config.nodeId, resourceClass: config.resourceClass,
      workItemId: input.workItemId, attemptId: null, leaseId: input.leaseId, estimate: estimatedCost,
    });
    if (!reservation.ok) return { ok: false, reason: 'aggregate_budget_denied', detail: reservation.code };
    budgetReservationId = reservation.reservationId;
  }
  const sink = input.evidenceSink ?? nodeLifecycleEvidenceSinkFor(input.client);
  const activeSince = clock();
  let state: NodeLifecycleState = 'offline';
  // Referência do recurso no provider: `null` até o provision retornar; a partir daí toda
  // evidência a carrega, permitindo recovery/teardown do órfão exato após restart.
  let providerRef: string | null = null;
  // SETTLEMENT no teardown: converte a reserva conservadora (R) no custo efetivo/estimado (S),
  // liberando o excesso ao envelope da sessão. BEST-EFFORT: uma falha de settlement NUNCA bloqueia o
  // teardown (parar o gasto é mais crítico que o registro do ledger); é logada. Só para node PAGO com
  // reserva feita; sem preço utilizável, `settleNodeLeaseCost` mantém a reserva inteira (conservador).
  // Idempotente por reserva na RPC — chamar mais de uma vez com o mesmo custo é seguro (replay).
  let settledThisAttempt: { readonly currency: string; readonly amount: number } | null = null;
  const settleReservation = async (): Promise<void> => {
    if (config.billingMode !== 'paid' || budgetReservationId === null || estimatedCost === null) return;
    const settlement = settleNodeLeaseCost({
      reserved: estimatedCost, billableDurationMs: Math.max(0, clock().getTime() - activeSince.getTime()),
      priceHint: admissionPrice,
    });
    if (!settlement) return;
    const source: NodeCostSourceV1 = settlement.source;
    try {
      const settle = input.settleBudget ?? settlePaidComputeBudgetReservation;
      const res = await settle(input.client, {
        reservationId: budgetReservationId,
        settled: { currency: settlement.currency, amount: settlement.settledAmount },
        costSource: source,
      });
      if (res.ok) settledThisAttempt = { currency: settlement.currency, amount: settlement.settledAmount };
      else console.error(`resident_node_settlement_failed ${JSON.stringify({ nodeId: config.nodeId, code: res.code })}`);
    } catch { console.error(`resident_node_settlement_error ${JSON.stringify({ nodeId: config.nodeId })}`); }
  };
  const persist = async (event: NodeLifecycleEvent, healthy: boolean, attemptId: string | null): Promise<boolean> => {
    const transition = transitionNodeLifecycle(state, event);
    if (!transition.ok) return false;
    if (transition.kind === 'noop') return true;
    const duration = Math.max(0, clock().getTime() - activeSince.getTime());
    const built = buildNodeLifecycleEvidence({
      nodeId: config.nodeId, providerId: config.providerId, leaseId: input.leaseId, providerRef,
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

  if (!await persist('provision_requested', false, null)) {
    if (budgetReservationId !== null) {
      const voidBudget = input.voidBudget ?? voidPaidComputeBudgetReservation;
      await voidBudget(input.client, budgetReservationId, 'provider_not_called');
    }
    return { ok: false, reason: 'evidence_failed', detail: 'provision_requested evidence failed' };
  }
  inFlight.add(config.nodeId);
  const provisioner = input.provisionerFactory?.() ?? resolveOnDemandProvisioner(config, process.env, selectedGpuTypeId);

  // Observador da IDENTIDADE do recurso: o provisioner o chama assim que o provider devolve o id
  // (pod existente OU recém-criado), ANTES de readiness. Persistimos `provider_identified`
  // (providerRef DURÁVEL, healthy=false, provisioning→provisioning) para que um crash entre a
  // criação e o ready deixe o recurso faturável reconciliável pelo id — não só pelo nome.
  const observer: NodeProvisionObserver = {
    providerIdentified: async (identity) => {
      if (identity.nodeId !== config.nodeId || identity.providerId !== config.providerId || identity.providerRef.trim() === '') return false;
      providerRef = identity.providerRef;
      return await persist('provider_identified', false, null);
    },
  };

  const provisioned = await provisioner.provision({
    nodeId: config.nodeId, providerId: config.providerId, model: config.model,
    resourceClass: config.resourceClass, ...(selectedGpuTypeId ? { gpuTypeId: selectedGpuTypeId } : {}), lease,
  }, input.signal, observer);
  if (!provisioned.ok) {
    // Se a IDENTIDADE já é conhecida (recurso faturável criado), o provider FOI chamado: NUNCA
    // voidar a reserva; tentar teardown COMPENSATÓRIO por providerRef com um signal FRESCO — nunca
    // deixar um signal de workload já abortado impedir a parada de um recurso pago conhecido.
    if (providerRef !== null) {
      const byRef: ProvisionedNodeHandle = { nodeId: config.nodeId, providerId: config.providerId, providerRef, endpoint: '' };
      await persist('shutdown_requested', false, null);
      const tornDown = await teardownKnownNode(provisioner, byRef, input.cleanupTimeoutMs ?? DEFAULT_NODE_TEARDOWN_TIMEOUT_MS);
      await persist(tornDown.ok ? 'shutdown_confirmed' : 'shutdown_failed', false, null);
      // Recurso faturável FOI criado e derrubado: LIQUIDA a reserva (custo efetivo/estimado),
      // liberando o excesso ao envelope da sessão. Teardown ANTES do settlement.
      await settleReservation();
    } else {
      // Nenhum recurso criado. Se o provider REJEITOU o create explicitamente (sem capacidade /
      // quota / auth inválida), é seguro VOIDAR a reserva (prova de que nenhum recurso faturável
      // nasceu), reabrindo o envelope para a próxima máquina. Reasons de REDE/ambíguas
      // (provider_unreachable, malformado) ficam conservadoras: não voida (reconciler decide), não settle.
      const providerRejectedCreate = provisioned.reason === 'capacity_unavailable'
        || provisioned.reason === 'quota_exceeded' || provisioned.reason === 'auth_invalid';
      await persist('provision_failed', false, null);
      if (budgetReservationId !== null && providerRejectedCreate) {
        const voidBudget = input.voidBudget ?? voidPaidComputeBudgetReservation;
        await voidBudget(input.client, budgetReservationId, 'provider_rejected_before_create');
      }
    }
    inFlight.delete(config.nodeId);
    return {
      ok: false,
      reason: provisioned.reason === 'provider_identity_unpersisted' ? 'provider_identity_unpersisted' : 'provision_failed',
      detail: provisioned.reason,
      providerRef,
      settledCost: settledThisAttempt,
    };
  }
  const handle: ProvisionedNodeHandle = provisioned.handle;
  providerRef = handle.providerRef; // confirma a referência (o observer já a setou antes do ready)
  const health = await provisioner.inspect(handle, input.signal);
  if (!health.healthy) {
    await persist('health_lost', false, null);
    await persist('shutdown_requested', false, null);
    const tornDown = await teardownKnownNode(provisioner, handle, input.cleanupTimeoutMs ?? DEFAULT_NODE_TEARDOWN_TIMEOUT_MS);
    await persist(tornDown.ok ? 'shutdown_confirmed' : 'shutdown_failed', false, null);
    await settleReservation();
    inFlight.delete(config.nodeId);
    return { ok: false, reason: 'health_failed', detail: health.detail ?? 'node unhealthy', providerRef, settledCost: settledThisAttempt };
  }
  if (config.billingMode === 'paid') {
    const authorityStillValid = input.revalidatePaidAuthority
      ? await input.revalidatePaidAuthority()
      : (await readActivePaidComputeAuthorization(input.client, {
          providerId: config.providerId, nodeId: config.nodeId, resourceClass: config.resourceClass,
          workItemId: input.workItemId, now: clock(),
        }))?.authorizationId === authorizationRef;
    if (!authorityStillValid) {
      await persist('health_lost', false, null);
      await persist('shutdown_requested', false, null);
      const tornDown = await teardownKnownNode(provisioner, handle, input.cleanupTimeoutMs ?? DEFAULT_NODE_TEARDOWN_TIMEOUT_MS);
      await persist(tornDown.ok ? 'shutdown_confirmed' : 'shutdown_failed', false, null);
      await settleReservation();
      inFlight.delete(config.nodeId);
      return { ok: false, reason: 'waiting_authorization', detail: 'authority_unavailable_before_runtime', providerRef, settledCost: settledThisAttempt };
    }
  }
  if (!await persist('health_confirmed', true, null)) {
    await persist('shutdown_requested', false, null);
    const tornDown = await teardownKnownNode(provisioner, handle, input.cleanupTimeoutMs ?? DEFAULT_NODE_TEARDOWN_TIMEOUT_MS);
    await persist(tornDown.ok ? 'shutdown_confirmed' : 'shutdown_failed', false, null);
    await settleReservation();
    inFlight.delete(config.nodeId);
    return { ok: false, reason: 'evidence_failed', detail: 'ready evidence failed', providerRef, settledCost: settledThisAttempt };
  }

  const node: CoderInferenceNodeV0 = {
    id: config.nodeId, endpoint: handle.endpoint, locality: 'remote', enabled: true, healthy: true,
    capabilities: ['coder_inference'], models: [config.model], resourceClass: config.resourceClass, billingMode: config.billingMode,
  };
  return {
    ok: true,
    runtime: remoteRuntimeFor(node, config.model),
    leaseExpiresAt: lease.leaseExpiresAt,
    providerRef: handle.providerRef,
    finish: async (attemptId) => {
      try {
        if (attemptId !== null) {
          await persist('reserved', true, attemptId);
          await persist('released', true, attemptId);
        }
        await persist('shutdown_requested', false, attemptId);
        const tornDown = await teardownKnownNode(provisioner, handle, input.cleanupTimeoutMs ?? DEFAULT_NODE_TEARDOWN_TIMEOUT_MS);
        await persist(tornDown.ok ? 'shutdown_confirmed' : 'shutdown_failed', false, attemptId);
        // SETTLEMENT FINAL do Pod saudável: converte a reserva no custo efetivo do ciclo inteiro
        // (provisão + coder/gates/Verifier/review) medido pelo relógio do host. Teardown ANTES.
        await settleReservation();
      } finally {
        await provisioner.disposeAll?.();
        inFlight.delete(config.nodeId);
      }
    },
  };
}

// ============================================================
// RESILIENT CLOUD SESSION V1 — ENTRADA CANÔNICA VIVA (composição, NÃO orquestrador paralelo).
//
// Liga `runResilientCloudSession` (loop puro) às PEÇAS VIVAS já existentes deste módulo. Uma
// autorização humana (capability-based) abre o ENVELOPE da sessão; dentro dele o Anima troca de
// máquina sozinho. NÃO cria authority; NÃO amplia autoridade; deriva o envelope da autoridade +
// decisão humana já existente.
//
//   selectNextCandidate = inventário read-only − placements excluídos → planCloudResourceProvisioning
//   attemptProvision    = prepareResidentOnDemandCoderNode FORÇANDO o candidato escolhido; em falha
//                         ele já LIQUIDA + faz teardown ANTES de retornar (settlement vivo)
//   readCommittedCost   = ledger committed da autoridade (reflete settlements)
//
// Correlação de sessão SEM sistema paralelo: cada tentativa usa leaseId `${cloudSessionId}-a<N>`,
// então toda a evidência de lifecycle da sessão compartilha o prefixo `cloudSessionId` e é
// reconstruível pelo log append-only existente.
// ============================================================

/** Duração de SESSÃO default quando não fornecida: generosa para algumas trocas de máquina + um
 * pipeline completo, SEMPRE limitada pela validade da autoridade. NÃO é dado contratual da
 * autoridade — é um watchdog operacional derivado (o teto duro é custo + validUntil). */
export const DEFAULT_CLOUD_SESSION_DURATION_MS = 90 * 60_000;

export interface ResilientCloudCoderSessionInput {
  readonly client: SupabaseClient<Database>;
  readonly config: ResidentOnDemandNodeConfig;
  readonly workItemId: string;
  readonly proposalVersion: number;
  readonly cloudSessionId: string;
  readonly signal: AbortSignal;
  readonly now?: () => Date;
  readonly maxSessionDurationMs?: number;
  readonly maxProvisionAttempts?: number;
  /** Tentativas na MESMA SKU antes de excluí-la (default 1). Ver CloudSessionEnvelopeV1. */
  readonly maxAttemptsPerPlacement?: number;
  readonly provisionerFactory?: () => NodeProvisioner & { disposeAll?: () => Promise<void> };
  readonly readResourceInventory?: () => Promise<RunPodInventoryResult>;
  readonly readLivePaidNodeCount?: () => Promise<LivePaidNodeCountResult>;
  readonly revalidatePaidAuthority?: () => Promise<boolean>;
  readonly reserveBudget?: typeof reservePaidComputeBudget;
  readonly voidBudget?: typeof voidPaidComputeBudgetReservation;
  readonly settleBudget?: typeof settlePaidComputeBudgetReservation;
  readonly evidenceSink?: NodeLifecycleEvidenceSink;
  readonly cleanupTimeoutMs?: number;
  /** Override de teste da leitura do committed do ledger. */
  readonly readCommittedCost?: () => Promise<RequirementMoneyV1 | null>;
}

export type ResilientCloudCoderSessionOutcome = ResilientCloudSessionOutcome<ReturnType<typeof remoteRuntimeFor>>;

export async function prepareResilientCloudCoderSession(
  input: ResilientCloudCoderSessionInput,
): Promise<ResilientCloudCoderSessionOutcome> {
  const clock = input.now ?? (() => new Date());
  const stop = (stopReason: CloudSessionStopReasonV1, detail: string): ResilientCloudCoderSessionOutcome =>
    ({ ok: false, cloudSessionId: input.cloudSessionId, stopReason, detail, attempts: 0, trace: [] });

  // Sessão resiliente exige node PAGO com autoridade (troca de máquina dentro do envelope humano).
  if (input.config.billingMode !== 'paid') return stop('terminal_failure', 'resilient cloud session requires paid billing mode');
  const authorization = await readActivePaidComputeAuthorization(input.client, {
    providerId: input.config.providerId, nodeId: input.config.nodeId, resourceClass: input.config.resourceClass,
    workItemId: input.workItemId, now: clock(),
  });
  if (authorization === null) return stop('terminal_failure', 'no active paid authority for cloud session');
  const ceiling = authorization.maxCostEstimate;
  if (ceiling === null) return stop('terminal_failure', 'authority has no aggregate cost ceiling');

  // ENVELOPE derivado da autoridade + decisão humana: teto=maxCostEstimate; janela=min(default,
  // validUntil-now); 1 node. maxSessionDurationMs é operacional (watchdog), não contratual.
  const windowMs = Math.max(0, Date.parse(authorization.validUntil) - clock().getTime());
  const sessionDurationMs = Math.min(input.maxSessionDurationMs ?? DEFAULT_CLOUD_SESSION_DURATION_MS, windowMs);
  const envelope = deriveCloudSessionEnvelope({
    cloudSessionId: input.cloudSessionId,
    maxTotalCost: ceiling,
    maxSessionDurationMs: sessionDurationMs,
    ...(input.maxProvisionAttempts ? { maxProvisionAttempts: input.maxProvisionAttempts } : {}),
    ...(input.maxAttemptsPerPlacement ? { maxAttemptsPerPlacement: input.maxAttemptsPerPlacement } : {}),
  });
  if (envelope === null) return stop('session_deadline_reached', 'authority validity window already elapsed');

  const requirements = deriveQwen3CoderCloudRequirements({
    model: input.config.model,
    maxHourlyPrice: authorization.capabilityScope?.maxHourlyPrice ?? null,
    maxEstimatedCost: ceiling,
    maxNodes: Math.min(authorization.capabilityScope?.maxNodes ?? 1, input.config.maxConcurrentPaidNodes ?? authorization.capabilityScope?.maxNodes ?? 1),
    providerConstraints: { allowedProviderIds: [input.config.providerId], cloudType: null },
  });

  const readInventory = input.readResourceInventory ?? ((): Promise<RunPodInventoryResult> => {
    const runpod = readRunPodProvisionerConfig();
    if (runpod === null) return Promise.resolve({ ok: false as const, reason: 'inventory_invalid' as const });
    return readRunPodResourceInventory({
      graphqlBase: process.env.ANIMA_RUNPOD_GRAPHQL_BASE?.trim() || 'https://api.runpod.io/graphql',
      apiKey: runpod.apiKey, gpuTypeIds: runpod.gpuTypeIds, gpuCount: runpod.gpuCount, cloudType: runpod.cloudType,
    }, input.signal);
  });

  let attemptCounter = 0;
  const ports: ResilientCloudSessionPorts<ReturnType<typeof remoteRuntimeFor>> = {
    now: () => clock().getTime(),
    readCommittedCost: input.readCommittedCost ?? (async (): Promise<RequirementMoneyV1 | null> => {
      const audit = await readPaidComputeBudgetAudit(input.client, authorization.authorizationId);
      // Fail-closed: leitura indisponível ⇒ assume o teto inteiro committed (nega novo provision).
      if (!audit.ok) return { currency: ceiling.currency, amount: ceiling.amount };
      const budget = audit.budget;
      return { currency: ceiling.currency, amount: budget ? budget.committed : 0 };
    }),
    selectNextCandidate: async (excluded) => {
      const raw = await readInventory();
      const filtered: RunPodInventoryResult = raw.ok
        ? { ok: true, candidates: raw.candidates.filter(c => !excluded.has(`${c.providerId}:${c.gpuTypeId}`)) }
        : raw;
      const plan = await planCloudResourceProvisioning({
        requirements, authorization, leaseDurationMs: input.config.maxActiveDurationMs, readInventory: async () => filtered,
      });
      if (!plan.ok) return { ok: false, blocker: plan.blocker, detail: plan.detail };
      const c = plan.chosen.candidate;
      return { ok: true, placementId: `${c.providerId}:${c.gpuTypeId}`, estimatedCost: { currency: plan.chosen.estimatedCost.currency, amount: plan.chosen.estimatedCost.amount } };
    },
    attemptProvision: async (candidate, signal) => {
      attemptCounter += 1;
      // Força a provisão EXATAMENTE no candidato escolhido pela sessão: filtra o inventário a esse
      // único placement, e o matcher determinístico de prepare o escolhe. Assim seleção e provisão
      // concordam sem re-derivar. leaseId carrega o cloudSessionId (correlação de sessão).
      const only = async (): Promise<RunPodInventoryResult> => {
        const raw = await readInventory();
        return raw.ok ? { ok: true, candidates: raw.candidates.filter(c => `${c.providerId}:${c.gpuTypeId}` === candidate.placementId) } : raw;
      };
      const prep = await prepareResidentOnDemandCoderNode({
        client: input.client, config: input.config, workItemId: input.workItemId,
        proposalVersion: input.proposalVersion, leaseId: `${input.cloudSessionId}-a${attemptCounter}`,
        signal, now: input.now, evidenceSink: input.evidenceSink, provisionerFactory: input.provisionerFactory,
        readResourceInventory: only, readLivePaidNodeCount: input.readLivePaidNodeCount,
        revalidatePaidAuthority: input.revalidatePaidAuthority, reserveBudget: input.reserveBudget,
        voidBudget: input.voidBudget, settleBudget: input.settleBudget, cleanupTimeoutMs: input.cleanupTimeoutMs,
      });
      if (prep.ok) return { ok: true, runtime: prep.runtime, providerRef: prep.providerRef, leaseExpiresAt: prep.leaseExpiresAt, finish: prep.finish };
      // Superfície o motivo do PROVISIONER (em `detail` quando prepare o encapsulou em provision_failed)
      // para que a sessão classifique corretamente (endpoint_unpublished, capacity_unavailable, ...).
      const reason = prep.reason === 'provision_failed' || prep.reason === 'aggregate_budget_denied'
        ? (prep.detail || prep.reason)
        : prep.reason === 'health_failed' ? 'health_failed'
        : prep.reason === 'provider_identity_unpersisted' ? 'provider_identity_unpersisted'
        : prep.reason;
      return { ok: false, reason, providerRef: prep.providerRef ?? null, settledCost: prep.settledCost ?? null };
    },
  };

  return runResilientCloudSession({ envelope, ports, signal: input.signal });
}

/** Feature gate da sessão resiliente no caminho VIVO. OFF por default (invisível): o host-turn segue
 * o caminho de tentativa única. ON só liga a troca autônoma de máquina para RunPod PAGO. Padrão dos
 * gates do repo (Compute Router V1 OFF invisível). */
export function resilientCloudSessionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ANIMA_RESILIENT_CLOUD_SESSION?.trim().toLowerCase() === 'true';
}

function positiveIntegerEnv(name: string, env: Record<string, string | undefined> = process.env): number | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Mapeia a razão de PARADA da sessão resiliente para a razão de preparação equivalente, para que o
 * consumidor derive a MESMA refusal já existente. PURA. */
export function resilientStopToPreparationReason(stopReason: CloudSessionStopReasonV1): ResidentNodePreparationFailure['reason'] {
  switch (stopReason) {
    case 'session_budget_exhausted':
    case 'cost_estimate_unavailable':
    case 'currency_mismatch':
      return 'aggregate_budget_denied';
    case 'no_more_candidates':
      return 'no_compatible_cloud_resource';
    case 'provider_unavailable':
    case 'session_deadline_reached':
    case 'attempt_limit_reached':
    case 'terminal_failure':
      return 'provision_failed';
  }
}

/**
 * ENTRADA CANÔNICA do host-turn para adquirir um coder node cloud. Roteia — env-gated — o RunPod
 * PAGO pela SESSÃO RESILIENTE (troca de máquina + settlement dentro do envelope) e mantém o caminho
 * de TENTATIVA ÚNICA para todo o resto (owned/local, SKU-fixa, ou gate desligado). Devolve SEMPRE a
 * mesma forma `ResidentNodePreparation`, então o consumidor não muda. A próxima prova, com o gate
 * ligado, NÃO bypassa a sessão resiliente.
 */
export async function prepareCloudCoderNode(
  input: Parameters<typeof prepareResidentOnDemandCoderNode>[0] & { readonly cloudSessionId?: string },
): Promise<ResidentNodePreparation> {
  if (input.config.providerId === 'runpod' && input.config.billingMode === 'paid' && resilientCloudSessionEnabled()) {
    const maxProvisionAttempts = positiveIntegerEnv('ANIMA_RESILIENT_CLOUD_MAX_PROVISION_ATTEMPTS');
    const maxAttemptsPerPlacement = positiveIntegerEnv('ANIMA_RESILIENT_CLOUD_MAX_ATTEMPTS_PER_PLACEMENT');
    const outcome = await prepareResilientCloudCoderSession({
      client: input.client, config: input.config, workItemId: input.workItemId,
      proposalVersion: input.proposalVersion, cloudSessionId: input.cloudSessionId ?? input.leaseId,
      signal: input.signal, ...(input.now ? { now: input.now } : {}),
      ...(maxProvisionAttempts !== undefined ? { maxProvisionAttempts } : {}),
      ...(maxAttemptsPerPlacement !== undefined ? { maxAttemptsPerPlacement } : {}),
      ...(input.readLivePaidNodeCount ? { readLivePaidNodeCount: input.readLivePaidNodeCount } : {}),
      ...(input.provisionerFactory ? { provisionerFactory: input.provisionerFactory } : {}),
      ...(input.readResourceInventory ? { readResourceInventory: input.readResourceInventory } : {}),
      ...(input.revalidatePaidAuthority ? { revalidatePaidAuthority: input.revalidatePaidAuthority } : {}),
      ...(input.reserveBudget ? { reserveBudget: input.reserveBudget } : {}),
      ...(input.voidBudget ? { voidBudget: input.voidBudget } : {}),
      ...(input.settleBudget ? { settleBudget: input.settleBudget } : {}),
      ...(input.evidenceSink ? { evidenceSink: input.evidenceSink } : {}),
      ...(input.cleanupTimeoutMs !== undefined ? { cleanupTimeoutMs: input.cleanupTimeoutMs } : {}),
    });
    if (outcome.ok) {
      return {
        ok: true, runtime: outcome.runtime, providerRef: outcome.providerRef ?? '',
        leaseExpiresAt: outcome.leaseExpiresAt ?? new Date((input.now?.() ?? new Date()).getTime() + input.config.maxActiveDurationMs).toISOString(),
        finish: outcome.finish,
      };
    }
    // "Sem autoridade / sem teto" continua indicando a fronteira humana (paid_compute_authorization).
    const reason: ResidentNodePreparationFailure['reason'] = /authority|ceiling/i.test(outcome.detail)
      ? 'waiting_authorization' : resilientStopToPreparationReason(outcome.stopReason);
    return { ok: false, reason, detail: `[cloud_session:${outcome.stopReason}] ${outcome.detail}` };
  }
  return prepareResidentOnDemandCoderNode(input);
}
