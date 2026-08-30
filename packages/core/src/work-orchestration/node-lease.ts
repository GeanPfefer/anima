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
import type { NodeBillingMode } from './paid-compute-authorization';

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
