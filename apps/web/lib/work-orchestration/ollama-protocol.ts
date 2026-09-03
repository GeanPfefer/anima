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
  | 'ollama_aborted'
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
      throw new OllamaProtocolError('ollama_timeout', `o modelo Ollama não respondeu em ${input.timeoutMs} ms.`);
    }
    throw new OllamaProtocolError('ollama_transport_error', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
    if (input.signal) input.signal.removeEventListener('abort', onAbort);
  }
  if (!response || !response.ok) {
    throw new OllamaProtocolError('ollama_transport_error', `o modelo Ollama respondeu ${response ? response.status : 'sem conexão'}.`);
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

// ---- Commit 2: manifesto sem conteúdo integral + leitura limitada ----

export const normalizeRelPath = (p: string): string => p.replace(/\\/g, '/');
const clipStr = (value: unknown, max = 80): string => {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return typeof s === 'string' && s.length > max ? `${s.slice(0, max)}…` : String(s);
};
const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, n));
};

/** Resolve um caminho declarado pelo modelo contra o escopo, de forma
 * DETERMINÍSTICA e fail-closed: normaliza `\`→`/`, colapsa um `./` inicial,
 * recusa absoluto (POSIX ou `X:`), traversal (`..`) e segmentos vazios/`.`, e
 * exige pertencer ao escopo. Não adivinha; só normaliza o que é inequívoco. */
export function resolveScopedPath(raw: unknown, allowed: ReadonlySet<string>): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  let p = raw.replace(/\\/g, '/').trim();
  if (p.startsWith('./')) p = p.slice(2);
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return null; // absoluto
  const segments = p.split('/');
  if (segments.some(s => s === '' || s === '.' || s === '..')) return null; // traversal/vazio
  return allowed.has(p) ? p : null;
}

export type FileKind = 'markdown' | 'typescript' | 'json' | 'other';
export interface ManifestEntry {
  readonly path: string;
  readonly exists: boolean;
  readonly byteSize: number;
  readonly lineCount: number;
  readonly sha256: string | null;
  readonly kind: FileKind;
  /** Estrutura resumida SEGURA (headings md / assinaturas exportadas ts), nunca
   * conteúdo integral. */
  readonly structure: readonly string[];
}
export interface ManifestInputFile { readonly path: string; readonly content: string | null; }

const MANIFEST_MAX_STRUCTURE = 80;
const STRUCTURE_ITEM_MAX = 200;
export const MAX_READS_PER_ROUND = 8;
const READ_MAX_LINES = 200;
const READ_MAX_CONTEXT = 20;
const SEARCH_MAX_CHARS = 200;
const SLICE_MAX_CHARS = 6000;
const MAX_SEARCH_MATCHES = 10;

const kindFromPath = (path: string): FileKind => {
  const p = normalizeRelPath(path).toLowerCase();
  if (p.endsWith('.md') || p.endsWith('.markdown')) return 'markdown';
  if (p.endsWith('.ts') || p.endsWith('.tsx')) return 'typescript';
  if (p.endsWith('.json')) return 'json';
  return 'other';
};

const structureOf = (kind: FileKind, content: string): string[] => {
  const out: string[] = [];
  const push = (line: string) => { if (out.length < MANIFEST_MAX_STRUCTURE) out.push(line.trim().slice(0, STRUCTURE_ITEM_MAX)); };
  if (kind === 'markdown') {
    for (const line of content.split('\n')) { if (/^#{1,6}\s+/.test(line)) push(line); if (out.length >= MANIFEST_MAX_STRUCTURE) break; }
  } else if (kind === 'typescript') {
    // Estrutura SEGURA de TS: assinaturas exportadas E blocos de teste
    // (describe/test/it, com .each/.only/.skip). Arquivos de teste não têm
    // `export`, então sem os blocos o manifesto os mostra OPACOS e o modelo
    // gasta rodadas de leitura só para mapeá-los. São rótulos estruturais
    // (como as assinaturas), nunca o corpo — mesma regra de "estrutura, não conteúdo".
    const re = /^\s*(?:export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|enum)\s+[A-Za-z0-9_]+|(?:describe|test|it)(?:\.[A-Za-z]+)?\s*\()/;
    for (const line of content.split('\n')) { if (re.test(line)) push(line); if (out.length >= MANIFEST_MAX_STRUCTURE) break; }
  }
  return out;
};

/** Manifesto do escopo SEM conteúdo integral: caminho, existência, tamanho,
 * linhas, sha256 e estrutura resumida. É tudo que a Fase 1 revela ao modelo. */
export function buildManifest(files: readonly ManifestInputFile[]): ManifestEntry[] {
  return files.map(file => {
    const exists = typeof file.content === 'string';
    const content = exists ? (file.content as string) : '';
    const kind = kindFromPath(file.path);
    return {
      path: normalizeRelPath(file.path),
      exists,
      byteSize: exists ? Buffer.byteLength(content, 'utf8') : 0,
      lineCount: exists ? content.split('\n').length : 0,
      sha256: exists ? sha256(content) : null,
      kind,
      structure: exists ? structureOf(kind, content) : [],
    };
  });
}

export interface ReadRequest {
  readonly path: string;
  readonly search?: string;
  readonly lineRange?: readonly [number, number];
  readonly contextBefore: number;
  readonly contextAfter: number;
  readonly maxLines: number;
}

/** Parseia solicitações de leitura, fail-closed. Estouro do teto de leituras é
 * erro de schema; entradas malformadas ou fora do escopo são REJEITADAS
 * (relatadas, nunca escondidas), não interrompem as válidas. Parâmetros são
 * limitados (linhas, contexto, tamanho da busca). */
export function parseReadRequests(reads: readonly unknown[], allowed: ReadonlySet<string>): { requests: ReadRequest[]; rejected: string[] } {
  if (!Array.isArray(reads)) throw new OllamaProtocolError('ollama_invalid_response_schema', '"reads" precisa ser uma lista.');
  if (reads.length > MAX_READS_PER_ROUND) throw new OllamaProtocolError('ollama_invalid_response_schema', `no máximo ${MAX_READS_PER_ROUND} leituras por rodada.`);
  const requests: ReadRequest[] = [];
  const rejected: string[] = [];
  for (const raw of reads) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { rejected.push('entrada de leitura malformada'); continue; }
    const entry = raw as Record<string, unknown>;
    const path = resolveScopedPath(entry.path, allowed);
    if (!path) { rejected.push(`caminho fora do escopo: ${clipStr(entry.path)}`); continue; }
    const search = typeof entry.search === 'string' && entry.search.trim().length > 0
      ? entry.search.trim().slice(0, SEARCH_MAX_CHARS) : undefined;
    let lineRange: [number, number] | undefined;
    if (Array.isArray(entry.lineRange) && entry.lineRange.length === 2
      && entry.lineRange.every(n => typeof n === 'number' && Number.isFinite(n))) {
      const a = Math.max(1, Math.floor(entry.lineRange[0] as number));
      const b = Math.max(a, Math.floor(entry.lineRange[1] as number));
      lineRange = [a, b];
    }
    requests.push({
      path,
      ...(search ? { search } : {}),
      ...(lineRange ? { lineRange } : {}),
      contextBefore: clampInt(entry.contextBefore, 0, READ_MAX_CONTEXT, 3),
      contextAfter: clampInt(entry.contextAfter, 0, READ_MAX_CONTEXT, 3),
      maxLines: clampInt(entry.maxLines, 1, READ_MAX_LINES, 60),
    });
  }
  return { requests, rejected };
}

const numberLines = (lines: readonly string[], firstLineNo: number): string =>
  lines.map((line, i) => `${String(firstLineNo + i).padStart(6, ' ')}| ${line}`).join('\n');

/** Extrai um trecho NUMERADO e LIMITADO do conteúdo, por busca, por intervalo de
 * linhas, ou (padrão) o começo do arquivo. Sempre limitado por linhas e por
 * caracteres — nunca devolve o arquivo inteiro. */
export function extractSlice(content: string, request: ReadRequest): string {
  const lines = content.split('\n');
  const total = lines.length;
  const clampIdx = (n: number) => Math.max(0, Math.min(total - 1, n));
  let out: string;
  if (request.search) {
    const needle = request.search.toLowerCase();
    const matches: number[] = [];
    for (let i = 0; i < total && matches.length < MAX_SEARCH_MATCHES; i++) {
      if (lines[i]!.toLowerCase().includes(needle)) matches.push(i);
    }
    if (matches.length === 0) { return `(sem ocorrências de "${clipStr(request.search)}" em ${total} linhas)`; }
    const chunks: string[] = [];
    let budgetLines = request.maxLines;
    for (const m of matches) {
      if (budgetLines <= 0) break;
      const start = clampIdx(m - request.contextBefore);
      const end = clampIdx(m + request.contextAfter);
      const take = lines.slice(start, end + 1).slice(0, budgetLines);
      budgetLines -= take.length;
      chunks.push(numberLines(take, start + 1));
    }
    out = chunks.join('\n   …\n');
  } else if (request.lineRange) {
    const start = clampIdx(request.lineRange[0] - 1);
    const endWanted = clampIdx(request.lineRange[1] - 1);
    const end = Math.min(endWanted, start + request.maxLines - 1);
    out = numberLines(lines.slice(start, end + 1), start + 1);
  } else {
    out = numberLines(lines.slice(0, request.maxLines), 1);
  }
  return out.length > SLICE_MAX_CHARS ? `${out.slice(0, SLICE_MAX_CHARS)}\n… (trecho truncado por limite de caracteres)` : out;
}

export type ServedReadEffectiveMode =
  | 'search'
  | 'lineRange'
  | 'head';

export interface ServedReadProvenance {
  readonly search?: string;
  readonly lineRange?: readonly [number, number];
  readonly contextBefore: number;
  readonly contextAfter: number;
  readonly maxLines: number;
  readonly effectiveMode: ServedReadEffectiveMode;
}

export interface ServedRead {
  readonly path: string;
  readonly sha256: string;
  readonly slice: string;
  readonly provenance: ServedReadProvenance;
}

const provenanceOfReadRequest = (
  request: ReadRequest,
): ServedReadProvenance => ({
  ...(request.search !== undefined
    ? { search: request.search }
    : {}),
  ...(request.lineRange !== undefined
    ? { lineRange: request.lineRange }
    : {}),
  contextBefore: request.contextBefore,
  contextAfter: request.contextAfter,
  maxLines: request.maxLines,
  effectiveMode: request.search !== undefined
    ? 'search'
    : request.lineRange !== undefined
      ? 'lineRange'
      : 'head',
});

/** Atende as solicitações válidas com trechos numerados + o sha256 ATUAL de cada
 * arquivo (âncora para a fase de edição). Arquivo inexistente é rejeitado
 * (relatado), nunca inventado. */
export function serveReadRequests(
  requests: readonly ReadRequest[],
  contentOf: (path: string) => string | null,
): { served: ServedRead[]; rejected: string[] } {
  const served: ServedRead[] = [];
  const rejected: string[] = [];
  for (const request of requests) {
    const content = contentOf(request.path);
    if (content === null) { rejected.push(`arquivo inexistente no escopo: ${request.path}`); continue; }
    served.push({
      path: request.path,
      sha256: sha256(content),
      slice: extractSlice(content, request),
      provenance: provenanceOfReadRequest(request),
    });
  }
  return { served, rejected };
}

// ---- Commit 3: edições exatas, verificáveis e aplicadas só na worktree ----

const SHA_HEX = /^[a-f0-9]{64}$/;
const MAX_OPERATIONS = 20;
const MAX_BEFORE_CHARS = 20_000;
const MAX_AFTER_CHARS = 40_000;
const MAX_CREATE_CHARS = 200_000;

/** Operação estruturada de edição. Sem diff ambíguo: substituição EXATA
 * verificável, criação de arquivo novo, ou APÊNDICE ao fim de arquivo existente.
 * Exclusão não existe neste recorte.
 *
 * `append` fecha um gap ergonômico PROVADO por eval (arquivo grande, mesmo modelo):
 * `replace_exact` exige um `before` ÚNICO, e "o fim do arquivo" não tem texto único
 * — o modelo tentava um `before` vazio/inexistente e a operação falhava
 * (`ollama_invalid_response_schema`/`ollama_ambiguous_replacement`). Adicionar
 * export/função/caso de teste ao fim é operação real; `append` a torna inequívoca
 * sem afrouxar nada (segue exigindo escopo + sha do arquivo como lido). */
export type EditOperation =
  | { readonly kind: 'replace_exact'; readonly path: string; readonly expectedFileSha256: string; readonly before: string; readonly after: string }
  | { readonly kind: 'create_file'; readonly path: string; readonly content: string }
  | { readonly kind: 'append'; readonly path: string; readonly expectedFileSha256: string; readonly content: string }
  // `insert` fecha o gap ergonômico PROVADO ao vivo: adicionar um caso a um bloco
  // existente (ex.: um `test` dentro de um `describe`) não é "fim do arquivo" —
  // `append` o joga FORA do bloco (léxicamente inválido) e `replace_exact` exige
  // reproduzir a âncora DUAS vezes (em `before` e `after`). `insert` posiciona
  // `content` imediatamente ANTES/DEPOIS de uma âncora ÚNICA e exata (reproduzida
  // UMA vez), sem removê-la. Segue EXATO (ocorrência única, sem fuzzy), com stale
  // hash, escopo e no-op fail-closed idênticos ao replace.
  | { readonly kind: 'insert'; readonly path: string; readonly expectedFileSha256: string; readonly anchor: string; readonly position: 'before' | 'after'; readonly content: string };

/** Parseia o lote de operações, fail-closed com limites de quantidade e tamanho.
 * Caminho fora do escopo é `ollama_edit_outside_scope`; qualquer outra violação
 * estrutural é `ollama_invalid_response_schema`. */
export function parseEditOperations(operations: readonly unknown[], allowed: ReadonlySet<string>): EditOperation[] {
  if (!Array.isArray(operations)) throw new OllamaProtocolError('ollama_invalid_response_schema', '"operations" precisa ser uma lista.');
  if (operations.length > MAX_OPERATIONS) throw new OllamaProtocolError('ollama_invalid_response_schema', `no máximo ${MAX_OPERATIONS} operações por lote.`);
  const out: EditOperation[] = [];
  for (const raw of operations) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new OllamaProtocolError('ollama_invalid_response_schema', 'operação de edição malformada.');
    const op = raw as Record<string, unknown>;
    if (op.kind === 'replace_exact') {
      if (typeof op.path !== 'string') throw new OllamaProtocolError('ollama_invalid_response_schema', 'replace_exact exige "path" string.');
      const path = resolveScopedPath(op.path, allowed);
      if (!path) throw new OllamaProtocolError('ollama_edit_outside_scope', `edição fora do escopo: ${clipStr(op.path)}`);
      if (typeof op.expected_file_sha256 !== 'string' || !SHA_HEX.test(op.expected_file_sha256)) throw new OllamaProtocolError('ollama_invalid_response_schema', 'replace_exact exige "expected_file_sha256" (64 hex).');
      if (typeof op.before !== 'string' || op.before.length === 0 || op.before.length > MAX_BEFORE_CHARS) throw new OllamaProtocolError('ollama_invalid_response_schema', 'replace_exact exige "before" não vazio e dentro do limite.');
      if (typeof op.after !== 'string' || op.after.length > MAX_AFTER_CHARS) throw new OllamaProtocolError('ollama_invalid_response_schema', 'replace_exact exige "after" string dentro do limite.');
      if (op.expected_occurrences !== undefined && op.expected_occurrences !== 1) throw new OllamaProtocolError('ollama_invalid_response_schema', '"expected_occurrences" só pode ser 1.');
      out.push({ kind: 'replace_exact', path, expectedFileSha256: op.expected_file_sha256, before: op.before, after: op.after });
    } else if (op.kind === 'create_file') {
      if (typeof op.path !== 'string') throw new OllamaProtocolError('ollama_invalid_response_schema', 'create_file exige "path" string.');
      const path = resolveScopedPath(op.path, allowed);
      if (!path) throw new OllamaProtocolError('ollama_edit_outside_scope', `criação fora do escopo: ${clipStr(op.path)}`);
      if (typeof op.content !== 'string' || op.content.length === 0 || op.content.length > MAX_CREATE_CHARS) throw new OllamaProtocolError('ollama_invalid_response_schema', 'create_file exige "content" string não vazio dentro do limite.');
      out.push({ kind: 'create_file', path, content: op.content });
    } else if (op.kind === 'append') {
      if (typeof op.path !== 'string') throw new OllamaProtocolError('ollama_invalid_response_schema', 'append exige "path" string.');
      const path = resolveScopedPath(op.path, allowed);
      if (!path) throw new OllamaProtocolError('ollama_edit_outside_scope', `apêndice fora do escopo: ${clipStr(op.path)}`);
      if (typeof op.expected_file_sha256 !== 'string' || !SHA_HEX.test(op.expected_file_sha256)) throw new OllamaProtocolError('ollama_invalid_response_schema', 'append exige "expected_file_sha256" (64 hex).');
      if (typeof op.content !== 'string' || op.content.length === 0 || op.content.length > MAX_AFTER_CHARS) throw new OllamaProtocolError('ollama_invalid_response_schema', 'append exige "content" string não vazio dentro do limite.');
      out.push({ kind: 'append', path, expectedFileSha256: op.expected_file_sha256, content: op.content });
    } else if (op.kind === 'insert') {
      if (typeof op.path !== 'string') throw new OllamaProtocolError('ollama_invalid_response_schema', 'insert exige "path" string.');
      const path = resolveScopedPath(op.path, allowed);
      if (!path) throw new OllamaProtocolError('ollama_edit_outside_scope', `inserção fora do escopo: ${clipStr(op.path)}`);
      if (typeof op.expected_file_sha256 !== 'string' || !SHA_HEX.test(op.expected_file_sha256)) throw new OllamaProtocolError('ollama_invalid_response_schema', 'insert exige "expected_file_sha256" (64 hex).');
      if (typeof op.anchor !== 'string' || op.anchor.length === 0 || op.anchor.length > MAX_BEFORE_CHARS) throw new OllamaProtocolError('ollama_invalid_response_schema', 'insert exige "anchor" não vazio e dentro do limite.');
      if (op.position !== 'before' && op.position !== 'after') throw new OllamaProtocolError('ollama_invalid_response_schema', 'insert exige "position" igual a "before" ou "after".');
      if (typeof op.content !== 'string' || op.content.length === 0 || op.content.length > MAX_AFTER_CHARS) throw new OllamaProtocolError('ollama_invalid_response_schema', 'insert exige "content" não vazio dentro do limite.');
      out.push({ kind: 'insert', path, expectedFileSha256: op.expected_file_sha256, anchor: op.anchor, position: op.position, content: op.content });
    } else {
      throw new OllamaProtocolError('ollama_invalid_response_schema', `operação não suportada: ${clipStr(op.kind)} (exclusão não é permitida neste recorte).`);
    }
  }
  return out;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Conta as ocorrências de `needle` em `haystack` de forma AGNÓSTICA a fim de
 * linha: cada quebra do needle (`\r\n`, `\r` ou `\n`) casa com `\r\n` OU `\n` no
 * haystack. Todos os demais bytes precisam ser IDÊNTICOS — continua uma
 * correspondência EXATA, não fuzzy. Devolve offsets no espaço CRU do haystack (a
 * `firstEnd` é o fim real da 1ª ocorrência, que pode exceder `needle.length`
 * quando o arquivo usa CRLF), o que preserva byte-a-byte tudo fora do trecho
 * editado. Corrige a incompatibilidade determinística CRLF↔LF: o modelo enxerga o
 * trecho servido (fatiado por `\n`) e reproduz a âncora com `\n`, enquanto o
 * arquivo em disco no Windows guarda `\r\n`; sem esta tolerância um `before`
 * multi-linha CORRETO ocorreria 0 vez(es) (`ollama_ambiguous_replacement`).
 */
const countOccurrences = (haystack: string, needle: string): { count: number; first: number; firstEnd: number } => {
  const pattern = escapeRegExp(needle).replace(/\r\n|\r|\n/g, '(?:\\r\\n|\\n)');
  const re = new RegExp(pattern, 'g');
  let count = 0; let first = -1; let firstEnd = -1;
  for (let m = re.exec(haystack); m !== null; m = re.exec(haystack)) {
    if (first === -1) { first = m.index; firstEnd = m.index + m[0].length; }
    count++;
    if (m.index === re.lastIndex) re.lastIndex++; // guarda defensiva (needle nunca é vazio: o schema exige > 0)
  }
  return { count, first, firstEnd };
};

/** Diagnostic only: uses precisely the production matcher, never applies a patch. */
export function anchorMatchEvidence(original: string, before: string): { rawMatchCount: number; matchCount: number } {
  return {
    rawMatchCount: before.length ? original.split(before).length - 1 : 0,
    matchCount: before.length ? countOccurrences(original, before).count : 0,
  };
}

/** Reencoda todas as quebras de linha de `value` para o EOL predominante do
 * arquivo (`\r\n` se o arquivo é CRLF, senão `\n`). Mantém o texto inserido
 * coerente com o arquivo e evita injetar LF solto num arquivo CRLF. */
const toFileEol = (value: string, fileUsesCrlf: boolean): string =>
  fileUsesCrlf ? value.replace(/\r\n|\r|\n/g, '\r\n') : value.replace(/\r\n|\r/g, '\n');

export interface AppliedChange { readonly path: string; readonly newContent: string; readonly kind: 'replace' | 'create'; }

/** Valida e aplica as operações contra o conteúdo ATUAL (lido da worktree),
 * produzindo o conjunto final de alterações. Fail-closed: hash divergente,
 * ocorrência != 1, operações sobrepostas, criação sobre existente, ou zero
 * mudança real são recusados com o código específico. NÃO escreve nada — devolve
 * o conjunto para o chamador aplicar exclusivamente na worktree. */
export function applyEditOperations(operations: readonly EditOperation[], contentOf: (path: string) => string | null): AppliedChange[] {
  if (operations.length === 0) throw new OllamaProtocolError('ollama_no_effective_edits', 'nenhuma operação de edição foi fornecida.');
  const creates: AppliedChange[] = [];
  const replaceByPath = new Map<string, { before: string; after: string; sha: string }[]>();
  const appendByPath = new Map<string, { content: string; sha: string }[]>();
  const insertByPath = new Map<string, { anchor: string; position: 'before' | 'after'; content: string; sha: string }[]>();
  for (const op of operations) {
    if (op.kind === 'create_file') {
      if (contentOf(op.path) !== null) throw new OllamaProtocolError('ollama_invalid_response_schema', `create_file exige caminho inexistente: ${op.path}.`);
      creates.push({ path: op.path, newContent: op.content, kind: 'create' });
    } else if (op.kind === 'append') {
      const list = appendByPath.get(op.path) ?? [];
      list.push({ content: op.content, sha: op.expectedFileSha256 });
      appendByPath.set(op.path, list);
    } else if (op.kind === 'insert') {
      const list = insertByPath.get(op.path) ?? [];
      list.push({ anchor: op.anchor, position: op.position, content: op.content, sha: op.expectedFileSha256 });
      insertByPath.set(op.path, list);
    } else {
      const list = replaceByPath.get(op.path) ?? [];
      list.push({ before: op.before, after: op.after, sha: op.expectedFileSha256 });
      replaceByPath.set(op.path, list);
    }
  }
  const changes: AppliedChange[] = [];
  // Um arquivo pode combinar replaces + appends: aplica os replaces sobre o
  // original (offsets do original) e então concatena os appends no fim, numa
  // ÚNICA mudança por caminho. O sha de CADA operação precisa bater com o arquivo
  // como lido — append não afrouxa a verificação de staleness.
  const editedPaths = new Set<string>([...replaceByPath.keys(), ...appendByPath.keys(), ...insertByPath.keys()]);
  for (const path of editedPaths) {
    const original = contentOf(path);
    if (original === null) throw new OllamaProtocolError('ollama_stale_file_hash', `arquivo do escopo não encontrado para edição: ${path}.`);
    const currentSha = sha256(original);
    // EOL do arquivo COMO LIDO (o sha atestado é do conteúdo cru; a tolerância é
    // só no casamento da âncora e no reencode do texto inserido).
    const fileUsesCrlf = original.includes('\r\n');
    const ranges: { start: number; end: number; after: string; insert: boolean }[] = [];
    for (const op of replaceByPath.get(path) ?? []) {
      if (op.sha !== currentSha) throw new OllamaProtocolError('ollama_stale_file_hash', `hash divergente para ${path}: o arquivo mudou desde a leitura.`);
      const { count, first, firstEnd } = countOccurrences(original, op.before);
      if (count !== 1) throw new OllamaProtocolError('ollama_ambiguous_replacement', `"before" ocorre ${count} vez(es) em ${path}; esperado exatamente 1.`);
      ranges.push({ start: first, end: firstEnd, after: toFileEol(op.after, fileUsesCrlf), insert: false });
    }
    // Insert = range de LARGURA ZERO na borda da âncora única (não remove a
    // âncora). Mesma exatidão/EOL/stale do replace; a âncora é reproduzida UMA vez.
    for (const op of insertByPath.get(path) ?? []) {
      if (op.sha !== currentSha) throw new OllamaProtocolError('ollama_stale_file_hash', `hash divergente para ${path}: o arquivo mudou desde a leitura.`);
      const { count, first, firstEnd } = countOccurrences(original, op.anchor);
      if (count !== 1) throw new OllamaProtocolError('ollama_ambiguous_replacement', `"anchor" ocorre ${count} vez(es) em ${path}; esperado exatamente 1.`);
      const at = op.position === 'before' ? first : firstEnd;
      ranges.push({ start: at, end: at, after: toFileEol(op.content, fileUsesCrlf), insert: true });
    }
    // Inserts primeiro no desempate por posição, para a checagem de borda a seguir.
    const sorted = [...ranges].sort((a, b) => a.start - b.start || Number(b.insert) - Number(a.insert));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!; const cur = sorted[i]!;
      // Interior sobreposto SEMPRE recusa; TOCAR uma borda só recusa quando um dos
      // lados é insert (ambíguo qual lado do corte o conteúdo entra) — replaces
      // adjacentes (borda a borda, sem insert) continuam permitidos como antes.
      if (cur.start < prev.end || (cur.start === prev.end && (cur.insert || prev.insert))) {
        throw new OllamaProtocolError('ollama_ambiguous_replacement', `operações sobrepostas em ${path}.`);
      }
    }
    let next = original;
    for (const range of [...sorted].sort((a, b) => b.start - a.start)) {
      next = next.slice(0, range.start) + range.after + next.slice(range.end);
    }
    for (const ap of appendByPath.get(path) ?? []) {
      if (ap.sha !== currentSha) throw new OllamaProtocolError('ollama_stale_file_hash', `hash divergente para ${path}: o arquivo mudou desde a leitura.`);
      next = next + toFileEol(ap.content, fileUsesCrlf);
    }
    if (next !== original) changes.push({ path, newContent: next, kind: 'replace' });
  }
  const all = [...changes, ...creates];
  if (all.length === 0) throw new OllamaProtocolError('ollama_no_effective_edits', 'as operações não produziram mudança real.');
  return all;
}

// ---- Escrita do lote (autoridade de restauração fica na worktree) ----

/** Escritor confinado — mesma superfície mínima do CoderWorkspace. */
export interface ChangeWriter {
  writeFile(relPath: string, content: string): Promise<boolean>;
}

/**
 * Escreve o conjunto de mudanças já validado contra o snapshot. Lança em QUALQUER
 * falha (abort, guarda recusa, exceção) — NUNCA retorna sucesso parcial. `replace`
 * e `create` são escritos igual; a criação de arquivo novo é feita pela própria
 * `writeFile`.
 *
 * NÃO restaura nada: a restauração ao estado-base em caso de falha é a autoridade
 * ÚNICA da camada da worktree (`GitWorktree.restoreToBase`), evitando duas
 * camadas concorrentes de rollback. Este helper apenas garante que nenhum sucesso
 * parcial seja RETORNADO; o estado transitório em disco é revertido pela worktree.
 */
export async function writeChangeSet(
  changes: readonly AppliedChange[],
  writer: ChangeWriter,
  signal?: AbortSignal,
): Promise<string[]> {
  const touched: string[] = [];
  for (const change of changes) {
    if (signal?.aborted) throw new OllamaProtocolError('ollama_aborted', 'aplicação abortada antes de concluir o lote.');
    let ok: boolean;
    try {
      ok = await writer.writeFile(change.path, change.newContent);
    } catch (error) {
      throw error instanceof OllamaProtocolError
        ? error
        : new OllamaProtocolError('ollama_transport_error', `falha ao escrever ${change.path}: ${error instanceof Error ? error.message : String(error)}.`);
    }
    if (!ok) throw new OllamaProtocolError('ollama_edit_outside_scope', `a guarda recusou a escrita em ${change.path}.`);
    touched.push(change.path);
  }
  if (touched.length === 0) throw new OllamaProtocolError('ollama_no_effective_edits', 'nenhuma alteração foi escrita.');
  return touched;
}
