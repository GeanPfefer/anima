import type { WorkPresentation, WorkResultProjection, WorkState } from '@anima/core';
import { describeMissingCompletedResult, presentMobileWorkResult } from './mobile-work-result';

const result: WorkResultProjection = {
  eventId: 'result-3', proposalVersion: 3, author: 'executor', summary: 'Correção entregue',
  references: ['commit:abc123', 'artifact:qa'],
  validations: [{ label: 'typecheck mobile', outcome: 'passed' }, { label: 'teste físico', outcome: 'failed' }],
  limitations: ['sem teste offline'],
};

function presentation(state: WorkState, overrides: Partial<WorkPresentation> = {}): WorkPresentation {
  return {
    item: {
      id: 'work-1', userId: 'user-1', sourceMessageId: 'message-1', state, impactLevel: 'low', capability: 'programming',
      originalRequest: 'corrigir cartão', intent: {}, proposalVersion: 3,
      proposal: { schemaVersion: 1, data: { summary: 'Cartão mobile', objective: 'Exibir resultado', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
      createdAt: new Date(), updatedAt: new Date(),
    },
    latestResult: null, acceptedResult: null, latestEventType: null, availableActions: [], ...overrides,
  };
}

describe('apresentação do resultado no cartão mobile', () => {
  test('exibe resultado aceito e todas as evidências tipadas em completed', () => {
    const content = presentMobileWorkResult(presentation('completed', { acceptedResult: result }));
    expect(content).toMatchObject({
      accessibilityLabel: 'Resultado aceito', title: 'Resultado aceito · v3 · executor',
      summary: expect.stringContaining('Correção entregue'), references: 'commit:abc123, artifact:qa',
      validations: 'typecheck mobile — passou; teste físico — falhou', limitations: 'sem teste offline',
      completionMessage: expect.stringContaining('evidências preservadas'),
    });
  });

  test('declara ausências opcionais sem crash', () => {
    const content = presentMobileWorkResult(presentation('completed', { acceptedResult: { ...result, references: [], validations: null, limitations: null } }));
    expect(content).toMatchObject({ references: 'nenhuma referência informada', validations: 'nenhuma validação registrada', limitations: 'nenhuma limitação declarada' });
  });

  test('completed sem resultado não inventa evidências e expõe a lacuna', () => {
    const value = presentation('completed');
    expect(presentMobileWorkResult(value)).toBeNull();
    expect(describeMissingCompletedResult(value)).toContain('não puderam ser verificadas');
  });

  test.each<WorkState>(['proposed', 'approved', 'in_progress', 'blocked', 'changes_requested', 'failed', 'rejected', 'cancelled'])('não altera o estado %s', state => {
    const value = presentation(state, { latestResult: result, acceptedResult: result });
    expect(presentMobileWorkResult(value)).toBeNull();
    expect(describeMissingCompletedResult(value)).toBeNull();
  });

  test('preserva a apresentação anterior no estado review', () => {
    expect(presentMobileWorkResult(presentation('review', { latestResult: result }))).toMatchObject({ accessibilityLabel: 'Resultado para revisão', title: 'Resultado · v3 · executor' });
  });
});
