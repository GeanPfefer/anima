import type { Json } from '@anima/types';
import { projectInvestigationReview } from './investigation-review';
import { investigationFixture, investigationItem } from './__fixtures__/investigation-review';
import type { WorkEvent } from './types';

const patchData = (event: WorkEvent, patch: Record<string, Json | undefined>): WorkEvent => {
  const envelope = event.payload as { schema_version: number; data: Record<string, Json> };
  return { ...event, payload: { ...envelope, data: { ...envelope.data, ...patch } } };
};
describe('investigation review read model', () => {
  test.each(['conclusive', 'partial', 'inconclusive'] as const)('preserves %s, source, provenance and gaps without semantic promotion', outcome => {
    const f = investigationFixture(outcome);
    const review = projectInvestigationReview(investigationItem, [f.result, f.verifier]);
    expect(review).toMatchObject({ schemaVersion: 1, status: 'available', source: { eventId: 'result', seq: 100, proposalVersion: 2, attemptId: 'attempt' },
      investigation: f.investigation, limitations: ['A/B are attestations. Semantic truth requires human review.'],
      verifierRecorded: f.opinion, automaticAcceptanceCoverage: 'not_applicable', humanReview: { status: 'pending' } });
  });
  test('absence is distinct from malformed payload; programming is not an investigation', () => {
    expect(projectInvestigationReview(investigationItem, [])).toMatchObject({ status: 'not_submitted', investigation: null });
    expect(projectInvestigationReview({ ...investigationItem, intent: {} }, [])).toBeNull();
  });
  test('latest malformed result never falls back to an older valid one', () => {
    const f = investigationFixture();
    const bad = patchData({ ...f.result, id: 'latest' }, { executor_signal: { kind: 'result' } });
    expect(projectInvestigationReview(investigationItem, [f.result, f.verifier, bad])).toMatchObject({ status: 'invalid', source: { eventId: 'latest' } });
  });
  test.each([{ attempt_id: 'other' }, { work_item_id: 'other' }, { approved_proposal_version: 3 }])('rejects divergent envelope %j', patch => {
    const f = investigationFixture();
    expect(projectInvestigationReview(investigationItem, [patchData(f.result, patch)])).toMatchObject({ status: 'invalid', issue: 'correlation_mismatch' });
  });
  test('rejects wrong event owner and stale proposal without losing source identity', () => {
    const f = investigationFixture();
    expect(projectInvestigationReview(investigationItem, [{ ...f.result, workItemId: 'other' }])).toMatchObject({ issue: 'correlation_mismatch' });
    expect(projectInvestigationReview({ ...investigationItem, proposalVersion: 3 }, [f.result])).toMatchObject({ issue: 'stale_result', source: { proposalVersion: 2 } });
  });
  test.each([{}, { schemaVersion: 2 }, { ...investigationFixture().investigation, outcome: 'partial', gaps: [] }])('rejects invalid investigation %j', investigation => {
    const f = investigationFixture();
    const data = (f.result.payload as { data: Record<string, Json> }).data;
    const signal = data.executor_signal as Record<string, Json>;
    expect(projectInvestigationReview(investigationItem, [patchData(f.result, { executor_signal: { ...signal, investigation: investigation as Json } })])).toMatchObject({ issue: 'invalid_payload' });
  });
  test('rejects summary or snapshot mismatch', () => {
    const f = investigationFixture();
    expect(projectInvestigationReview(investigationItem, [patchData(f.result, { summary: 'invented' })])).toMatchObject({ issue: 'invalid_payload' });
    expect(projectInvestigationReview({ ...investigationItem, intent: { execution_spec: { executor: 'investigation-v1', effect_class: 'read_only', base_sha: 'b'.repeat(40) } } }, [f.result])).toMatchObject({ issue: 'invalid_payload' });
  });
  test.each(['result', 'attempt', 'item', 'version', 'envelope', 'author'] as const)('does not attach a divergent verifier: %s', mismatch => {
    const f = investigationFixture();
    const opinion = { ...f.opinion, ...(mismatch === 'result' ? { evidenceBasis: { ...f.opinion.evidenceBasis, resultEventId: 'other' } } : {}),
      ...(mismatch === 'attempt' ? { attemptId: 'other' } : {}), ...(mismatch === 'item' ? { workItemId: 'other' } : {}),
      ...(mismatch === 'version' ? { approvedProposalVersion: 3 } : {}) };
    const verifier = patchData({ ...f.verifier, ...(mismatch === 'author' ? { author: 'user' as const } : {}) },
      { opinion: opinion as unknown as Json, ...(mismatch === 'envelope' ? { attempt_id: 'other' } : {}) });
    expect(projectInvestigationReview(investigationItem, [f.result, verifier])?.verifierRecorded).toBeNull();
  });
  test('human acceptance requires a later user event correlated to this result', () => {
    const f = investigationFixture();
    expect(projectInvestigationReview({ ...investigationItem, state: 'completed' }, [f.result, f.verifier, f.accepted])?.humanReview).toEqual({ status: 'accepted', eventId: 'accept', resultEventId: 'result' });
    for (const accepted of [patchData(f.accepted, { accepted_result_event_id: 'other' }), { ...f.accepted, author: 'system' as const }, { ...f.accepted, proposalVersion: 1 }]) {
      expect(projectInvestigationReview(investigationItem, [f.result, accepted])?.humanReview.status).toBe('pending');
    }
    expect(projectInvestigationReview(investigationItem, [f.accepted, f.result])?.humanReview.status).toBe('pending');
  });
});
