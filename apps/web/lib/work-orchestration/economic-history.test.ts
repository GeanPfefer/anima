/** @jest-environment node */
import type { Json } from '@anima/types';
import { ECONOMIC_HISTORY_LIMIT, economicTaskClass, projectEconomicHistory } from './economic-history';

const query = { capability: 'programming' as const, taskClass: null, localModel: 'qwen3-coder:latest', openAIModel: 'gpt-5.6-terra' };
const coder = (over: Record<string, unknown> = {}) => ({
  id: 'coder-1', work_item_id: 'work-1', event_type: 'host_observed_coder_evidence_recorded', proposal_version: 1,
  created_at: '2026-09-04T12:00:15.000Z',
  payload: { schema_version: 1, data: { work_item_id: 'work-1', attempt_id: 'attempt-1', approved_proposal_version: 1, evidence: {
    schemaVersion: 1, workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 1,
    backendId: 'gpt-coder', durationMs: 14_900, outcome: 'succeeded', model: 'gpt-5.6-terra',
    placement: 'local', nodeId: null, providerCallCount: 3,
    providerUsage: { schemaVersion: 1, inputTokens: 4_123, outputTokens: 1_142, totalTokens: 5_265, cachedInputTokens: 1_121 },
    observedAt: '2026-09-04T12:00:14.900Z', ...over,
  } } } as unknown as Json,
});
const opinion = (verdict: 'verified' | 'inconclusive' = 'inconclusive') => ({
  id: 'op-1', work_item_id: 'work-1', event_type: 'verifier_opinion_recorded', proposal_version: 1,
  created_at: '2026-09-04T12:00:20.000Z', payload: { schema_version: 1, data: {
    work_item_id: 'work-1', attempt_id: 'attempt-1', approved_proposal_version: 1, opinion: {
      schemaVersion: 1, workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 1,
      verifierVersion: 'work-verifier-v2', verdict, restsOnAttestedEvidence: false,
      summary: { violations: 0, gaps: verdict === 'inconclusive' ? 1 : 0, checks: 7, attested: 0, independent: 7 }, findings: [],
      evidenceBasis: { resultEventId: 'result-1', observedEventId: 'git-1', observedGateEventId: 'gate-1', coverage: { git: true, gates: true } },
    },
  } } as unknown as Json,
});

describe('economic history adapter', () => {
  test('histórico inexistente produz economics insuficiente, não custo zero', () => {
    const result = projectEconomicHistory(query, [], [], []);
    expect(result.observations).toEqual([]);
    expect(result.signal.local).toMatchObject({ dataQuality: 'insufficient', totalAttempts: 0, totalCost: { status: 'unavailable' } });
    expect(result.signal.openai).toMatchObject({ dataQuality: 'insufficient', totalAttempts: 0, totalCost: { status: 'unavailable' } });
  });

  test('prova OpenAI real preserva usage, inconclusive e custo unsettled', () => {
    const result = projectEconomicHistory(query, [coder()], [opinion()], [{ id: 'work-1', capability: 'programming', intent: {} }], [
      { attempt_id: 'attempt-1', event_type: 'reserved', amount: 0.25, currency: 'USD' },
    ]);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      cohort: { taskClass: 'unknown', provider: 'openai', model: 'gpt-5.6-terra', placement: 'api' },
      runtimeMs: 14_900, reachedReview: true, verified: false, outcomeClass: 'review_inconclusive', cost: null,
      reservedExposure: { kind: 'reserved_exposure', money: { amount: 0.25, currency: 'USD' } },
      usage: { hostObservedCallCount: 3, providerReported: { inputTokens: 4_123, outputTokens: 1_142, cachedInputTokens: 1_121 } },
    });
    expect(result.openai).toMatchObject({ attempts: 1, verified: 0, dataQuality: 'insufficient_sample' });
    expect(result.signal.openai.totalCost).toEqual({ status: 'unavailable', reason: 'pricing_missing' });
  });

  test('Verifier verified é o único parecer contado como verified', () => {
    const result = projectEconomicHistory(query, [coder()], [opinion('verified')], [{ id: 'work-1', capability: 'programming', intent: {} }]);
    expect(result.observations[0]?.verified).toBe(true);
  });

  test('capability diferente e modelo diferente não contaminam a coorte', () => {
    const otherModel = coder({ model: 'gpt-other' });
    const result = projectEconomicHistory(query, [coder(), otherModel], [opinion()], [{ id: 'work-1', capability: 'research', intent: {} }]);
    expect(result.observations).toEqual([]);
  });

  test('taskClass diferente não contamina a coorte e ausência permanece unknown', () => {
    expect(economicTaskClass({})).toBe('unknown');
    const result = projectEconomicHistory({ ...query, taskClass: 'coding/simple' }, [coder()], [opinion()], [
      { id: 'work-1', capability: 'programming', intent: { taskClass: 'coding/architectural' } },
    ]);
    expect(result.observations).toEqual([]);
  });

  test('limite de leitura é explícito e bounded', () => expect(ECONOMIC_HISTORY_LIMIT).toBe(100));
});
