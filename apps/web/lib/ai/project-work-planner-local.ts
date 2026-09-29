import { executeProjectTool } from './project-tools';
import {
  buildPlannerUserPrompt,
  coercePlannerArrayFields,
  includedScopeAnchoredInProject,
  INCLUDED_SCOPE_ANCHORING_RULE,
  unanchoredIncludedScopePaths,
  validatePlannerProposal,
  PLANNER_CHAT_TOOLS,
  PLANNER_SYSTEM_INSTRUCTIONS,
  PLANNER_TOOL_CALL_LIMIT,
  SUBMIT_CHAT_TOOL,
  SUBMIT_TOOL_NAME,
  timeoutSignal,
  type ProjectWorkPlanner,
  type PlannerProposalResult,
} from './project-work-planner-shared';

// ============================================================
// Planejador LOCAL (Ollama, API nativa /api/chat). Mesmo contrato
// da porta: investiga com as ferramentas READ-ONLY e devolve os ARGUMENTOS BRUTOS
// do submit. NÃO edita arquivos, NÃO usa subprocesso/worktree, NÃO recebe nenhuma
// credencial de nuvem — o único endpoint é o Ollama local (sem Authorization). O
// host valida e monta o execution_spec depois, com a MESMA autoridade de sempre.
//
// Segredos: a requisição carrega apenas as instruções, a mensagem do usuário e as
// saídas das ferramentas read-only (dados não sensíveis do repo). Nenhuma variável
// de ambiente secreta (OPENAI_API_KEY/DEEPSEEK_API_KEY/etc.) é lida ou enviada.
// ============================================================

type ChatToolCall = { id?: string; type?: string; function?: { name?: string; arguments?: unknown } };

const TEXTUAL_TOOL_CALL = /<function=([A-Za-z_][\w-]*)>([\s\S]*?)<\/function>/g;
const TEXTUAL_PARAMETER = /<parameter=([A-Za-z_][\w-]*)>([\s\S]*?)<\/parameter>/g;
const HERMES_JSON_FENCE = /^```json[ \t]*\r?\n([\s\S]*?)\r?\n```$/i;
const MAX_TEXTUAL_TOOL_CALLS = 8;

function parseHermesTextualToolCall(content: string, knownTools: ReadonlySet<string>): ChatToolCall[] {
  const trimmed = content.trim();
  const fenced = HERMES_JSON_FENCE.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

  const call = parsed as Record<string, unknown>;
  const hasOwn = (key: string): boolean => Object.prototype.hasOwnProperty.call(call, key);
  if (Object.keys(call).length !== 2 || !hasOwn('name') || !hasOwn('arguments')) return [];
  if (typeof call.name !== 'string' || !knownTools.has(call.name)) return [];
  if (!call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) return [];

  return [{ id: 'text_call_0', type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }];
}

/**
 * Fallback de protocolo: aceita o formato textual nativo legado do `qwen3-coder` e
 * um único objeto Hermes/JSON emitido pelo `qwen2.5-coder`, puro ou dentro de uma
 * fence `json` exata. Hermes é deliberadamente estrito: o conteúdo inteiro precisa
 * ser `{name, arguments}`, `arguments` precisa ser objeto e a ferramenta precisa ser
 * conhecida. Não extrai JSON de prosa, arrays ou múltiplos objetos ambíguos.
 */
export function parseTextualToolCalls(content: string | null | undefined, knownTools: ReadonlySet<string>): ChatToolCall[] {
  if (typeof content !== 'string') return [];
  if (!content.includes('<function=')) return parseHermesTextualToolCall(content, knownTools);
  const calls: ChatToolCall[] = [];
  for (const match of content.matchAll(TEXTUAL_TOOL_CALL)) {
    if (calls.length >= MAX_TEXTUAL_TOOL_CALLS) break;
    const name = match[1]!;
    if (!knownTools.has(name)) continue;
    const args: Record<string, unknown> = {};
    for (const parameter of match[2]!.matchAll(TEXTUAL_PARAMETER)) {
      const raw = parameter[2]!.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
      const trimmed = raw.trim();
      let value: unknown = raw;
      if (/^[[{]/.test(trimmed) || /^-?\d+(\.\d+)?$/.test(trimmed) || trimmed === 'true' || trimmed === 'false') {
        try { value = JSON.parse(trimmed); } catch { value = raw; }
      }
      args[parameter[1]!] = value;
    }
    calls.push({ id: `text_call_${calls.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  }
  return calls;
}

/** Timeout POR RODADA do planejador local. Ausente ⇒ 90 s (histórico). Faixa [30 s, 600 s];
 * valor inválido ⇒ default (o planejamento local nunca gasta dinheiro, só tempo). Um modelo
 * grande no limite de memória da máquina pode precisar de rodadas mais longas. */
export function resolveLocalPlannerRoundTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.ANIMA_PROJECT_PLANNER_ROUND_TIMEOUT_MS);
  return Number.isInteger(raw) && raw >= 30_000 && raw <= 600_000 ? raw : 90_000;
}

export const LOCAL_PLANNER_DEFAULT_CONTEXT_LENGTH = 16_384;

/** Contexto request-scoped do planejador local. Ausente => 16k; presente precisa
 * ser um inteiro decimal positivo estrito. Configuração inválida é erro, nunca
 * fallback silencioso para o contexto default do servidor Ollama. */
export function resolveLocalPlannerContextLength(env: Record<string, string | undefined> = process.env): number {
  const raw = env.ANIMA_PROJECT_PLANNER_CONTEXT_LENGTH;
  if (raw === undefined) return LOCAL_PLANNER_DEFAULT_CONTEXT_LENGTH;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error('ANIMA_PROJECT_PLANNER_CONTEXT_LENGTH deve ser um inteiro decimal positivo.');
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error('ANIMA_PROJECT_PLANNER_CONTEXT_LENGTH excede o maior inteiro seguro suportado.');
  }
  return value;
}

const KNOWN_PLANNER_TOOLS: ReadonlySet<string> = new Set(
  [...PLANNER_CHAT_TOOLS, SUBMIT_CHAT_TOOL]
    .map(tool => (tool as { function?: { name?: unknown } }).function?.name)
    .filter((name): name is string => typeof name === 'string'),
);
type NativeToolCall = { function: { name: string; arguments: Record<string, unknown> } };
type NativeChatMessage = {
  role: string;
  content?: string;
  tool_calls?: NativeToolCall[];
  tool_name?: string;
};
type NormalizedAssistantMessage = { content: string; toolCalls: ChatToolCall[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNativeAssistantResponse(value: unknown): NormalizedAssistantMessage | null {
  if (!isRecord(value) || value.done !== true || !isRecord(value.message)) return null;
  const message = value.message;
  if (message.role !== 'assistant') return null;
  const content = message.content;
  if (content !== undefined && typeof content !== 'string') return null;

  const rawCalls = message.tool_calls;
  if (rawCalls !== undefined && !Array.isArray(rawCalls)) return null;
  const toolCalls: ChatToolCall[] = [];
  for (const [index, rawCall] of (rawCalls ?? []).entries()) {
    if (!isRecord(rawCall) || (rawCall.type !== undefined && rawCall.type !== 'function') || !isRecord(rawCall.function)) return null;
    const fn = rawCall.function;
    if (typeof fn.name !== 'string' || !KNOWN_PLANNER_TOOLS.has(fn.name) || !isRecord(fn.arguments)) return null;
    toolCalls.push({
      id: `native_call_${index}`,
      type: 'function',
      function: { name: fn.name, arguments: JSON.stringify(fn.arguments) },
    });
  }
  if (content === undefined && toolCalls.length === 0) return null;
  if ((content ?? '').length === 0 && toolCalls.length === 0) return null;
  return { content: content ?? '', toolCalls };
}

const argString = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value ?? {});

export interface LocalPlannerDeps {
  readonly fetchImpl?: typeof fetch;
  readonly executeTool?: (name: string, rawArguments: string) => Promise<string>;
  readonly baseUrl?: string;
  readonly model?: string;
  /** Limite de TURNOS (rodadas de chat) — barreira dura contra loop do modelo. */
  readonly maxTurns?: number;
  /** Após N chamadas de evidência, força o submit (tools = só submit). O modelo
   * local tende a sobre-investigar; forçar mais cedo é mais confiável e barato. */
  readonly forceAfterEvidence?: number;
  /** Timeout por rodada; ausente ⇒ `ANIMA_PROJECT_PLANNER_ROUND_TIMEOUT_MS` ⇒ 90 s. */
  readonly roundTimeoutMs?: number;
  /** Ambiente injetável para configuração determinística em testes. */
  readonly env?: Record<string, string | undefined>;
}

export class LocalOllamaProjectWorkPlanner implements ProjectWorkPlanner {
  readonly id = 'local_ollama_project_tools_v1';
  private readonly fetchImpl: typeof fetch;
  private readonly executeTool: (name: string, rawArguments: string) => Promise<string>;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxTurns: number;
  private readonly forceAfterEvidence: number;
  private readonly roundTimeoutMs: number;
  private readonly contextLength: number;

  constructor(deps: LocalPlannerDeps = {}) {
    const env = deps.env ?? process.env;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.executeTool = deps.executeTool ?? executeProjectTool;
    this.baseUrl = (deps.baseUrl ?? env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/+$/, '');
    this.model = deps.model ?? env.ANIMA_PROJECT_PLANNER_MODEL ?? 'qwen3-coder:latest';
    this.maxTurns = deps.maxTurns ?? 16;
    this.forceAfterEvidence = deps.forceAfterEvidence ?? 4;
    this.roundTimeoutMs = deps.roundTimeoutMs ?? resolveLocalPlannerRoundTimeoutMs(env);
    this.contextLength = resolveLocalPlannerContextLength(env);
  }

  async proposeArguments(message: string): Promise<PlannerProposalResult> {
    const messages: NativeChatMessage[] = [
      { role: 'system', content: PLANNER_SYSTEM_INSTRUCTIONS },
      { role: 'user', content: buildPlannerUserPrompt(message) },
    ];
    let evidenceCalls = 0;
    let totalCalls = 0;
    let noProgress = 0;
    let directedToSubmit = false;

    for (let turn = 0; turn < this.maxTurns; turn += 1) {
      const forceSubmit = evidenceCalls >= this.forceAfterEvidence;
      // Ao forçar, RETIRAMOS as ferramentas de investigação: o modelo só pode chamar
      // submit. A API nativa não oferece tool_choice; restringir o catálogo evita o
      // loop de investigação infinita observado ao vivo com o qwen3-coder.
      if (forceSubmit && !directedToSubmit) {
        messages.push({
          role: 'user',
          content: 'Você já reuniu evidência suficiente. Pare de investigar e chame AGORA submit_project_work_proposal com todos os campos exigidos (summary, objective, included_scope, excluded_scope, expected_effects, risks, validation_label, validation_command).',
        });
        directedToSubmit = true;
      }
      let response: Response | null = null;
      let transportFailure: unknown = null;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          signal: timeoutSignal(this.roundTimeoutMs),
          // SEM Authorization: o endpoint é o Ollama local; nenhum segredo é enviado.
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            stream: false,
            options: { temperature: 0, num_ctx: this.contextLength },
            messages,
            tools: forceSubmit ? [SUBMIT_CHAT_TOOL] : PLANNER_CHAT_TOOLS,
          }),
        });
      } catch (error) {
        transportFailure = error;
      }

      if (!response?.ok) {
        if (transportFailure) {
          const name = transportFailure instanceof Error ? transportFailure.name : '';
          const timedOut = name === 'AbortError' || name === 'TimeoutError';
          return {
            ok: false,
            message: timedOut
              ? `O planejador local excedeu o tempo limite de ${Math.round(this.roundTimeoutMs / 1000)} segundos em uma rodada do modelo.`
              : 'Não foi possível comunicar com o modelo local durante o planejamento.',
          };
        }
        const details: unknown = response ? await response.json().catch(() => null) : null;
        const nativeError = isRecord(details) && typeof details.error === 'string'
          ? details.error
          : isRecord(details) && isRecord(details.error) && typeof details.error.message === 'string'
            ? details.error.message
            : null;
        return { ok: false, message: nativeError ?? 'O modelo local recusou a requisição de planejamento sem fornecer detalhes.' };
      }
      const body: unknown = await response.json().catch(() => null);
      const assistant = normalizeNativeAssistantResponse(body);
      if (!assistant) return { ok: false, message: 'O modelo local não retornou uma resposta utilizável.' };

      const toolCalls = assistant.toolCalls.length > 0
        ? assistant.toolCalls
        : parseTextualToolCalls(assistant.content, KNOWN_PLANNER_TOOLS);
      if (toolCalls.length === 0) {
        // Sem tool call: o modelo conversou. Cutuca para submeter (se já investigou)
        // ou para investigar; fail-closed se não progredir.
        noProgress += 1;
        if (noProgress > 2) return { ok: false, message: 'O modelo local não produziu uma proposta estruturada.' };
        messages.push({ role: 'assistant', content: assistant.content });
        messages.push({
          role: 'user',
          content: evidenceCalls > 0
            ? 'Chame agora a ferramenta submit_project_work_proposal com todos os campos exigidos (summary, objective, included_scope, excluded_scope, expected_effects, risks, validation_label, validation_command).'
            : 'Use as ferramentas read-only para investigar o repositório e depois chame submit_project_work_proposal.',
        });
        continue;
      }

      totalCalls += toolCalls.length;
      if (totalCalls > PLANNER_TOOL_CALL_LIMIT) return { ok: false, message: 'O planejamento local excedeu o limite de consultas.' };

      const submitted = toolCalls.find(call => call.function?.name === SUBMIT_TOOL_NAME);
      if (submitted && evidenceCalls > 0) {
        // Normaliza o quirk escalar→lista e valida a proposta ainda no adapter local.
        // O host autoritativo revalida depois em planExecutableProjectWork.
        const rawArguments = coercePlannerArrayFields(argString(submitted.function?.arguments));
        const validation = validatePlannerProposal(rawArguments);

        if (validation.ok && includedScopeAnchoredInProject(validation.proposal.included_scope)) {
          return { ok: true, rawArguments };
        }

        const rejection = validation.ok
          ? (() => {
              const paths = unanchoredIncludedScopePaths(validation.proposal.included_scope);
              const diagnosticPaths = paths.slice(0, 4).map(path => path.length > 160 ? `${path.slice(0, 157)}...` : path);
              return {
                code: 'included_scope_not_anchored' as const,
                message: `included_scope_not_anchored: ${diagnosticPaths.join(', ')}`,
                details: {
                  field: 'included_scope', rule: 'project_topology', paths: diagnosticPaths,
                  ...(paths.length > diagnosticPaths.length ? { omittedPathCount: paths.length - diagnosticPaths.length } : {}),
                },
              };
            })()
          : {
              code: validation.issue.code,
              message: `${validation.issue.code}: ${validation.issue.message}`,
              details: { field: validation.issue.field, rule: validation.issue.rule },
            };

        // Mantém a conversa viva: o modelo precisa investigar/corrigir o escopo
        // ou o contrato em vez de transformar payload inválido em proposta executável.
        messages.push({
          role: 'assistant',
          content: assistant.content,
          tool_calls: toolCalls.map(call => ({
            function: {
              name: call.function?.name ?? '',
              arguments: JSON.parse(argString(call.function?.arguments)) as Record<string, unknown>,
            },
          })),
        });
        messages.push({
          role: 'tool',
          tool_name: SUBMIT_TOOL_NAME,
          content: JSON.stringify({
            ok: false,
            error: rejection,
            guidance: rejection.code === 'included_scope_not_anchored'
              ? `${INCLUDED_SCOPE_ANCHORING_RULE} Investigue os paths listados e submeta novamente.`
              : 'Corrija somente o campo/regra indicado e submeta novamente.',
          }),
        });
        noProgress = 0;
        continue;
      }

      // Espelha o turno do assistente e responde CADA tool call no formato nativo,
      // associando a resposta pelo `tool_name`.
      const echoed: NativeToolCall[] = toolCalls.map(call => ({
        function: {
          name: call.function?.name ?? '',
          arguments: JSON.parse(argString(call.function?.arguments)) as Record<string, unknown>,
        },
      }));
      messages.push({ role: 'assistant', content: assistant.content, tool_calls: echoed });

      for (const call of toolCalls) {
        const name = call.function?.name ?? '';
        if (name === SUBMIT_TOOL_NAME) {
          messages.push({ role: 'tool', tool_name: name, content: JSON.stringify({ ok: false, error: 'Investigue o repositório antes de enviar a proposta.' }) });
          continue;
        }
        // O catálogo da rodada forçada contém SOMENTE submit. Alguns providers locais
        // ainda emitem uma tool antiga fora do catálogo; o host não pode executá-la, pois
        // tools oferecidas são a fronteira de capacidade desta rodada. Responde pelo
        // nome para manter o protocolo nativo coerente, mas falha fechado no efeito.
        if (forceSubmit) {
          messages.push({
            role: 'tool',
            tool_name: name,
            content: JSON.stringify({
              ok: false,
              error: 'Esta ferramenta não está disponível nesta rodada. Chame submit_project_work_proposal.',
            }),
          });
          continue;
        }
        const output = await this.executeTool(name, argString(call.function?.arguments));

        try {
          const parsedOutput = JSON.parse(output) as { ok?: unknown };
          if (parsedOutput.ok === true) evidenceCalls += 1;
        } catch {
          // Saída de tool inválida nunca conta como evidência.
        }

        messages.push({ role: 'tool', tool_name: name, content: output });
      }
      noProgress = 0;
    }
    return { ok: false, message: 'O planejamento local não chegou a uma proposta terminal.' };
  }
}
