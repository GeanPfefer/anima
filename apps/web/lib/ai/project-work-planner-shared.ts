import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { projectRoot } from '@/lib/work-orchestration/executor-selection';
import { OPENAI_PROJECT_TOOLS } from './project-tools';

// ============================================================
// Núcleo COMPARTILHADO do planejador de trabalho de projeto (provider-agnóstico).
//
// A porta `ProjectWorkPlanner` isola SÓ a parte que depende do provedor: dada a
// mensagem do usuário e as ferramentas READ-ONLY de investigação, produzir os
// ARGUMENTOS BRUTOS da proposta (uma string JSON). Ela NÃO monta o execution_spec,
// NÃO captura base_sha, NÃO decide executor/backend/permissões/limites e NÃO valida
// path/comando — tudo isso é AUTORIDADE DO HOST, aplicada de forma idêntica no
// orquestrador `planExecutableProjectWork`, qualquer que seja o provedor.
//
// O planejador (OpenAI na nuvem ou Ollama local) só INVESTIGA e INFERE; nunca
// edita arquivos (as ferramentas são read-only) e nunca ganha autoridade nova.
// ============================================================

/** Argumentos que o modelo propõe. É o ÚNICO grau de liberdade do LLM: escopo,
 * um comando de validação e texto descritivo. Todo o resto é fixado pelo host. */
export type PlannerArguments = {
  summary: string;
  objective: string;
  included_scope: string[];
  excluded_scope: string[];
  expected_effects: string[];
  risks: string[];
  validation_label: string;
  validation_command: string;
};

/** Resultado do PLANEJADOR (parte provider-específica): a string JSON dos
 * argumentos de submit, ou uma falha. O host valida depois (fail-closed). */
export type PlannerProposalResult =
  | { ok: true; rawArguments: string }
  | { ok: false; message: string };

/** Porta provider-agnóstica. `id` identifica o planejador na evidência persistida
 * (intent.planner), para proveniência — nunca concede autoridade. */
export interface ProjectWorkPlanner {
  readonly id: string;
  proposeArguments(message: string): Promise<PlannerProposalResult>;
}

export const SUBMIT_TOOL_NAME = 'submit_project_work_proposal';
export const PLANNER_TOOL_CALL_LIMIT = 24;
export const FORCE_SUBMISSION_AFTER_EVIDENCE = 8;

/** Parâmetros do submit — fonte única compartilhada pelos formatos de tool de cada
 * provedor. Cada `included_scope` é um caminho relativo exato; o host revalida. */
export const SUBMIT_PARAMETERS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    objective: { type: 'string' },
    included_scope: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 },
    excluded_scope: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 },
    expected_effects: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
    risks: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
    validation_label: { type: 'string' },
    validation_command: { type: 'string', description: 'Um único comando npm de teste, typecheck ou build.' },
  },
  required: ['summary', 'objective', 'included_scope', 'excluded_scope', 'expected_effects', 'risks', 'validation_label', 'validation_command'],
  additionalProperties: false,
} as const;

const SUBMIT_DESCRIPTION =
  'Entrega uma proposta executável somente depois de investigar o repositório. Cada item de included_scope deve ser um caminho relativo exato de arquivo que poderá ser criado ou alterado.';

/** Tool de submit no formato da OpenAI Responses API (planejador OpenAI). */
export const SUBMIT_TOOL_RESPONSES = {
  type: 'function',
  name: SUBMIT_TOOL_NAME,
  description: SUBMIT_DESCRIPTION,
  strict: true,
  parameters: SUBMIT_PARAMETERS,
} as const;

/** Converte uma tool do formato Responses (`{type, name, description, parameters}`)
 * para o formato chat/OpenAI-compat (`{type:'function', function:{...}}`) que o
 * Ollama entende. `strict` é descartado (Ollama não o exige). */
export function toChatTool(tool: { name: string; description?: string; parameters: unknown }): {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
} {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description ?? '', parameters: tool.parameters },
  };
}

/** Tool de submit no formato chat (planejador local Ollama). */
export const SUBMIT_CHAT_TOOL = toChatTool({ name: SUBMIT_TOOL_NAME, description: SUBMIT_DESCRIPTION, parameters: SUBMIT_PARAMETERS });

/** Ferramentas read-only + submit no formato chat (planejador local Ollama). */
export const PLANNER_CHAT_TOOLS = [
  ...OPENAI_PROJECT_TOOLS.map(tool => toChatTool(tool)),
  SUBMIT_CHAT_TOOL,
];

export const PLANNER_SYSTEM_INSTRUCTIONS =
  'Você é a capacidade interna de planejamento técnico do Anima. Investigue o repositório real com as ferramentas read-only antes de propor. Produza uma proposta pequena, concreta, verificável e compatível com as regras do repositório. Nunca alegue execução nem edite arquivos. A aprovação e a execução ocorrerão depois, por contratos locais do host. O alvo é fixado pelo servidor como "anima". Escolha somente caminhos exatos de arquivos necessários. O comando de validação deve ser um único npm test, npm run typecheck, npm run test ou npm run build. Ao chamar submit_project_work_proposal, os campos included_scope, excluded_scope, expected_effects e risks são LISTAS (arrays) de strings, cada uma com pelo menos um item — nunca uma string única; excluded_scope deve listar ao menos um caminho ou área que NÃO deve ser tocada. Quando houver evidência suficiente, chame submit_project_work_proposal.';

export function buildPlannerUserPrompt(message: string): string {
  return `Prepare uma proposta executável para este pedido:\n\n${message}\n\nInvestigue primeiro o repositório com as ferramentas locais (project_search, project_read_file, project_list_files, project_git_status, project_git_diff). Leia AGENTS.md e os arquivos relevantes. Não altere nada. O alvo será fixado pelo servidor como anima. Escolha somente caminhos exatos de arquivos necessários. Quando houver informação suficiente, chame submit_project_work_proposal.`;
}

export const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/**
 * Normaliza um quirk CONHECIDO de modelos locais: emitir uma STRING única onde o
 * schema pede uma LISTA de strings. Envolve o escalar em `[escalar]` para os campos
 * de lista, PRESERVANDO o conteúdo do modelo — nunca inventa itens. Campos ausentes
 * ou vazios continuam ausentes/vazios (o host valida estrito depois). NÃO afrouxa o
 * contrato do host: é robustez do ADAPTADOR do provedor, não da validação.
 */
export function coercePlannerArrayFields(rawArguments: string): string {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(rawArguments) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return rawArguments;
    parsed = value as Record<string, unknown>;
  } catch {
    return rawArguments;
  }
  for (const field of ['included_scope', 'excluded_scope', 'expected_effects', 'risks']) {
    if (nonBlank(parsed[field])) parsed[field] = [parsed[field]];
  }
  return JSON.stringify(parsed);
}
const textList = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(nonBlank);

// ---- Validação HOST-SIDE (idêntica para todos os provedores) -----------------

/** Um caminho de escopo é seguro? (não absoluto, sem traversal, sem segmentos/
 * arquivos sensíveis). NÃO checa existência — investigação é qualidade, não
 * segurança; a segurança é este predicado + safeValidationCommand + guardas do
 * worktree na execução. */
export const safePath = (value: string): boolean => {
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false;
  const segments = normalized.toLowerCase().split('/');
  return !segments.includes('..')
    && !segments.includes('.git')
    && !segments.includes('node_modules')
    && !segments.includes('.next')
    && !segments.includes('.worktrees')
    && !segments.some(segment => segment === '.env' || segment.startsWith('.env.'))
    && !/\.(?:pem|key|p12|pfx)$/i.test(normalized);
};

/** Um único comando npm de test/typecheck/build da allowlist. */

/**
 * Ancora o included_scope na topologia REAL do checkout autorizado.
 *
 * - arquivo existente: permitido;
 * - arquivo novo: permitido somente se o diretório-pai já existir;
 * - diretório inexistente/inventado: rejeitado fail-closed.
 *
 * Segurança sintática continua em safePath; esta checagem é de realidade do repo.
 */
export function includedScopeAnchoredInProject(
  paths: readonly string[],
  repoRoot: string = projectRoot(),
): boolean {
  return paths.every(path => {
    if (!safePath(path)) return false;

    const target = resolve(repoRoot, path);

    try {
      if (existsSync(target)) return statSync(target).isFile();
    } catch {
      return false;
    }

    const parent = dirname(target);

    try {
      return existsSync(parent) && statSync(parent).isDirectory();
    } catch {
      return false;
    }
  });
}
export const safeValidationCommand = (value: string): boolean =>
  /^npm(?:\.cmd)? (?:run (?:typecheck|test|build)(?: -- [\w./()\\:-]+)*|test(?: -- [\w./()\\:*?-]+)*)$/i.test(value.trim());

/** Valida e normaliza os argumentos BRUTOS do modelo — AUTORIDADE DO HOST. Rejeita
 * fail-closed qualquer coisa fora dos limites permitidos (escopo, path, comando). */
export function parseProposal(raw: string): PlannerArguments | null {
  try {
    const value = JSON.parse(raw) as Partial<PlannerArguments>;
    if (!nonBlank(value.summary) || !nonBlank(value.objective) || !textList(value.included_scope)
      || !textList(value.excluded_scope) || !textList(value.expected_effects) || !textList(value.risks)
      || !nonBlank(value.validation_label) || !nonBlank(value.validation_command)) return null;
    if (value.included_scope.length > 12 || !value.included_scope.every(safePath) || !safeValidationCommand(value.validation_command)) return null;
    return value as PlannerArguments;
  } catch {
    return null;
  }
}

export function timeoutSignal(milliseconds: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  (timer as NodeJS.Timeout).unref?.();
  return controller.signal;
}
