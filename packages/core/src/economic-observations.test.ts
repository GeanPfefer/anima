import {
  aggregateEconomicObservations,
  normalizeEconomicObservation,
  serializeEconomicCohortKey,
  type EconomicCohortKeyV1,
  type EconomicObservationV1,
} from './economic-observations';

const provenance = {
  identity: 'persisted', timestamps: 'host_observed', runtime: 'host_observed', outcome: 'persisted',
  hostObservedCallCount: 'host_observed', providerReportedUsage: 'provider_reported',
} as const;

const observation = (over: Partial<EconomicObservationV1> = {}): EconomicObservationV1 => ({
  schemaVersion: 1,
  workItemId: 'work-1',
  attemptId: 'attempt-1',
  cohort: { capability: 'coding', taskClass: 'simple', provider: 'openai', model: 'gpt-test', placement: 'api' },
  admittedAt: '2026-09-04T12:00:00.000Z',
  startedAt: '2026-09-04T12:00:01.000Z',
  finishedAt: '2026-09-04T12:00:11.000Z',
  reviewAt: '2026-09-04T12:00:12.000Z',
  runtimeMs: 10_000,
  timeToReviewMs: 11_000,
  reachedReview: true,
  verified: true,
  terminalClass: 'completed',
  failureCategory: null,
  outcomeClass: 'verified',
  usage: { hostObservedCallCount: 1, providerReported: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 10 } },
  cost: { kind: 'settled', money: { currency: 'USD', amount: 0.01 }, provenance: 'provider_reported' },
  reservedExposure: null,
  local: null,
  cloud: null,
  provenance,
  ...over,
});

const aggregate = (values: readonly EconomicObservationV1[]) => {
  const result = aggregateEconomicObservations(values);
  if (!result.ok) throw new Error(`unexpected invalid fixture: ${result.errors[0]?.defect}`);
  return result.value;
};

describe('economic observation validation', () => {
  test('accepts valid API evidence and preserves separate call/token provenance', () => {
    const result = normalizeEconomicObservation(observation());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.usage?.hostObservedCallCount).toBe(1);
      expect(result.value.usage?.providerReported?.inputTokens).toBe(100);
      expect(result.value.provenance.hostObservedCallCount).toBe('host_observed');
      expect(result.value.provenance.providerReportedUsage).toBe('provider_reported');
    }
  });

  test('accepts valid local evidence with unknown monetary cost', () => {
    const result = normalizeEconomicObservation(observation({
      cohort: { capability: 'coding', taskClass: 'simple', provider: 'ollama', model: 'qwen', placement: 'local' },
      usage: null, cost: null, local: { runtimeMs: 10_000, monetaryCost: null },
    }));
    expect(result).toMatchObject({ ok: true, quality: 'cost_unsettled' });
  });

  test('accepts valid cloud evidence', () => {
    const cloudCost = { kind: 'settled', money: { currency: 'USD', amount: 0.2 }, provenance: 'provider_reported' } as const;
    const result = normalizeEconomicObservation(observation({
      cohort: { capability: 'coding', taskClass: 'simple', provider: 'runpod', model: 'qwen', placement: 'cloud' },
      usage: null, cost: cloudCost,
      cloud: { leaseId: 'lease-1', instanceClass: 'gpu-24gb', billableSeconds: 60, usefulRuntimeSeconds: 10, attributedCost: cloudCost },
    }));
    expect(result).toMatchObject({ ok: true, quality: 'complete' });
  });

  test.each<[string, EconomicObservationV1, string]>([
    ['cached > input', observation({ usage: { hostObservedCallCount: 1, providerReported: { inputTokens: 1, outputTokens: 0, cachedInputTokens: 2 } } }), 'usage_inconsistent'],
    ['negative runtime', observation({ runtimeMs: -1 }), 'negative_runtime'],
    ['finished before started', observation({ finishedAt: '2026-09-04T11:59:00.000Z' }), 'reversed_timestamps'],
    ['review before start', observation({ reviewAt: '2026-09-04T12:00:00.000Z' }), 'reversed_timestamps'],
  ])('rejects %s', (_label, value, defect) => expect(normalizeEconomicObservation(value)).toMatchObject({ ok: false, defect }));

  test('derives missing runtime from timestamps without inventing host provenance', () => {
    const result = normalizeEconomicObservation(observation({ runtimeMs: null }));
    expect(result).toMatchObject({ ok: true, value: { runtimeMs: 10_000, provenance: { runtime: 'derived' } } });
  });

  test('missing cost stays unavailable and reserved exposure is not settlement', () => {
    const result = normalizeEconomicObservation(observation({
      cost: null,
      reservedExposure: { kind: 'reserved_exposure', money: { currency: 'USD', amount: 0.25 }, provenance: 'persisted' },
    }));
    expect(result).toMatchObject({ ok: true, quality: 'pricing_missing', value: { cost: null } });
  });

  test('review may be inconclusive without becoming VERIFIED', () => {
    const result = normalizeEconomicObservation(observation({
      verified: false, terminalClass: 'completed', failureCategory: 'review_inconclusive', outcomeClass: 'review_inconclusive',
    }));
    expect(result).toMatchObject({ ok: true, value: { reachedReview: true, verified: false } });
  });

  test('rejects inconsistent VERIFIED', () => {
    expect(normalizeEconomicObservation(observation({ reachedReview: false, reviewAt: null, timeToReviewMs: null })))
      .toMatchObject({ ok: false, defect: 'outcome_inconsistent' });
  });

  test('rejects useful cloud runtime greater than billable runtime', () => {
    expect(normalizeEconomicObservation(observation({
      cohort: { capability: 'coding', taskClass: 'simple', provider: 'runpod', model: 'qwen', placement: 'cloud' },
      usage: null,
      cloud: { leaseId: 'lease', instanceClass: 'gpu', billableSeconds: 5, usefulRuntimeSeconds: 6, attributedCost: null },
    }))).toMatchObject({ ok: false, defect: 'cloud_runtime_inconsistent' });
  });

  test('rejects currency mismatch across settled and attributed costs', () => {
    expect(normalizeEconomicObservation(observation({
      cohort: { capability: 'coding', taskClass: 'simple', provider: 'runpod', model: 'qwen', placement: 'cloud' },
      usage: null,
      cloud: { leaseId: 'lease', instanceClass: 'gpu', billableSeconds: 10, usefulRuntimeSeconds: 5,
        attributedCost: { kind: 'settled', money: { currency: 'EUR', amount: 1 }, provenance: 'provider_reported' } },
    }))).toMatchObject({ ok: false, defect: 'currency_mismatch' });
  });
});

describe('cohort identity', () => {
  test('same identity groups together', () => expect(aggregate([
    observation(), observation({ attemptId: 'attempt-2' }),
  ])).toHaveLength(1));

  test.each<[string, Partial<EconomicCohortKeyV1>]>([
    ['provider', { provider: 'other' }],
    ['model', { model: 'other' }],
    ['capability', { capability: 'planning' }],
    ['taskClass', { taskClass: 'architectural' }],
    ['placement', { placement: 'cloud' }],
  ])('%s difference separates cohorts', (_label, cohortChange) => {
    const other = observation({ attemptId: 'attempt-2', cohort: { ...observation().cohort, ...cohortChange } });
    if (other.cohort.placement === 'cloud') {
      Object.assign(other, { usage: null, cloud: { leaseId: 'l', instanceClass: 'gpu', billableSeconds: 10, usefulRuntimeSeconds: 10, attributedCost: null } });
    }
    expect(aggregate([observation(), other])).toHaveLength(2);
  });

  test('unknown taskClass is deterministic', () => {
    const result = normalizeEconomicObservation(observation({ cohort: { ...observation().cohort, taskClass: '' } }));
    expect(result).toMatchObject({ ok: true, value: { cohort: { taskClass: 'unknown' } } });
    expect(serializeEconomicCohortKey({ ...observation().cohort, taskClass: 'unknown' })).toContain('unknown');
  });
});

describe('aggregation into Compute Economics', () => {
  const failed = (failureCategory: EconomicObservationV1['failureCategory'], over: Partial<EconomicObservationV1> = {}) => observation({
    attemptId: `attempt-${failureCategory}`, verified: false, terminalClass: failureCategory === 'no_progress' ? 'no_progress' : 'failed',
    failureCategory, outcomeClass: failureCategory ?? 'outcome_unknown', ...over,
  });

  test('counts mixed success, failure, no_progress and infrastructure', () => {
    const cohort = aggregate([observation(), failed('no_progress'), failed('infrastructure')])[0]!;
    expect(cohort).toMatchObject({ attempts: 3, verified: 1, failures: 2, noProgress: 1,
      failureCounts: { no_progress: 1, infrastructure: 1 } });
    expect(cohort.computeEconomics.successRate).toEqual({ status: 'known', value: 1 / 3 });
  });

  test('known plus unknown cost is not summed as zero', () => {
    const cohort = aggregate([observation(), failed('gate_failed', { cost: null })])[0]!;
    expect(cohort).toMatchObject({ knownCostAttempts: 1, unknownCostAttempts: 1, dataQuality: 'pricing_missing' });
    expect(cohort.computeEconomics.totalCost.status).toBe('unavailable');
  });

  test('no VERIFIED keeps cost-per-verified insufficient', () => {
    const cohort = aggregate([failed('gate_failed'), failed('infrastructure')])[0]!;
    expect(cohort.computeEconomics.costPerVerified).toEqual({ status: 'insufficient_data', reason: 'no_verified_results' });
  });

  test('partial timestamps retain attempt and known review sample', () => {
    const partial = observation({ admittedAt: null, finishedAt: null, runtimeMs: null });
    const cohort = aggregate([partial, observation({ attemptId: 'attempt-2' })])[0]!;
    expect(cohort.attempts).toBe(2);
    expect(cohort.computeEconomics.meanTimeToReviewMs).toEqual({ status: 'known', value: 11_000 });
    expect(cohort.dataQuality).toBe('partial');
  });

  test('single observation is insufficient sample', () => expect(aggregate([observation()])[0]?.dataQuality).toBe('insufficient_sample'));

  test('invalid observation fails the whole aggregation closed', () => {
    expect(aggregateEconomicObservations([observation(), observation({ runtimeMs: -1 })]))
      .toMatchObject({ ok: false, errors: [{ index: 1, defect: 'negative_runtime' }] });
  });
});

describe('first OpenAI proof fixture', () => {
  const proof = observation({
    cohort: { capability: 'coding', taskClass: 'unknown', provider: 'openai', model: 'gpt-5.6-terra', placement: 'api' },
    runtimeMs: 14_900,
    usage: { hostObservedCallCount: 3, providerReported: { inputTokens: 4_123, outputTokens: 1_142, cachedInputTokens: 1_121 } },
    verified: false,
    terminalClass: 'completed',
    failureCategory: 'review_inconclusive',
    outcomeClass: 'review_inconclusive',
    cost: null,
    reservedExposure: { kind: 'reserved_exposure', money: { currency: 'USD', amount: 0.25 }, provenance: 'persisted' },
  });

  test('is review/inconclusive, retains usage, and never treats USD 0.25 as actual cost', () => {
    const normalized = normalizeEconomicObservation(proof);
    expect(normalized).toMatchObject({ ok: true, value: {
      reachedReview: true, verified: false, outcomeClass: 'review_inconclusive', cost: null,
      usage: { hostObservedCallCount: 3, providerReported: { inputTokens: 4_123, outputTokens: 1_142, cachedInputTokens: 1_121 } },
      reservedExposure: { kind: 'reserved_exposure', money: { amount: 0.25 } },
    } });
    const cohort = aggregate([proof])[0]!;
    expect(cohort.computeEconomics.totalCost).toEqual({ status: 'unavailable', reason: 'pricing_missing' });
    expect(cohort.verified).toBe(0);
  });
});
