import { calculateApiAttemptCost, type ComputeCohortKeyV1, type ProviderPricingV1 } from '@anima/core';

export interface OpenAIProviderUsageV1 {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly providerCallCount: number;
  /** The host only settles usage collected after the attempt has reached a terminal state. */
  readonly terminalEvidence: true;
}

export interface OpenAIComputeReservationV1 {
  readonly reservationId: string;
  readonly attemptId: string;
  readonly currency: string;
  readonly reservedAmount: number;
}

export interface OpenAISettlementAuditV1 {
  readonly schemaVersion: 1;
  readonly reservationId: string;
  readonly attemptId: string;
  readonly provider: 'openai';
  readonly model: string;
  readonly pricing: ProviderPricingV1;
  readonly usage: OpenAIProviderUsageV1;
  readonly actualCost: { readonly currency: string; readonly amount: number };
}

export type SettlePaidComputeBudgetReservation = (input: OpenAISettlementAuditV1) => Promise<void>;

export type OpenAIActualCostSettlementResult =
  | { readonly settled: true; readonly audit: OpenAISettlementAuditV1 }
  | { readonly settled: false; readonly reason: 'missing_reservation' | 'attempt_mismatch' | 'terminal_evidence_missing' | 'cost_unavailable' | 'reservation_exceeded' | 'already_settled' };

/**
 * Settles a coder reservation only from provider-reported aggregate terminal usage.
 * The supplied store callback is the sole mutation boundary; callers must bind it to
 * the canonical, idempotent paid-compute reservation store API.
 */
export async function settleOpenAIActualCostReservation(input: {
  readonly reservation: OpenAIComputeReservationV1 | null;
  readonly attemptId: string;
  readonly model: string;
  readonly cohort: ComputeCohortKeyV1;
  readonly usage: OpenAIProviderUsageV1 | null;
  readonly pricing: ProviderPricingV1 | null;
  readonly settlePaidComputeBudgetReservation: SettlePaidComputeBudgetReservation;
  readonly settledReservationIds?: ReadonlySet<string>;
}): Promise<OpenAIActualCostSettlementResult> {
  const { reservation, attemptId, usage, pricing } = input;
  if (!reservation) return { settled: false, reason: 'missing_reservation' };
  if (reservation.attemptId !== attemptId) return { settled: false, reason: 'attempt_mismatch' };
  if (!usage?.terminalEvidence) return { settled: false, reason: 'terminal_evidence_missing' };
  if (input.settledReservationIds?.has(reservation.reservationId)) return { settled: false, reason: 'already_settled' };

  const cost = calculateApiAttemptCost({
    schemaVersion: 1,
    kind: 'api',
    cohort: input.cohort,
    providerCallCount: usage.providerCallCount,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    terminalResult: 'terminal',
    reachedReview: false,
    verified: false,
    durationMs: null,
    timeToReviewMs: null,
  }, pricing);
  if (cost.status !== 'known') return { settled: false, reason: 'cost_unavailable' };
  if (cost.value.currency !== reservation.currency || cost.value.amount > reservation.reservedAmount) {
    return { settled: false, reason: 'reservation_exceeded' };
  }

  const audit: OpenAISettlementAuditV1 = {
    schemaVersion: 1,
    reservationId: reservation.reservationId,
    attemptId,
    provider: 'openai',
    model: input.model,
    pricing: pricing!,
    usage,
    actualCost: cost.value,
  };
  await input.settlePaidComputeBudgetReservation(audit);
  return { settled: true, audit };
}
