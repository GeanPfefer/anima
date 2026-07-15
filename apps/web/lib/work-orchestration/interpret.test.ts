import { interpretWorkRequest } from './interpret';
describe('interpretação conservadora de trabalho', () => {
  test.each(['Como estão meus pilares?', 'Hoje corri por 30 minutos', 'Estou me sentindo cansado', 'Tenho uma ideia interessante'])('mantém conversa comum: %s', message => expect(interpretWorkRequest(message, 'm').kind).toBe('conversation'));
  test('pede esclarecimento para desejo vago', () => expect(interpretWorkRequest('Quero criar', 'm').kind).toBe('clarification_required'));
  test('cria candidato apenas para pedido operacional explícito', () => {
    const result = interpretWorkRequest('Quero implementar uma tela nova no Anima', 'message-id');
    expect(result.kind).toBe('work_candidate');
    if (result.kind !== 'work_candidate') return;
    expect(result.command.sourceMessageId).toBe('message-id');
    expect(result.command).not.toHaveProperty('userId'); expect(result.command).not.toHaveProperty('state'); expect(result.command).not.toHaveProperty('event'); expect(result.command).not.toHaveProperty('author');
  });
});
