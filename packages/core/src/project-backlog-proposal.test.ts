import { interpretProjectBacklogConversation, isProjectBacklogMaterializationConfirmation, presentProjectBacklogProposal, validateProjectBacklogProposalDraft, type ProjectBacklogProposalDraft } from './project-backlog-proposal';

const work = (key: string, dependencies: string[] = []) => ({
  sliceKey: key, summary: `Slice ${key}`, objective: `Entregar ${key}`, impactLevel: 'structural' as const,
  capability: 'programming' as const, dependencies, intent: {},
  proposal: { schemaVersion: 1 as const, data: { summary: `Slice ${key}`, objective: `Entregar ${key}`, includedScope: ['apps/web'], excludedScope: ['infra'], expectedEffects: ['Prova local'], risks: ['Regressão'] } },
});
const draft: ProjectBacklogProposalDraft = { objective: 'Implementar local-first com cloud sob necessidade', slices: [work('inventory'), work('routing', ['inventory'])], rationale: 'Slices causais', exclusions: ['auto-provisioning'], uncertainties: [] };

describe('Backlog Proposal V0', () => {
  test('aceita proposta de slices executáveis, validáveis e dependentes', () => expect(validateProjectBacklogProposalDraft(draft)).toBeNull());
  test('recusa chave duplicada', () => expect(validateProjectBacklogProposalDraft({ ...draft, slices: [work('a'), work('a')] })).toBe('slice_key_duplicate'));
  test('recusa dependência ausente, própria ou duplicada', () => expect(validateProjectBacklogProposalDraft({ ...draft, slices: [work('aa', ['missing'])] })).toBe('slice_dependencies_invalid'));
  test('recusa work proposal inválida', () => expect(validateProjectBacklogProposalDraft({ ...draft, slices: [{ ...work('aa'), proposal: { ...work('aa').proposal, data: { ...work('aa').proposal.data, summary: '' } } }] })).toBe('slice_work_contract_invalid'));
  test.each(['Pode registrar isso no backlog.', 'Pode criar esses trabalhos.', 'Sim, coloca no backlog.'])('%s é confirmação inequívoca', message => expect(isProjectBacklogMaterializationConfirmation(message)).toBe(true));
  test.each(['Legal.', 'Parece bom.', 'Interessante.'])('%s não materializa', message => expect(interpretProjectBacklogConversation(message, true)).toEqual({ kind: 'conversation' }));
  test('confirmação sem proposta pendente não tem efeito', () => expect(interpretProjectBacklogConversation('Pode registrar.', false)).toEqual({ kind: 'conversation' }));
  test('pedido de mudança preserva texto humano', () => expect(interpretProjectBacklogConversation('Não quero cloud provisioning ainda.', true)).toMatchObject({ kind: 'request_changes' }));
  test('apresentação é conversa natural', () => expect(presentProjectBacklogProposal(draft)).toContain('Quer que eu registre esses trabalhos no backlog?'));
});
