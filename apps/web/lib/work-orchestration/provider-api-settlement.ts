import { readFileSync } from 'node:fs';
import {
  aggregateProviderApiAttemptUsage,
  deriveProviderApiSettlement,
  parseProviderPricingCatalog,
  type ObservedCoderInput,
  type ProviderApiReservationStateV1,
  type ProviderApiSettlementDecisionV1,
  type ProviderApiSettlementProvenanceV1,
  type ProviderPricingCatalogV1,
} from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  readProviderApiReservationForAttempt,
  settlePaidComputeUsagePricedReservation,
  type PaidComputeStoreError,
  type UsagePricedSettlementResult,
} from './paid-compute-authorization-store';

// ============================================================
// B1 — SETTLEMENT PÓS-ATTEMPT de compute `provider_api` (camada de efeito).
//
// attempt → usage observada (sucesso OU falha) → preço versionado → custo derivado → settlement.
//
// A decisão é do core PURO (`deriveProviderApiSettlement`); aqui só se lê a reserva da attempt, o
// catálogo de preços e se grava o evento `settled` (`usage_priced`) quando — e somente quando — a
// decisão for `settle`. Qualquer outra decisão deixa a reserva ABERTA (`cost_unknown`), sem escrita.
//
// FAIL-OPEN em relação à attempt: settlement nunca altera o desfecho do turno. Uma falha aqui deixa
// a reserva aberta e reconciliável (a decisão é recomputável a partir do ledger + evidência).
// ============================================================

/** Caminho de um JSON `ProviderPricingCatalogV1` curado por humano. Ausente ⇒ sem preço
 * autoritativo ⇒ toda attempt `provider_api` permanece `cost_unknown`. */
export const PROVIDER_PRICING_CATALOG_ENV = 'ANIMA_PROVIDER_PRICING_CATALOG';

export type ProviderPricingCatalogLoad =
  | { readonly status: 'absent' }
  | { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'loaded'; readonly catalog: ProviderPricingCatalogV1 };

/** Carrega e valida o catálogo (fail-closed no catálogo inteiro). Nunca inventa preço. */
export function loadProviderPricingCatalog(
  env: Readonly<Record<string, string | undefined>> = process.env,
  readFile: (path: string) => string = path => readFileSync(path, 'utf8'),
): ProviderPricingCatalogLoad {
  const path = env[PROVIDER_PRICING_CATALOG_ENV]?.trim();
  if (!path) return { status: 'absent' };
  let parsed: unknown;
  try { parsed = JSON.parse(readFile(path)); } catch { return { status: 'invalid', reason: 'catalog_unreadable' }; }
  const result = parseProviderPricingCatalog(parsed);
  return result.ok ? { status: 'loaded', catalog: result.catalog } : { status: 'invalid', reason: result.reason };
}

export interface ProviderApiSettlementStore {
  readReservation(attemptId: string): Promise<{ readonly ok: true; readonly reservation: ProviderApiReservationStateV1 | null } | PaidComputeStoreError>;
  settle(input: { readonly reservationId: string; readonly currency: string; readonly settledAmount: string; readonly provenance: ProviderApiSettlementProvenanceV1 }): Promise<UsagePricedSettlementResult>;
}

export function providerApiSettlementStoreFor(client: SupabaseClient<Database>): ProviderApiSettlementStore {
  return {
    readReservation: attemptId => readProviderApiReservationForAttempt(client, attemptId),
    settle: input => settlePaidComputeUsagePricedReservation(client, input),
  };
}

export type ProviderApiSettlementOutcome =
  | { readonly kind: 'no_reservation' }
  | { readonly kind: 'store_error'; readonly stage: 'read' | 'settle'; readonly code: string; readonly message: string; readonly decision?: ProviderApiSettlementDecisionV1 }
  | { readonly kind: 'settled'; readonly action: 'settled' | 'replayed'; readonly decision: Extract<ProviderApiSettlementDecisionV1, { kind: 'settle' }> }
  | { readonly kind: 'not_settled'; readonly decision: Exclude<ProviderApiSettlementDecisionV1, { kind: 'settle' }> };

/**
 * Liquida (ou deixa explicitamente `cost_unknown`) a reserva `provider_api` de UMA attempt.
 * Idempotente: um replay relê o ledger; reserva já liquidada com a mesma versão ⇒ `already_settled`
 * (sem escrita); divergente ⇒ `settlement_conflict` (sem escrita; a RPC também recusaria).
 */
export async function settleProviderApiAttemptCost(
  store: ProviderApiSettlementStore,
  input: {
    readonly attemptId: string;
    readonly provider: string;
    readonly coderObservations: readonly ObservedCoderInput[];
    readonly catalog: ProviderPricingCatalogV1 | null;
  },
): Promise<ProviderApiSettlementOutcome> {
  const read = await store.readReservation(input.attemptId);
  if (!read.ok) return { kind: 'store_error', stage: 'read', code: read.code, message: read.message };
  if (read.reservation === null) return { kind: 'no_reservation' };

  // Modelo EFETIVAMENTE enviado ao provider (identidade observada do backend); divergência entre
  // observações ou ausência ⇒ o core recusa por `model_mismatch` (fail-closed).
  const models = new Set(input.coderObservations.flatMap(o => o.model ? [o.model] : []));
  const model = models.size === 1 ? [...models][0]! : '';

  const decision = deriveProviderApiSettlement({
    attemptId: input.attemptId, provider: input.provider, model,
    reservation: read.reservation,
    usage: aggregateProviderApiAttemptUsage(input.coderObservations),
    catalog: input.catalog,
  });
  if (decision.kind !== 'settle') return { kind: 'not_settled', decision };

  const written = await store.settle({
    reservationId: decision.reservationId, currency: decision.currency,
    settledAmount: decision.settledAmount, provenance: decision.provenance,
  });
  if (!written.ok) return { kind: 'store_error', stage: 'settle', code: written.code, message: written.message, decision };
  return { kind: 'settled', action: written.action, decision };
}
