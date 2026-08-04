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
  // Modo de desenvolvimento: só quando explícito E autorizado (ver chat-surface).
  // No chat pessoal (default) NENHUMA ferramenta de repositório é anexada e o
  // modelo não recebe instrução para investigar o código.
  developmentMode?: boolean;
};

// Instrução de desenvolvimento — anexada SOMENTE no modo de desenvolvimento.
// Nunca entra no chat pessoal, para o modelo jamais expor caminhos, diffs ou
// estado Git a um usuário comum.
const DEVELOPMENT_TOOLS_INSTRUCTION =
  'Você possui ferramentas locais somente de leitura para o repositório Anima. Use-as quando uma afirmação depender do estado atual do código. Cite caminhos e linhas obtidos pelas ferramentas. Não alegue ter alterado arquivos nem executado trabalho de escrita. Para mudanças, investigue e então oriente o usuário a criar/aprovar uma proposta de trabalho no Anima.';

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

  // Chat pessoal (default): SEM ferramentas e SEM instrução de investigar o
  // repositório. Só o modo de desenvolvimento (explícito + autorizado) as recebe.
  const developmentMode = request.developmentMode === true;
  const instructions = developmentMode
    ? `${request.systemPrompt}\n\n${DEVELOPMENT_TOOLS_INSTRUCTION}`
    : request.systemPrompt;

  let input: unknown[] = request.messages;
  let toolCalls = 0;
  let finalText = '';
  // Ao atingir o limite de ferramentas, encerramos o laço de forma controlada e
  // pedimos UMA resposta textual final SEM ferramentas, usando só o contexto já
  // obtido — o usuário nunca fica sem retorno (nem recebe um 422 vazio).
  let forceFinal = false;
  // Teto rígido de iterações: proteção extra contra laço (limite + a final).
  for (let iteration = 0; iteration <= PROJECT_TOOL_CALL_LIMIT + 1; iteration++) {
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
        instructions,
        input,
        // Ferramentas SÓ no modo de desenvolvimento e ENQUANTO abaixo do limite.
        // Na resposta final forçada, nenhuma ferramenta é oferecida.
        ...(developmentMode && !forceFinal ? { tools: OPENAI_PROJECT_TOOLS, tool_choice: 'auto' } : {}),
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

    // Resposta final: sem chamadas de ferramenta, ou já na rodada final forçada.
    if (forceFinal || calls.length === 0) {
      finalText = body.output_text
        ?? output.flatMap(item => item.content ?? []).filter(item => item.type === 'output_text').map(item => item.text ?? '').join('');
      break;
    }

    // O limite seria excedido: NÃO executa as novas chamadas (nenhuma chamada de
    // ferramenta após o limite) e força uma resposta textual final na próxima
    // iteração. Log estruturado, sem segredos.
    if (toolCalls + calls.length > PROJECT_TOOL_CALL_LIMIT) {
      console.warn('[chat-provider] limite de ferramentas atingido; encerrando com resposta textual', {
        toolCalls, pending: calls.length, limit: PROJECT_TOOL_CALL_LIMIT,
      });
      forceFinal = true;
      continue;
    }

    toolCalls += calls.length;
    const toolOutputs = await Promise.all(calls.map(async call => ({
      type: 'function_call_output',
      call_id: call.call_id,
      output: await executeProjectTool(call.name, call.arguments),
    })));
    input = [...input, ...output, ...toolOutputs];
  }

  if (!finalText) {
    // Mesmo a resposta final não veio: erro CLARO e recuperável (o cliente mostra
    // a mensagem e permite tentar de novo). Nunca um 422 silencioso.
    throw new ChatProviderError('Não consegui concluir a investigação local desta vez. Tente novamente ou reformule o pedido.', 502);
  }
  return { provider: 'openai', model, stream: textStream(finalText) };
}

export function parseChatProvider(value: unknown): ChatProviderId {
  if (value === 'openai' || value === 'ollama') return value;
  return process.env.ANIMA_AI_PROVIDER === 'ollama' ? 'ollama' : 'openai';
}

export function streamChatProvider(request: ChatProviderRequest): Promise<ChatProviderStream> {
  return request.provider === 'openai' ? streamOpenAI(request) : streamOllama(request);
}
