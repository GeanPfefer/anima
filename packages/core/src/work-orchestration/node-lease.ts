// ============================================================
// PROVISIONAMENTO ON-DEMAND V1 — LEASE / envelope temporal de um node (puro).
//
// Objetivo: nunca deixar um servidor pago ligado e esquecido. Toda provisão nasce com um
// LEASE que dá uma resposta DETERMINÍSTICA para "este node ainda deve permanecer ativo?".
// Para o V0, um envelope TEMPORAL explícito basta — não inventamos precisão financeira que
// o provider não fornece. O lease correlaciona com o trabalho/tentativa, carrega o modo de
// cobrança e uma referência de autorização (obrigatória para `paid`), e opcionalmente um
// palpite de preço para custo observado (classificação, não fato imutável — visão §13).
//
// Puro e determinístico: dado agora + quando ficou ativo + desde quando está ocioso, decide
// se o lease ainda está ativo ou expirou (e por quê). Não desliga nada — só diz.
// ============================================================

import type { Json } from '@anima/types';
import type { NodeBillingMode, PaidComputeAuthorizationV1 } from './paid-compute-authorization';

/** Palpite de preço do provider (opcional). Preço é INTERPRETAÇÃO dependente de catálogo,
 * não fato eterno — por isso é um "hint" que deriva custo estimado, não custo gravado. */
export interface NodePriceHintV0 {
  readonly currency: string;
  readonly perHour: number;
}

export interface NodeLeaseV0 {
  readonly schemaVersion: 1;
  readonly nodeId: string;
  readonly providerId: string;
  readonly billingMode: NodeBillingMode;
  readonly workItemId: string;
  readonly attemptId: string;
  /** Teto de duração ATIVA total (ms) desde que o node ficou ativo. */
  readonly maxActiveDurationMs: number;
  /** Desligar após este tempo OCIOSO (ms) sem trabalho. */
  readonly idleTimeoutMs: number;
  /** Prazo absoluto (ISO): mesmo ocupado, o lease vence aqui. */
  readonly leaseExpiresAt: string;
  /** Referência à autorização humana. Obrigatória quando `paid`; `null` para node não-pago. */
  readonly authorizationRef: string | null;
  readonly priceHint: NodePriceHintV0 | null;
}

export interface LeaseEvaluationInput {
  readonly lease: NodeLeaseV0;
  readonly now: Date;
  /** Quando o node ficou ativo (início da provisão). */
  readonly activeSince: Date;
  /** Desde quando está ocioso (última liberação). `null` = está ocupado ou nunca ociou. */
  readonly idleSince: Date | null;
}

export type LeaseExpiryReason = 'deadline' | 'max_duration' | 'idle_timeout';

export type LeaseStatus =
  | { readonly status: 'active'; readonly activeDurationMs: number }
  | { readonly status: 'expired'; readonly reason: LeaseExpiryReason; readonly activeDurationMs: number };

const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const positiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const nonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Decide se o lease de um node ainda está ativo — puro e determinístico. Ordem de precedência
 * do motivo de expiração: prazo absoluto (`deadline`) → duração ativa (`max_duration`) →
 * ocioso (`idle_timeout`). Duração ativa é `now - activeSince`, sempre não-negativa. Um clock
 * inconsistente (agora antes de activeSince) é tratado como duração 0, não negativa.
 */
export function evaluateLeaseStatus(input: LeaseEvaluationInput): LeaseStatus {
  const { lease, now, activeSince, idleSince } = input;
  const activeDurationMs = Math.max(0, now.getTime() - activeSince.getTime());
  if (now.getTime() >= Date.parse(lease.leaseExpiresAt)) return { status: 'expired', reason: 'deadline', activeDurationMs };
  if (activeDurationMs >= lease.maxActiveDurationMs) return { status: 'expired', reason: 'max_duration', activeDurationMs };
  if (idleSince !== null) {
    const idleMs = Math.max(0, now.getTime() - idleSince.getTime());
    if (idleMs >= lease.idleTimeoutMs) return { status: 'expired', reason: 'idle_timeout', activeDurationMs };
  }
  return { status: 'active', activeDurationMs };
}

/**
 * Estima o custo de um período ativo a partir do palpite de preço, quando houver. Devolve
 * `null` quando não há preço conhecido — nunca inventa um número. É CLASSIFICAÇÃO derivada
 * (preço × duração), não um fato gravado.
 */
export function estimateLeaseCost(priceHint: NodePriceHintV0 | null, activeDurationMs: number): { readonly currency: string; readonly amount: number } | null {
  if (!priceHint || activeDurationMs < 0) return null;
  const hours = activeDurationMs / 3_600_000;
  return { currency: priceHint.currency, amount: priceHint.perHour * hours };
}

export type BoundedLeaseRefusal = 'authority_window_elapsed' | 'authority_duration_zero';
export type BoundedLeaseResult =
  | { readonly ok: true; readonly lease: NodeLeaseV0 }
  | { readonly ok: false; readonly reason: BoundedLeaseRefusal };

export interface BoundedLeaseInput {
  /** A autorização HUMANA que concede a autoridade — o TETO. */
  readonly authorization: PaidComputeAuthorizationV1;
  readonly nodeId: string;
  readonly workItemId: string;
  readonly attemptId: string;
  /** Duração pretendida da lease (ms). Será limitada pela autoridade. */
  readonly requestedDurationMs: number;
  readonly idleTimeoutMs: number;
  readonly now: Date;
  readonly priceHint: NodePriceHintV0 | null;
}

/**
 * Deriva uma lease PAGA cujo envelope é o MENOR entre o pedido e a autoridade concedida — a
 * autorização humana é TETO DURO, JAMAIS ampliável por uma camada inferior. Duas barreiras
 * determinísticas, ambas apertadas para a autoridade:
 *   - `leaseExpiresAt` (deadline absoluto) = min(agora + duração pedida, `validUntil` da auth);
 *   - `maxActiveDurationMs` = min(duração pedida, `maxDurationMs` da auth).
 * A lease NUNCA fatura além da janela de validade da autorização. Fail-closed se a janela já
 * se esgotou (nada a autorizar) — devolve refusal, não uma lease frouxa. Assume que a
 * autorização já foi validada contra o pedido (`evaluatePaidComputeAuthorization`); aqui só
 * se APLICA o teto. Não persiste, não chama provider.
 */
export function deriveBoundedLease(input: BoundedLeaseInput): BoundedLeaseResult {
  const nowMs = input.now.getTime();
  const authUntilMs = Date.parse(input.authorization.validUntil);
  const boundedDuration = Math.min(input.requestedDurationMs, input.authorization.maxDurationMs);
  if (!Number.isInteger(boundedDuration) || boundedDuration <= 0) return { ok: false, reason: 'authority_duration_zero' };
  const deadlineMs = Math.min(nowMs + boundedDuration, authUntilMs);
  if (!Number.isFinite(deadlineMs) || deadlineMs <= nowMs) return { ok: false, reason: 'authority_window_elapsed' };
  return {
    ok: true,
    lease: {
      schemaVersion: 1,
      nodeId: input.nodeId,
      providerId: input.authorization.providerId,
      billingMode: 'paid',
      workItemId: input.workItemId,
      attemptId: input.attemptId,
      maxActiveDurationMs: boundedDuration,
      idleTimeoutMs: input.idleTimeoutMs,
      leaseExpiresAt: new Date(deadlineMs).toISOString(),
      authorizationRef: input.authorization.authorizationId,
      priceHint: input.priceHint,
    },
  };
}

const asObject = (v: Json | undefined): Record<string, Json | undefined> | null =>
  v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v) ? v : null;

/**
 * Reconstrói e valida um lease persistido — fail-closed. Um lease `paid` sem `authorizationRef`
 * é INVÁLIDO por construção (não se aluga sem autorização). `null` quando malformado.
 */
export function parseNodeLease(value: Json | undefined): NodeLeaseV0 | null {
  const root = asObject(value);
  if (!root || root.schemaVersion !== 1) return null;
  if (!nonBlank(root.nodeId) || !nonBlank(root.providerId) || !nonBlank(root.workItemId) || !nonBlank(root.attemptId)) return null;
  const billingMode = root.billingMode;
  if (billingMode !== 'owned' && billingMode !== 'already_provisioned' && billingMode !== 'paid') return null;
  if (!positiveInt(root.maxActiveDurationMs) || !nonNegInt(root.idleTimeoutMs)) return null;
  if (!nonBlank(root.leaseExpiresAt) || Number.isNaN(Date.parse(root.leaseExpiresAt))) return null;
  const authorizationRef = root.authorizationRef;
  if (authorizationRef !== null && !nonBlank(authorizationRef)) return null;
  // Invariante financeira: node pago exige referência de autorização no próprio lease.
  if (billingMode === 'paid' && !nonBlank(authorizationRef)) return null;
  let priceHint: NodePriceHintV0 | null = null;
  if (root.priceHint !== null && root.priceHint !== undefined) {
    const p = asObject(root.priceHint);
    if (!p || !nonBlank(p.currency) || typeof p.perHour !== 'number' || !Number.isFinite(p.perHour) || p.perHour < 0) return null;
    priceHint = { currency: p.currency, perHour: p.perHour };
  }
  return {
    schemaVersion: 1,
    nodeId: root.nodeId,
    providerId: root.providerId,
    billingMode,
    workItemId: root.workItemId,
    attemptId: root.attemptId,
    maxActiveDurationMs: root.maxActiveDurationMs,
    idleTimeoutMs: root.idleTimeoutMs,
    leaseExpiresAt: root.leaseExpiresAt,
    authorizationRef: (authorizationRef as string | null) ?? null,
    priceHint,
  };
}
