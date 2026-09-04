import { openAIStructuredOutputSchema, parseChatProvider, streamChatProvider } from './chat-provider';
import type { OpenAIAdmissionControl } from './openai-paid-transport';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

// Admissão que CONCEDE: exercita o caminho OpenAI sem fail-open. Sem ela (default),
// a admissão interativa recusa e o chat cai no provider local — coberto abaixo.
const grant: OpenAIAdmissionControl = { admit: async intent => ({ consumer: intent.consumer, authorizationRef: 'test', reservationId: null }) };

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
    }, { admission: grant });

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

  test('OpenAI paga NÃO admitida (default) cai no provider local, observável, sem chamada à OpenAI', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    // Só o endpoint do Ollama responde; qualquer ida à OpenAI seria um bug de política.
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (String(url).includes('api.openai.com')) throw new Error('POLÍTICA VIOLADA: OpenAI paga sem admissão');
      return Promise.resolve({ ok: true, body: bodyFrom(['{"message":{"content":"resposta local"}}\n{"done":true}\n']) });
    });

    const result = await streamChatProvider({
      provider: 'openai', systemPrompt: 'sistema', messages: [{ role: 'user', content: 'oi' }], userId: 'u1',
    });

    expect(result.provider).toBe('ollama');
    expect(result.fallback).toEqual({ from: 'openai', reason: 'interactive_paid_authority_absent' });
    expect(await read(result.stream)).toBe('resposta local');
    // Nenhuma chamada ao endpoint pago.
    for (const call of (global.fetch as jest.Mock).mock.calls) expect(String(call[0])).not.toContain('api.openai.com');
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
    }, { admission: grant });

    expect(result.provider).toBe('openai');
    const init = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as { tools: Array<{ name: string }>; tool_choice: string; instructions: string };
    expect(body.tools.map(tool => tool.name).sort()).toEqual(
      ['project_git_diff', 'project_git_status', 'project_list_files', 'project_read_file', 'project_search'],
    );
    expect(body.tool_choice).toBe('auto');
    expect(body.instructions).toMatch(/repositório Anima/i);
  });

  test('propaga o mesmo contrato estruturado para OpenAI sem habilitar ferramentas', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ output_text: '{}', output: [] }) });
    const schema = { type: 'object', properties: { ids: { type: 'array', uniqueItems: true, items: { type: 'string' } } }, additionalProperties: false };
    await streamChatProvider({
      provider: 'openai', systemPrompt: 'sistema', messages: [],
      structuredOutput: { name: 'proof', schema },
    }, { admission: grant });
    const body = JSON.parse(((global.fetch as jest.Mock).mock.calls[0][1] as RequestInit).body as string) as {
      text?: { format?: { type?: string; name?: string; strict?: boolean; schema?: unknown } };
      tools?: unknown;
    };
    expect(body.text?.format).toEqual({
      type: 'json_schema', name: 'proof', strict: true,
      schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
    });
    expect(body.tools).toBeUndefined();
  });

  test('projeta schema OpenAI sem uniqueItems e preserva as demais restrições', () => {
    const hostSchema = {
      type: 'object',
      properties: {
        sourceIds: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: ['proof'] } },
        nested: { anyOf: [{ type: 'array', uniqueItems: true, items: { type: 'string' } }] },
      },
      required: ['sourceIds', 'nested'],
      additionalProperties: false,
    };
    const projected = openAIStructuredOutputSchema(hostSchema);
    expect(JSON.stringify(projected)).not.toContain('uniqueItems');
    expect(projected).toMatchObject({
      type: 'object',
      properties: { sourceIds: { type: 'array', minItems: 1, items: { enum: ['proof'] } } },
      required: ['sourceIds', 'nested'],
      additionalProperties: false,
    });
    expect(hostSchema.properties.sourceIds.uniqueItems).toBe(true);
  });

  test('propaga o mesmo contrato estruturado para Ollama', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, body: bodyFrom(['{"done":true}\n']) });
    const schema = { type: 'object', properties: {}, additionalProperties: false };
    await streamChatProvider({
      provider: 'ollama', systemPrompt: 'sistema', messages: [],
      structuredOutput: { name: 'proof', schema },
    });
    const body = JSON.parse(((global.fetch as jest.Mock).mock.calls[0][1] as RequestInit).body as string) as { format?: unknown };
    expect(body.format).toEqual(schema);
  });

  test('Ollama recebe uniqueItems do contrato completo sem a projeção OpenAI', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, body: bodyFrom(['{"done":true}\n']) });
    const schema = { type: 'array', uniqueItems: true, items: { type: 'string' } };
    await streamChatProvider({ provider: 'ollama', systemPrompt: 'sistema', messages: [], structuredOutput: { name: 'proof', schema } });
    const body = JSON.parse(((global.fetch as jest.Mock).mock.calls[0][1] as RequestInit).body as string) as { format?: unknown };
    expect(body.format).toEqual(schema);
  });
});
