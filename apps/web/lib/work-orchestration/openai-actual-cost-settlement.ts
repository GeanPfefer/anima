import { calculateApiAttemptCost, type ProviderPricingV1 } from '@anima/core';

export interface OpenAIAggregatedUsageV1 {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly providerCallCount: number;
}

export interface OpenAIActualCostSettlementInput {
  readonly attemptId: string;
  readonly reservationId: string;
  readonly terminalEvidencePersisted: boolean;
  readonly provider: 'openai';
  readonly model: string;
  readonly usage: OpenAIAggregatedUsageV1 | null;
  readonly pricing: ProviderPricingV1 | null;
  readonly reservedAmount: { readonly currency: string; readonly amount: number } | null;
}

export interface OpenAIActualCostSettlementTrailV1 {
  readonly schemaVersion: 1;
  readonly attemptId: string;
  readonly reservationId: string;
  readonly provider: 'openai';
  readonly model: string;
  readonly usage: OpenAIAggregatedUsageV1;
  readonly pricing: ProviderPricingV1;
  readonly actualCost: { readonly currency: string; readonly amount: number };
  readonly reservedAmount: { readonly currency: string; readonly amount: number };
}

export type OpenAIActualCostSettlementResult =
  | { readonly status: 'settled'; readonly trail: OpenAIActualCostSettlementTrailV1 }
  | { readonly status: 'not_settled'; readonly reason: 'terminal_evidence_incomplete' | 'correlation_invalid' | 'usage_incomplete' | 'cost_unavailable' | 'reservation_inconsistent' | 'reservation_exceeded' };

export type SettlePaidComputeBudgetReservation = (input: {
  readonly reservationId: string;
  readonly actualCost: { readonly currency: string; readonly amount: number };
  readonly idempotencyKey: string;
  readonly trail: OpenAIActualCostSettlementTrailV1;
}) => Promise<void>;

const nonNegativeInteger = (value: number): boolean => Number.isInteger(value) && value >= 0;
const validMoney = (value: { readonly currency: string; readonly amount: number } | null): value is { readonly currency: string; readonly amount: number } => value !== null
  && value.currency.trim().length > 0 && Number.isFinite(value.amount) && value.amount >= 0;

/**
 * Focal settlement boundary. It accepts only terminal host evidence and already
 * aggregated provider usage; it never estimates missing usage or settles above
 * the reservation. The reservation idempotency key makes retries reproducible.
 */
export async function settleOpenAIActualCost(
  input: OpenAIActualCostSettlementInput,
  settlePaidComputeBudgetReservation: SettlePaidComputeBudgetReservation,
): Promise<OpenAIActualCostSettlementResult> {
  if (!input.terminalEvidencePersisted) return { status: 'not_settled', reason: 'terminal_evidence_incomplete' };
  if (!input.attemptId || !input.reservationId || !input.model) return { status: 'not_settled', reason: 'correlation_invalid' };
  if (!input.usage || ![input.usage.inputTokens, input.usage.cachedInputTokens, input.usage.outputTokens, input.usage.providerCallCount].every(nonNegativeInteger)
    || input.usage.cachedInputTokens > input.usage.inputTokens) return { status: 'not_settled', reason: 'usage_incomplete' };
  if (!validMoney(input.reservedAmount)) return { status: 'not_settled', reason: 'reservation_inconsistent' };

  const actual = calculateApiAttemptCost({
    schemaVersion: 1,
    kind: 'api',
    cohort: { provider: input.provider, model: input.model, capability: 'coder', taskClass: 'backlog' },
    terminalResult: 'terminal', reachedReview: false, verified: false, durationMs: null, timeToReviewMs: null,
    ...input.usage,
  }, input.pricing, input.reservedAmount.currency);
  if (actual.status !== 'known') return { status: 'not_settled', reason: 'cost_unavailable' };
  if (actual.value.amount > input.reservedAmount.amount) return { status: 'not_settled', reason: 'reservation_exceeded' };

  const trail: OpenAIActualCostSettlementTrailV1 = {
    schemaVersion: 1, attemptId: input.attemptId, reservationId: input.reservationId,
    provider: input.provider, model: input.model, usage: input.usage,
    pricing: input.pricing!, actualCost: actual.value, reservedAmount: input.reservedAmount,
  };
  await settlePaidComputeBudgetReservation({
    reservationId: input.reservationId,
    actualCost: actual.value,
    idempotencyKey: `openai-actual-cost:${input.reservationId}`,
    trail,
  });
  return { status: 'settled', trail };
}
