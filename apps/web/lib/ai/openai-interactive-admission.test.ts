import { createInteractiveOpenAIAdmission } from './openai-interactive-admission';

describe('admissão OpenAI interativa por seleção explícita', () => {
  test.each(['chat', 'planner'] as const)('%s recebe autoridade estreita e correlacionada ao usuário', async consumer => {
    await expect(createInteractiveOpenAIAdmission().admit({ consumer, userId: 'user-1', model: 'gpt-test' }))
      .resolves.toEqual({
        consumer,
        authorizationRef: `interactive-provider-selection:${consumer}:user-1`,
        reservationId: null,
      });
  });

  test('identidade ausente falha fechado', async () => {
    await expect(createInteractiveOpenAIAdmission().admit({ consumer: 'chat', userId: 'unknown', model: 'gpt-test' }))
      .rejects.toThrow(/interactive_provider_selection_absent/);
  });
});
