import {
  executeProjectTool,
  OPENAI_PROJECT_TOOLS,
  PROJECT_TOOL_CALL_LIMIT,
} from './project-tools';

export type ChatProviderId = 'openai' | 'ollama';

export type ChatProviderMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ChatProviderRequest = {
  provider: ChatProviderId;
  systemPrompt: string;
  messages: ChatProviderMessage[];
};

export type ChatProviderStream = {
  provider: ChatProviderId;
  model: string;
  stream: ReadableStream<Uint8Array>;
};

export class ChatProviderError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ChatProviderError';
  }
}

const encoder = new TextEncoder();

function timeoutSignal(milliseconds: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  (timer as NodeJS.Timeout).unref?.();
  return controller.signal;
}

function textStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function parsedTextStream(
  body: ReadableStream<Uint8Array>,
  parseRecord: (record: string) => string,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const records = buffer.split('\n');
          buffer = records.pop() ?? '';

          for (const record of records) {
            const text = parseRecord(record.trim());
            if (text) controller.enqueue(encoder.encode(text));
          }
          if (done) break;
        }

        const finalText = parseRecord(buffer.trim());
        if (finalText) controller.enqueue(encoder.encode(finalText));
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
    cancel(reason) {
      return body.cancel(reason);
    },
  });
}

async function streamOllama(request: ChatProviderRequest): Promise<ChatProviderStream> {
  const url = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';
  const response = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: request.systemPrompt },
        ...request.messages,
      ],
      options: { num_ctx: 8192 },
    }),
  }).catch(() => null);

  if (!response?.ok || !response.body) {
    throw new ChatProviderError('Não foi possível conectar ao modelo local.', 502);
  }

  return {
    provider: 'ollama',
    model,
    stream: parsedTextStream(response.body, record => {
      if (!record) return '';
      try {
        const parsed = JSON.parse(record) as { message?: { content?: string } };
        return parsed.message?.content ?? '';
      } catch {
        return '';
      }
    }),
  };
}

async function streamOpenAI(request: ChatProviderRequest): Promise<ChatProviderStream> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
  if (!apiKey) {
    throw new ChatProviderError('A chave da OpenAI não está configurada no servidor.', 503);
  }

  type OutputItem = {
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  type OpenAIResponse = {
    output?: OutputItem[];
    output_text?: string;
    error?: { message?: string };
  };

  let input: unknown[] = request.messages;
  let toolCalls = 0;
  let finalText = '';

  while (toolCalls <= PROJECT_TOOL_CALL_LIMIT) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: timeoutSignal(90_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: false,
        store: false,
        instructions: `${request.systemPrompt}\n\nVocê possui ferramentas locais somente de leitura para o repositório Anima. Use-as quando uma afirmação depender do estado atual do código. Cite caminhos e linhas obtidos pelas ferramentas. Não alegue ter alterado arquivos nem executado trabalho de escrita. Para mudanças, investigue e então oriente o usuário a criar/aprovar uma proposta de trabalho no Anima.`,
        input,
        tools: OPENAI_PROJECT_TOOLS,
        tool_choice: 'auto',
      }),
    }).catch(() => null);

    if (!response?.ok) {
      const details = response
        ? await response.json().catch(() => null) as OpenAIResponse | null
        : null;
      const suffix = details?.error?.message ? ` ${details.error.message}` : '';
      throw new ChatProviderError(`Não foi possível conectar à OpenAI.${suffix}`, response?.status ?? 502);
    }

    const body = await response.json() as OpenAIResponse;
    const output = body.output ?? [];
    const calls = output.filter((item): item is OutputItem & { call_id: string; name: string; arguments: string } =>
      item.type === 'function_call'
      && typeof item.call_id === 'string'
      && typeof item.name === 'string'
      && typeof item.arguments === 'string');

    if (calls.length === 0) {
      finalText = body.output_text
        ?? output.flatMap(item => item.content ?? []).filter(item => item.type === 'output_text').map(item => item.text ?? '').join('');
      break;
    }

    toolCalls += calls.length;
    if (toolCalls > PROJECT_TOOL_CALL_LIMIT) {
      throw new ChatProviderError('O GPT excedeu o limite de consultas locais deste turno.', 422);
    }
    const toolOutputs = await Promise.all(calls.map(async call => ({
      type: 'function_call_output',
      call_id: call.call_id,
      output: await executeProjectTool(call.name, call.arguments),
    })));
    input = [...input, ...output, ...toolOutputs];
  }

  if (!finalText) throw new ChatProviderError('A OpenAI não retornou uma resposta textual.', 502);
  return { provider: 'openai', model, stream: textStream(finalText) };
}

export function parseChatProvider(value: unknown): ChatProviderId {
  if (value === 'openai' || value === 'ollama') return value;
  return process.env.ANIMA_AI_PROVIDER === 'ollama' ? 'ollama' : 'openai';
}

export function streamChatProvider(request: ChatProviderRequest): Promise<ChatProviderStream> {
  return request.provider === 'openai' ? streamOpenAI(request) : streamOllama(request);
}
