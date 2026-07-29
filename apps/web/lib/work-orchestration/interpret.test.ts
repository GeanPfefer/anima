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

describe('UX-00 — intenção natural vira candidato a proposta', () => {
  // A mensagem exata do teste real que caía em conversa livre.
  const realMessage = 'Anima, analise os Planos 003 a 006 do projeto e prepare um resumo para mim. Organize esse trabalho de forma segura e me apresente a proposta antes de começar.';

  test('a mensagem real do teste vira work_candidate (analisar/preparar + planos/projeto)', () => {
    const result = interpretWorkRequest(realMessage, 'msg-real');
    expect(result.kind).toBe('work_candidate');
    if (result.kind !== 'work_candidate') return;
    expect(result.command.sourceMessageId).toBe('msg-real');
    expect(result.command.capability).toBe('research');
    expect(result.command.impactLevel).toBe('low');
    expect(result.command.intent).toMatchObject({ mode: 'construction', request_kind: 'investigate' });
  });

  test('a proposta é planning-first e não inventa alvo/arquivo/nó', () => {
    const result = interpretWorkRequest(realMessage, 'msg-real');
    if (result.kind !== 'work_candidate') throw new Error('esperado work_candidate');
    const data = result.command.proposal.data;
    // Não há execution_spec no intent: nada de alvo/permissões/limites inventados.
    expect(result.command.intent).not.toHaveProperty('execution_spec');
    // O excludedScope registra explicitamente que nada é lido antes de aprovação.
    expect(data.excludedScope.join(' ')).toMatch(/antes de aprova/i);
    expect(data.excludedScope.join(' ')).toMatch(/ler|executar|alterar/i);
    // O objetivo preserva o pedido original, sem afirmar leitura/execução.
    expect(data.objective).toContain('analise os Planos 003 a 006');
  });

  test.each([
    'Prepare uma proposta para revisar a arquitetura do banco',
    'Organize esse trabalho e me apresente a proposta antes de começar',
    'Analise os documentos do projeto e escreva um resumo',
    'Revise o backlog e prepare um relatório',
    'Documente a API do chat',
  ])('reconhece pedido de trabalho: %s', message => expect(interpretWorkRequest(message, 'm').kind).toBe('work_candidate'));

  test.each([
    'Não. Você descreveu conteúdos que não correspondem aos Planos',
    'O que você acha desses planos?',
    'prepare o jantar hoje',
    'vou organizar minha semana',
    'gostei do resumo que você fez',
  ])('não transforma conversa comum em trabalho: %s', message => expect(interpretWorkRequest(message, 'm').kind).toBe('conversation'));

  test('é determinística: a mesma mensagem produz o mesmo resultado', () => {
    const a = interpretWorkRequest(realMessage, 'x');
    const b = interpretWorkRequest(realMessage, 'x');
    expect(a).toEqual(b);
  });

  test('objeto de projeto sem verbo operacional não vira trabalho', () => {
    // "planos" presente, mas sem verbo operacional nem frase forte → conversa.
    expect(interpretWorkRequest('esses planos parecem interessantes', 'm').kind).toBe('conversation');
  });
});
