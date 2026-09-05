import { calculateCohortMetrics, type EconomicAttemptV1 } from './compute-economics';
import { decideComputeRoute, type DecideComputeRouteInputV1 } from './compute-router';

const cohort = (provider: string) => ({ provider, model: provider === 'openai' ? 'gpt-x' : 'qwen', capability: 'programming', taskClass: 'coding/simple' });
const metrics = (provider: string, cost: number) => calculateCohortMetrics([0, 1].map((): EconomicAttemptV1 => ({
  cohort: cohort(provider), terminalResult: 'completed', reachedReview: true, verified: true,
  durationMs: 100, timeToReviewMs: 100, cost: { status: 'known', value: { currency: 'USD', amount: cost / 2 } },
})));
const input = (over: Partial<DecideComputeRouteInputV1> = {}): DecideComputeRouteInputV1 => ({
  schemaVersion: 1, workItemId: 'work-1', approvedProposalVersion: 1, capability: 'programming', taskClass: 'coding/simple', preferred: null,
  local: { provider: 'ollama', model: 'qwen', available: true, supportsCapability: true, modelFits: true, resourceClass: 'local:16gb' },
  resourceGovernor: 'permit', localFailure: 'none',
  openai: { provider: 'openai', model: 'gpt-x', available: true, supportsCapability: true, modelFits: true, resourceClass: 'provider_api:gpt-x' },
  paidAuthority: { status: 'authorized', authorizationId: 'auth-1', remainingExposure: { status: 'known', value: { currency: 'USD', amount: 1 } } },
  economics: null, ...over,
});

describe('Compute Router V1', () => {
  test('1 local admissible selects local', () => expect(decideComputeRoute(input())).toMatchObject({ status: 'selected', selectedProvider: 'ollama', reasonCode: 'local_sufficient' }));
  test('2 Governor deny plus authority selects OpenAI', () => expect(decideComputeRoute(input({ resourceGovernor: 'deny' }))).toMatchObject({ selectedProvider: 'openai', reasonCode: 'local_governor_denied' }));
  test('3 Governor deny without authority waits', () => expect(decideComputeRoute(input({ resourceGovernor: 'deny', paidAuthority: { status: 'missing', authorizationId: null, remainingExposure: { status: 'unavailable', reason: 'cost_unknown' } } }))).toMatchObject({ status: 'waiting_for_human_authorization', reasonCode: 'paid_authorization_required' }));
  test('4 incapable local model selects authorized OpenAI', () => expect(decideComputeRoute(input({ localFailure: 'model_capability' }))).toMatchObject({ selectedProvider: 'openai', reasonCode: 'local_model_incapable' }));
  test('5 no-progress history selects authorized OpenAI', () => expect(decideComputeRoute(input({ localFailure: 'no_progress' }))).toMatchObject({ selectedProvider: 'openai', reasonCode: 'local_no_progress' }));
  test('6 temporary local infrastructure never promotes paid', () => expect(decideComputeRoute(input({ localFailure: 'temporary_infrastructure' }))).toMatchObject({ status: 'blocked', selectedProvider: null, reasonCode: 'local_temporary_infrastructure' }));
  test('7 unavailable OpenAI leaves admissible local selected', () => expect(decideComputeRoute(input({ openai: { ...input().openai, available: false } }))).toMatchObject({ selectedProvider: 'ollama' }));
  test('8 no admissible provider blocks', () => expect(decideComputeRoute(input({ local: { ...input().local, available: false }, openai: { ...input().openai, available: false } }))).toMatchObject({ status: 'blocked', reasonCode: 'openai_unavailable' }));
  test('9 comparable economics can favor OpenAI', () => expect(decideComputeRoute(input({ economics: { local: metrics('ollama', 4), openai: metrics('openai', 2) } }))).toMatchObject({ selectedProvider: 'openai', reasonCode: 'economics_favors_openai' }));
  test('10 comparable economics favors local on lower cost', () => expect(decideComputeRoute(input({ economics: { local: metrics('ollama', 1), openai: metrics('openai', 2) } }))).toMatchObject({ selectedProvider: 'ollama', reasonCode: 'economics_favors_local' }));
  test('11 unavailable economics falls back deterministically', () => {
    const incomplete = calculateCohortMetrics([]);
    expect(decideComputeRoute(input({ economics: { local: incomplete, openai: incomplete } }))).toMatchObject({ selectedProvider: 'ollama', reasonCode: 'local_sufficient', economicsBasis: {
      used: false, localSampleSize: 0, openaiSampleSize: 0, localDataQuality: 'insufficient', openaiDataQuality: 'insufficient',
    } });
  });
  test('12 expired authority never selects paid', () => expect(decideComputeRoute(input({ resourceGovernor: 'deny', paidAuthority: { ...input().paidAuthority, status: 'expired', authorizationId: null } }))).toMatchObject({ status: 'waiting_for_human_authorization', selectedProvider: null }));
  test('13 incompatible paid model/resource never selects paid', () => expect(decideComputeRoute(input({ resourceGovernor: 'deny', openai: { ...input().openai, modelFits: false } }))).toMatchObject({ status: 'blocked', selectedProvider: null }));
  test('14 identical inputs produce identical decisions', () => expect(decideComputeRoute(input())).toEqual(decideComputeRoute(input())));
  test('15 reason and both alternatives are always populated', () => {
    const decision = decideComputeRoute(input());
    expect(decision.reason.length).toBeGreaterThan(0);
    expect(decision.reasonCode.length).toBeGreaterThan(0);
    expect(decision.alternativesConsidered).toHaveLength(2);
  });
  test('explicit approved preference selects authorized OpenAI', () => expect(decideComputeRoute(input({ preferred: { provider: 'openai', model: 'gpt-x' } }))).toMatchObject({ selectedProvider: 'openai', reasonCode: 'preferred_candidate', authorizationId: 'auth-1' }));
});
