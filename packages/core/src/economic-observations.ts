import {
  calculateCohortMetrics,
  type CohortMetricsV1,
  type ComputeCohortKeyV1,
  type EconomicAttemptV1,
  type EconomicReasonV1,
  type EconomicValueV1,
  type MoneyV1,
} from './compute-economics';

export type EconomicProvenanceV1 =
  | 'host_observed'
  | 'provider_reported'
  | 'persisted'
  | 'derived'
  | 'unknown';

export type EconomicPlacementV1 = 'local' | 'api' | 'cloud' | 'unknown';
export type EconomicTerminalClassV1 = 'completed' | 'failed' | 'blocked' | 'cancelled' | 'no_progress' | 'unknown';
export type EconomicFailureCategoryV1 =
  | 'review_inconclusive'
  | 'gate_failed'
  | 'no_progress'
  | 'model_capability'
  | 'protocol_edit_failure'
  | 'infrastructure'
  | 'resource_pressure'
  | 'authorization_blocked'
  | 'unknown';
export type EconomicOutcomeClassV1 = 'verified' | EconomicFailureCategoryV1 | 'outcome_unknown';

export interface EconomicCohortKeyV1 extends ComputeCohortKeyV1 {
  readonly placement: EconomicPlacementV1;
}

export interface EconomicUsageV1 {
  /** Calls observed at the transport boundary, not inferred from provider usage. */
  readonly hostObservedCallCount: number | null;
  readonly providerReported: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cachedInputTokens: number;
    readonly requestIds?: readonly string[];
  } | null;
}

export interface EconomicCostEvidenceV1 {
  readonly kind: 'settled' | 'derived';
  readonly money: MoneyV1;
  readonly provenance: EconomicProvenanceV1;
  readonly sourceRef?: string;
}

export interface ReservedExposureV1 {
  readonly kind: 'reserved_exposure';
  readonly money: MoneyV1;
  readonly provenance: EconomicProvenanceV1;
}

export interface EconomicObservationV1 {
  readonly schemaVersion: 1;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly cohort: EconomicCohortKeyV1;
  readonly admittedAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly reviewAt: string | null;
  readonly runtimeMs: number | null;
  readonly timeToReviewMs: number | null;
  readonly reachedReview: boolean;
  readonly verified: boolean;
  readonly terminalClass: EconomicTerminalClassV1;
  readonly failureCategory: EconomicFailureCategoryV1 | null;
  readonly outcomeClass: EconomicOutcomeClassV1;
  readonly usage: EconomicUsageV1 | null;
  readonly cost: EconomicCostEvidenceV1 | null;
  readonly reservedExposure: ReservedExposureV1 | null;
  readonly local: { readonly runtimeMs: number | null; readonly monetaryCost: EconomicCostEvidenceV1 | null } | null;
  readonly cloud: {
    readonly leaseId: string;
    readonly instanceClass: string;
    readonly billableSeconds: number | null;
    readonly usefulRuntimeSeconds: number | null;
    readonly attributedCost: EconomicCostEvidenceV1 | null;
  } | null;
  readonly provenance: {
    readonly identity: EconomicProvenanceV1;
    readonly timestamps: EconomicProvenanceV1;
    readonly runtime: EconomicProvenanceV1;
    readonly outcome: EconomicProvenanceV1;
    readonly hostObservedCallCount: EconomicProvenanceV1;
    readonly providerReportedUsage: EconomicProvenanceV1;
  };
}

export type EconomicObservationDefectV1 =
  | 'invalid_identity'
  | 'invalid_cohort'
  | 'invalid_timestamp'
  | 'reversed_timestamps'
  | 'negative_runtime'
  | 'usage_inconsistent'
  | 'outcome_inconsistent'
  | 'cloud_runtime_inconsistent'
  | 'money_invalid'
  | 'currency_mismatch'
  | 'placement_inconsistent';

export type EconomicObservationResultV1 =
  | { readonly ok: true; readonly value: EconomicObservationV1; readonly quality: ObservationDataQualityV1 }
  | { readonly ok: false; readonly defect: EconomicObservationDefectV1; readonly explanation: string };

export type ObservationDataQualityV1 = 'complete' | 'partial' | 'pricing_missing' | 'cost_unsettled' | 'outcome_missing';
export type CohortDataQualityV1 = ObservationDataQualityV1 | 'inconsistent' | 'insufficient_sample';

const finiteNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const nonNegativeInteger = (value: number): boolean => Number.isInteger(value) && value >= 0;
const nonBlank = (value: string): boolean => value.trim().length > 0;
const fail = (defect: EconomicObservationDefectV1, explanation: string): EconomicObservationResultV1 =>
  ({ ok: false, defect, explanation });
const timestamp = (value: string | null): number | null => {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};
const validMoney = (value: MoneyV1): boolean => nonBlank(value.currency) && finiteNonNegative(value.amount);

export function economicCohortKey(observation: Pick<EconomicObservationV1, 'cohort'>): EconomicCohortKeyV1 {
  return { ...observation.cohort, taskClass: nonBlank(observation.cohort.taskClass) ? observation.cohort.taskClass : 'unknown' };
}

export function serializeEconomicCohortKey(key: EconomicCohortKeyV1): string {
  return [key.capability, key.taskClass || 'unknown', key.provider, key.model, key.placement, key.configVersion ?? ''].map(encodeURIComponent).join('|');
}

function observationQuality(observation: EconomicObservationV1): ObservationDataQualityV1 {
  if (observation.outcomeClass === 'outcome_unknown') return 'outcome_missing';
  if (observation.cost === null) return observation.cohort.placement === 'api' ? 'pricing_missing' : 'cost_unsettled';
  if (observation.runtimeMs === null || observation.startedAt === null || observation.finishedAt === null) return 'partial';
  return 'complete';
}

export function normalizeEconomicObservation(input: EconomicObservationV1): EconomicObservationResultV1 {
  if (input.schemaVersion !== 1 || !nonBlank(input.workItemId) || !nonBlank(input.attemptId)) {
    return fail('invalid_identity', 'schemaVersion, workItemId and attemptId are required.');
  }
  const cohort = economicCohortKey(input);
  if (![cohort.capability, cohort.provider, cohort.model].every(nonBlank)) {
    return fail('invalid_cohort', 'Capability, provider and model are required; taskClass alone may normalize to unknown.');
  }
  const times = [input.admittedAt, input.startedAt, input.finishedAt, input.reviewAt].map(timestamp);
  if (times.some((value) => value !== null && Number.isNaN(value))) return fail('invalid_timestamp', 'Timestamps must be valid ISO-compatible instants.');
  const started = times[1] ?? null;
  const finished = times[2] ?? null;
  const review = times[3] ?? null;
  if ((started !== null && finished !== null && finished < started)
    || (started !== null && review !== null && review < started)) {
    return fail('reversed_timestamps', 'Finished/review timestamps cannot precede the attempt start.');
  }
  let runtimeMs = input.runtimeMs;
  let timeToReviewMs = input.timeToReviewMs;
  let runtimeProvenance = input.provenance.runtime;
  if (runtimeMs === null && started !== null && finished !== null) {
    runtimeMs = finished - started;
    runtimeProvenance = 'derived';
  }
  if (timeToReviewMs === null && started !== null && review !== null) timeToReviewMs = review - started;
  if ((runtimeMs !== null && !finiteNonNegative(runtimeMs)) || (timeToReviewMs !== null && !finiteNonNegative(timeToReviewMs))) {
    return fail('negative_runtime', 'Runtime and time-to-review must be finite and non-negative.');
  }
  if (input.reachedReview !== (input.reviewAt !== null || input.timeToReviewMs !== null)) {
    return fail('outcome_inconsistent', 'reachedReview must agree with review evidence.');
  }
  if (input.verified && (!input.reachedReview || input.terminalClass !== 'completed'
    || input.failureCategory !== null || input.outcomeClass !== 'verified')) {
    return fail('outcome_inconsistent', 'VERIFIED requires completed, reviewed evidence without a failure category.');
  }
  if (!input.verified && input.outcomeClass === 'verified') return fail('outcome_inconsistent', 'A non-VERIFIED attempt cannot have verified outcomeClass.');
  if (input.failureCategory !== null && input.outcomeClass !== input.failureCategory) {
    return fail('outcome_inconsistent', 'failureCategory and outcomeClass must agree.');
  }
  const usage = input.usage;
  if (usage !== null) {
    if (usage.hostObservedCallCount !== null && !nonNegativeInteger(usage.hostObservedCallCount)) return fail('usage_inconsistent', 'Call count must be a non-negative integer.');
    const reported = usage.providerReported;
    if (reported !== null && (![reported.inputTokens, reported.outputTokens, reported.cachedInputTokens].every(nonNegativeInteger)
      || reported.cachedInputTokens > reported.inputTokens)) return fail('usage_inconsistent', 'Provider token usage is inconsistent.');
  }
  if (input.cohort.placement === 'local' && input.local === null
    || input.cohort.placement === 'cloud' && input.cloud === null
    || input.cohort.placement === 'api' && input.usage === null) return fail('placement_inconsistent', 'Placement-specific evidence is missing.');
  if (input.cloud !== null) {
    if (!nonBlank(input.cloud.leaseId) || !nonBlank(input.cloud.instanceClass)
      || (input.cloud.billableSeconds !== null && !finiteNonNegative(input.cloud.billableSeconds))
      || (input.cloud.usefulRuntimeSeconds !== null && !finiteNonNegative(input.cloud.usefulRuntimeSeconds))) return fail('cloud_runtime_inconsistent', 'Cloud lease evidence is invalid.');
    if (input.cloud.billableSeconds !== null && input.cloud.usefulRuntimeSeconds !== null
      && input.cloud.usefulRuntimeSeconds > input.cloud.billableSeconds) return fail('cloud_runtime_inconsistent', 'Useful runtime cannot exceed billable runtime in V1.');
  }
  const costs = [input.cost, input.local?.monetaryCost ?? null, input.cloud?.attributedCost ?? null].filter((value): value is EconomicCostEvidenceV1 => value !== null);
  if (costs.some((value) => !validMoney(value.money))) return fail('money_invalid', 'Economic costs require finite non-negative money and a currency.');
  if (input.reservedExposure !== null && !validMoney(input.reservedExposure.money)) return fail('money_invalid', 'Reserved exposure is invalid.');
  const currencies = new Set(costs.map((value) => value.money.currency));
  if (currencies.size > 1) return fail('currency_mismatch', 'Costs attributed to one observation must use one currency.');
  const value: EconomicObservationV1 = {
    ...input,
    cohort,
    runtimeMs,
    timeToReviewMs,
    provenance: { ...input.provenance, runtime: runtimeProvenance },
  };
  return { ok: true, value, quality: observationQuality(value) };
}

export interface EconomicCohortAggregationV1 {
  readonly schemaVersion: 1;
  readonly cohort: EconomicCohortKeyV1;
  readonly attempts: number;
  readonly verified: number;
  readonly failures: number;
  readonly noProgress: number;
  readonly failureCounts: Readonly<Partial<Record<EconomicFailureCategoryV1, number>>>;
  readonly knownCostAttempts: number;
  readonly unknownCostAttempts: number;
  readonly computeEconomics: CohortMetricsV1;
  readonly dataQuality: CohortDataQualityV1;
  readonly observationQualities: readonly ObservationDataQualityV1[];
}

export type EconomicObservationAggregationResultV1 =
  | { readonly ok: true; readonly value: readonly EconomicCohortAggregationV1[] }
  | { readonly ok: false; readonly errors: readonly {
    readonly index: number;
    readonly defect: EconomicObservationDefectV1;
    readonly explanation: string;
  }[] };

const unavailableCost = (observation: EconomicObservationV1): EconomicValueV1<MoneyV1> => ({
  status: 'unavailable',
  reason: observation.cohort.placement === 'api' ? 'pricing_missing' : 'cost_unknown',
});

function toEconomicAttempt(observation: EconomicObservationV1): EconomicAttemptV1 {
  return {
    cohort: observation.cohort,
    terminalResult: observation.terminalClass,
    reachedReview: observation.reachedReview,
    verified: observation.verified,
    durationMs: observation.runtimeMs,
    timeToReviewMs: observation.timeToReviewMs,
    cost: observation.cost === null ? unavailableCost(observation) : { status: 'known', value: observation.cost.money },
  };
}

export function aggregateEconomicObservations(
  inputs: readonly EconomicObservationV1[],
  minimumSampleSize = 2,
): EconomicObservationAggregationResultV1 {
  const normalized = inputs.map(normalizeEconomicObservation);
  const errors = normalized.flatMap((result, index) => result.ok ? [] : [{ index, defect: result.defect, explanation: result.explanation }]);
  if (errors.length > 0) return { ok: false, errors };
  const groups = new Map<string, { key: EconomicCohortKeyV1; values: Array<{ observation: EconomicObservationV1; quality: ObservationDataQualityV1 }> }>();
  for (const result of normalized) {
    if (!result.ok) continue;
    const key = economicCohortKey(result.value);
    const serialized = serializeEconomicCohortKey(key);
    const group = groups.get(serialized) ?? { key, values: [] };
    group.values.push({ observation: result.value, quality: result.quality });
    groups.set(serialized, group);
  }
  const value: readonly EconomicCohortAggregationV1[] = [...groups.values()]
    .sort((left, right) => serializeEconomicCohortKey(left.key).localeCompare(serializeEconomicCohortKey(right.key)))
    .map(({ key, values }): EconomicCohortAggregationV1 => {
    const observations = values.map(({ observation }) => observation);
    const failureCounts: Partial<Record<EconomicFailureCategoryV1, number>> = {};
    for (const observation of observations) if (observation.failureCategory !== null) {
      failureCounts[observation.failureCategory] = (failureCounts[observation.failureCategory] ?? 0) + 1;
    }
    const qualities = [...new Set(values.map(({ quality }) => quality))];
    const metrics = calculateCohortMetrics(observations.map(toEconomicAttempt), minimumSampleSize);
    const dataQuality: CohortDataQualityV1 = observations.length < minimumSampleSize
      ? 'insufficient_sample'
      : qualities.includes('outcome_missing') ? 'outcome_missing'
        : qualities.includes('pricing_missing') ? 'pricing_missing'
          : qualities.includes('cost_unsettled') ? 'cost_unsettled'
            : qualities.includes('partial') ? 'partial' : 'complete';
    return {
      schemaVersion: 1,
      cohort: key,
      attempts: observations.length,
      verified: observations.filter((value) => value.verified).length,
      failures: observations.filter((value) => !value.verified && value.outcomeClass !== 'outcome_unknown').length,
      noProgress: observations.filter((value) => value.failureCategory === 'no_progress').length,
      failureCounts,
      knownCostAttempts: observations.filter((value) => value.cost !== null).length,
      unknownCostAttempts: observations.filter((value) => value.cost === null).length,
      computeEconomics: metrics,
      dataQuality,
      observationQualities: qualities,
    };
  });
  return { ok: true, value };
}

export function invalidObservationReasons(results: readonly EconomicObservationResultV1[]): readonly EconomicReasonV1[] {
  return results.some((result) => !result.ok) ? ['invalid_value'] : [];
}
