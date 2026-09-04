import { coderBackendId, type CoderBackend, type CoderEditRequest, type CoderEditResult, type CoderWorkspace } from './coder-backend';
import { OllamaCoderBackend, type CoderProtocolTransport } from './ollama-coder';

export interface OpenAIUsage { readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens: number; readonly cachedInputTokens?: number }
export interface GptCoderOptions {
  readonly model?: string; readonly apiKey?: string; readonly url?: string; readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number; readonly maxReadRounds?: number; readonly onUsage?: (usage: OpenAIUsage) => void;
}
export type OpenAICoderErrorCode = 'openai_auth' | 'openai_rate_limit' | 'openai_timeout' | 'openai_cancelled' | 'openai_api' | 'openai_malformed_response';
export class OpenAICoderError extends Error {
  constructor(readonly code: OpenAICoderErrorCode, message: string, readonly status?: number) { super(message); this.name = 'OpenAICoderError'; }
}

const combinedSignal = (outer: AbortSignal, timeoutMs: number) => {
  const controller = new AbortController(); let timeout = false;
  const abort = () => controller.abort(); outer.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timeout = true; controller.abort(); }, timeoutMs);
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); outer.removeEventListener('abort', abort); }, timedOut: () => timeout };
};
const extractText = (body: unknown): string | null => {
  const root = body as { output_text?: unknown; output?: Array<{ type?: unknown; name?: unknown; arguments?: unknown; content?: Array<{ type?: unknown; text?: unknown }> }> } | null;
  if (typeof root?.output_text === 'string' && root.output_text.trim()) return root.output_text;
  for (const item of root?.output ?? []) if (item.type === 'function_call' && item.name === 'submit_coder_action' && typeof item.arguments === 'string') return item.arguments;
  const text = (root?.output ?? []).flatMap(item => item.content ?? []).filter(part => part.type === 'output_text' && typeof part.text === 'string').map(part => part.text as string).join('');
  return text.trim() ? text : null;
};
const parseUsage = (body: unknown): OpenAIUsage | null => {
  const usage = (body as { usage?: Record<string, unknown> } | null)?.usage;
  const input = usage?.input_tokens, output = usage?.output_tokens, total = usage?.total_tokens;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || !Number.isSafeInteger(total)) return null;
  const cached = (usage?.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens;
  return { inputTokens: input as number, outputTokens: output as number, totalTokens: total as number, ...(Number.isSafeInteger(cached) ? { cachedInputTokens: cached as number } : {}) };
};

export class GptCoderBackend implements CoderBackend {
  readonly id: string;
  readonly observation: NonNullable<CoderBackend['observation']>;
  private readonly delegate: OllamaCoderBackend;
  private readonly usages: OpenAIUsage[] = [];
  constructor(options: GptCoderOptions = {}) {
    const model = options.model ?? process.env.ANIMA_CODER_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    const url = options.url ?? 'https://api.openai.com/v1/responses'; const fetchImpl = options.fetchImpl ?? fetch;
    const transport: CoderProtocolTransport = async ({ messages, signal, timeoutMs }) => {
      if (!apiKey) throw new OpenAICoderError('openai_auth', 'A chave da OpenAI não está configurada no servidor.');
      const bounded = combinedSignal(signal, timeoutMs); let response: Response;
      try {
        response = await fetchImpl(url, { method: 'POST', signal: bounded.signal, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, store: false, input: messages }) });
      } catch {
        const code = signal.aborted ? 'openai_cancelled' : bounded.timedOut() ? 'openai_timeout' : 'openai_api';
        throw new OpenAICoderError(code, code === 'openai_timeout' ? 'A chamada da OpenAI excedeu o timeout.' : code === 'openai_cancelled' ? 'A chamada da OpenAI foi cancelada.' : 'Falha de transporte ao chamar a OpenAI.');
      } finally { bounded.dispose(); }
      if (!response.ok) {
        const code: OpenAICoderErrorCode = response.status === 401 || response.status === 403 ? 'openai_auth' : response.status === 429 ? 'openai_rate_limit' : 'openai_api';
        throw new OpenAICoderError(code, `A OpenAI recusou a chamada (HTTP ${response.status}).`, response.status);
      }
      const body: unknown = await response.json().catch(() => null); const usage = parseUsage(body); if (usage) { this.usages.push(usage); options.onUsage?.(usage); }
      const content = extractText(body); if (!content) throw new OpenAICoderError('openai_malformed_response', 'A OpenAI retornou uma resposta sem ação estruturada válida.');
      return { content };
    };
    this.id = coderBackendId('openai', model);
    this.observation = { placement: 'remote', nodeId: 'openai-api', model };
    this.delegate = new OllamaCoderBackend({ model, backendId: this.id, providerLabel: `OpenAI ${model}`, protocolTransport: transport, fetchImpl, timeoutMs: options.timeoutMs ?? 90_000, maxReadRounds: options.maxReadRounds });
  }
  async edit(request: CoderEditRequest, workspace: CoderWorkspace, signal: AbortSignal): Promise<CoderEditResult> {
    this.usages.length = 0;
    const result = await this.delegate.edit(request, workspace, signal);
    if (!this.usages.length) return result;
    return { ...result, providerUsage: {
      schemaVersion: 1,
      inputTokens: this.usages.reduce((sum, value) => sum + value.inputTokens, 0),
      outputTokens: this.usages.reduce((sum, value) => sum + value.outputTokens, 0),
      totalTokens: this.usages.reduce((sum, value) => sum + value.totalTokens, 0),
      cachedInputTokens: this.usages.reduce((sum, value) => sum + (value.cachedInputTokens ?? 0), 0),
    } };
  }
}
