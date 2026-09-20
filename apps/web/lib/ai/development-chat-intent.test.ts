import { classifyDevelopmentChatIntent } from './development-chat-intent';

const CASE_1 = 'Quero corrigir um bug de fronteira no getEraForLevel: abaixo de MIN_LEVEL deve continuar retornando a primeira era e acima de MAX_LEVEL deve retornar a última era. Adicione cobertura explícita para esses dois limites. Limite a mudança a packages/core/src/levels.ts e packages/core/src/levels.test.ts.';
const CASE_2 = 'Não estou me referindo a nenhum work item existente. Quero criar um novo trabalho de programação, independente dos itens anteriores, para corrigir o bug de fronteira em getEraForLevel. Abaixo de MIN_LEVEL deve continuar retornando a primeira era e acima de MAX_LEVEL deve retornar a última era. Adicione cobertura explícita para esses dois limites. Limite a mudança a packages/core/src/levels.ts e packages/core/src/levels.test.ts. Não reutilize, retome ou selecione nenhum item completed/cancelled existente. Crie uma nova proposta para este trabalho.';
const COMPLETED = '11111111-1111-4111-8111-111111111111';

describe('classificação canônica da intenção Dev', () => {
  test.each([CASE_1, CASE_2])('as mensagens reais são novo trabalho, não handlers de item: %s', message => {
    const result = classifyDevelopmentChatIntent({ message });
    expect(result.kind).toBe('new_work_request');
    if (result.kind !== 'new_work_request') return;
    expect(result.work.command.capability).toBe('programming');
    expect(result.work.command.intent).toMatchObject({ mode: 'construction', request_kind: 'change' });
  });

  test('UUID explícito continua sendo referência, inclusive a item completed', () => {
    expect(classifyDevelopmentChatIntent({ message: `O que aconteceu no item ${COMPLETED}?` }).kind)
      .toBe('existing_item_reference');
  });

  test('referência contextual apresentada continua funcionando', () => {
    expect(classifyDevelopmentChatIntent({
      message: 'E o segundo?',
      presentedItemReferences: [
        { workItemId: COMPLETED, ordinal: 1, role: 'active_item' },
        { workItemId: '22222222-2222-4222-8222-222222222222', ordinal: 2, role: 'review_item' },
      ],
    }).kind).toBe('existing_item_reference');
  });

  test('mandato positivo continua autônomo e negação não concede autoridade', () => {
    expect(classifyDevelopmentChatIntent({ message: 'retome o trabalho aprovado X' }).kind)
      .toBe('autonomous_queue_command');
    expect(classifyDevelopmentChatIntent({ message: `execute o item ${COMPLETED}` }).kind)
      .toBe('autonomous_queue_command');
    expect(classifyDevelopmentChatIntent({ message: 'não execute o item X' }).kind)
      .toBe('conversation');
  });

  test('pergunta comum não vira proposta', () => {
    expect(classifyDevelopmentChatIntent({ message: 'Como estão meus pilares?' }).kind).toBe('conversation');
  });
});

export { CASE_1, CASE_2 };
