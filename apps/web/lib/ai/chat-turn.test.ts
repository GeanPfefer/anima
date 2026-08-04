import { findInterruptedTurn, shouldReuseOrphanUserMessage, type TurnMessage } from './chat-turn';

describe('chat-turn — estado de turno e idempotência (correção 3)', () => {
  const userMsg = (id: string, content: string) => ({ id, role: 'user', content });

  describe('shouldReuseOrphanUserMessage (servidor)', () => {
    test('sem última mensagem: não reaproveita (grava nova)', () => {
      expect(shouldReuseOrphanUserMessage({ latest: null, incomingContent: 'oi' })).toBe(false);
    });

    test('última é do assistente (turno completo): não reaproveita', () => {
      expect(shouldReuseOrphanUserMessage({ latest: { id: 'a1', role: 'assistant', content: 'resposta' }, incomingContent: 'oi' })).toBe(false);
    });

    test('reenvio do MESMO texto sobre órfã: reaproveita (idempotente, sem duplicar)', () => {
      expect(shouldReuseOrphanUserMessage({ latest: userMsg('u1', 'oi'), incomingContent: 'oi' })).toBe(true);
    });

    test('mensagem NOVA e diferente sobre órfã: grava nova (não reaproveita)', () => {
      expect(shouldReuseOrphanUserMessage({ latest: userMsg('u1', 'oi'), incomingContent: 'outra' })).toBe(false);
    });

    test('retry explícito por id que casa a órfã: reaproveita', () => {
      expect(shouldReuseOrphanUserMessage({ latest: userMsg('u1', 'oi'), incomingContent: 'qualquer', retryMessageId: 'u1' })).toBe(true);
    });

    test('retry explícito por id que NÃO casa: não reaproveita', () => {
      expect(shouldReuseOrphanUserMessage({ latest: userMsg('u1', 'oi'), incomingContent: 'oi', retryMessageId: 'outro' })).toBe(false);
    });

    test('retry explícito mas última é do assistente: não reaproveita', () => {
      expect(shouldReuseOrphanUserMessage({ latest: { id: 'a1', role: 'assistant', content: 'r' }, incomingContent: 'oi', retryMessageId: 'a1' })).toBe(false);
    });
  });

  describe('findInterruptedTurn (cliente)', () => {
    test('conversa vazia: nenhum turno interrompido', () => {
      expect(findInterruptedTurn([])).toBeNull();
    });

    test('termina com resposta do assistente: turno completo, nada a retryar', () => {
      const messages: TurnMessage[] = [{ id: 'u1', role: 'user', content: 'oi' }, { id: 'a1', role: 'assistant', content: 'olá' }];
      expect(findInterruptedTurn(messages)).toBeNull();
    });

    test('termina com mensagem do usuário (após reload): turno interrompido e retryável', () => {
      const messages: TurnMessage[] = [{ id: 'a0', role: 'assistant', content: 'anterior' }, { id: 'u2', role: 'user', content: 'pergunta órfã' }];
      expect(findInterruptedTurn(messages)).toEqual({ id: 'u2', content: 'pergunta órfã' });
    });

    test('mensagem do usuário sem id ainda: retorna só o conteúdo', () => {
      expect(findInterruptedTurn([{ role: 'user', content: 'sem id' }])).toEqual({ content: 'sem id' });
    });
  });
});
