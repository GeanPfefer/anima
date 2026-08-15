import type { WorkPresentation, WorkResultProjection, WorkState } from '@anima/core';
import { describeMissingCompletedResult, presentMobileWorkResult, presentMobileWorkVerification } from './mobile-work-result';

const result: WorkResultProjection = {
  eventId: 'result-3', proposalVersion: 3, author: 'executor', summary: 'Correção entregue',
  references: ['commit:abc123', 'artifact:qa'],
  validations: [{ label: 'typecheck mobile', outcome: 'passed' }, { label: 'teste físico', outcome: 'failed' }],
  limitations: ['sem teste offline'],
  handoffReference: 'runner-bundle:mobile',
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
      handoff: 'runner-bundle:mobile',
      completionMessage: expect.stringContaining('evidências preservadas'),
    });
  });

  test('declara ausências opcionais sem crash', () => {
    const content = presentMobileWorkResult(presentation('completed', { acceptedResult: { ...result, references: [], validations: null, limitations: null, handoffReference: null } }));
    expect(content).toMatchObject({ references: 'nenhuma referência informada', validations: 'nenhuma validação registrada', limitations: 'nenhuma limitação declarada', handoff: 'nenhuma referência de handoff' });
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

describe('apresentação do parecer advisory no cartão mobile', () => {
  const report = (verdict: 'verified' | 'inconclusive' | 'rejected', issues: Array<{ code: string; severity: 'ok' | 'gap' | 'violation'; detail: string }> = []) =>
    ({ schemaVersion: 1 as const, verdict, workItemId: 'work-1', attemptId: 'a1', approvedProposalVersion: 3,
      findings: [{ code: 'correlation_verified', severity: 'ok' as const, detail: 'ok' }, ...issues],
      summary: { violations: issues.filter(i => i.severity === 'violation').length, gaps: issues.filter(i => i.severity === 'gap').length, checks: 1 + issues.length },
      advisory: true as const });

  test('sem parecer ⇒ null (não inventa verificação)', () => {
    expect(presentMobileWorkVerification(presentation('review', { latestResult: result }))).toBeNull();
  });

  test('parecer verified traz o rótulo sem listar violações', () => {
    const content = presentMobileWorkVerification(presentation('review', { latestResult: result, verification: report('verified') as unknown as WorkPresentation['verification'] }));
    expect(content?.verdictLabel).toContain('evidência suficiente e coerente');
    expect(content?.issues).toEqual([]);
  });

  test('parecer rejeitado lista as violações estruturadas', () => {
    const content = presentMobileWorkVerification(presentation('review', { latestResult: result, verification: report('rejected', [{ code: 'change_out_of_included_scope', severity: 'violation', detail: 'Arquivo fora do escopo.' }]) as unknown as WorkPresentation['verification'] }));
    expect(content?.verdictLabel).toContain('violação ou incoerência');
    expect(content?.issues).toEqual(['Violação: Arquivo fora do escopo.']);
  });
});
