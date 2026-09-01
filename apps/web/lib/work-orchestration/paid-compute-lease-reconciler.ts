import {
  buildNodeLifecycleEvidence,
  decidePaidLeaseReconciliation,
  type LeaseReconciliationSummary,
  type NodeLifecycleEvidenceV1,
  type NodeLifecycleState,
  type NodeProvisioner,
  type ObservedResourceStatus,
  type PaidLeaseReconcileAction,
  type ProvisionedNodeHandle,
} from '@anima/core';
import { DEFAULT_NODE_TEARDOWN_TIMEOUT_MS, teardownKnownNode } from './bounded-node-teardown';

// ============================================================
// RECONCILER de leases pagas (orquestração web) — o SEGURO contra recurso pago esquecido.
//
// Roda na fase de RECONCILE do Resident Host (arranque + pós-wake, ANTES da volta) — quando
// NENHUMA volta está ativa, de modo que toda lease paga ainda viva é um ÓRFÃO (o processo que
// a provisionou morreu). Para cada órfão: LOCALIZA o recurso pelo nodeId (via a porta,
// reset-safe, sem estado volátil), DECIDE (core puro) e APLICA teardown pela MESMA porta
// `NodeProvisioner`, persistindo evidência append-only. Bounded e idempotente:
//   - stop/destroy repetidos são seguros (404 = convergência);
//   - a evidência de teardown deduplica na RPC (índice semântico);
//   - indisponibilidade temporária do provider vira `retry_later`, NUNCA abandono.
// EVIDÊNCIA ≠ DECISÃO ≠ EFEITO. O adapter não decide nada; a autoridade não é ampliada aqui.
// ============================================================

/** Uma lease reconciliável + o proposal_version do item (necessário p/ persistir evidência). */
export interface ReconcilerLease extends LeaseReconciliationSummary {
  readonly proposalVersion: number;
}

export type ReconcilerLeaseReadResult =
  | { readonly ok: true; readonly leases: readonly ReconcilerLease[] }
  | { readonly ok: false; readonly reason: 'paid_lease_observation_unavailable' };

export interface PaidComputeLeaseReconcilerDeps {
  /** Resolve o provisioner concreto para um providerId (ou `null` se indisponível/não configurado). */
  readonly resolveProvisioner: (providerId: string) => NodeProvisioner | null;
  /** Lê as leases pagas ainda vivas do log durável (via `projectReconcilableLeases` + versão). */
  readonly readLeases: () => Promise<ReconcilerLeaseReadResult>;
  /** A autoridade ainda vale? (agora < validUntil e não revogada). `null`/ausente → false. */
  readonly readAuthorityValid: (authorizationRef: string | null, now: Date) => Promise<boolean>;
  /** Persiste UMA evidência de lifecycle (append-only; idempotente na RPC). */
  readonly recordEvidence: (evidence: NodeLifecycleEvidenceV1, proposalVersion: number) => Promise<{ readonly ok: boolean }>;
  readonly now?: () => Date;
  readonly signal?: AbortSignal;
  /** Teto de leases reconciliadas por ciclo (bounded). Default 25. */
  readonly maxReconcile?: number;
  readonly cleanupTimeoutMs?: number;
}

export type LeaseReconcileOutcome =
  | 'awaited'            // dentro da autoridade, deixado (bounded pela autoridade)
  | 'torn_down'          // órfão parado/destruído e confirmado offline
  | 'confirmed_offline'  // já estava ausente; convergência registrada
  | 'retry_later'        // provider inalcançável; será re-tentado no próximo ciclo
  | 'reconciler_unavailable' // sem provisioner/locate p/ este provider
  | 'teardown_failed';   // stop/destroy falhou; permanece candidato (não fabricamos sucesso)

export interface LeaseReconcileResult {
  readonly nodeId: string;
  readonly providerId: string;
  readonly leaseId: string;
  readonly decision: PaidLeaseReconcileAction;
  readonly outcome: LeaseReconcileOutcome;
  readonly detail?: string;
}

export interface LeaseReconciliationReport {
  readonly results: readonly LeaseReconcileResult[];
  readonly tornDown: number;
  readonly retriable: number;
  readonly leftAwaiting: number;
  readonly observation: 'observed' | 'unavailable';
}

const observedFromLocate = (
  outcome: Awaited<ReturnType<NonNullable<NodeProvisioner['locate']>>>,
): { status: ObservedResourceStatus; handle: ProvisionedNodeHandle | null } => {
  if (!outcome.ok) return { status: 'unreachable', handle: null };
  if (!outcome.found) return { status: 'absent', handle: null };
  return { status: 'running', handle: outcome.handle };
};

export async function reconcilePaidComputeLeases(deps: PaidComputeLeaseReconcilerDeps): Promise<LeaseReconciliationReport> {
  const now = deps.now ?? (() => new Date());
  const signal = deps.signal ?? new AbortController().signal;
  const max = deps.maxReconcile ?? 25;
  const observed = await deps.readLeases();
  if (!observed.ok) {
    return { results: [], tornDown: 0, retriable: 0, leftAwaiting: 0, observation: 'unavailable' };
  }
  const leases = observed.leases.slice(0, max);
  const results: LeaseReconcileResult[] = [];

  for (const lease of leases) {
    if (signal.aborted) break;
    const provisioner = deps.resolveProvisioner(lease.providerId);
    if (!provisioner || !provisioner.locate) {
      results.push({ ...ids(lease), decision: 'retry_later', outcome: 'reconciler_unavailable', detail: `sem provisioner locate p/ ${lease.providerId}` });
      continue;
    }

    const located = await provisioner.locate(lease.nodeId, signal);
    const { status, handle } = observedFromLocate(located);
    const authorityStillValid = await deps.readAuthorityValid(lease.authorizationRef, now());
    const decision = decidePaidLeaseReconciliation({
      latestState: lease.latestState, observed: status, authorityStillValid, deadlinePassed: false,
    });

    if (decision === 'none' || decision === 'await') {
      results.push({ ...ids(lease), decision, outcome: 'awaited' });
      continue;
    }
    if (decision === 'retry_later') {
      results.push({ ...ids(lease), decision, outcome: 'retry_later', detail: located.ok ? undefined : located.reason });
      continue;
    }
    if (decision === 'confirm_offline') {
      // Defesa em profundidade: com providerRef persistido, um stop/destroy DIRETO por id encerra
      // um recurso que a busca por nome possa ter perdido (404 = já foi ⇒ `stop` devolve ok). Mas
      // se ESSE teardown por id FALHAR (não-404: 5xx/rede), NÃO podemos afirmar offline — mantemos
      // reconciliável em vez de FABRICAR convergência sobre um recurso possivelmente vivo/faturando.
      if (lease.providerRef) {
        const byRef: ProvisionedNodeHandle = { nodeId: lease.nodeId, providerId: lease.providerId, providerRef: lease.providerRef, endpoint: '' };
        const tornDown = await teardownKnownNode(provisioner, byRef, deps.cleanupTimeoutMs ?? DEFAULT_NODE_TEARDOWN_TIMEOUT_MS);
        if (!tornDown.ok) {
          results.push({ ...ids(lease), decision, outcome: 'teardown_failed', detail: `by_ref_${tornDown.stage}:${tornDown.reason}` });
          continue;
        }
      }
      const ok = await recordTeardown(deps, lease, ['shutdown_requested', 'shutdown_confirmed'], now());
      results.push({ ...ids(lease), decision, outcome: ok ? 'confirmed_offline' : 'teardown_failed' });
      continue;
    }
    // decision === 'stop': órfão de pé — parar o gasto e destruir, depois confirmar offline.
    if (!handle) { // segurança: 'stop' sem handle não deveria ocorrer (running ⇒ handle)
      results.push({ ...ids(lease), decision, outcome: 'retry_later', detail: 'stop sem handle localizado' });
      continue;
    }
    if (!await recordTeardown(deps, lease, ['shutdown_requested'], now())) {
      results.push({ ...ids(lease), decision, outcome: 'teardown_failed', detail: 'shutdown_requested não persistiu' });
      continue;
    }
    const tornDown = await teardownKnownNode(provisioner, handle, deps.cleanupTimeoutMs ?? DEFAULT_NODE_TEARDOWN_TIMEOUT_MS);
    if (!tornDown.ok) {
      results.push({ ...ids(lease), decision, outcome: 'teardown_failed', detail: `${tornDown.stage}: ${tornDown.reason}` });
      continue;
    }
    const confirmed = await recordTeardown(deps, lease, ['shutdown_confirmed'], now());
    results.push({ ...ids(lease), decision, outcome: confirmed ? 'torn_down' : 'teardown_failed' });
  }

  return {
    results,
    tornDown: results.filter(r => r.outcome === 'torn_down').length,
    retriable: results.filter(r => r.outcome === 'retry_later' || r.outcome === 'reconciler_unavailable' || r.outcome === 'teardown_failed').length,
    leftAwaiting: results.filter(r => r.outcome === 'awaited').length,
    observation: 'observed',
  };
}

const ids = (l: ReconcilerLease) => ({ nodeId: l.nodeId, providerId: l.providerId, leaseId: l.leaseId });

// Estado alvo por evento de teardown do reconciler (append-only; a RPC deduplica).
const TEARDOWN_TO: Record<'shutdown_requested' | 'shutdown_confirmed', NodeLifecycleState> = {
  shutdown_requested: 'shutting_down', shutdown_confirmed: 'offline',
};

async function recordTeardown(
  deps: PaidComputeLeaseReconcilerDeps,
  lease: ReconcilerLease,
  events: ReadonlyArray<'shutdown_requested' | 'shutdown_confirmed'>,
  now: Date,
): Promise<boolean> {
  let from: NodeLifecycleState = lease.latestState;
  for (const event of events) {
    const to = TEARDOWN_TO[event];
    const built = buildNodeLifecycleEvidence({
      nodeId: lease.nodeId, providerId: lease.providerId, leaseId: lease.leaseId, providerRef: lease.providerRef,
      workItemId: lease.workItemId, attemptId: lease.attemptId, billingMode: lease.billingMode,
      transition: { from, to, event }, healthy: false, activeDurationMs: 0,
      authorizationRef: lease.authorizationRef, observedAt: now.toISOString(),
    });
    if (!built.ok) return false;
    const saved = await deps.recordEvidence(built.value, lease.proposalVersion);
    if (!saved.ok) return false;
    from = to;
  }
  return true;
}
