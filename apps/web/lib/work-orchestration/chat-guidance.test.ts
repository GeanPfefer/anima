import {
  buildWorkOrchestrationReply,
} from './chat-guidance';

describe('UX-00 — orientação determinística da resposta conversacional', () => {
  test('proposta persistida recebe resposta honesta sem chamar o modelo', () => {
    const reply = buildWorkOrchestrationReply('work_proposal');

    expect(reply).toContain('proposta');
    expect(reply).toContain('cartão');
    expect(reply).toContain('Ainda não li nem executei');
  });

  test('capacidade ausente recebe resposta honesta sem proposta simulada', () => {
    const reply = buildWorkOrchestrationReply('work_unavailable');

    expect(reply).toContain('não está habilitada');
    expect(reply).toContain('Não criei uma proposta');
    expect(reply).toContain('nem executei');
  });

  test('conversa comum continua usando o modelo', () => {
    expect(buildWorkOrchestrationReply('none')).toBeNull();
  });
});
