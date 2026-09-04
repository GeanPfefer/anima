import {
  fetchAdmittedOpenAIResponses,
  OpenAIAdmissionDenied,
  type OpenAIAdmissionControl,
} from '@/lib/ai/openai-paid-transport';
import { coderBackendId, type CoderBackend, type CoderEditRequest, type CoderEditResult, type CoderWorkspace } from './coder-backend';
import { OllamaCoderBackend, type CoderProtocolTransport } from './ollama-coder';

export interface OpenAIUsage { readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens: number; readonly cachedInputTokens?: number }
export interface GptCoderOptions {
  readonly model?: string;
  /** Admissão financeira OBRIGATÓRIA (borda única). Sem ela o adapter não é
   * construível: é assim que o coder OpenAI de produção é fail-closed por construção. */
  readonly admission: OpenAIAdmissionControl;
  /** Chave explícita só para teste determinístico; produção lê do env NA BORDA. */
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number; readonly maxReadRounds?: number; readonly onUsage?: (usage: OpenAIUsage) => void;
}
/** Correlação do attempt pago, derivada do `CoderEditRequest` a cada `edit()`. */
interface CoderPaidContext {
  readonly workItemId: string; readonly attemptId: string;
  readonly approvedProposalVersion: number; readonly maxDurationMs: number;
}
export type OpenAICoderErrorCode = 'openai_auth' | 'openai_paid_authorization' | 'openai_rate_limit' | 'openai_timeout' | 'openai_cancelled' | 'openai_api' | 'openai_malformed_response';
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
  private activePaidContext: CoderPaidContext | null = null;
  private callIndex = 0;
  constructor(options: GptCoderOptions) {
    const model = options.model ?? process.env.ANIMA_CODER_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
    const fetchImpl = options.fetchImpl ?? fetch;
    const admission = options.admission;
    // O transport NUNCA fala com o provider sem admissão: `fetchAdmittedOpenAIResponses`
    // roda `admit()` antes de qualquer rede. A chave e a URL vivem SÓ na borda; aqui
    // nem a credencial é lida. Correlação ausente ⇒ erro ANTES de qualquer fetch.
    const transport: CoderProtocolTransport = async ({ messages, signal, timeoutMs }) => {
      this.callIndex += 1;
      const context = this.activePaidContext;
      if (!context) throw new OpenAICoderError('openai_paid_authorization', 'A chamada paga não possui correlação de work item/attempt.');
      const bounded = combinedSignal(signal, timeoutMs); let response: Response;
      try {
        const admitted = await fetchAdmittedOpenAIResponses({
          admission,
          intent: {
            consumer: 'coder', workItemId: context.workItemId, attemptId: context.attemptId,
            approvedProposalVersion: context.approvedProposalVersion, model,
            callIndex: this.callIndex, maxDurationMs: context.maxDurationMs,
          },
          body: { model, store: false, input: messages },
          signal: bounded.signal,
          fetchImpl,
          ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
        });
        response = admitted.response;
      } catch (error) {
        if (error instanceof OpenAIAdmissionDenied) {
          // Chave ausente preserva a classe histórica `openai_auth`; qualquer outra
          // recusa da borda é falha de admissão paga.
          throw new OpenAICoderError(error.reason === 'openai_key_missing' ? 'openai_auth' : 'openai_paid_authorization', error.message);
        }
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
    this.callIndex = 0;
    this.activePaidContext = request.workItemId && request.attemptId && request.approvedProposalVersion && request.maxDurationMs
      ? { workItemId: request.workItemId, attemptId: request.attemptId, approvedProposalVersion: request.approvedProposalVersion, maxDurationMs: request.maxDurationMs }
      : null;
    let result: CoderEditResult;
    try { result = await this.delegate.edit(request, workspace, signal); }
    finally { this.activePaidContext = null; }
    const providerCallCount = this.callIndex;
    if (!this.usages.length) return { ...result, providerCallCount };
    return { ...result, providerUsage: {
      schemaVersion: 1,
      inputTokens: this.usages.reduce((sum, value) => sum + value.inputTokens, 0),
      outputTokens: this.usages.reduce((sum, value) => sum + value.outputTokens, 0),
      totalTokens: this.usages.reduce((sum, value) => sum + value.totalTokens, 0),
      cachedInputTokens: this.usages.reduce((sum, value) => sum + (value.cachedInputTokens ?? 0), 0),
    }, providerCallCount };
  }
}
