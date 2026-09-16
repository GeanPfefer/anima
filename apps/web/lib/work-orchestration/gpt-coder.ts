import {
  fetchAdmittedOpenAIResponses,
  OpenAIAdmissionDenied,
  type OpenAIAdmissionControl,
} from '@/lib/ai/openai-paid-transport';
import {
  resolveAgenticRuntimePolicy,
  STRONG_REMOTE_AGENTIC_RUNTIME_PROFILE_V1,
} from '@anima/core';
import { coderBackendId, type CoderBackend, type CoderEditRequest, type CoderEditResult, type CoderWorkspace } from './coder-backend';
import { OllamaCoderBackend, type CoderProtocolTransport } from './ollama-coder';
import type { ContextBudget } from './ollama-protocol';

// ============================================================
// Orçamento de contexto do coder OpenAI — BOUNDED por contrato explícito.
//
// O protocolo host-mediated é compartilhado com o Ollama, mas o TETO operacional de
// contexto (`operationalContextCap`) NÃO deve ser: o default 8192 do Ollama existe para
// proteger a RAM/latência da máquina LOCAL (o próprio código nota que 32768 já derrubou
// esta máquina). Modelos OpenAI rodam REMOTOS — sem esse teto físico local — e uma janela
// de 8192 recusa prompts que a janela real do modelo aceita (foi a barreira real:
// prompt ~7613 > input 6656). NUNCA ilimitado e NUNCA herda o teto local do Ollama.
//
// Três grandezas explícitas e bounded, sem catálogo hardcoded frágil nem semântica
// model-aware prometida e não cumprida:
//   • operationalCap — teto operacional conservador (POLÍTICA), independente da
//     capacidade máxima de qualquer modelo; NÃO afirma a janela real do modelo.
//   • declaredContextLength — capacidade REAL declarada do modelo, e só quando um
//     operador a configura explicitamente (`ANIMA_OPENAI_CODER_DECLARED_CONTEXT`);
//     nada é fabricado.
//   • safeAbsoluteMaximum — teto absoluto seguro (contrato). Nenhum valor operacional
//     — env, default ou declarado — pode ultrapassá-lo.
// O teto EFETIVO (numCtx) = min(declaredContextLength ?? operationalCap, operationalCap),
// resolvido em `resolveContextBudget`; por construção é finito, ≤ safeAbsoluteMaximum e,
// quando há capacidade declarada, ≤ declaredContextLength. Um modelo DESCONHECIDO recebe
// apenas a política conservadora — nunca implicitamente uma janela maior do que se pode
// justificar.
// ============================================================

/** Piso operacional absoluto: nenhum teto de contexto abaixo disto é aceito. */
export const OPENAI_CODER_CONTEXT_MIN_TOKENS = 1024;
/** Teto absoluto seguro (contrato explícito). Deliberadamente MUITO abaixo de ilimitado:
 * contém custo/latência mesmo diante de override ou metadata mal declarados. Nenhum teto
 * operacional — env, default ou capacidade declarada — o ultrapassa. */
export const OPENAI_CODER_CONTEXT_SAFE_MAX_TOKENS = 200_000;
/** Política operacional conservadora (default). NÃO é a janela máxima de nenhum modelo:
 * é um teto operacional bounded, independente da capacidade máxima, dimensionado para
 * cobrir prompts reais do protocolo READ→EDIT (que mantém o prompt pequeno) sem crescer
 * sem teto e sem herdar o 8192 local do Ollama. */
export const OPENAI_CODER_CONTEXT_CONSERVATIVE_CAP_TOKENS = 64_000;
/** Reserva de saída e num_predict do coder OpenAI. O num_predict alimenta o cálculo local
 * do orçamento e vai à Responses API como `max_output_tokens` (contenção real de geração),
 * NUNCA como campo Ollama. */
export const OPENAI_CODER_OUTPUT_RESERVE_TOKENS = 16_384;
export const OPENAI_CODER_NUM_PREDICT = 16_384;

/** Configuração de contexto inválida (env/metadata): fail-closed na construção. */
export class OpenAICoderContextConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'OpenAICoderContextConfigError'; }
}

/**
 * Valida um número de tokens de contexto contra o contrato [MIN, SAFE_MAX]. Recusa
 * fail-closed qualquer valor não-finito, NaN, fora do inteiro seguro, abaixo do mínimo ou
 * acima do teto absoluto seguro (inclui overflow prático e valores absurdamente grandes).
 * Floats são truncados (floor) antes de validar.
 */
function boundedContextTokens(raw: number, source: string): number {
  if (!Number.isFinite(raw)) {
    throw new OpenAICoderContextConfigError(`${source}: valor não finito (NaN/Infinity) não é permitido.`);
  }
  const floored = Math.floor(raw);
  if (!Number.isSafeInteger(floored)) {
    throw new OpenAICoderContextConfigError(`${source}: valor fora do inteiro seguro.`);
  }
  if (floored < OPENAI_CODER_CONTEXT_MIN_TOKENS) {
    throw new OpenAICoderContextConfigError(`${source}: ${floored} é menor que o mínimo ${OPENAI_CODER_CONTEXT_MIN_TOKENS}.`);
  }
  if (floored > OPENAI_CODER_CONTEXT_SAFE_MAX_TOKENS) {
    throw new OpenAICoderContextConfigError(`${source}: ${floored} excede o teto absoluto seguro ${OPENAI_CODER_CONTEXT_SAFE_MAX_TOKENS}.`);
  }
  return floored;
}

/**
 * Teto operacional do coder OpenAI. Precedência: override de operação
 * (`ANIMA_OPENAI_CODER_CONTEXT_CAP`, estritamente bounded) → política conservadora default.
 * NUNCA herda o 8192 do Ollama; SEMPRE finito e ≤ teto absoluto seguro. Ausência/whitespace
 * ⇒ default; override presente porém inválido ⇒ recusa fail-closed (misconfiguração de
 * operador é ruidosa, não silenciosa).
 */
export function resolveOpenAICoderContextCap(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.ANIMA_OPENAI_CODER_CONTEXT_CAP?.trim();
  if (!raw) return OPENAI_CODER_CONTEXT_CONSERVATIVE_CAP_TOKENS;
  return boundedContextTokens(Number(raw), 'ANIMA_OPENAI_CODER_CONTEXT_CAP');
}

/**
 * Capacidade de contexto DECLARADA por modelo — dirigida por configuração explícita e
 * validada (`ANIMA_OPENAI_CODER_DECLARED_CONTEXT`), NÃO por um catálogo hardcoded frágil.
 * Vazia por padrão: nada é fabricado. Formato: entradas `modelo=tokens` separadas por
 * vírgula; uma chave terminada em `*` casa por PREFIXO (o prefixo mais longo vence;
 * correspondência exata tem prioridade). Cada valor é bounded pelo MESMO contrato
 * [MIN, SAFE_MAX]. Retorna null quando o modelo não tem capacidade declarada — e então só
 * a política operacional conservadora atua.
 */
export function resolveOpenAICoderDeclaredContextLength(
  model: string,
  env: Record<string, string | undefined> = process.env,
): number | null {
  const raw = env.ANIMA_OPENAI_CODER_DECLARED_CONTEXT?.trim();
  if (!raw) return null;
  let exact: number | null = null;
  let prefix: { readonly length: number; readonly tokens: number } | null = null;
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      throw new OpenAICoderContextConfigError(`ANIMA_OPENAI_CODER_DECLARED_CONTEXT: entrada inválida "${trimmed}" (esperado modelo=tokens).`);
    }
    const key = trimmed.slice(0, eq).trim();
    if (!key) throw new OpenAICoderContextConfigError('ANIMA_OPENAI_CODER_DECLARED_CONTEXT: chave de modelo vazia.');
    const tokens = boundedContextTokens(Number(trimmed.slice(eq + 1).trim()), `ANIMA_OPENAI_CODER_DECLARED_CONTEXT[${key}]`);
    if (key.endsWith('*')) {
      const stem = key.slice(0, -1);
      if (stem && model.startsWith(stem) && (prefix === null || stem.length > prefix.length)) {
        prefix = { length: stem.length, tokens };
      }
    } else if (key === model) {
      exact = tokens;
    }
  }
  return exact ?? prefix?.tokens ?? null;
}

/** Resolução completa do orçamento de contexto do coder OpenAI: teto operacional,
 * capacidade declarada (quando configurada) e teto absoluto seguro — as três grandezas que
 * o protocolo compartilhado combina em `min(declared ?? cap, cap)`. */
export interface OpenAICoderContextResolution {
  readonly operationalCap: number;
  readonly declaredContextLength: number | null;
  readonly safeAbsoluteMax: number;
}
export function resolveOpenAICoderContext(
  model: string,
  env: Record<string, string | undefined> = process.env,
): OpenAICoderContextResolution {
  return {
    operationalCap: resolveOpenAICoderContextCap(env),
    declaredContextLength: resolveOpenAICoderDeclaredContextLength(model, env),
    safeAbsoluteMax: OPENAI_CODER_CONTEXT_SAFE_MAX_TOKENS,
  };
}

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
  private readonly contextResolutionValue: OpenAICoderContextResolution;
  private readonly usages: OpenAIUsage[] = [];
  private readonly requestIds: string[] = [];
  private activePaidContext: CoderPaidContext | null = null;
  private callIndex = 0;
  constructor(options: GptCoderOptions) {
    const model = options.model ?? process.env.ANIMA_CODER_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
    const fetchImpl = options.fetchImpl ?? fetch;
    const admission = options.admission;
    // O transport NUNCA fala com o provider sem admissão: `fetchAdmittedOpenAIResponses`
    // roda `admit()` antes de qualquer rede. A chave e a URL vivem SÓ na borda; aqui
    // nem a credencial é lida. Correlação ausente ⇒ erro ANTES de qualquer fetch.
    const transport: CoderProtocolTransport = async ({ messages, signal, timeoutMs, maxOutputTokens }) => {
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
          // `max_output_tokens` = a reserva de saída do orçamento (numPredict): a contenção
          // de geração equivalente ao `num_predict` do Ollama, honrando a invariante no
          // request REAL enviado à OpenAI. `num_ctx`/`num_predict` NUNCA vão à OpenAI.
          body: { model, store: false, input: messages, max_output_tokens: maxOutputTokens },
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
      // Id estável da resposta do provider (Responses API `id`): preservado para
      // correlação/idempotência/auditoria. Nunca é segredo.
      const requestId = (body as { id?: unknown } | null)?.id;
      if (typeof requestId === 'string' && requestId.trim().length > 0) this.requestIds.push(requestId);
      const content = extractText(body); if (!content) throw new OpenAICoderError('openai_malformed_response', 'A OpenAI retornou uma resposta sem ação estruturada válida.');
      return { content };
    };
    this.id = coderBackendId('openai', model);
    this.observation = { placement: 'remote', nodeId: 'openai-api', model };
    // Teto operacional bounded por contrato: a janela conservadora (ou a declarada, quando
    // configurada) do modelo OpenAI, NÃO o 8192 local do Ollama. `declaredContextLength`
    // participa do OpenAI path e limita ainda mais o efetivo. O orçamento permanece
    // bounded/fail-closed (o protocolo ainda recusa um prompt que não caiba na janela).
    const context = resolveOpenAICoderContext(model);
    this.contextResolutionValue = context;
    // Coding Harness V3: um backend REMOTO FORTE recebe o perfil agêntico forte —
    // orçamento de leituras por rodada e rodadas MAIORES do que o local. É a correção
    // arquiteturalmente correta do gargalo que reprovou a correction paga: o
    // `gpt-5.6-terra` pediu mais leituras do que o orçamento por rodada e a tentativa
    // falhava com `ollama_invalid_response_schema` ANTES de qualquer edit. Agora o
    // excedente é deferido; a janela grande do modelo remoto comporta a exploração
    // ampla. Um `maxReadRounds` legado (se passado) ainda faz override, clampado no core.
    const runtimePolicy = resolveAgenticRuntimePolicy({
      mode: 'supervised',
      profile: STRONG_REMOTE_AGENTIC_RUNTIME_PROFILE_V1,
      ...(options.maxReadRounds !== undefined
        ? { overrides: { maxReadRounds: options.maxReadRounds } }
        : {}),
    });
    this.delegate = new OllamaCoderBackend({
      model, backendId: this.id, providerLabel: `OpenAI ${model}`, protocolTransport: transport, fetchImpl,
      timeoutMs: options.timeoutMs ?? 90_000, agenticRuntimePolicy: runtimePolicy,
      operationalContextCap: context.operationalCap,
      ...(context.declaredContextLength !== null ? { declaredContextLength: context.declaredContextLength } : {}),
      outputReserveTokens: OPENAI_CODER_OUTPUT_RESERVE_TOKENS,
      numPredict: OPENAI_CODER_NUM_PREDICT,
    });
  }

  /** Orçamento de contexto EFETIVO do coder OpenAI (delegado ao protocolo compartilhado).
   * Bounded; exposto para observabilidade e prova. `numCtx` é o teto efetivo. */
  get contextBudget(): ContextBudget { return this.delegate.contextBudget; }

  /** Resolução de contexto (teto operacional, capacidade declarada, teto absoluto seguro)
   * mais o teto EFETIVO já aplicado — para observabilidade e prova de que o efetivo é
   * finito, ≤ safeAbsoluteMax e ≤ declaredContextLength quando esta existe. */
  get contextResolution(): OpenAICoderContextResolution & { readonly effectiveContextCap: number } {
    return { ...this.contextResolutionValue, effectiveContextCap: this.delegate.contextBudget.numCtx };
  }
  async edit(request: CoderEditRequest, workspace: CoderWorkspace, signal: AbortSignal): Promise<CoderEditResult> {
    this.usages.length = 0;
    this.requestIds.length = 0;
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
      ...(this.requestIds.length ? { providerRequestIds: [...this.requestIds] } : {}),
    }, providerCallCount };
  }
}
