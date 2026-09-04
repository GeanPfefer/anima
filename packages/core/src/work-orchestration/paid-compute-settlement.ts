// ============================================================
// RESERVED ≠ SETTLED — modela EXPLICITAMENTE as quatro grandezas distintas do
// compute pago, para que "teto autorizado" jamais seja confundido com "custo real".
//
//   authorizedCeiling — teto humano (autoridade). NÃO é gasto.
//   reservedExposure  — exposição reservada no ledger ANTES do provider. NÃO é gasto.
//   usage             — uso REPORTADO pelo provider (tokens, chamadas, request ids).
//                       Fato observado; nunca inventado (sem usage ⇒ zero tokens).
//   settledCost       — custo REAL, só quando há pricing confiável/versionado. Sem
//                       pricing ⇒ permanece `unresolved` (JAMAIS deriva USD do teto).
//
// Módulo PURO e determinístico: não persiste, não chama provider, não decide nada.
// Prepara o cálculo futuro de `cost_per_verified` sem fabricar preço.
// ============================================================

export interface PaidComputeMoneyV1 {
  readonly currency: string;
  readonly amount: number;
}

/** Uso reportado pelo provider + observado pelo host. Tokens são fato do provider;
 * `providerCallCount` é host-observed; `providerRequestIds` são ids estáveis do
 * provider para correlação/idempotência/auditoria (nunca segredos). */
export interface PaidComputeUsageV1 {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly totalTokens: number;
  readonly providerCallCount: number;
  readonly providerRequestIds: readonly string[];
}

/** Custo liquidado. `resolved` só quando um pricing versionado/confiável foi aplicado;
 * `unresolved` preserva a honestidade (uso real presente, preço indisponível). */
export type SettledCostV1 =
  | { readonly status: 'resolved'; readonly currency: string; readonly amount: number; readonly pricingRef: string }
  | { readonly status: 'unresolved'; readonly reason: string };

export interface PaidComputeSettlementV1 {
  readonly schemaVersion: 1;
  readonly authorizedCeiling: PaidComputeMoneyV1 | null;
  readonly reservedExposure: PaidComputeMoneyV1 | null;
  readonly usage: PaidComputeUsageV1;
  readonly settledCost: SettledCostV1;
}

/** Tabela de preço por milhão de tokens, VERSIONADA (auditável por `pricingRef`).
 * Injetável; ausente ⇒ o custo permanece `unresolved`. */
export interface TokenPricingV1 {
  readonly currency: string;
  readonly pricingRef: string;
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  /** Preço do input em cache; ausente ⇒ usa `inputPerMillion` (conservador). */
  readonly cachedInputPerMillion?: number;
}

const nonNegInt = (v: number): boolean => Number.isInteger(v) && v >= 0;

function computeSettledCost(usage: PaidComputeUsageV1, pricing: TokenPricingV1 | null): SettledCostV1 {
  // Sem pricing confiável: NÃO transforma teto/reserva em custo. Fica unresolved.
  if (!pricing) return { status: 'unresolved', reason: 'pricing_unversioned' };
  if (![pricing.inputPerMillion, pricing.outputPerMillion].every(v => Number.isFinite(v) && v >= 0)) {
    return { status: 'unresolved', reason: 'pricing_invalid' };
  }
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const uncachedInput = Math.max(0, usage.inputTokens - cached);
  const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion;
  const amount =
    (uncachedInput / 1_000_000) * pricing.inputPerMillion +
    (cached / 1_000_000) * cachedRate +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  return { status: 'resolved', currency: pricing.currency, amount, pricingRef: pricing.pricingRef };
}

/**
 * Liquida o uso pago mantendo as quatro grandezas SEPARADAS. O teto e a reserva
 * atravessam intactos (autoridade/exposição, não custo); o custo só é `resolved`
 * quando um pricing versionado é fornecido. Determinístico.
 */
export function settlePaidComputeUsage(input: {
  readonly authorizedCeiling: PaidComputeMoneyV1 | null;
  readonly reservedExposure: PaidComputeMoneyV1 | null;
  readonly usage: PaidComputeUsageV1;
  readonly pricing?: TokenPricingV1 | null;
}): PaidComputeSettlementV1 {
  return {
    schemaVersion: 1,
    authorizedCeiling: input.authorizedCeiling,
    reservedExposure: input.reservedExposure,
    usage: input.usage,
    settledCost: computeSettledCost(input.usage, input.pricing ?? null),
  };
}

/**
 * Passo futuro preparado: custo por desfecho verificado. Fica `unresolved` enquanto
 * o custo não for `resolved` (nunca deriva do teto) ou quando não há verificados.
 */
export function costPerVerifiedOutcome(
  settlement: PaidComputeSettlementV1,
  verifiedCount: number,
): SettledCostV1 {
  if (settlement.settledCost.status !== 'resolved') return settlement.settledCost;
  if (!nonNegInt(verifiedCount) || verifiedCount <= 0) return { status: 'unresolved', reason: 'no_verified_outcomes' };
  return {
    status: 'resolved',
    currency: settlement.settledCost.currency,
    amount: settlement.settledCost.amount / verifiedCount,
    pricingRef: settlement.settledCost.pricingRef,
  };
}
