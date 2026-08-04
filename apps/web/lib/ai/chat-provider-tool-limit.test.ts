import { ReadableStream as NodeReadableStream } from 'node:stream/web';

// Limite de ferramentas pequeno e execução mockada, para exercitar a degradação
// controlada sem tocar o repositório real. As ferramentas só existem no modo de
// desenvolvimento, então todos os turnos aqui passam developmentMode: true.
jest.mock('./project-tools', () => ({
  OPENAI_PROJECT_TOOLS: [{ type: 'function', name: 'project_search' }],
  PROJECT_TOOL_CALL_LIMIT: 2,
  executeProjectTool: jest.fn(async () => 'saída da ferramenta'),
}));

import { streamChatProvider, ChatProviderError } from './chat-provider';
import { executeProjectTool } from './project-tools';

const functionCall = (id: string) => ({
  ok: true,
  json: async () => ({ output: [{ type: 'function_call', call_id: id, name: 'project_search', arguments: '{}' }] }),
});
const finalText = (text: string) => ({ ok: true, json: async () => ({ output_text: text, output: [] }) });

async function read(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return result;
    result += decoder.decode(value, { stream: true });
  }
}

describe('chat provider — limite de ferramentas sem erro vazio (correção 2)', () => {
  const originalEnv = process.env;
  beforeAll(() => {
    Object.defineProperty(global, 'ReadableStream', { configurable: true, value: NodeReadableStream });
  });
  beforeEach(() => {
    process.env = { ...originalEnv, OPENAI_API_KEY: 'test-key' };
    global.fetch = jest.fn();
    (executeProjectTool as jest.Mock).mockClear();
  });
  afterAll(() => { process.env = originalEnv; });

  const request = { provider: 'openai' as const, systemPrompt: 'sistema', messages: [{ role: 'user' as const, content: 'investigue' }], developmentMode: true };

  test('limite alcançado gera resposta textual final (nunca 422 vazio)', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(functionCall('c1'))
      .mockResolvedValueOnce(functionCall('c2'))
      .mockResolvedValueOnce(functionCall('c3')) // esta excede o limite (2)
      .mockResolvedValueOnce(finalText('Resposta final com o contexto obtido.'));

    const result = await streamChatProvider(request);
    expect(await read(result.stream)).toBe('Resposta final com o contexto obtido.');
  });

  test('nenhuma nova chamada de ferramenta após o limite', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(functionCall('c1'))
      .mockResolvedValueOnce(functionCall('c2'))
      .mockResolvedValueOnce(functionCall('c3'))
      .mockResolvedValueOnce(finalText('Final.'));

    await streamChatProvider(request);
    // Executadas só as 2 dentro do limite; a 3ª (que estouraria) não roda.
    expect((executeProjectTool as jest.Mock).mock.calls).toHaveLength(2);
    // A última requisição (final forçada) não oferece ferramentas.
    const lastBody = JSON.parse((global.fetch as jest.Mock).mock.calls.at(-1)![1].body as string) as { tools?: unknown };
    expect(lastBody.tools).toBeUndefined();
  });

  test('falha na resposta final gera erro amigável e recuperável — não 422', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(functionCall('c1'))
      .mockResolvedValueOnce(functionCall('c2'))
      .mockResolvedValueOnce(functionCall('c3'))
      .mockResolvedValueOnce(finalText('')); // resposta final vazia

    const error = await streamChatProvider(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChatProviderError);
    // Recuperável e claro; e explicitamente NÃO 422 silencioso.
    expect((error as ChatProviderError).status).toBe(502);
    expect((error as ChatProviderError).status).not.toBe(422);
    expect((error as ChatProviderError).message).toMatch(/tente novamente|reformule/i);
  });
});
