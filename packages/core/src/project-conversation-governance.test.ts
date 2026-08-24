import { interpretProjectConversationGovernance, isProjectDecisionConfirmation, presentProjectDecisionProposal, type PendingProjectDecision } from './project-conversation-governance';

const A: PendingProjectDecision = { id: 'a', version: 1, statement: 'Execução local primeiro; cloud só quando necessário.' };
const B: PendingProjectDecision = { id: 'b', version: 1, statement: 'Priorizar mobile.' };
const run = (message: string, pending: readonly PendingProjectDecision[] = []) => interpretProjectConversationGovernance({ message, pending });

describe('governança de conversa de projeto', () => {
  test.each(['E se usássemos Kubernetes?', 'Você acha que cloud faria sentido?', 'Quais seriam as alternativas?'])('%s permanece exploração', message => expect(run(message)).toMatchObject({ kind: 'conversation', phase: 'exploration' }));
  test.each(['Talvez seja melhor trocar o banco.', 'Estou pensando em priorizar mobile.', 'Não sei ainda.'])('%s não ratifica', message => expect(run(message).kind).toBe('conversation'));
  test('preferência explícita e substancial produz proposta, ainda não decisão', () => expect(run('Eu prefiro local primeiro e cloud só quando realmente precisar.')).toMatchObject({ kind: 'propose' }));
  test('preferência vaga continua conversa', () => expect(run('Prefiro local.')).toMatchObject({ kind: 'conversation' }));
  test.each(['Sim.', 'Isso.', 'Pode registrar.', 'É exatamente isso.', 'Concordo.'])('%s confirma a única proposta pendente', message => expect(run(message, [A])).toEqual({ kind: 'ratify', proposal: A }));
  test('sim sem proposta não ratifica', () => expect(run('Sim.')).toMatchObject({ kind: 'conversation' }));
  test('confirmação pode ser reconhecida sem conceder autoridade de ratificação', () => {
    expect(isProjectDecisionConfirmation('Sim.')).toBe(true);
    expect(isProjectDecisionConfirmation('Talvez.')).toBe(false);
  });
  test('sim com duas propostas pede esclarecimento', () => expect(run('Sim.', [A, B])).toEqual({ kind: 'clarification_required', proposals: [A, B] }));
  test.each(['Não.', 'Não é isso.', 'Prefiro não decidir isso agora.', 'Descarta essa ideia.'])('%s rejeita somente a pendente inequívoca', message => expect(run(message, [A])).toEqual({ kind: 'reject', proposal: A }));
  test.each(['Quase, mas cloud só se não couber localmente.', 'Não foi isso que eu quis dizer. Troca a condição.', 'Troca essa parte: custo precisa de limite.'])('%s pede revisão sem ratificar', message => expect(run(message, [A])).toMatchObject({ kind: 'request_changes', proposal: A }));
  test('silêncio não é consentimento', () => expect(run('', [A])).toMatchObject({ kind: 'conversation' }));
  test('apresentação é natural e não expõe comando interno', () => expect(presentProjectDecisionProposal(A)).toBe('Só para confirmar: você quer registrar como direção do projeto: “Execução local primeiro; cloud só quando necessário.”. É isso?'));
});
