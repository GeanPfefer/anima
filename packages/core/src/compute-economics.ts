export type EconomicReasonV1 =
  | 'pricing_missing'
  | 'pricing_invalid'
  | 'provider_mismatch'
  | 'model_mismatch'
  | 'currency_mismatch'
  | 'usage_inconsistent'
  | 'cost_unknown'
  | 'mixed_currencies'
  | 'no_attempts'
  | 'no_verified_results'
  | 'no_review_observations'
  | 'zero_useful_runtime'
  | 'sample_too_small'
  | 'invalid_value';

export type EconomicValueV1<T> =
  | { readonly status: 'known'; readonly value: T }
  | { readonly status: 'unavailable'; readonly reason: EconomicReasonV1 }
  | { readonly status: 'insufficient_data'; readonly reason: EconomicReasonV1 };

export interface MoneyV1 {
  readonly currency: string;
  readonly amount: number;
}

export interface ComputeCohortKeyV1 {
  readonly provider: string;
  readonly model: string;
  readonly capability: string;
  readonly taskClass: string;
  /** Optional for backwards compatibility; observation cohorts always supply it. */
  readonly placement?: string;
  readonly configVersion?: string;
}

export interface AttemptOutcomeV1 {
  readonly terminalResult: string;
  readonly reachedReview: boolean;
  readonly verified: boolean;
  readonly durationMs: number | null;
  /** Host-observed elapsed time from attempt start until review was reached. */
  readonly timeToReviewMs: number | null;
}

export interface ApiAttemptV1 extends AttemptOutcomeV1 {
  readonly schemaVersion: 1;
  readonly kind: 'api';
  readonly cohort: ComputeCohortKeyV1;
  readonly providerCallCount: number;
  /** Provider-reported total input, including cached input. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
}

export interface LocalAttemptV1 extends AttemptOutcomeV1 {
  readonly schemaVersion: 1;
  readonly kind: 'local';
  readonly cohort: ComputeCohortKeyV1;
  readonly runtimeMs: number;
  /** Externally supplied cost only. Energy and amortization are never inferred. */
  readonly monetaryCost: MoneyV1 | null;
}

export interface ProviderPricingV1 {
  readonly schemaVersion: 1;
  readonly provider: string;
  readonly model: string;
  readonly currency: string;
  readonly inputPerMillion: number;
  readonly cachedInputPerMillion?: number;
  readonly outputPerMillion: number;
  readonly effectiveFrom?: string;
  readonly sourceRef: string;
}

export interface EconomicAttemptV1 extends AttemptOutcomeV1 {
  readonly cohort: ComputeCohortKeyV1;
  readonly cost: EconomicValueV1<MoneyV1>;
}

export type DataQualityV1 = 'complete' | 'incomplete' | 'insufficient' | 'invalid';

export interface CohortMetricsV1 {
  readonly schemaVersion: 1;
  readonly cohort: ComputeCohortKeyV1 | null;
  readonly totalAttempts: number;
  readonly verifiedResults: number;
  readonly successRate: EconomicValueV1<number>;
  readonly totalCost: EconomicValueV1<MoneyV1>;
  readonly meanCostPerAttempt: EconomicValueV1<MoneyV1>;
  readonly costPerVerified: EconomicValueV1<MoneyV1>;
  readonly meanTimeToReviewMs: EconomicValueV1<number>;
  readonly dataQuality: DataQualityV1;
  readonly missingInputs: readonly EconomicReasonV1[];
}

export interface CloudWorkloadV1 {
  readonly workloadId: string;
  readonly cohort: ComputeCohortKeyV1;
  readonly usefulRuntimeSeconds: number;
  readonly attempts: readonly AttemptOutcomeV1[];
}

export interface CloudLeaseV1 {
  readonly schemaVersion: 1;
  readonly provider: string;
  readonly instanceClass: string;
  readonly currency: string;
  readonly hourlyRate: number;
  readonly billableSeconds: number;
  readonly usefulRuntimeSeconds: number;
  readonly bootSeconds?: number;
  readonly loadSeconds?: number;
  readonly idleSeconds?: number;
  readonly teardownSeconds?: number;
  readonly workloads: readonly CloudWorkloadV1[];
}

export interface CloudCostAllocationV1 {
  readonly workloadId: string;
  readonly cost: MoneyV1;
}

export interface CloudLeaseEconomicsV1 {
  readonly leaseCost: EconomicValueV1<MoneyV1>;
  /** The full lease cost is allocated by useful-runtime share; idle/boot/load never vanish. */
  readonly allocations: EconomicValueV1<readonly CloudCostAllocationV1[]>;
  readonly unallocatedOverheadSeconds: EconomicValueV1<number>;
}

const known = <T>(value: T): EconomicValueV1<T> => ({ status: 'known', value });
const unavailable = <T>(reason: EconomicReasonV1): EconomicValueV1<T> => ({ status: 'unavailable', reason });
const insufficient = <T>(reason: EconomicReasonV1): EconomicValueV1<T> => ({ status: 'insufficient_data', reason });
const finiteNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const nonNegativeInteger = (value: number): boolean => Number.isInteger(value) && value >= 0;
const validMoney = (money: MoneyV1): boolean => money.currency.trim().length > 0 && finiteNonNegative(money.amount);
const sameCohort = (left: ComputeCohortKeyV1, right: ComputeCohortKeyV1): boolean =>
  left.provider === right.provider && left.model === right.model
  && left.capability === right.capability && left.taskClass === right.taskClass
  && (left.placement ?? 'unknown') === (right.placement ?? 'unknown')
  && (left.configVersion ?? null) === (right.configVersion ?? null);

export function calculateApiAttemptCost(
  attempt: ApiAttemptV1,
  pricing: ProviderPricingV1 | null,
  expectedCurrency?: string,
): EconomicValueV1<MoneyV1> {
  if (!pricing) return unavailable('pricing_missing');
  if (pricing.provider !== attempt.cohort.provider) return unavailable('provider_mismatch');
  if (pricing.model !== attempt.cohort.model) return unavailable('model_mismatch');
  if (expectedCurrency !== undefined && pricing.currency !== expectedCurrency) return unavailable('currency_mismatch');
  const rates = [pricing.inputPerMillion, pricing.outputPerMillion, pricing.cachedInputPerMillion ?? pricing.inputPerMillion];
  if (pricing.currency.trim().length === 0 || pricing.sourceRef.trim().length === 0 || !rates.every(finiteNonNegative)) {
    return unavailable('pricing_invalid');
  }
  if (![attempt.inputTokens, attempt.outputTokens, attempt.cachedInputTokens, attempt.providerCallCount].every(nonNegativeInteger)
    || attempt.cachedInputTokens > attempt.inputTokens) {
    return unavailable('usage_inconsistent');
  }
  const uncachedInputTokens = attempt.inputTokens - attempt.cachedInputTokens;
  const amount = (
    uncachedInputTokens * pricing.inputPerMillion
    + attempt.cachedInputTokens * (pricing.cachedInputPerMillion ?? pricing.inputPerMillion)
    + attempt.outputTokens * pricing.outputPerMillion
  ) / 1_000_000;
  return known({ currency: pricing.currency, amount });
}

export function toApiEconomicAttempt(
  attempt: ApiAttemptV1,
  pricing: ProviderPricingV1 | null,
  expectedCurrency?: string,
): EconomicAttemptV1 {
  return { ...attempt, cost: calculateApiAttemptCost(attempt, pricing, expectedCurrency) };
}

export function toLocalEconomicAttempt(attempt: LocalAttemptV1): EconomicAttemptV1 {
  const cost = attempt.monetaryCost === null
    ? unavailable<MoneyV1>('cost_unknown')
    : validMoney(attempt.monetaryCost) ? known(attempt.monetaryCost) : unavailable<MoneyV1>('invalid_value');
  return { ...attempt, cost };
}

function uniqueReasons(values: readonly EconomicReasonV1[]): readonly EconomicReasonV1[] {
  return [...new Set(values)];
}

export function calculateCohortMetrics(
  attempts: readonly EconomicAttemptV1[],
  minimumSampleSize = 2,
): CohortMetricsV1 {
  const cohort = attempts[0]?.cohort ?? null;
  const invalidCohort = cohort !== null && attempts.some((attempt) => !sameCohort(cohort, attempt.cohort));
  const totalAttempts = attempts.length;
  const verifiedResults = attempts.filter((attempt) => attempt.verified).length;
  const reviewed = attempts.filter((attempt) => attempt.reachedReview && attempt.timeToReviewMs !== null);
  const invalidObservation = attempts.some((attempt) => (attempt.durationMs !== null && !finiteNonNegative(attempt.durationMs))
    || (attempt.timeToReviewMs !== null && !finiteNonNegative(attempt.timeToReviewMs))
    || (attempt.verified && !attempt.reachedReview));
  const knownCosts = attempts.filter((attempt): attempt is EconomicAttemptV1 & { cost: { status: 'known'; value: MoneyV1 } } => attempt.cost.status === 'known');
  const costReasons = attempts.flatMap((attempt) => attempt.cost.status === 'known' ? [] : [attempt.cost.reason]);
  const currencies = new Set(knownCosts.map((attempt) => attempt.cost.value.currency));
  const invalidCost = knownCosts.some((attempt) => !validMoney(attempt.cost.value));
  const allCostsKnown = knownCosts.length === totalAttempts && totalAttempts > 0;
  const totalCost = invalidCost || currencies.size > 1
    ? unavailable<MoneyV1>(currencies.size > 1 ? 'mixed_currencies' : 'invalid_value')
    : allCostsKnown
      ? known({ currency: knownCosts[0]!.cost.value.currency, amount: knownCosts.reduce((sum, attempt) => sum + attempt.cost.value.amount, 0) })
      : unavailable<MoneyV1>(costReasons[0] ?? 'cost_unknown');
  const successRate = totalAttempts === 0 ? insufficient<number>('no_attempts') : known(verifiedResults / totalAttempts);
  const meanCostPerAttempt = totalCost.status !== 'known'
    ? totalCost
    : known({ currency: totalCost.value.currency, amount: totalCost.value.amount / totalAttempts });
  const costPerVerified = totalCost.status !== 'known'
    ? totalCost
    : verifiedResults === 0
      ? insufficient<MoneyV1>('no_verified_results')
      : known({ currency: totalCost.value.currency, amount: totalCost.value.amount / verifiedResults });
  const meanTimeToReviewMs = reviewed.length === 0
    ? insufficient<number>('no_review_observations')
    : known(reviewed.reduce((sum, attempt) => sum + attempt.timeToReviewMs!, 0) / reviewed.length);
  const missingInputs = uniqueReasons([
    ...costReasons,
    ...(totalAttempts === 0 ? ['no_attempts' as const] : []),
    ...(verifiedResults === 0 ? ['no_verified_results' as const] : []),
    ...(reviewed.length === 0 ? ['no_review_observations' as const] : []),
    ...(totalAttempts > 0 && totalAttempts < minimumSampleSize ? ['sample_too_small' as const] : []),
    ...(invalidCohort || invalidObservation || invalidCost ? ['invalid_value' as const] : []),
    ...(currencies.size > 1 ? ['mixed_currencies' as const] : []),
  ]);
  const dataQuality: DataQualityV1 = invalidCohort || invalidObservation || invalidCost || currencies.size > 1
    ? 'invalid'
    : totalAttempts === 0 || totalAttempts < minimumSampleSize
      ? 'insufficient'
      : missingInputs.length > 0 ? 'incomplete' : 'complete';
  return {
    schemaVersion: 1, cohort, totalAttempts, verifiedResults, successRate, totalCost,
    meanCostPerAttempt, costPerVerified, meanTimeToReviewMs, dataQuality, missingInputs,
  };
}

export function calculateCloudLeaseEconomics(lease: CloudLeaseV1): CloudLeaseEconomicsV1 {
  const numeric = [lease.hourlyRate, lease.billableSeconds, lease.usefulRuntimeSeconds,
    lease.bootSeconds ?? 0, lease.loadSeconds ?? 0, lease.idleSeconds ?? 0, lease.teardownSeconds ?? 0];
  const workloadRuntime = lease.workloads.reduce((sum, workload) => sum + workload.usefulRuntimeSeconds, 0);
  if (lease.currency.trim().length === 0 || !numeric.every(finiteNonNegative)
    || lease.workloads.some((workload) => workload.workloadId.trim().length === 0 || !finiteNonNegative(workload.usefulRuntimeSeconds))
    || Math.abs(workloadRuntime - lease.usefulRuntimeSeconds) > 1e-9) {
    return {
      leaseCost: unavailable('invalid_value'), allocations: unavailable('invalid_value'),
      unallocatedOverheadSeconds: unavailable('invalid_value'),
    };
  }
  const leaseCost = { currency: lease.currency, amount: lease.hourlyRate * lease.billableSeconds / 3600 };
  const overhead = Math.max(0, lease.billableSeconds - lease.usefulRuntimeSeconds);
  if (lease.usefulRuntimeSeconds === 0) {
    return {
      leaseCost: known(leaseCost), allocations: insufficient('zero_useful_runtime'),
      unallocatedOverheadSeconds: known(overhead),
    };
  }
  let assigned = 0;
  const positive = lease.workloads.filter((workload) => workload.usefulRuntimeSeconds > 0);
  const allocations = positive.map((workload, index): CloudCostAllocationV1 => {
    const amount = index === positive.length - 1
      ? leaseCost.amount - assigned
      : leaseCost.amount * workload.usefulRuntimeSeconds / lease.usefulRuntimeSeconds;
    assigned += amount;
    return { workloadId: workload.workloadId, cost: { currency: lease.currency, amount } };
  });
  return { leaseCost: known(leaseCost), allocations: known(allocations), unallocatedOverheadSeconds: known(overhead) };
}

/**
 * Attributes an already allocated workload cost evenly to its attempts. This does not
 * claim that each attempt consumed an equal resource share: it is an explicit V1
 * accounting rule whose sum remains the workload's full share of the lease.
 */
export function toCloudEconomicAttempts(
  workload: CloudWorkloadV1,
  allocatedCost: EconomicValueV1<MoneyV1>,
): readonly EconomicAttemptV1[] {
  if (workload.attempts.length === 0) return [];
  const perAttempt = allocatedCost.status === 'known'
    ? known({ currency: allocatedCost.value.currency, amount: allocatedCost.value.amount / workload.attempts.length })
    : allocatedCost;
  return workload.attempts.map((attempt) => ({ ...attempt, cohort: workload.cohort, cost: perAttempt }));
}

export interface BreakEvenV1 {
  readonly comparison: 'api_cheaper' | 'cloud_cheaper' | 'equal';
  readonly requiredVerifiedPerBillableHour: number;
}

export function calculateBreakEven(
  apiCostPerVerified: EconomicValueV1<MoneyV1>,
  cloudCostPerVerified: EconomicValueV1<MoneyV1>,
  cloudHourlyPrice: MoneyV1,
): EconomicValueV1<BreakEvenV1> {
  if (apiCostPerVerified.status !== 'known') return apiCostPerVerified;
  if (cloudCostPerVerified.status !== 'known') return cloudCostPerVerified;
  if (!validMoney(cloudHourlyPrice) || cloudHourlyPrice.amount <= 0
    || !validMoney(apiCostPerVerified.value) || apiCostPerVerified.value.amount <= 0
    || !validMoney(cloudCostPerVerified.value)) return unavailable('invalid_value');
  if (apiCostPerVerified.value.currency !== cloudCostPerVerified.value.currency
    || apiCostPerVerified.value.currency !== cloudHourlyPrice.currency) return unavailable('currency_mismatch');
  const difference = apiCostPerVerified.value.amount - cloudCostPerVerified.value.amount;
  const comparison = Math.abs(difference) <= Number.EPSILON
    ? 'equal' : difference < 0 ? 'api_cheaper' : 'cloud_cheaper';
  return known({ comparison, requiredVerifiedPerBillableHour: cloudHourlyPrice.amount / apiCostPerVerified.value.amount });
}
