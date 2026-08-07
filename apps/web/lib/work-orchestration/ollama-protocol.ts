import { createHash } from 'node:crypto';

// ============================================================
// Protocolo limitado de leitura + edição estruturada para backends de modelo
// local (ADR-001). Substitui o round-trip de CONTEÚDO INTEGRAL — provado
// inviável: um prompt com 4 docs (~73k tokens) foi truncado para ~4k pelo
// num_ctx=8192, o system prompt se perdeu e o modelo devolveu JSON de schema
// errado, que o parser corretamente recusou como "0 arquivos".
//
// Princípios (fail-closed em toda ambiguidade):
//  - nunca injeta arquivos completos no prompt nem exige arquivos completos de
//    volta; o modelo pede TRECHOS e devolve OPERAÇÕES exatas;
//  - orçamento de contexto explícito, com reserva de saída e recusa antecipada;
//  - truncamento detectado por metadados do Ollama vira erro específico, nunca
//    o genérico "nenhum arquivo válido";
//  - todo caminho é validado contra o escopo; absoluto/traversal é recusado.
//
// Este arquivo é puro (sem rede além do helper injetável de chamada) e não
// conhece worktree, Supervisor nem banco.
// ============================================================

// ---- Commit 1: orçamento, diagnóstico honesto e códigos de erro ----

export type OllamaProtocolErrorCode =
  | 'ollama_context_budget_exceeded'
  | 'ollama_prompt_truncated'
  | 'ollama_invalid_response_schema'
  | 'ollama_read_round_limit'
  | 'ollama_edit_outside_scope'
  | 'ollama_stale_file_hash'
  | 'ollama_ambiguous_replacement'
  | 'ollama_no_effective_edits'
  | 'ollama_timeout'
  | 'ollama_transport_error';

/** Erro do protocolo que preserva o código específico para diagnóstico interno.
 * A mensagem já embute o código; quem apresenta ao usuário pode resumir, mas o
 * código nunca se perde. */
export class OllamaProtocolError extends Error {
  readonly code: OllamaProtocolErrorCode;
  constructor(code: OllamaProtocolErrorCode, detail: string) {
    super(`[${code}] ${detail}`);
    this.name = 'OllamaProtocolError';
    this.code = code;
  }
}

/** Estimativa conservadora (super-estima) de tokens a partir de caracteres.
 * ~3,5 chars/token deixa margem para não subestimar o custo e estourar a janela. */
export const estimateTokens = (text: string): number =>
  Math.ceil((typeof text === 'string' ? text.length : 0) / 3.5);

export interface ContextBudget {
  readonly numCtx: number;
  readonly inputBudgetTokens: number;
  readonly outputReserveTokens: number;
  readonly numPredict: number;
}

export interface ResolveBudgetInput {
  /** Limite de contexto declarado pelo modelo (quando descoberto); opcional. */
  readonly declaredContextLength?: number | null;
  /** Teto operacional conservador — nunca ultrapassado, mesmo se o modelo
   * declarar mais. Evita estourar memória/latência (32768 já falhou nesta
   * máquina). */
  readonly operationalCap: number;
  /** Reserva explícita para a saída, subtraída do orçamento de input. */
  readonly outputReserveTokens: number;
  /** Teto duro de tokens gerados (num_predict). */
  readonly numPredict: number;
}

/** Resolve a janela efetiva: min(declarado, teto operacional), com reserva de
 * saída e num_predict limitados. Nunca cresce o num_ctx sem teto. */
export function resolveContextBudget(input: ResolveBudgetInput): ContextBudget {
  const cap = Math.max(1024, Math.floor(input.operationalCap));
  const declared = typeof input.declaredContextLength === 'number' && input.declaredContextLength > 0
    ? Math.floor(input.declaredContextLength)
    : cap;
  const numCtx = Math.min(declared, cap);
  const outputReserve = Math.max(256, Math.min(Math.floor(input.outputReserveTokens), Math.floor(numCtx / 2)));
  const inputBudgetTokens = Math.max(0, numCtx - outputReserve);
  const numPredict = Math.max(64, Math.min(Math.floor(input.numPredict), outputReserve));
  return { numCtx, inputBudgetTokens, outputReserveTokens: outputReserve, numPredict };
}

/** Guarda ANTES da chamada: recusa se o prompt estimado não cabe no orçamento de
 * input. Evita mandar um prompt que o Ollama truncaria silenciosamente. */
export function assertPromptWithinBudget(promptText: string, budget: ContextBudget): void {
  const tokens = estimateTokens(promptText);
  if (tokens > budget.inputBudgetTokens) {
    throw new OllamaProtocolError(
      'ollama_context_budget_exceeded',
      `prompt estimado em ${tokens} tokens excede o orçamento de input ${budget.inputBudgetTokens} (num_ctx ${budget.numCtx}).`,
    );
  }
}

/** Metadados seguros retornados pelo Ollama (contagens, nunca conteúdo). */
export interface OllamaCallMeta {
  readonly promptEvalCount: number | null;
  readonly evalCount: number | null;
  readonly doneReason: string | null;
}

/** Guarda DEPOIS da chamada: se o modelo avaliou muito menos tokens do que o
 * prompt estimado, o input foi truncado — erro específico, não "0 arquivos". */
export function assertNotTruncated(promptText: string, meta: OllamaCallMeta): void {
  const estimated = estimateTokens(promptText);
  const evaluated = typeof meta.promptEvalCount === 'number' ? meta.promptEvalCount : null;
  if (evaluated !== null && estimated > 64 && evaluated < Math.floor(estimated * 0.6)) {
    throw new OllamaProtocolError(
      'ollama_prompt_truncated',
      `o modelo avaliou ${evaluated} tokens de um prompt estimado em ${estimated}: input truncado.`,
    );
  }
}

/** SHA-256 hex do conteúdo — âncora de frescor de arquivo entre leitura e edição. */
export const sha256 = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex');

// ---- Chamada ao Ollama com timeout e num_predict (transporte injetável) ----

export interface OllamaChatInput {
  readonly url: string;
  readonly model: string;
  readonly messages: readonly { readonly role: 'system' | 'user' | 'assistant'; readonly content: string }[];
  readonly budget: ContextBudget;
  readonly temperature?: number;
  readonly timeoutMs: number;
  readonly fetchImpl: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface OllamaChatResult {
  readonly content: string;
  readonly meta: OllamaCallMeta;
}

/** Uma chamada /api/chat com format:json, num_ctx/num_predict do orçamento,
 * timeout explícito e erros de transporte/timeout tipados. Não valida schema:
 * isso é dos parsers dedicados. */
export async function callOllamaChat(input: OllamaChatInput): Promise<OllamaChatResult> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (input.signal) {
    if (input.signal.aborted) controller.abort();
    else input.signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), Math.max(1, input.timeoutMs));
  let response: Response | null;
  try {
    response = await input.fetchImpl(`${input.url}/api/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        stream: false,
        format: 'json',
        options: {
          num_ctx: input.budget.numCtx,
          num_predict: input.budget.numPredict,
          temperature: input.temperature ?? 0,
        },
        messages: input.messages,
      }),
    });
  } catch (error) {
    if (controller.signal.aborted && (!input.signal || !input.signal.aborted)) {
      throw new OllamaProtocolError('ollama_timeout', `o modelo local não respondeu em ${input.timeoutMs} ms.`);
    }
    throw new OllamaProtocolError('ollama_transport_error', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
    if (input.signal) input.signal.removeEventListener('abort', onAbort);
  }
  if (!response || !response.ok) {
    throw new OllamaProtocolError('ollama_transport_error', `o modelo local respondeu ${response ? response.status : 'sem conexão'}.`);
  }
  const body = await response.json().catch(() => null) as {
    message?: { content?: unknown };
    prompt_eval_count?: unknown;
    eval_count?: unknown;
    done_reason?: unknown;
  } | null;
  const content = typeof body?.message?.content === 'string' ? body.message.content : '';
  const meta: OllamaCallMeta = {
    promptEvalCount: typeof body?.prompt_eval_count === 'number' ? body.prompt_eval_count : null,
    evalCount: typeof body?.eval_count === 'number' ? body.eval_count : null,
    doneReason: typeof body?.done_reason === 'string' ? body.done_reason : null,
  };
  return { content, meta };
}

// ---- Envelope da resposta do protocolo (discriminado por `action`) ----

export type ProtocolResponse =
  | { readonly action: 'read'; readonly reads: unknown }
  | { readonly action: 'edit'; readonly operations: unknown };

const MAX_RAW_RESPONSE_CHARS = 200_000;

const extractJsonObject = (raw: string): string => {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text.length > MAX_RAW_RESPONSE_CHARS) return '';
  return text.startsWith('{') ? text : (text.match(/\{[\s\S]*\}/)?.[0] ?? '');
};

/** Parseia SOMENTE o envelope: `{ "action": "read", "reads": [...] }` ou
 * `{ "action": "edit", "operations": [...] }`. Fail-closed: qualquer JSON que
 * não seja exatamente esse envelope vira `ollama_invalid_response_schema`. Os
 * detalhes de `reads`/`operations` ficam para os parsers dedicados. NÃO reusa
 * nem afrouxa o `parseScopedFiles` genérico. */
export function parseProtocolResponse(raw: string): ProtocolResponse {
  const candidate = extractJsonObject(raw);
  if (!candidate) throw new OllamaProtocolError('ollama_invalid_response_schema', 'resposta sem objeto JSON reconhecível.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new OllamaProtocolError('ollama_invalid_response_schema', 'resposta não é JSON válido.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OllamaProtocolError('ollama_invalid_response_schema', 'resposta não é um objeto de protocolo.');
  }
  const root = parsed as Record<string, unknown>;
  if (root.action === 'read') {
    if (!Array.isArray(root.reads)) throw new OllamaProtocolError('ollama_invalid_response_schema', 'ação read exige uma lista "reads".');
    return { action: 'read', reads: root.reads };
  }
  if (root.action === 'edit') {
    if (!Array.isArray(root.operations)) throw new OllamaProtocolError('ollama_invalid_response_schema', 'ação edit exige uma lista "operations".');
    return { action: 'edit', operations: root.operations };
  }
  throw new OllamaProtocolError('ollama_invalid_response_schema', 'campo "action" precisa ser "read" ou "edit".');
}
