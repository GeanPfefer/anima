// ============================================================
// RESILIENT CLOUD SESSION V1 — SETTLEMENT de lease de node por TEMPO (puro, determinístico).
//
// Distinto do `paid-compute-settlement.ts` (custo por TOKEN de provider de API). Aqui o recurso é
// um Pod cobrado por TEMPO: preço/hora × vida faturável. A reserva do ledger é CONSERVADORA (o teto
// da lease, ex.: 30 min), mas o Pod viveu segundos. Sem settlement, "reserva" vira "committed"
// integral e reduz artificialmente o budget da sessão — errado para sessões resilientes, onde a
// próxima máquina precisa do budget liberado.
//
// Este módulo calcula o custo LIQUIDADO (S) a partir de:
//   - o custo CONFIRMADO pelo provider, quando existe (source `provider_confirmed`); OU
//   - uma ESTIMATIVA preço/h × vida faturável (source `estimated`), com arredondamento
//     CONSERVADOR (para cima — nunca sub-reporta custo).
//
// Invariantes duros:
//   - S nunca é negativo (committed jamais negativo);
//   - S nunca excede a reserva R (settlement jamais aumenta a exposição);
//   - o excesso liberado = R − S ≥ 0.
//
// NÃO persiste, NÃO chama provider. Só calcula. Quem grava o evento append-only `settled` é a
// camada de store; quem mede a vida faturável é o host.
// ============================================================

import type { RequirementMoneyV1 } from './cloud-resource-requirements';
import type { NodePriceHintV0 } from './node-lease';

export type NodeCostSourceV1 = 'estimated' | 'provider_confirmed';

export interface NodeLeaseSettlementV1 {
  readonly currency: string;
  /** Reserva conservadora original (R). */
  readonly reservedAmount: number;
  /** Custo liquidado (S), sempre em [0, R]. É o que permanece committed. */
  readonly settledAmount: number;
  /** Excesso liberado (R − S), sempre ≥ 0. Volta ao budget da sessão. */
  readonly releasedExcess: number;
  readonly source: NodeCostSourceV1;
  /** Vida faturável medida (ms) usada na estimativa; 0 quando o custo veio confirmado. */
  readonly billableDurationMs: number;
}

/** Incremento de arredondamento conservador (potência de dez). Default 0.0001 = quatro casas —
 * fino o bastante para não liberar excesso a mais, e SEMPRE arredonda o custo PARA CIMA. */
export const DEFAULT_SETTLEMENT_ROUNDING_INCREMENT = 0.0001;

export interface SettleNodeLeaseInput {
  /** Reserva do ledger (R) — a moeda dela é autoritativa para o settlement. */
  readonly reserved: RequirementMoneyV1;
  /** Vida ATIVA faturável medida pelo host (ms). */
  readonly billableDurationMs: number;
  /** Palpite de preço/hora (autoridade concedida / preço observado) para a estimativa. */
  readonly priceHint: NodePriceHintV0 | null;
  /** Custo FINAL confirmado pelo provider, quando disponível. Preferido sobre a estimativa. */
  readonly providerConfirmedCost?: RequirementMoneyV1 | null;
  /** Incremento de arredondamento conservador (potência de dez). Default 0.0001. */
  readonly roundingIncrement?: number;
}

const HOUR_MS = 3_600_000;

const isValidMoney = (m: RequirementMoneyV1 | null | undefined): m is RequirementMoneyV1 =>
  !!m && typeof m.currency === 'string' && m.currency.trim() !== '' && Number.isFinite(m.amount) && m.amount >= 0;

const sameCurrency = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase();

/** Arredonda PARA CIMA ao incremento (potência de dez), matando ruído de ponto flutuante. */
function roundUpTo(value: number, increment: number): number {
  const inc = Number.isFinite(increment) && increment > 0 ? increment : DEFAULT_SETTLEMENT_ROUNDING_INCREMENT;
  const decimals = Math.max(0, Math.round(-Math.log10(inc)));
  const ceiled = Math.ceil(value / inc - 1e-9);
  return Number((ceiled * inc).toFixed(Math.min(decimals, 12)));
}

/**
 * Liquida o custo de uma lease de node por tempo. Determinística e fail-closed:
 *   - reserva inválida ⇒ `null` (não se liquida sem reserva confiável; o caller mantém a reserva
 *     conservadora inteira);
 *   - custo confirmado do provider na MESMA moeda ⇒ `S = clamp(confirmado, 0, R)`,
 *     source `provider_confirmed` (número real do provider, sem arredondar; só clampado a R);
 *   - senão, estimativa preço/h × vida faturável, arredondada PARA CIMA, `S = clamp(est, 0, R)`,
 *     source `estimated`;
 *   - sem preço utilizável ⇒ conservador: `S = R` (mantém a reserva inteira; nunca inventa número
 *     menor), source `estimated`, excesso liberado 0.
 */
export function settleNodeLeaseCost(input: SettleNodeLeaseInput): NodeLeaseSettlementV1 | null {
  if (!isValidMoney(input.reserved) || input.reserved.amount <= 0) return null;
  const currency = input.reserved.currency;
  const R = input.reserved.amount;
  const clampToReservation = (raw: number): number => Math.min(R, Math.max(0, raw));

  // 1) Custo confirmado pelo provider (preferido), quando na mesma moeda da reserva.
  const confirmed = input.providerConfirmedCost;
  if (isValidMoney(confirmed) && sameCurrency(confirmed.currency, currency)) {
    const settledAmount = clampToReservation(confirmed.amount);
    return {
      currency, reservedAmount: R, settledAmount,
      releasedExcess: Math.max(0, Number((R - settledAmount).toFixed(12))),
      source: 'provider_confirmed', billableDurationMs: 0,
    };
  }

  // 2) Estimativa preço/h × vida faturável, arredondada PARA CIMA (conservador).
  const durationMs = Number.isFinite(input.billableDurationMs) && input.billableDurationMs > 0 ? input.billableDurationMs : 0;
  const price = input.priceHint;
  const priceUsable = !!price && typeof price.currency === 'string' && sameCurrency(price.currency, currency)
    && Number.isFinite(price.perHour) && price.perHour >= 0;
  if (priceUsable) {
    const rawEstimate = (price as NodePriceHintV0).perHour * (durationMs / HOUR_MS);
    const rounded = roundUpTo(rawEstimate, input.roundingIncrement ?? DEFAULT_SETTLEMENT_ROUNDING_INCREMENT);
    const settledAmount = clampToReservation(rounded);
    return {
      currency, reservedAmount: R, settledAmount,
      releasedExcess: Math.max(0, Number((R - settledAmount).toFixed(12))),
      source: 'estimated', billableDurationMs: durationMs,
    };
  }

  // 3) Sem preço utilizável: conservador — mantém a reserva inteira (não inventa número menor).
  return {
    currency, reservedAmount: R, settledAmount: R, releasedExcess: 0,
    source: 'estimated', billableDurationMs: durationMs,
  };
}
