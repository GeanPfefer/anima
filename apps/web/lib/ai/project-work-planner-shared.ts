import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { WorkClaimKind } from '@anima/core';
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
  /** Teto de tentativas da unidade (1–3). Ausente ⇒ 3 (default histórico do host). */
  max_attempts?: number;
  /** Itens EXATOS de expected_effects demonstrados pelo gate principal. */
  validation_covers: string[];
  /**
   * Classe de AFIRMAÇÃO do gate principal (`WorkClaimKind` canônico do core), que o
   * Verifier lê como DADO ESTRUTURAL (nunca infere de texto/label/comando):
   * `gate_assertion` = o critério de aceite coberto AFIRMA o próprio resultado do
   * gate ("as validações declaradas passam", "o typecheck passa"); `substantive` =
   * o critério descreve um COMPORTAMENTO material que um gate verde apenas ASSOCIA,
   * não demonstra sozinho. O host normaliza fail-closed: ausência ⇒ `substantive`
   * conservador (NUNCA `gate_assertion`); valor inválido ⇒ proposta rejeitada.
   */
  validation_claim_kind: WorkClaimKind;
  /** Superfície material exercitada pelo gate principal. Vazio/ausente significa
   * que a investigação não sustentou paths precisos; o host não os inventa. */
  validation_target_paths?: string[];
  /**
   * Provas ADICIONAIS além da principal (validation_label/validation_command),
   * quando o trabalho exige múltiplas verificações independentes (ex.: um teste
   * direcionado, uma regressão de compatibilidade e um typecheck). Cada entrada é
   * UM único comando npm da allowlist; o host valida e escopa cada uma como um
   * gate FORMAL separado. Ausente/vazio ⇒ exatamente uma prova — compatível com
   * propostas antigas de gate único. NUNCA é comando composto (`A && B`): são N
   * critérios, não uma concatenação de shell. Cada prova também declara seu
   * `claim_kind` (mesma régua do gate principal).
   */
  additional_validations?: { label: string; command: string; covers: string[]; claim_kind: WorkClaimKind; target_paths?: string[] }[];
};

export type PlannerProposalValidationIssue = {
  code: 'proposal_invalid';
  field: string;
  rule: string;
  message: string;
};

export type PlannerProposalValidationResult =
  | { ok: true; proposal: PlannerArguments }
  | { ok: false; issue: PlannerProposalValidationIssue };

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
    validation_covers: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Itens exatos de expected_effects provados por este gate.' },
    validation_claim_kind: {
      type: 'string',
      enum: ['gate_assertion', 'substantive'],
      description: 'Classe do que o gate principal DEMONSTRA. Use "gate_assertion" quando o(s) item(ns) de covers afirmam o PRÓPRIO resultado do gate (ex.: "as validações declaradas passam", "o typecheck passa"). Use "substantive" quando covers descreve um COMPORTAMENTO material que um gate verde apenas associa, mas não demonstra sozinho (ex.: "o parser rejeita entrada inválida"). Na dúvida use "substantive". Não escolha por palavra-chave/nome de teste/comando: declare a intenção real do critério.',
    },
    validation_target_paths: { type: 'array', items: { type: 'string' }, maxItems: 12, description: 'Paths relativos exatos que este gate exercita. Use [] quando a investigação não sustentar uma superfície precisa.' },
    max_attempts: { type: 'integer', enum: [1, 2, 3], description: 'Teto de tentativas de execução da unidade. Use 3 salvo pedido explícito do usuário por menos tentativas; nunca afirme um teto em texto sem declará-lo aqui.' },
    additional_validations: {
      type: 'array',
      description: 'Provas ADICIONAIS além da principal, SÓ quando múltiplas verificações independentes são realmente necessárias. Cada item é UM único comando npm (test/typecheck/build); nunca encadeie comandos com &&. Use [] quando uma única prova basta.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          command: { type: 'string', description: 'Um único comando npm de teste, typecheck ou build.' },
          covers: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Itens exatos de expected_effects provados por este gate.' },
          claim_kind: { type: 'string', enum: ['gate_assertion', 'substantive'], description: 'Mesma régua de validation_claim_kind, aplicada a esta prova.' },
          target_paths: { type: 'array', items: { type: 'string' }, maxItems: 12, description: 'Paths relativos exatos que esta prova exercita; [] quando não deriváveis.' },
        },
        required: ['label', 'command', 'covers', 'claim_kind', 'target_paths'],
        additionalProperties: false,
      },
      maxItems: 6,
    },
  },
  required: ['summary', 'objective', 'included_scope', 'excluded_scope', 'expected_effects', 'risks', 'validation_label', 'validation_command', 'validation_covers', 'validation_claim_kind', 'validation_target_paths', 'max_attempts', 'additional_validations'],
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
  'Você é a capacidade interna de planejamento técnico do Anima. Investigue o repositório real com as ferramentas read-only antes de propor. Produza uma proposta pequena, concreta, verificável e compatível com as regras do repositório. Nunca alegue execução nem edite arquivos. A aprovação e a execução ocorrerão depois, por contratos locais do host. O alvo é fixado pelo servidor como "anima". Escolha somente caminhos exatos de arquivos necessários. O comando de validação deve ser um único npm test, npm run typecheck, npm run test ou npm run build. Para cada gate, `covers` deve repetir literalmente os itens de `expected_effects` que aquela prova demonstra; TODO expected_effect deve ser coberto por ao menos um gate. Para cada gate, declare também `claim_kind`: use "gate_assertion" quando os itens de `covers` afirmam o PRÓPRIO resultado do gate (ex.: "as validações declaradas passam", "o typecheck passa"); use "substantive" quando `covers` descreve um COMPORTAMENTO material que um gate verde apenas associa, mas não demonstra sozinho (ex.: "o parser rejeita entrada inválida"). Na dúvida, use "substantive". A escolha é a intenção real do critério, nunca uma inferência por palavra-chave, nome de teste ou comando. Declare ainda `target_paths` por gate: somente paths relativos exatos que a investigação demonstrou serem a superfície material exercitada por aquela prova (incluindo testes quando aplicável), nunca o projeto inteiro; use [] quando não houver evidência suficiente. Quando o trabalho exigir MAIS DE UMA prova independente, registre a primeira em validation_label/validation_command/validation_covers/validation_claim_kind/validation_target_paths e as demais em additional_validations, cada uma com seu label, command, covers, claim_kind e target_paths. Use additional_validations = [] quando uma única prova basta. Ao chamar submit_project_work_proposal, os campos included_scope, excluded_scope, expected_effects e risks são LISTAS de strings. Inclua no included_scope TODOS os arquivos que o trabalho cria ou altera — inclusive arquivos novos e seus testes —, nunca arquivos não relacionados só porque já existem. Um arquivo novo pode ficar em uma pasta nova quando a pasta acima dela já existe (ex.: uma nova rota apps/web/app/api/<nome>/route.ts). Executar um teste NÃO concede permissão de editar o arquivo testado: só o included_scope autoriza escrita. Quando houver evidência suficiente, chame submit_project_work_proposal.';

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
 * - arquivo novo com diretório-pai existente: permitido;
 * - arquivo novo cujo ÚNICO diretório novo é o pai imediato (ex.: rota Next.js
 *   `app/api/<nova>/route.ts`): permitido quando o avô existe e NÃO é a raiz do repo;
 * - mais de um nível de diretório inventado, ou diretório novo na raiz: rejeitado.
 *
 * Sem o segundo caso, todo trabalho que cria uma pasta nova era recusado e o planner
 * recuava para arquivos existentes não relacionados (escopo desonesto).
 * Segurança sintática continua em safePath; esta checagem é de realidade do repo.
 */
export function includedScopeAnchoredInProject(
  paths: readonly string[],
  repoRoot: string = projectRoot(),
): boolean {
  return unanchoredIncludedScopePaths(paths, repoRoot).length === 0;
}

/** Retorna somente os paths que falham na mesma regra autoritativa de ancoragem.
 * Serve para diagnóstico; não altera nem infere escopo. */
export function unanchoredIncludedScopePaths(
  paths: readonly string[],
  repoRoot: string = projectRoot(),
): string[] {
  return paths.filter(path => {
    if (!safePath(path)) return true;

    const target = resolve(repoRoot, path);

    try {
      if (existsSync(target)) return !statSync(target).isFile();
    } catch {
      return true;
    }

    const parent = dirname(target);

    try {
      if (existsSync(parent)) return !statSync(parent).isDirectory();
      const grandparent = dirname(parent);
      return grandparent === resolve(repoRoot)
        || !existsSync(grandparent) || !statSync(grandparent).isDirectory();
    } catch {
      return true;
    }
  });
}

/** Regra de ancoragem em linguagem do planner — o MESMO contrato de `includedScopeAnchoredInProject`. */
export const INCLUDED_SCOPE_ANCHORING_RULE =
  'Cada caminho do included_scope deve ser um arquivo existente, ou um arquivo novo cujo diretório-pai existe, ou um arquivo novo em UMA pasta nova cujo diretório acima existe (ex.: apps/web/app/api/<nova-rota>/route.ts e o teste ao lado). Mais de um nível de pasta inventada, ou pasta nova na raiz do repositório, é recusado.';

/** `target_paths` usa semântica de ARQUIVO EXATO. Um path ausente é permitido
 * (teste/arquivo novo e fato `existedAtBase=false`), mas um diretório existente é
 * recusado — nunca vira prefixo implícito para descendentes. */
export function targetPathsAreExactFilesOrAbsent(
  proposal: Pick<PlannerArguments, 'validation_target_paths' | 'additional_validations'>,
  repoRoot: string = projectRoot(),
): boolean {
  const paths = [
    ...(proposal.validation_target_paths ?? []),
    ...(proposal.additional_validations ?? []).flatMap(validation => validation.target_paths ?? []),
  ];
  return paths.every(path => {
    if (!safePath(path) || path.includes('*') || path.includes('?') || path.replace(/\\/g, '/').endsWith('/')) return false;
    const target = resolve(repoRoot, path);
    try {
      return !existsSync(target) || statSync(target).isFile();
    } catch {
      return false;
    }
  });
}
export const safeValidationCommand = (value: string): boolean =>
  /^npm(?:\.cmd)? (?:run (?:typecheck|test|build)(?: --workspace=[@a-z0-9._/-]+)?(?: -- [\w./()\\:-]+)*|test(?: --workspace=[@a-z0-9._/-]+)?(?: -- [\w./()\\:*?-]+)*)$/i.test(value.trim());

/**
 * Workspace do monorepo (root package.json: `apps/*`, `packages/*`) que contém TODO
 * o included_scope, ou null quando os caminhos cruzam workspaces, estão na raiz, ou
 * fora de `apps/`/`packages/`. O workspace de um caminho são seus dois primeiros
 * segmentos.
 */
export function workspaceForScope(includedScope: readonly string[]): string | null {
  const workspaces = new Set<string>();
  for (const raw of includedScope) {
    const parts = raw.replace(/\\/g, '/').replace(/^\.\//, '').split('/');
    if (parts.length < 2 || (parts[0] !== 'apps' && parts[0] !== 'packages')) return null;
    workspaces.add(`${parts[0]}/${parts[1]}`);
  }
  return workspaces.size === 1 ? [...workspaces][0]! : null;
}

/**
 * Escopa um comando de TESTE filtrado ao workspace do included_scope. No monorepo,
 * `npm test -- <arquivo>` na RAIZ faz fan-out para todos os workspaces com o mesmo
 * filtro; um workspace sem o arquivo sai 1 ("No tests found"), reprovando o gate
 * MESMO com o coder correto — foi a causa raiz de uma prova viva falha. Escopar
 * torna o gate executável e PRECISO; não afrouxa nada (o jest do workspace ainda
 * exige que o teste exista e passe). Já escopado, sem filtro, ou escopo ambíguo →
 * inalterado (o host mantém a autoridade, mas não adivinha).
 */
export function scopeTestCommandToWorkspace(command: string, includedScope: readonly string[]): string {
  const trimmed = command.trim();
  if (/--workspace=/i.test(trimmed)) return trimmed;
  const match = /^(npm(?:\.cmd)?) (?:run )?test (-- .+)$/i.exec(trimmed);
  if (!match) return trimmed;
  const workspace = workspaceForScope(includedScope);
  if (!workspace) return trimmed;
  return `${match[1]} test --workspace=${workspace} ${match[2]}`;
}

/** Máximo de provas ADICIONAIS além da principal (espelha `maxItems` do schema). */
export const MAX_ADDITIONAL_VALIDATIONS = 6;

const parseTargetPaths = (value: unknown): string[] | undefined | null => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return undefined;
  if (value.length > 12 || !value.every(nonBlank) || !value.every(safePath)
    || value.some(path => path.includes('*') || path.includes('?') || path.replace(/\\/g, '/').endsWith('/'))
    || new Set(value).size !== value.length) return null;
  return value;
};

/** Domínio canônico de `claim_kind` — amarrado ao `WorkClaimKind` do core (fonte
 * única): se o tipo mudar, esta lista falha o typecheck. */
const CLAIM_KINDS: readonly WorkClaimKind[] = ['gate_assertion', 'substantive'];
const isClaimKind = (value: unknown): value is WorkClaimKind =>
  typeof value === 'string' && (CLAIM_KINDS as readonly string[]).includes(value);

/**
 * Normaliza o `claim_kind` de UM gate — AUTORIDADE DO HOST, fail-closed, SEM
 * heurística (nunca infere de label/comando/texto):
 * - valor válido (`gate_assertion` | `substantive`) ⇒ o próprio valor;
 * - ausente/null ⇒ fallback CONSERVADOR `substantive` (NUNCA `gate_assertion`);
 * - qualquer outro valor ⇒ `null` (o chamador rejeita a proposta inteira).
 */
export function normalizeClaimKind(value: unknown): WorkClaimKind | null {
  if (value === undefined || value === null) return 'substantive';
  return isClaimKind(value) ? value : null;
}

/**
 * Valida as provas ADICIONAIS (AUTORIDADE DO HOST, fail-closed).
 *
 * - ausente/null/`[]` ⇒ `undefined` (sem extras; compat com gate único);
 * - array de `{label, command}` onde CADA `command` é um comando único da
 *   allowlist (`safeValidationCommand` já recusa shell arbitrário e `&&`);
 * - qualquer entrada malformada/insegura, não-array, ou acima do teto ⇒ `null`
 *   (rejeita a proposta inteira). Nunca deriva obrigação de prosa nem aceita
 *   comando composto — são N critérios FORMAIS, não um `A && B`.
 */
export function parseAdditionalValidations(
  value: unknown,
): { label: string; command: string; covers: string[]; claim_kind: WorkClaimKind; target_paths?: string[] }[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return undefined;
  if (value.length > MAX_ADDITIONAL_VALIDATIONS) return null;
  const out: { label: string; command: string; covers: string[]; claim_kind: WorkClaimKind; target_paths?: string[] }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const candidate = entry as { label?: unknown; command?: unknown; covers?: unknown; claim_kind?: unknown; target_paths?: unknown };
    if (!nonBlank(candidate.label) || !nonBlank(candidate.command) || !safeValidationCommand(candidate.command)
      || !textList(candidate.covers)) return null;
    // `claim_kind` inválido reprova a prova inteira; ausência ⇒ substantive conservador.
    const claimKind = normalizeClaimKind(candidate.claim_kind);
    if (claimKind === null) return null;
    const targetPaths = parseTargetPaths(candidate.target_paths);
    if (targetPaths === null) return null;
    out.push({ label: candidate.label, command: candidate.command, covers: candidate.covers, claim_kind: claimKind,
      ...(targetPaths === undefined ? {} : { target_paths: targetPaths }) });
  }
  return out;
}

const proposalIssue = (field: string, rule: string, message: string): PlannerProposalValidationResult => ({
  ok: false,
  issue: { code: 'proposal_invalid', field, rule, message },
});

function diagnoseTargetPaths(value: unknown, field: string): PlannerProposalValidationResult | null {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return null;
  if (!Array.isArray(value)) return proposalIssue(field, 'type', `${field} deve ser uma lista de paths.`);
  if (value.length > 12) return proposalIssue(field, 'max_items', `${field} aceita no máximo 12 paths.`);
  if (!value.every(nonBlank)) return proposalIssue(field, 'non_blank_items', `${field} deve conter apenas paths não vazios.`);
  if (!value.every(safePath)) return proposalIssue(field, 'safe_path', `${field} contém path inseguro.`);
  if (value.some(path => path.includes('*') || path.includes('?') || path.replace(/\\/g, '/').endsWith('/')))
    return proposalIssue(field, 'exact_file_paths', `${field} deve conter somente paths exatos de arquivos.`);
  if (new Set(value).size !== value.length) return proposalIssue(field, 'unique_items', `${field} não pode repetir paths.`);
  return null;
}

function diagnoseAdditionalValidations(value: unknown): PlannerProposalValidationResult | null {
  const field = 'additional_validations';
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return null;
  if (!Array.isArray(value)) return proposalIssue(field, 'type', `${field} deve ser uma lista.`);
  if (value.length > MAX_ADDITIONAL_VALIDATIONS)
    return proposalIssue(field, 'max_items', `${field} aceita no máximo ${MAX_ADDITIONAL_VALIDATIONS} itens.`);
  for (const [index, entry] of value.entries()) {
    const prefix = `${field}[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return proposalIssue(prefix, 'type', `${prefix} deve ser um objeto.`);
    const candidate = entry as { label?: unknown; command?: unknown; covers?: unknown; claim_kind?: unknown; target_paths?: unknown };
    if (!nonBlank(candidate.label)) return proposalIssue(`${prefix}.label`, 'required_non_blank', `${prefix}.label é obrigatório.`);
    if (!nonBlank(candidate.command)) return proposalIssue(`${prefix}.command`, 'required_non_blank', `${prefix}.command é obrigatório.`);
    if (!safeValidationCommand(candidate.command))
      return proposalIssue(`${prefix}.command`, 'command_not_allowed', `${prefix}.command não pertence à allowlist de gates.`);
    if (!textList(candidate.covers)) return proposalIssue(`${prefix}.covers`, 'required_text_list', `${prefix}.covers deve ser uma lista não vazia de textos.`);
    if (normalizeClaimKind(candidate.claim_kind) === null)
      return proposalIssue(`${prefix}.claim_kind`, 'unsupported_value', `${prefix}.claim_kind deve ser gate_assertion ou substantive.`);
    const targetIssue = diagnoseTargetPaths(candidate.target_paths, `${prefix}.target_paths`);
    if (targetIssue) return targetIssue;
  }
  return null;
}

/** Mesma validação autoritativa de `parseProposal`, com a primeira causa estável
 * observável. Não corrige, remove, coage ou infere nenhum valor do payload. */
export function validatePlannerProposal(raw: string): PlannerProposalValidationResult {
  let unknownValue: unknown;
  try {
    unknownValue = JSON.parse(raw) as unknown;
  } catch {
    return proposalIssue('$', 'invalid_json', 'O payload da proposta deve ser JSON válido.');
  }
  if (!unknownValue || typeof unknownValue !== 'object' || Array.isArray(unknownValue))
    return proposalIssue('$', 'object_required', 'A proposta deve ser um objeto JSON.');
  const value = unknownValue as Partial<PlannerArguments>;
  for (const field of ['summary', 'objective', 'validation_label', 'validation_command'] as const) {
    if (!nonBlank(value[field])) return proposalIssue(field, 'required_non_blank', `${field} é obrigatório e deve ser texto não vazio.`);
  }
  for (const field of ['included_scope', 'excluded_scope', 'expected_effects', 'risks', 'validation_covers'] as const) {
    if (!textList(value[field])) return proposalIssue(field, 'required_text_list', `${field} deve ser uma lista não vazia de textos.`);
  }
  if (value.included_scope!.length > 12)
    return proposalIssue('included_scope', 'max_items', 'included_scope aceita no máximo 12 paths.');
  if (!value.included_scope!.every(safePath))
    return proposalIssue('included_scope', 'safe_path', 'included_scope contém path inseguro.');
  if (!safeValidationCommand(value.validation_command!))
    return proposalIssue('validation_command', 'command_not_allowed', 'validation_command não pertence à allowlist de gates.');
  // `claim_kind` do gate principal: inválido reprova a proposta; ausência ⇒ substantive conservador.
  const validationClaimKind = normalizeClaimKind(value.validation_claim_kind);
  if (validationClaimKind === null)
    return proposalIssue('validation_claim_kind', 'unsupported_value', 'validation_claim_kind deve ser gate_assertion ou substantive.');
  const targetIssue = diagnoseTargetPaths(value.validation_target_paths, 'validation_target_paths');
  if (targetIssue) return targetIssue;
  const validationTargetPaths = parseTargetPaths(value.validation_target_paths);
  if (validationTargetPaths === null)
    return proposalIssue('validation_target_paths', 'invalid', 'validation_target_paths é inválido.');
  const additionalIssue = diagnoseAdditionalValidations(value.additional_validations);
  if (additionalIssue) return additionalIssue;
  const additionalValidations = parseAdditionalValidations(value.additional_validations);
  if (additionalValidations === null)
    return proposalIssue('additional_validations', 'invalid', 'additional_validations é inválido.');
  // Teto de tentativas: declarado estruturalmente (1–3); ausência ⇒ 3; qualquer outro valor reprova.
  if (value.max_attempts !== undefined && value.max_attempts !== 1 && value.max_attempts !== 2 && value.max_attempts !== 3)
    return proposalIssue('max_attempts', 'unsupported_value', 'max_attempts deve ser um dos inteiros 1, 2 ou 3.');
  const expectedEffects = value.expected_effects!;
  const validationCovers = value.validation_covers!;
  const expected = new Set(expectedEffects);
  const allCovered = [validationCovers, ...(additionalValidations ?? []).map(v => v.covers)].flat();
  if (allCovered.some(criterion => !expected.has(criterion)))
    return proposalIssue('validation_covers', 'unknown_criterion', 'validation_covers contém item ausente de expected_effects.');
  if (expectedEffects.some(criterion => !allCovered.includes(criterion)))
    return proposalIssue('validation_covers', 'missing_coverage', 'Todo item de expected_effects deve aparecer em covers.');
  const normalized = { ...(value as PlannerArguments), validation_claim_kind: validationClaimKind,
    additional_validations: additionalValidations };
  if (validationTargetPaths === undefined) delete normalized.validation_target_paths;
  else normalized.validation_target_paths = validationTargetPaths;
  return { ok: true, proposal: normalized };
}

export function parseProposal(raw: string): PlannerArguments | null {
  const result = validatePlannerProposal(raw);
  return result.ok ? result.proposal : null;
}

export function timeoutSignal(milliseconds: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  (timer as NodeJS.Timeout).unref?.();
  return controller.signal;
}
