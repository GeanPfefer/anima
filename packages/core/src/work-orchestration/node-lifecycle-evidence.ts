// ============================================================
// PROVISIONAMENTO ON-DEMAND V1 — EVIDÊNCIA do ciclo de vida OBSERVADA PELO HOST (V1).
//
// A Goma observa e persiste os fatos do ciclo de vida de um node — NUNCA deixando o próprio
// node remoto ser a única fonte da própria saúde/custo (visão §12). Mesmo eixo da evidência
// do coder/gate observada pelo host: quem cronometra e registra é a Goma, ao redor das
// operações do provisioner (provision/inspect/stop).
//
// Cada evidência é uma transição do ciclo de vida com: node/provider, from→to+event, health,
// duração ativa observada, modo de cobrança, referência de autorização (quando pago), custo
// estimado (quando há price hint) e a correlação de trabalho/tentativa. Fail-closed na
// construção; recomputável do log (autor `system`/origem `host`).
// ============================================================

import { containsSensitiveData } from './execution-attempt';
import type { NodeLifecycleEvent, NodeLifecycleState } from './node-lifecycle';
import type { NodeBillingMode } from './paid-compute-authorization';
import type { WorkItemId } from './types';
import type { Json } from '@anima/types';

const MAX_ID = 200;

const BILLING_MODES: ReadonlySet<NodeBillingMode> = new Set<NodeBillingMode>(['owned', 'already_provisioned', 'paid']);
const LIFECYCLE_STATES: ReadonlySet<NodeLifecycleState> = new Set<NodeLifecycleState>([
  'offline', 'provisioning', 'ready', 'busy', 'idle', 'shutting_down', 'provision_failed', 'health_failed', 'shutdown_failed',
]);
const LIFECYCLE_EVENTS: ReadonlySet<NodeLifecycleEvent> = new Set<NodeLifecycleEvent>([
  'provision_requested', 'provider_identified', 'health_confirmed', 'provision_failed', 'health_lost', 'reserved', 'released',
  'shutdown_requested', 'shutdown_confirmed', 'shutdown_failed',
]);

export interface NodeLifecycleEvidenceV1 {
  readonly schemaVersion: 1;
  readonly nodeId: string;
  readonly providerId: string;
  readonly leaseId: string;
  /** Referência OPACA do recurso no provider (pod/instância/pid) quando já conhecida — permite
   * recovery/teardown do órfão exato após restart. `null` antes de o recurso existir (ex.:
   * `provision_requested`). NUNCA credencial. */
  readonly providerRef: string | null;
  readonly workItemId: WorkItemId;
  /** Tentativa quando já existe; provisão pode começar antes de `execution_started`. */
  readonly attemptId: string | null;
  readonly billingMode: NodeBillingMode;
  readonly transition: { readonly from: NodeLifecycleState; readonly to: NodeLifecycleState; readonly event: NodeLifecycleEvent };
  readonly healthy: boolean;
  /** Duração ATIVA observada pelo host até esta transição (ms, inteiro não-negativo). */
  readonly activeDurationMs: number;
  /** Referência à autorização humana, quando `paid`; `null` caso contrário. */
  readonly authorizationRef: string | null;
  /** Custo estimado observado, quando há price hint; `null` quando desconhecido. */
  readonly estimatedCost: { readonly currency: string; readonly amount: number } | null;
  readonly observedAt: string;
}

export interface BuildNodeLifecycleEvidenceInput {
  readonly nodeId: string;
  readonly providerId: string;
  readonly leaseId: string;
  readonly providerRef?: string | null;
  readonly workItemId: WorkItemId;
  readonly attemptId?: string | null;
  readonly billingMode: NodeBillingMode;
  readonly transition: { readonly from: NodeLifecycleState; readonly to: NodeLifecycleState; readonly event: NodeLifecycleEvent };
  readonly healthy: boolean;
  readonly activeDurationMs: number;
  readonly authorizationRef?: string | null;
  readonly estimatedCost?: { readonly currency: string; readonly amount: number } | null;
  readonly observedAt: string;
}

export type NodeLifecycleEvidenceDefect =
  | 'invalid_identity'
  | 'invalid_correlation'
  | 'invalid_billing'
  | 'invalid_transition'
  | 'invalid_duration'
  | 'invalid_authorization'
  | 'invalid_cost'
  | 'invalid_timestamp'
  | 'payload_too_large'
  | 'sensitive_data';

export type NodeLifecycleEvidenceResult =
  | { readonly ok: true; readonly value: NodeLifecycleEvidenceV1 }
  | { readonly ok: false; readonly defect: NodeLifecycleEvidenceDefect; readonly explanation: string };

const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const nonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

const fail = (defect: NodeLifecycleEvidenceDefect, explanation: string): NodeLifecycleEvidenceResult => ({ ok: false, defect, explanation });

const isCost = (v: unknown): v is { currency: string; amount: number } => {
  const o = v as { currency?: unknown; amount?: unknown } | null;
  return !!o && typeof o === 'object' && nonBlank((o as { currency?: unknown }).currency)
    && typeof (o as { amount?: unknown }).amount === 'number' && Number.isFinite((o as { amount: number }).amount) && (o as { amount: number }).amount >= 0;
};

/**
 * Constrói e valida a evidência do ciclo de vida — fail-closed. Uma transição precisa ser
 * COERENTE com o vocabulário do ciclo de vida (estados/evento no conjunto), a duração ativa
 * um inteiro não-negativo, e nenhum id pode carregar credencial/caminho absoluto. Node `paid`
 * SEM `authorizationRef` é malformado (não há evidência de gasto sem referência de autorização).
 */
export function buildNodeLifecycleEvidence(input: BuildNodeLifecycleEvidenceInput): NodeLifecycleEvidenceResult {
  if (!nonBlank(input.nodeId) || !nonBlank(input.providerId) || !nonBlank(input.leaseId)) return fail('invalid_identity', 'A evidência exige nodeId, providerId e leaseId.');
  if (input.nodeId.length > MAX_ID || input.providerId.length > MAX_ID || input.leaseId.length > MAX_ID) return fail('payload_too_large', 'Identidade excede o tamanho permitido.');
  const providerRef = input.providerRef ?? null;
  if (providerRef !== null && !nonBlank(providerRef)) return fail('invalid_identity', 'providerRef precisa ser string não-vazia ou null.');
  if (providerRef !== null && providerRef.length > MAX_ID) return fail('payload_too_large', 'providerRef excede o tamanho permitido.');
  if (!nonBlank(input.workItemId) || (input.attemptId !== null && input.attemptId !== undefined && !nonBlank(input.attemptId))) {
    return fail('invalid_correlation', 'A evidência exige item e tentativa válida quando disponível.');
  }
  if (!BILLING_MODES.has(input.billingMode)) return fail('invalid_billing', 'Modo de cobrança inválido.');
  const { from, to, event } = input.transition;
  if (!LIFECYCLE_STATES.has(from) || !LIFECYCLE_STATES.has(to) || !LIFECYCLE_EVENTS.has(event)) {
    return fail('invalid_transition', 'A transição precisa usar estados/evento do ciclo de vida.');
  }
  if (typeof input.healthy !== 'boolean') return fail('invalid_transition', 'healthy precisa ser booleano.');
  if (!nonNegInt(input.activeDurationMs)) return fail('invalid_duration', 'A duração ativa precisa ser um inteiro de ms não-negativo.');

  const authorizationRef = input.authorizationRef ?? null;
  if (authorizationRef !== null && !nonBlank(authorizationRef)) return fail('invalid_authorization', 'authorizationRef precisa ser string não-vazia ou null.');
  if (input.billingMode === 'paid' && !nonBlank(authorizationRef)) return fail('invalid_authorization', 'Node pago exige authorizationRef na evidência.');

  const estimatedCost = input.estimatedCost ?? null;
  if (estimatedCost !== null && !isCost(estimatedCost)) return fail('invalid_cost', 'estimatedCost precisa ser {currency, amount>=0} ou null.');

  if (!nonBlank(input.observedAt) || Number.isNaN(Date.parse(input.observedAt))) return fail('invalid_timestamp', 'observedAt precisa ser ISO-8601 válido.');
  if (containsSensitiveData(input.nodeId) || containsSensitiveData(input.providerId)
    || (authorizationRef !== null && containsSensitiveData(authorizationRef))
    || (providerRef !== null && containsSensitiveData(providerRef))) {
    return fail('sensitive_data', 'A evidência não pode carregar credenciais nem caminhos absolutos.');
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      nodeId: input.nodeId,
      providerId: input.providerId,
      leaseId: input.leaseId,
      providerRef,
      workItemId: input.workItemId,
      attemptId: input.attemptId ?? null,
      billingMode: input.billingMode,
      transition: { from, to, event },
      healthy: input.healthy,
      activeDurationMs: input.activeDurationMs,
      authorizationRef,
      estimatedCost,
      observedAt: input.observedAt,
    },
  };
}

const object = (value: Json | undefined): Record<string, Json | undefined> | null =>
  value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object' ? value : null;

/** Reconstrói a evidência do JSON persistido reusando o construtor (uma só régua). `null`
 * quando malformada. */
export function parseNodeLifecycleEvidence(value: Json | undefined): NodeLifecycleEvidenceV1 | null {
  const root = object(value);
  if (!root || root.schemaVersion !== 1) return null;
  const transition = object(root.transition);
  if (!transition) return null;
  const built = buildNodeLifecycleEvidence({
    nodeId: root.nodeId as string,
    providerId: root.providerId as string,
    leaseId: root.leaseId as string,
    providerRef: (root.providerRef as string | null | undefined) ?? null,
    workItemId: root.workItemId as WorkItemId,
    attemptId: (root.attemptId as string | null | undefined) ?? null,
    billingMode: root.billingMode as NodeBillingMode,
    transition: { from: transition.from as NodeLifecycleState, to: transition.to as NodeLifecycleState, event: transition.event as NodeLifecycleEvent },
    healthy: root.healthy as boolean,
    activeDurationMs: root.activeDurationMs as number,
    authorizationRef: (root.authorizationRef as string | null | undefined) ?? null,
    estimatedCost: (root.estimatedCost as { currency: string; amount: number } | null | undefined) ?? null,
    observedAt: root.observedAt as string,
  });
  return built.ok ? built.value : null;
}

/** Forma mínima que a projeção precisa de um evento. `WorkEvent[]` a satisfaz. O tipo de
 * evento fica como `string` de propósito: a persistência (novo `work_event_type` +
 * RPC/migration) é o próximo recorte; até lá a projeção não depende do enum. */
export interface NodeLifecycleEvidenceEventLike {
  readonly type: string;
  readonly payload: Json;
}

/** Nome canônico do evento append-only que carregará esta evidência quando a persistência
 * existir (próximo recorte: `work_event_type` + RPC host-observed). */
export const NODE_LIFECYCLE_EVIDENCE_EVENT_TYPE = 'host_observed_node_lifecycle_recorded' as const;

/**
 * Projeta todas as evidências de ciclo de vida do log de eventos (autor `system`/origem
 * `host`), cruzando a correlação declarada contra o envelope do evento. Ordem do log.
 */
export function projectNodeLifecycleEvidence(events: readonly NodeLifecycleEvidenceEventLike[]): readonly NodeLifecycleEvidenceV1[] {
  const projected: NodeLifecycleEvidenceV1[] = [];
  for (const event of events) {
    if (event.type !== NODE_LIFECYCLE_EVIDENCE_EVENT_TYPE) continue;
    const data = object(object(event.payload)?.data);
    const evidence = parseNodeLifecycleEvidence(data?.evidence);
    if (!evidence) continue;
    if (data?.work_item_id !== evidence.workItemId || (data?.attempt_id ?? null) !== evidence.attemptId) continue;
    projected.push(evidence);
  }
  return projected;
}
