import { isActiveWorkState, isTerminalWorkState, isValidApprovalDecision, isValidProposalVersion, isValidWorkIntent, isValidWorkProposal, isValidWorkResult, isWaitingForUserWorkState, type WorkProposal } from '.';
const proposal: WorkProposal = { schemaVersion: 1, data: { summary: 'Resumo', objective: 'Objetivo', includedScope: ['a'], excludedScope: [], expectedEffects: ['b'], risks: [] } };
describe('domínio da orquestração', () => {
  test('aceita proposta V1 válida', () => expect(isValidWorkProposal(proposal)).toBe(true));
  test('recusa texto vazio', () => expect(isValidWorkProposal({ ...proposal, data: { ...proposal.data, summary: ' ' } })).toBe(false));
  test('valida intenção objeto', () => { expect(isValidWorkIntent({ kind: 'build' })).toBe(true); expect(isValidWorkIntent([] as never)).toBe(false); });
  test('valida resultado', () => { expect(isValidWorkResult({ summary: 'feito', resultReferences: ['ref'] })).toBe(true); expect(isValidWorkResult({ summary: '', resultReferences: [] })).toBe(false); });
  test('exige contexto nas decisões', () => { expect(isValidApprovalDecision({ type: 'request_changes', requestedChanges: '' })).toBe(false); expect(isValidApprovalDecision({ type: 'defer', reason: 'depois' })).toBe(true); });
  test('exige versão inteira positiva', () => { expect(isValidProposalVersion(1)).toBe(true); expect(isValidProposalVersion(0)).toBe(false); expect(isValidProposalVersion(1.5)).toBe(false); });
  test('classifica estados', () => { expect(isTerminalWorkState('completed')).toBe(true); expect(isWaitingForUserWorkState('review')).toBe(true); expect(isActiveWorkState('in_progress')).toBe(true); });
});
