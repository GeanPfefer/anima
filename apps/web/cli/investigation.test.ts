import type { Json } from '@anima/types';
import type { WorkEvent, WorkItem, WorkOperationResult } from '@anima/core';
import { investigationFixture, investigationItem } from '../../../packages/core/src/work-orchestration/__fixtures__/investigation-review';
import { parseArgs } from './args';
import { resolveCommandWorkReference, runWorkEvidence, runWorkInvestigation, runWorkShow, type WorkOrchestrationPort } from './app';
import { renderHuman } from './render';
import { resolveWorkReference } from '@/lib/work-orchestration/work-reference';

const ok = <T>(value: T): WorkOperationResult<T> => ({ ok: true, value });
function port(events: readonly WorkEvent[], item: WorkItem = investigationItem): WorkOrchestrationPort {
  return {
    getItem: jest.fn(async () => ok(item)), listEvents: jest.fn(async () => ok(events)),
    listContexts: jest.fn(async () => ok([])), findResumableWorkItems: jest.fn(async () => ok([])),
    reviewResult: jest.fn(async () => { throw new Error('No mutation allowed'); }),
    resolveApproval: jest.fn(async () => { throw new Error('No mutation allowed'); }),
    withdrawApprovedWork: jest.fn(async () => { throw new Error('No mutation allowed'); }),
  };
}
describe('native investigation CLI', () => {
  test.each(['INV-10', investigationItem.id])('parses and resolves %s using the existing resolver', async input => {
    const parsed = parseArgs(['work', 'investigation', input, '--json']);
    expect(parsed).toEqual({ ok: true, command: { kind: 'work-investigation', id: input, json: true } });
    if (!parsed.ok) return;
    const lookup = { findByCanonicalSourceId: jest.fn(async () => [{ workItemId: investigationItem.id,
      state: 'review', proposalVersion: 2, createdAt: investigationItem.createdAt.toISOString(), intent: investigationItem.intent }]) };
    const resolved = await resolveCommandWorkReference(parsed.command, ref => resolveWorkReference(lookup, ref));
    expect(resolved).toMatchObject({ ok: true, command: { id: investigationItem.id } });
    expect(lookup.findByCanonicalSourceId).toHaveBeenCalledTimes(input === 'INV-10' ? 1 : 0);
  });
  test.each([[], ['INV-10', 'extra'], ['INV-10', '--reason', 'x'], ['INV-10', '--unknown'], ['INV-10', '--require-gate', 'x']].map(args => [args]))('rejects invalid arguments %j', args => {
    expect(parseArgs(['work', 'investigation', ...args]).ok).toBe(false);
  });
  test.each(['conclusive', 'partial', 'inconclusive'] as const)('returns complete structured JSON and human report for %s without mutation', async outcome => {
    const f = investigationFixture(outcome), service = port([f.result, f.verifier]);
    const result = await runWorkInvestigation(service, investigationItem.id);
    expect(result.exitCode).toBe(0);
    const json: unknown = JSON.parse(JSON.stringify(result.payload));
    expect(json).toMatchObject({ kind: 'work-investigation', schemaVersion: 1, reference: 'INV-10', question: 'Audit contracts',
      review: { investigation: f.investigation, verifierRecorded: f.opinion, humanReview: { status: 'pending' }, source: { seq: 100 } } });
    const human = renderHuman(result.payload);
    for (const finding of f.investigation.findings) expect(human).toContain(`[${finding.status}] ${finding.statement}`);
    expect(human).toContain('src/contract.ts@' + 'a'.repeat(40) + ':1-3');
    expect(human).toContain('C:no_new_prohibited_refs [ok/independent]');
    expect(human).toContain('A/B are attestations');
    expect(human).toContain('sem aceite registrado');
    expect(service.listContexts).not.toHaveBeenCalled();
    expect(service.reviewResult).not.toHaveBeenCalled();
    expect(service.resolveApproval).not.toHaveBeenCalled();
  });
  test('absent report is a successful explicit read; invalid and non-investigation are errors', async () => {
    const absent = await runWorkInvestigation(port([]), investigationItem.id);
    expect(absent).toMatchObject({ exitCode: 0, payload: { review: { status: 'not_submitted', investigation: null } } });
    expect(renderHuman(absent.payload)).toContain('ainda não submetido');
    expect(await runWorkInvestigation(port([], { ...investigationItem, intent: {} }), investigationItem.id)).toMatchObject({ exitCode: 1, payload: { code: 'not_investigation' } });
    const f = investigationFixture();
    const bad = { ...f.result, payload: { schema_version: 1, data: {} } };
    expect(await runWorkInvestigation(port([bad]), investigationItem.id)).toMatchObject({ exitCode: 1, payload: { ok: false } });
    const missing = port([]);
    missing.getItem = async () => ({ ok: false, error: { code: 'work_item_not_found', message: 'Item de trabalho não encontrado.', retryable: false } });
    expect(await runWorkInvestigation(missing, investigationItem.id)).toMatchObject({ exitCode: 1 });
  });
  test('shows human acceptance only from its canonical event, including completed items', async () => {
    const f = investigationFixture();
    const result = await runWorkInvestigation(port([f.result, f.verifier, f.accepted], { ...investigationItem, state: 'completed' }), investigationItem.id);
    expect(result.payload).toMatchObject({ review: { humanReview: { status: 'accepted', eventId: 'accept' } } });
    expect(renderHuman(result.payload)).toContain('aceito (evento accept)');
  });
  test('show/evidence separate technical checks from automatic acceptance and investigation gaps', async () => {
    const f = investigationFixture(), service = port([f.result, f.verifier]);
    const show = await runWorkShow(service, investigationItem.id);
    expect(show.payload).toMatchObject({ acceptance: { total: 1, covered: null, missing: null, criteria: [{ covered: null }] }, suggestedDecision: null,
      investigationReview: { investigation: { outcome: 'partial', gaps: ['Runtime not audited'] }, verifierRecorded: { verdict: 'verified' } } });
    const evidence = await runWorkEvidence(service, investigationItem.id);
    for (const result of [show, evidence]) {
      const human = renderHuman(result.payload);
      expect(human).toContain('Cobertura automática de aceite: não aplicável');
      expect(human).toContain('Runtime not audited');
      expect(human).not.toContain('0/1');
      expect(human).not.toContain('Verifier (agora)');
      expect(human).not.toContain('SEM covers');
    }
  });
  test('programming still has insufficient coverage and suggests changes', async () => {
    const f = investigationFixture();
    const result = await runWorkShow(port([f.result], { ...investigationItem, capability: 'programming', intent: {} }), investigationItem.id);
    expect(result.payload).toMatchObject({ acceptance: { total: 1, covered: 0, missing: 1 }, suggestedDecision: 'request_changes' });
    expect(result.payload).not.toHaveProperty('investigationReview');
    expect(renderHuman(result.payload)).toContain('Cobertura de aceite: 0/1');
  });
  test('divergent verifier is not used in show/evidence', async () => {
    const f = investigationFixture();
    const verifier = { ...f.verifier, payload: { schema_version: 1, data: { work_item_id: investigationItem.id,
      attempt_id: 'attempt', approved_proposal_version: 2, opinion: { ...f.opinion,
        evidenceBasis: { ...f.opinion.evidenceBasis, resultEventId: 'other' } } as unknown as Json } } };
    for (const runner of [runWorkShow, runWorkEvidence]) {
      expect((await runner(port([f.result, verifier]), investigationItem.id)).payload).toMatchObject({ verifierRecorded: null });
    }
  });
});
