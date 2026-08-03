import type { WorkEvent, WorkItem, WorkState } from '@anima/core';
import { buildHistoryPresentations, shouldRequestHostResume } from './mobile-history';

function item(state: WorkState, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'work-1', userId: 'user-1', sourceMessageId: 'msg-1', state, impactLevel: 'low', capability: 'programming',
    originalRequest: 'retomar', intent: {}, proposalVersion: 1,
    proposal: { schemaVersion: 1, data: { summary: 'Bloqueado', objective: 'Provar retomada', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  } as WorkItem;
}

const inputRequested = (): WorkEvent => ({
  id: 'evt-decision', workItemId: 'work-1', type: 'input_requested', author: 'anima', proposalVersion: 1,
  occurredAt: new Date(),
  payload: { data: {
    reason: 'architectural_decision', attempt_id: 'attempt-1',
    explanation: 'Continuar do checkpoint ou encerrar?', checkpoint_reference: 'cp-1',
    options: [
      { id: 'continuar', label: 'Continuar do checkpoint', effect: 'resume' },
      { id: 'encerrar', label: 'Encerrar o trabalho', effect: 'cancel' },
    ],
  } },
});

describe('montagem do histórico mobile (reuso da projeção compartilhada)', () => {
  test('reconstrói um item bloqueado com a decisão pendente e suas opções', () => {
    const [presentation] = buildHistoryPresentations([{ item: item('blocked'), events: [inputRequested()] }]);
    expect(presentation!.item.id).toBe('work-1');
    expect(presentation!.pendingDecision).not.toBeNull();
    expect(presentation!.pendingDecision!.options.map(option => option.id)).toEqual(['continuar', 'encerrar']);
    expect(presentation!.pendingDecision!.options.find(option => option.id === 'continuar')!.effect).toBe('resume');
  });

  test('preserva a ordem e a cardinalidade da lista de entrada', () => {
    const presentations = buildHistoryPresentations([
      { item: item('approved', { id: 'a' }), events: [] },
      { item: item('review', { id: 'b' }), events: [] },
    ]);
    expect(presentations.map(presentation => presentation.item.id)).toEqual(['a', 'b']);
  });

  test('lista vazia não inventa cartões', () => {
    expect(buildHistoryPresentations([])).toEqual([]);
  });
});

describe('decisão de pedir retomada ao host', () => {
  test('efeito resume + estado approved pede retomada', () => {
    expect(shouldRequestHostResume('resume', 'approved')).toBe(true);
  });
  test('efeito cancel NÃO pede retomada', () => {
    expect(shouldRequestHostResume('cancel', 'cancelled')).toBe(false);
  });
  test('resume sem estado approved NÃO pede retomada', () => {
    expect(shouldRequestHostResume('resume', 'review')).toBe(false);
    expect(shouldRequestHostResume('resume', 'blocked')).toBe(false);
  });
  test('efeito ausente NÃO pede retomada', () => {
    expect(shouldRequestHostResume(undefined, 'approved')).toBe(false);
  });
});
