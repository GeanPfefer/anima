import { buildOperationalProjectSnapshot, operationalEvidenceForContext, operationalStateForContext } from './project-operational-snapshot';

const snapshot = () => buildOperationalProjectSnapshot({
  generatedAt: '2026-08-24T16:00:00.000Z',
  items: [
    { id: 'active', capability: 'programming', state: 'in_progress', updatedAt: '2026-08-24T15:00:00.000Z' },
    { id: 'failed', capability: 'programming', state: 'in_progress', updatedAt: '2026-08-24T14:00:00.000Z' },
    { id: 'review', capability: 'architecture', state: 'review', updatedAt: '2026-08-24T13:00:00.000Z' },
    { id: 'blocked', capability: 'research', state: 'blocked', updatedAt: '2026-08-24T12:00:00.000Z' },
    { id: 'recovered', capability: 'planning', state: 'review', updatedAt: '2026-08-24T11:00:00.000Z' },
  ],
  events: [
    { workItemId: 'active', eventType: 'execution_started', author: 'system', occurredAt: '2026-08-24T15:00:00.000Z' },
    { workItemId: 'failed', eventType: 'execution_failed', author: 'executor', occurredAt: '2026-08-24T14:00:00.000Z' },
    { workItemId: 'review', eventType: 'result_submitted', author: 'executor', occurredAt: '2026-08-24T13:00:00.000Z' },
    { workItemId: 'review', eventType: 'host_observed_gate_evidence_recorded', author: 'system', occurredAt: '2026-08-24T12:59:00.000Z' },
    { workItemId: 'recovered', eventType: 'result_submitted', author: 'executor', occurredAt: '2026-08-24T11:00:00.000Z' },
    { workItemId: 'recovered', eventType: 'execution_failed', author: 'executor', occurredAt: '2026-08-23T11:00:00.000Z' },
  ],
  focus: { workItemId: 'active', updatedAt: '2026-08-24T15:30:00.000Z' },
});

test('projeta estado atual, foco, review, bloqueio e falha não superada', () => {
  const result = snapshot();
  expect(result.activeWork.map(item => item.itemRef)).toEqual(['active', 'failed', 'review', 'blocked', 'recovered']);
  expect(result.awaitingReview.map(item => item.itemRef)).toEqual(['review', 'recovered']);
  expect(result.blocked.map(item => item.itemRef)).toEqual(['blocked']);
  expect(result.recentlyFailed.map(item => item.itemRef)).toEqual(['failed']);
  expect(result.currentFocus?.itemRef).toBe('active');
});

test('define recente pela sequência sem inventar TTL e mantém timestamps auditáveis', () => {
  const result = snapshot();
  expect(result.temporalSemantics.recent).toContain('no wall-clock TTL');
  expect(result.coverage).toEqual({
    itemCount: 5,
    eventCount: 6,
    oldestEventAt: '2026-08-23T11:00:00.000Z',
    newestEventAt: '2026-08-24T15:00:00.000Z',
  });
  expect(result.recentVerifiedEvidence).toEqual([{
    itemRef: 'review', type: 'host_observed_gate_evidence_recorded', occurredAt: '2026-08-24T12:59:00.000Z',
  }]);
});

test('separa estado de evidência e nunca inclui payload bruto', () => {
  const result = snapshot();
  const state = operationalStateForContext(result);
  const evidence = operationalEvidenceForContext(result);
  expect(state).not.toContain('recentVerifiedEvidence');
  expect(evidence).not.toContain('activeWork');
  expect(`${state}${evidence}`).not.toMatch(/payload|original_request|prompt|secret/i);
  expect(state.length).toBeLessThanOrEqual(2_400);
  expect(evidence.length).toBeLessThanOrEqual(2_400);
  expect(JSON.parse(state)).toHaveProperty('triage');
  expect(JSON.parse(evidence)).toHaveProperty('recentVerifiedEvidence');
});

test('ausência de eventos vira incerteza em vez de saúde presumida', () => {
  const result = buildOperationalProjectSnapshot({
    generatedAt: '2026-08-24T16:00:00.000Z', items: [], events: [], focus: null,
  });
  expect(result.recentlyFailed).toEqual([]);
  expect(result.uncertainties).toEqual(expect.arrayContaining([
    expect.stringContaining('No work item'), expect.stringContaining('No event sequence'),
  ]));
});

test('limite atingido é exposto como incerteza e não como cobertura total', () => {
  const result = buildOperationalProjectSnapshot({
    generatedAt: '2026-08-24T16:00:00.000Z', items: [], events: [], focus: null,
    itemsTruncated: true, eventsTruncated: true,
  });
  expect(result.uncertainties).toEqual(expect.arrayContaining([
    expect.stringContaining('item projection reached its bound'),
    expect.stringContaining('event projection reached its bound'),
  ]));
});
