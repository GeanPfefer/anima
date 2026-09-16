import type { Json } from '@anima/types';
import { resolveAutonomousWorkSelection, type AutonomousQueueCandidate, type WorkItem, type WorkIntelligenceClassificationV1 } from '..';

const classification: WorkIntelligenceClassificationV1 = {
  schemaVersion: 1, complexity: 'bounded', risk: 'low', reversibility: 'reversible', planClarity: 'clear', urgency: 'normal',
  provenance: { kind: 'system_assessed', classifiedAt: '2026-09-01T00:00:00.000Z', classifierId: 'host-test', policyVersion: 'test-v1' },
};
const item = (id: string, state: WorkItem['state'], created: string, deps: string[] = []): WorkItem => ({
  id, userId: 'u', sourceMessageId: `m-${id}`, state, impactLevel: 'low', capability: 'programming', originalRequest: 'x',
  intent: { execution_spec: { schema_version: 1, target: { kind: 'project', reference: `G:/anima/${id}` }, permissions: ['read', 'write'], validation_criteria: [{ label: 'test', command: 'npm test' }], limits: { max_attempts: 1 }, depends_on_work_item_ids: deps } as Json },
  proposal: { schemaVersion: 1, data: { summary: id, objective: 'obj', includedScope: [id], excludedScope: ['cloud'], expectedEffects: ['feito'], risks: [] } },
  proposalVersion: 1, createdAt: new Date(created), updatedAt: new Date(created),
});
const candidate = (work: WorkItem, seq: number): AutonomousQueueCandidate => ({
  item: work, currentClassification: classification,
  approval: work.state === 'approved' ? { seq, approvedAt: work.createdAt, proposalVersion: 1 } : null, openClaim: null,
});
const decide = (items: WorkItem[], seqs: Record<string, number> = {}, lineage: { predecessorId: string; successorId: string; recoverySequence: number }[] = []) =>
  resolveAutonomousWorkSelection({ candidates: items.map(value => candidate(value, seqs[value.id] ?? 1)), observedItems: items, lineage, now: new Date('2026-09-09T00:00:00Z') });

describe('seleção autônoma conversacional canônica', () => {
  test('múltiplos failed substituídos não pedem ID', () => {
    const result = decide([item('old-a', 'failed', '2026-09-01'), item('old-b', 'failed', '2026-09-02')], {}, [
      { predecessorId: 'old-a', successorId: 'next-a', recoverySequence: 1 }, { predecessorId: 'old-b', successorId: 'next-b', recoverySequence: 1 },
    ]);
    expect(result.outcome).toBe('none_eligible');
    expect(result.evidence.eliminated.every(entry => entry.reason === 'superseded_by_successor')).toBe(true);
  });
  test('predecessor failed resolve para successor executável', () => {
    const predecessor = item('old', 'failed', '2026-09-01'); const successor = item('next', 'approved', '2026-09-02');
    const result = decide([predecessor, successor], { next: 7 }, [{ predecessorId: 'old', successorId: 'next', recoverySequence: 1 }]);
    expect(result).toMatchObject({ outcome: 'selected', workItemId: 'next' });
    expect(result.evidence.eliminated).toContainEqual({ workItemId: 'old', reason: 'superseded_by_successor', canonicalSuccessorId: 'next' });
  });
  test('item diretamente elegível único é selecionado', () => expect(decide([item('only', 'approved', '2026-09-01')])).toMatchObject({ outcome: 'selected', workItemId: 'only' }));
  test('vários elegíveis usam FIFO de aprovação', () => {
    const result = decide([item('newer', 'approved', '2026-09-02'), item('older', 'approved', '2026-09-01')], { newer: 20, older: 10 });
    expect(result).toMatchObject({ outcome: 'selected', workItemId: 'older', rationale: { policy: 'oldest_approval_first' } });
  });
  test('nenhum elegível retorna barreira sem inventar trabalho', () => expect(decide([item('blocked', 'blocked', '2026-09-01')])).toMatchObject({ outcome: 'none_eligible' }));
  test('fronteira realmente humana pede intervenção', () => expect(decide([item('review', 'review', '2026-09-01')])).toMatchObject({ outcome: 'human_decision_required', workItemIds: ['review'] }));
  test('fronteira humana histórica substituída não reaparece como decisão pendente', () => {
    const result = decide([item('old-review', 'changes_requested', '2026-09-01')], {}, [
      { predecessorId: 'old-review', successorId: 'current', recoverySequence: 1 },
    ]);
    expect(result).toMatchObject({ outcome: 'none_eligible' });
  });
});
