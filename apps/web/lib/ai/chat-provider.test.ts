import { parseChatProvider, streamChatProvider } from './chat-provider';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

function bodyFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new NodeReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }) as unknown as ReadableStream<Uint8Array>;
}

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

describe('chat provider', () => {
  const originalEnv = process.env;

  beforeAll(() => {
    Object.defineProperty(global, 'ReadableStream', {
      configurable: true,
      value: NodeReadableStream,
    });
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    global.fetch = jest.fn();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('aceita apenas provedores conhecidos e usa o padrão do servidor', () => {
    process.env.ANIMA_AI_PROVIDER = 'ollama';
    expect(parseChatProvider('openai')).toBe('openai');
    expect(parseChatProvider('ollama')).toBe('ollama');
    expect(parseChatProvider('outro')).toBe('ollama');
  });

  test('converte o NDJSON do Ollama em texto puro mesmo com chunk dividido', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: bodyFrom([
        '{"message":{"content":"Olá"}}\n{"message":{"con',
        'tent":" mundo"}}\n{"done":true}\n',
      ]),
    });

    const result = await streamChatProvider({
      provider: 'ollama',
      systemPrompt: 'sistema',
      messages: [{ role: 'user', content: 'oi' }],
    });

    expect(result.provider).toBe('ollama');
    expect(await read(result.stream)).toBe('Olá mundo');
  });

  test('chat pessoal (default): NENHUMA ferramenta e SEM instrução de investigar o repositório', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: 'Olá GPT', output: [] }),
    });

    const result = await streamChatProvider({
      provider: 'openai',
      systemPrompt: 'sistema',
      messages: [{ role: 'user', content: 'oi' }],
    });

    expect(result.provider).toBe('openai');
    expect(await read(result.stream)).toBe('Olá GPT');
    const init = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as { store: boolean; stream: boolean; tools?: unknown; tool_choice?: unknown; instructions: string };
    expect(body).toMatchObject({ store: false, stream: false });
    // Sem ferramentas nem tool_choice: o modelo não pode ler o repositório.
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    // A instrução de investigar o repositório não vaza para o chat pessoal.
    expect(body.instructions).toBe('sistema');
    expect(body.instructions).not.toMatch(/repositório Anima/i);
  });

  test('modo de desenvolvimento explícito: oferece somente as ferramentas de leitura permitidas', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: 'Olá GPT', output: [] }),
    });

    const result = await streamChatProvider({
      provider: 'openai',
      systemPrompt: 'sistema',
      messages: [{ role: 'user', content: 'oi' }],
      developmentMode: true,
    });

    expect(result.provider).toBe('openai');
    const init = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as { tools: Array<{ name: string }>; tool_choice: string; instructions: string };
    expect(body.tools.map(tool => tool.name).sort()).toEqual(
      ['project_git_diff', 'project_git_status', 'project_list_files', 'project_read_file', 'project_search'],
    );
    expect(body.tool_choice).toBe('auto');
    expect(body.instructions).toMatch(/repositório Anima/i);
  });
});
