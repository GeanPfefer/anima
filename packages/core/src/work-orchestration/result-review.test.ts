import { planResultReview, type WorkEvent, type WorkItem } from '.';

const item = {
  id: 'i', userId: 'u', sourceMessageId: 'm', state: 'review', impactLevel: 'low', capability: 'programming',
  originalRequest: 'x', intent: {},
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
  proposalVersion: 2, createdAt: new Date(), updatedAt: new Date(),
} satisfies WorkItem;
const result = {
  id: 'r', workItemId: 'i', type: 'result_submitted', author: 'executor', proposalVersion: 2,
  payload: { schema_version: 1, data: { summary: 'feito', result_references: ['commit:a'] } }, occurredAt: new Date(),
} satisfies WorkEvent;

describe('plano puro de revisão de resultado', () => {
  test('monta o comando request_changes com a correlação derivada do último resultado', () => {
    const plan = planResultReview(item, [result], { type: 'request_changes', requestedChanges: 'faltam provas' });
    expect(plan).toEqual({
      ok: true,
      command: {
        workItemId: 'i',
        expectedProposalVersion: 2,
        reviewedResultEventId: 'r',
        decision: { type: 'request_changes', requestedChanges: 'faltam provas' },
      },
    });
  });

  test('monta o comando accept com a mesma correlação', () => {
    const plan = planResultReview(item, [result], { type: 'accept' });
    expect(plan).toMatchObject({ ok: true, command: { reviewedResultEventId: 'r', decision: { type: 'accept' } } });
  });

  test('recusa fechado quando o item não está em review', () => {
    expect(planResultReview({ ...item, state: 'in_progress' }, [result], { type: 'accept' }))
      .toEqual({ ok: false, reason: 'not_in_review' });
  });

  test('recusa fechado quando não há resultado submetido reconstituível', () => {
    expect(planResultReview(item, [], { type: 'request_changes', requestedChanges: 'x' }))
      .toEqual({ ok: false, reason: 'no_reviewable_result' });
  });

  test('recusa fechado quando o resultado é de uma versão de proposta anterior', () => {
    const stale = { ...result, proposalVersion: 1, payload: { schema_version: 1, data: { summary: 'antigo', result_references: [] } } } satisfies WorkEvent;
    expect(planResultReview(item, [stale], { type: 'accept' }))
      .toEqual({ ok: false, reason: 'result_version_mismatch' });
  });
});
