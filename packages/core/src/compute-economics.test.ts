import {
  calculateApiAttemptCost,
  calculateBreakEven,
  calculateCloudLeaseEconomics,
  calculateCohortMetrics,
  toCloudEconomicAttempts,
  toApiEconomicAttempt,
  toLocalEconomicAttempt,
  type ApiAttemptV1,
  type CloudLeaseV1,
  type EconomicAttemptV1,
  type EconomicValueV1,
  type MoneyV1,
  type ProviderPricingV1,
} from './compute-economics';

const cohort = { provider: 'openai', model: 'model-a', capability: 'coding', taskClass: 'simple' } as const;
const apiAttempt = (over: Partial<ApiAttemptV1> = {}): ApiAttemptV1 => ({
  schemaVersion: 1, kind: 'api', cohort, providerCallCount: 1,
  inputTokens: 1_000_000, outputTokens: 100_000, cachedInputTokens: 0,
  terminalResult: 'completed', reachedReview: true, verified: true,
  durationMs: 1_000, timeToReviewMs: 1_000, ...over,
});
const pricing = (over: Partial<ProviderPricingV1> = {}): ProviderPricingV1 => ({
  schemaVersion: 1, provider: 'openai', model: 'model-a', currency: 'USD',
  inputPerMillion: 2, cachedInputPerMillion: 0.5, outputPerMillion: 10,
  sourceRef: 'catalog@2026-01', ...over,
});
const economicAttempt = (over: Partial<EconomicAttemptV1> = {}): EconomicAttemptV1 => ({
  cohort, terminalResult: 'completed', reachedReview: true, verified: true,
  durationMs: 1_000, timeToReviewMs: 1_000,
  cost: { status: 'known', value: { currency: 'USD', amount: 2 } }, ...over,
});
const money = (amount: number): EconomicValueV1<MoneyV1> => ({ status: 'known', value: { currency: 'USD', amount } });

describe('API pricing', () => {
  test('prices simple input plus output', () => {
    expect(calculateApiAttemptCost(apiAttempt(), pricing())).toEqual({ status: 'known', value: { currency: 'USD', amount: 3 } });
  });
  test('subtracts cached input before charging uncached input', () => {
    const result = calculateApiAttemptCost(apiAttempt({ cachedInputTokens: 400_000 }), pricing());
    expect(result).toEqual({ status: 'known', value: { currency: 'USD', amount: 2.4 } });
  });
  test('accepts cached input equal to zero', () => expect(calculateApiAttemptCost(apiAttempt(), pricing()).status).toBe('known'));
  test('rejects cached input greater than total input', () => {
    expect(calculateApiAttemptCost(apiAttempt({ inputTokens: 2, cachedInputTokens: 3 }), pricing())).toEqual({ status: 'unavailable', reason: 'usage_inconsistent' });
  });
  test('prices zero tokens as a known zero', () => {
    expect(calculateApiAttemptCost(apiAttempt({ inputTokens: 0, outputTokens: 0 }), pricing())).toEqual({ status: 'known', value: { currency: 'USD', amount: 0 } });
  });
  test('keeps cost unavailable without pricing', () => expect(calculateApiAttemptCost(apiAttempt(), null)).toEqual({ status: 'unavailable', reason: 'pricing_missing' }));
  test('rejects incompatible model', () => expect(calculateApiAttemptCost(apiAttempt(), pricing({ model: 'other' }))).toEqual({ status: 'unavailable', reason: 'model_mismatch' }));
  test('rejects incompatible provider and currency', () => {
    expect(calculateApiAttemptCost(apiAttempt(), pricing({ provider: 'other' }))).toEqual({ status: 'unavailable', reason: 'provider_mismatch' });
    expect(calculateApiAttemptCost(apiAttempt(), pricing(), 'EUR')).toEqual({ status: 'unavailable', reason: 'currency_mismatch' });
  });
  test('uses already aggregated usage regardless of multiple call count', () => {
    expect(calculateApiAttemptCost(apiAttempt({ providerCallCount: 3 }), pricing())).toEqual({ status: 'known', value: { currency: 'USD', amount: 3 } });
  });
  test('rejects negative usage and invalid pricing', () => {
    expect(calculateApiAttemptCost(apiAttempt({ outputTokens: -1 }), pricing())).toEqual({ status: 'unavailable', reason: 'usage_inconsistent' });
    expect(calculateApiAttemptCost(apiAttempt(), pricing({ inputPerMillion: Number.NaN }))).toEqual({ status: 'unavailable', reason: 'pricing_invalid' });
  });
  test('real proof fixture remains monetarily unavailable without a quote', () => {
    const proof = apiAttempt({ inputTokens: 4123, outputTokens: 1142, cachedInputTokens: 1121, providerCallCount: 3, durationMs: 14_900 });
    expect(toApiEconomicAttempt(proof, null).cost).toEqual({ status: 'unavailable', reason: 'pricing_missing' });
  });
});

describe('cohort metrics', () => {
  test('computes success rate', () => expect(calculateCohortMetrics([economicAttempt(), economicAttempt({ verified: false })]).successRate).toEqual({ status: 'known', value: 0.5 }));
  test('zero attempts is explicit', () => {
    const metrics = calculateCohortMetrics([]);
    expect(metrics.successRate).toEqual({ status: 'insufficient_data', reason: 'no_attempts' });
    expect(metrics.totalCost).toEqual({ status: 'unavailable', reason: 'cost_unknown' });
  });
  test('no VERIFIED is explicit', () => expect(calculateCohortMetrics([economicAttempt({ verified: false }), economicAttempt({ verified: false })]).costPerVerified).toEqual({ status: 'insufficient_data', reason: 'no_verified_results' }));
  test('computes total and mean cost per attempt', () => {
    const metrics = calculateCohortMetrics([economicAttempt(), economicAttempt({ cost: money(4) })]);
    expect(metrics.totalCost).toEqual(money(6));
    expect(metrics.meanCostPerAttempt).toEqual(money(3));
  });
  test('computes cost per VERIFIED', () => expect(calculateCohortMetrics([economicAttempt(), economicAttempt({ verified: false, cost: money(4) })]).costPerVerified).toEqual(money(6)));
  test('means time only across review observations', () => {
    const metrics = calculateCohortMetrics([economicAttempt(), economicAttempt({ timeToReviewMs: 3_000 })]);
    expect(metrics.meanTimeToReviewMs).toEqual({ status: 'known', value: 2_000 });
  });
  test('attempt not reaching review is excluded from time-to-review', () => {
    const metrics = calculateCohortMetrics([economicAttempt(), economicAttempt({ reachedReview: false, verified: false, timeToReviewMs: null })]);
    expect(metrics.meanTimeToReviewMs).toEqual({ status: 'known', value: 1_000 });
  });
  test('unknown local cost never becomes zero', () => {
    const local = toLocalEconomicAttempt({ schemaVersion: 1, kind: 'local', cohort: { ...cohort, provider: 'ollama' }, runtimeMs: 500,
      monetaryCost: null, terminalResult: 'completed', reachedReview: true, verified: true, durationMs: 500, timeToReviewMs: 500 });
    expect(calculateCohortMetrics([local]).totalCost).toEqual({ status: 'unavailable', reason: 'cost_unknown' });
  });
  test('reports small samples and refuses mixed currencies or cohorts', () => {
    expect(calculateCohortMetrics([economicAttempt()]).dataQuality).toBe('insufficient');
    expect(calculateCohortMetrics([economicAttempt(), economicAttempt({ cost: { status: 'known', value: { currency: 'EUR', amount: 1 } } })]).totalCost).toEqual({ status: 'unavailable', reason: 'mixed_currencies' });
    expect(calculateCohortMetrics([economicAttempt(), economicAttempt({ cohort: { ...cohort, taskClass: 'architectural' } })]).dataQuality).toBe('invalid');
  });
});

const cloudLease = (over: Partial<CloudLeaseV1> = {}): CloudLeaseV1 => ({
  schemaVersion: 1, provider: 'cloud', instanceClass: 'gpu-24gb', currency: 'USD',
  hourlyRate: 3.6, billableSeconds: 3600, usefulRuntimeSeconds: 1800,
  bootSeconds: 300, loadSeconds: 300, idleSeconds: 900, teardownSeconds: 300,
  workloads: [{ workloadId: 'a', cohort: { ...cohort, provider: 'cloud' }, usefulRuntimeSeconds: 1800, attempts: [apiAttempt()] }], ...over,
});

describe('cloud lease economics', () => {
  test('prices a full hour', () => expect(calculateCloudLeaseEconomics(cloudLease()).leaseCost).toEqual(money(3.6)));
  test('prices a fraction of an hour', () => expect(calculateCloudLeaseEconomics(cloudLease({ billableSeconds: 900, usefulRuntimeSeconds: 900, workloads: [{ ...cloudLease().workloads[0]!, usefulRuntimeSeconds: 900 }] })).leaseCost).toEqual(money(0.9)));
  test('includes idle in cost instead of dropping it', () => {
    const result = calculateCloudLeaseEconomics(cloudLease());
    expect(result.unallocatedOverheadSeconds).toEqual({ status: 'known', value: 1800 });
    expect(result.allocations).toEqual({ status: 'known', value: [{ workloadId: 'a', cost: { currency: 'USD', amount: 3.6 } }] });
  });
  test('allocates multiple workloads by useful runtime', () => {
    const result = calculateCloudLeaseEconomics(cloudLease({ usefulRuntimeSeconds: 1800, workloads: [
      { ...cloudLease().workloads[0]!, workloadId: 'a', usefulRuntimeSeconds: 600 },
      { ...cloudLease().workloads[0]!, workloadId: 'b', usefulRuntimeSeconds: 1200 },
    ] }));
    expect(result.allocations.status).toBe('known');
    if (result.allocations.status === 'known') {
      expect(result.allocations.value[0]?.cost.amount).toBeCloseTo(1.2);
      expect(result.allocations.value[1]?.cost.amount).toBeCloseTo(2.4);
    }
  });
  test('zero useful runtime keeps lease cost but refuses allocation', () => {
    const result = calculateCloudLeaseEconomics(cloudLease({ usefulRuntimeSeconds: 0, workloads: [] }));
    expect(result.leaseCost).toEqual(money(3.6));
    expect(result.allocations).toEqual({ status: 'insufficient_data', reason: 'zero_useful_runtime' });
  });
  test('lease without VERIFIED still has its full cost', () => {
    const workload = { ...cloudLease().workloads[0]!, attempts: [apiAttempt({ verified: false })] };
    expect(calculateCloudLeaseEconomics(cloudLease({ workloads: [workload] })).leaseCost).toEqual(money(3.6));
  });
  test('allocation sum exactly equals lease cost', () => {
    const workloads = [1, 1, 1].map((usefulRuntimeSeconds, index) => ({ ...cloudLease().workloads[0]!, workloadId: `${index}`, usefulRuntimeSeconds }));
    const result = calculateCloudLeaseEconomics(cloudLease({ usefulRuntimeSeconds: 3, workloads }));
    expect(result.allocations.status).toBe('known');
    if (result.allocations.status === 'known' && result.leaseCost.status === 'known') {
      expect(result.allocations.value.reduce((sum, allocation) => sum + allocation.cost.amount, 0)).toBe(result.leaseCost.value.amount);
    }
  });
  test('feeds full allocated workload cost into cost-per-VERIFIED metrics', () => {
    const workload = { ...cloudLease().workloads[0]!, attempts: [apiAttempt(), apiAttempt({ verified: false })] };
    const metrics = calculateCohortMetrics(toCloudEconomicAttempts(workload, money(3.6)));
    expect(metrics.totalCost).toEqual(money(3.6));
    expect(metrics.costPerVerified).toEqual(money(3.6));
  });
  test('rejects inconsistent useful-runtime totals', () => expect(calculateCloudLeaseEconomics(cloudLease({ usefulRuntimeSeconds: 1 })).allocations).toEqual({ status: 'unavailable', reason: 'invalid_value' }));
});

describe('break-even', () => {
  test('identifies API as cheaper', () => expect(calculateBreakEven(money(1), money(2), { currency: 'USD', amount: 4 })).toEqual({ status: 'known', value: { comparison: 'api_cheaper', requiredVerifiedPerBillableHour: 4 } }));
  test('identifies cloud as cheaper', () => expect(calculateBreakEven(money(2), money(1), { currency: 'USD', amount: 4 })).toEqual({ status: 'known', value: { comparison: 'cloud_cheaper', requiredVerifiedPerBillableHour: 2 } }));
  test('identifies equality', () => expect(calculateBreakEven(money(2), money(2), { currency: 'USD', amount: 4 })).toEqual({ status: 'known', value: { comparison: 'equal', requiredVerifiedPerBillableHour: 2 } }));
  test('propagates insufficient data', () => expect(calculateBreakEven({ status: 'insufficient_data', reason: 'no_verified_results' }, money(2), { currency: 'USD', amount: 4 })).toEqual({ status: 'insufficient_data', reason: 'no_verified_results' }));
  test('rejects zero or invalid price', () => expect(calculateBreakEven(money(2), money(2), { currency: 'USD', amount: 0 })).toEqual({ status: 'unavailable', reason: 'invalid_value' }));
  test('cannot compare a cohort with no VERIFIED', () => {
    const noVerified = calculateCohortMetrics([economicAttempt({ verified: false }), economicAttempt({ verified: false })]).costPerVerified;
    expect(calculateBreakEven(noVerified, money(2), { currency: 'USD', amount: 4 })).toEqual({ status: 'insufficient_data', reason: 'no_verified_results' });
  });
  test('rejects currency mismatch', () => expect(calculateBreakEven(money(2), money(2), { currency: 'EUR', amount: 4 })).toEqual({ status: 'unavailable', reason: 'currency_mismatch' }));
});
