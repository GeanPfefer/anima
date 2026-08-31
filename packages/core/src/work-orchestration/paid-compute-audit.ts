// ============================================================
// AUDITORIA de compute (Milestone J — observabilidade/evidência) — PURA.
//
// Projeta, do log append-only de evidência de lifecycle, um registro por lease que responde as
// perguntas do humano: quem autorizou, qual node/provider/providerRef, quando começou, quando
// ficou pronto, quando o shutdown foi solicitado/observado, o estado final, se falhou, o custo
// estimado, o desfecho e se houve RISCO DE ÓRFÃO. Não persiste, não chama provider, não decide
// efeito — só LÊ o que a Goma observou. EVIDÊNCIA ≠ DECISÃO ≠ EFEITO.
// ============================================================

import { isNodeLifecycleFailure, isNodeLive, type NodeLifecycleState } from './node-lifecycle';
import {
  projectNodeLifecycleEvidence,
  type NodeLifecycleEvidenceEventLike,
  type NodeLifecycleEvidenceV1,
} from './node-lifecycle-evidence';
import type { NodeBillingMode } from './paid-compute-authorization';

export type PaidComputeOutcome = 'active' | 'teardown_pending' | 'terminated' | 'failed';

export interface PaidComputeAuditRecord {
  readonly nodeId: string;
  readonly providerId: string;
  readonly leaseId: string;
  readonly providerRef: string | null;
  readonly workItemId: string;
  readonly attemptId: string | null;
  readonly billingMode: NodeBillingMode;
  readonly authorizationRef: string | null;
  /** Primeiro fato observado (início). */
  readonly startedAt: string | null;
  /** Primeiro `health_confirmed` (pronto). */
  readonly readyAt: string | null;
  readonly shutdownRequestedAt: string | null;
  /** `shutdown_confirmed` → `offline` (desligamento observado). */
  readonly offlineAt: string | null;
  readonly lastState: NodeLifecycleState;
  readonly failed: boolean;
  readonly estimatedCost: { readonly currency: string; readonly amount: number } | null;
  readonly outcome: PaidComputeOutcome;
  /** Recurso PAGO ainda vivo (não-`offline`) = pode estar faturando esquecido. */
  readonly orphanRisk: boolean;
  readonly transitions: number;
}

const key = (e: { workItemId: string; nodeId: string; leaseId: string }): string =>
  `${e.workItemId} ${e.nodeId} ${e.leaseId}`;

const outcomeOf = (state: NodeLifecycleState): PaidComputeOutcome => {
  if (state === 'offline') return 'terminated';
  if (state === 'shutting_down') return 'teardown_pending';
  if (isNodeLifecycleFailure(state)) return 'failed';
  return 'active';
};

interface Acc {
  first: NodeLifecycleEvidenceV1;
  last: NodeLifecycleEvidenceV1;
  providerRef: string | null;
  readyAt: string | null;
  shutdownRequestedAt: string | null;
  offlineAt: string | null;
  failed: boolean;
  count: number;
}

/**
 * Projeta um registro de auditoria por (item, node, lease) na ordem do log. `estimatedCost` e
 * `lastState` vêm da última transição; `providerRef` é o último não-nulo; marcos temporais são o
 * PRIMEIRO evento de cada tipo. Inclui owned e paid (o consumidor filtra); `orphanRisk` só é
 * verdadeiro para `paid` ainda vivo.
 */
export function projectPaidComputeAudit(
  events: readonly NodeLifecycleEvidenceEventLike[],
): readonly PaidComputeAuditRecord[] {
  const acc = new Map<string, Acc>();
  for (const e of projectNodeLifecycleEvidence(events)) {
    const k = key(e);
    const prev = acc.get(k);
    const event = e.transition.event;
    acc.set(k, {
      first: prev?.first ?? e,
      last: e,
      providerRef: e.providerRef ?? prev?.providerRef ?? null,
      readyAt: prev?.readyAt ?? (event === 'health_confirmed' ? e.observedAt : null),
      shutdownRequestedAt: prev?.shutdownRequestedAt ?? (event === 'shutdown_requested' ? e.observedAt : null),
      offlineAt: prev?.offlineAt ?? (event === 'shutdown_confirmed' && e.transition.to === 'offline' ? e.observedAt : null),
      failed: (prev?.failed ?? false) || isNodeLifecycleFailure(e.transition.to),
      count: (prev?.count ?? 0) + 1,
    });
  }
  const out: PaidComputeAuditRecord[] = [];
  for (const a of acc.values()) {
    const last = a.last;
    const lastState = last.transition.to;
    out.push({
      nodeId: last.nodeId, providerId: last.providerId, leaseId: last.leaseId, providerRef: a.providerRef,
      workItemId: last.workItemId, attemptId: last.attemptId, billingMode: last.billingMode,
      authorizationRef: last.authorizationRef,
      startedAt: a.first.observedAt, readyAt: a.readyAt,
      shutdownRequestedAt: a.shutdownRequestedAt, offlineAt: a.offlineAt,
      lastState, failed: a.failed, estimatedCost: last.estimatedCost,
      outcome: outcomeOf(lastState),
      orphanRisk: last.billingMode === 'paid' && isNodeLive(lastState),
      transitions: a.count,
    });
  }
  return out;
}
