import { renderCoderTaskSpec, type CoderHarnessPolicyV1, type CoderTaskSpecV1, type CommandExecutionPolicyV1, type ObservedGateInput, type WorkExecutorRequest, type WorkspaceAccessPolicyV1 } from '@anima/core';

// ============================================================
// Interface selecionável de inteligência que ESCREVE o código (ADR-001).
//
// O Supervisor e o adaptador de worktree nunca falam com OpenAI, Ollama, Claude
// ou Codex diretamente: falam com esta interface. Um backend recebe um workspace
// confinado (as guardas de path já foram aplicadas pelo worktree) e devolve o
// que tocou. Trocar de inteligência é trocar a implementação, não o adaptador.
// ============================================================

export type HostValidationFeedback =
  | {
      /** Gate observed directly by the host; never inferred from model output. */
      readonly kind: 'gate-failure';
      readonly failedGate: Pick<ObservedGateInput, 'label' | 'command' | 'exitCode' | 'timedOut' | 'cancelled'>;
      /** 1 = first internal retry after the initial coder turn. */
      readonly retryIndex: number;
      /** Configured internal retry limit for this execution attempt. */
      readonly retryLimit: number;
      /** Estado observado pelo host antes do repair; conteúdo do diff não é exposto. */
      readonly changedFiles: readonly string[];
      readonly diffSha256: string;
      /**
       * Diagnostico curto e sanitizado derivado da saida do gate pelo host.
       * Efemero: nao e evidencia persistida e nunca amplia autoridade.
       */
      readonly diagnostic?: string;
    }
  | {
      /**
       * O git do HOST observou zero arquivos alterados depois do turno do coder.
       * Nao e falha de gate e nao e inferido da resposta textual do modelo.
       */
      readonly kind: 'no-change';
      readonly retryIndex: number;
      readonly retryLimit: number;
    };

export interface CoderEditRequest {
  readonly workItemId?: string;
  readonly attemptId?: string;
  readonly approvedProposalVersion?: number;
  readonly maxDurationMs?: number;
  /** Instante absoluto (epoch ms) do DEADLINE GLOBAL da tentativa, medido desde o
   * início da attempt (inclui baseline e reparos). Backends com laço agêntico param
   * de iniciar rodadas ao atingi-lo. Ausente ⇒ derivado de `maxDurationMs` no início
   * da chamada. */
  readonly deadlineAtMs?: number;
  readonly onTranscript?: (transcript: import('@anima/core').CoderTranscript) => void;
  readonly objective: string;
  readonly includedScope: readonly string[];
  readonly excludedScope: readonly string[];
  /**
   * Projeção semântica COMPARTILHADA da versão aprovada (`CoderTaskSpecV1`): resumo,
   * efeitos esperados, riscos, semântica completa dos critérios e requisito do
   * Verifier. Todos os backends a renderizam pela MESMA função
   * (`renderCoderTaskSection`). Informativa: escopo de escrita, command policy e
   * gates continuam vindo dos campos de autoridade deste request e do host.
   * Ausente ⇒ chamada direta sem Work Item (testes/probes): nenhuma seção é inventada.
   */
  readonly taskSpec?: CoderTaskSpecV1;
  /** Contexto informativo de uma tentativa anterior; nunca amplia escopo. */
  readonly carriedContext?: WorkExecutorRequest['carriedContext'];
  /** Continuidade seletiva entre successors/recoveries da mesma lineage. */
  readonly recoveryEvidence?: WorkExecutorRequest['recoveryEvidence'];
  /**
   * Política canônica do harness (runner de teste canônico, runners incompatíveis,
   * fontes de backend não autoritativas), transportada no contrato COMPARTILHADO para
   * que TODOS os backends aplicáveis (Ollama, OpenAI — que delega ao Ollama —, DeepSeek
   * Harness) recebam a MESMA regra ANTES da inferência. O host a resolve como superset
   * canônico e a injeta; o validador estrutural pós-output é a segunda linha de defesa.
   */
  readonly harnessPolicy?: CoderHarnessPolicyV1;
  /**
   * Autoridade de acesso ao workspace (Coding Harness V3): READ e WRITE são
   * DISTINTAS. Quando presente, o backend usa `readScope` (potencialmente amplo)
   * para leitura/busca e `writeScope` (estreito, = Work Item) para edição. Ausente
   * ⇒ retrocompatível: read == write == `includedScope`. NUNCA amplia a autoridade
   * de escrita além do que o host observa via git no `worktree-executor`.
   */
  readonly workspaceAccessPolicy?: WorkspaceAccessPolicyV1;
  /**
   * Autoridade de EXECUÇÃO (Coding Harness V3, 3ª fatia): comandos de dev + git
   * read-only que o coder pode rodar na worktree via a ação `exec`. Ausente ⇒ EXEC
   * desabilitado (retrocompat: o laço não oferece a ação nem aceita `exec`). EXEC é
   * uma autoridade DISTINTA de READ/WRITE — poder executar testes não concede rede
   * nem escrita fora do write scope.
   */
  readonly commandPolicy?: CommandExecutionPolicyV1;
  /** Comandos executáveis dos critérios de validação do Work Item, já parseados e
   * autorizados pelo host. Informam o agente e sustentam validate-before-submit;
   * não ampliam a command policy. */
  readonly validationCommands?: readonly {
    readonly label: string;
    readonly program: string;
    readonly args: readonly string[];
    /** Identidade canônica calculada do critério antes de sanitização/display. */
    readonly gateIdentity?: string;
  }[];
  /**
   * Host-observed validation feedback from the CURRENT execution attempt.
   * This is not persisted resumption context, does not create a new attempt,
   * and never expands scope or permissions.
   */
  readonly hostValidationFeedback?: HostValidationFeedback;
}

/**
 * Seção semântica canônica do coder, idêntica para Ollama, OpenAI (que delega ao
 * Ollama) e DeepSeek Harness: a especificação aprovada + os comandos de validação já
 * autorizados pelo host (informativos). `null` quando o request não traz `taskSpec`.
 */
export function renderCoderTaskSection(request: Pick<CoderEditRequest, 'taskSpec' | 'validationCommands'>): string | null {
  if (!request.taskSpec) return null;
  return renderCoderTaskSpec(request.taskSpec, (request.validationCommands ?? []).map(command => ({
    label: command.label, program: command.program, args: command.args,
  })));
}

/** Pedido de busca textual/símbolo executado pelo HOST (nunca shell do modelo). */
export interface WorkspaceSearchInput {
  readonly query: string;
  readonly pathGlob?: string;
  readonly maxResults: number;
  readonly isRegex: boolean;
}
export interface WorkspaceSearchHit {
  readonly path: string;
  readonly line: number;
  readonly preview: string;
}
export interface WorkspaceSearchResult {
  readonly matches: readonly WorkspaceSearchHit[];
  readonly truncated: boolean;
}
/** Pedido de listagem por padrão glob executado pelo HOST. */
/** Opções do HOST para busca/listagem (nunca derivadas da resposta do modelo). */
export interface WorkspaceLookupHostOptions {
  /** Timeout do subprocesso, já limitado ao restante do deadline global. */
  readonly timeoutMs?: number;
}
export interface WorkspaceListInput {
  readonly pattern: string;
  readonly maxResults: number;
}
export interface WorkspaceListResult {
  readonly paths: readonly string[];
  readonly truncated: boolean;
}

/** Comando ESTRUTURADO já validado pela command policy, para o host executar
 * confinado à worktree. O modelo nunca vê isto — vem do laço após a validação. */
export interface WorkspaceExecInput {
  readonly program: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}
/** Observação bruta de uma execução (o laço trunca ao cap da policy antes de servir). */
export interface WorkspaceExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

/** Superfície confinada de arquivos entregue ao backend. Ler/escrever fora da
 * raiz do worktree ou em caminhos sensíveis já é recusado pelas guardas. */
export interface CoderWorkspace {
  readFile(relPath: string): Promise<string | null>;
  writeFile(relPath: string, content: string): Promise<boolean>;
  /**
   * Busca textual/símbolo executada pelo HOST sobre o escopo de LEITURA (V3),
   * confinada ao workspace. Opcional: um workspace sem esta capacidade
   * simplesmente não oferece a ação `search` ao modelo (retrocompatível). O modelo
   * NUNCA executa shell — o host roda a busca e devolve caminhos + trechos.
   */
  search?(input: WorkspaceSearchInput, signal: AbortSignal, host?: WorkspaceLookupHostOptions): Promise<WorkspaceSearchResult>;
  /** Listagem por padrão glob executada pelo HOST, confinada ao workspace. Opcional. */
  list?(input: WorkspaceListInput, signal: AbortSignal, host?: WorkspaceLookupHostOptions): Promise<WorkspaceListResult>;
  /**
   * Execução de comando (dev/test/typecheck/git read-only) pelo HOST, confinada à
   * worktree, SEM shell arbitrário. Opcional: um workspace sem esta capacidade não
   * oferece a ação `exec` (retrocompat). Recebe o comando JÁ validado pela command
   * policy; o confinamento de cwd e a captura/limite de saída são do host.
   */
  exec?(input: WorkspaceExecInput, signal: AbortSignal): Promise<WorkspaceExecResult>;
  /**
   * Raiz ABSOLUTA da worktree isolada, presente SÓ quando o host roda a execução
   * local in-process (o adaptador de worktree a preenche com `worktree.root`). É o
   * seam mínimo para um backend que roda o PRÓPRIO laço agêntico (ex.: DeepSeek
   * Harness): ele precisa de um cwd real para as próprias ferramentas de arquivo,
   * enquanto os backends que só PROPÕEM edições (Ollama, OpenAI) a ignoram e
   * continuam confinados por `readFile`/`writeFile`. Um backend enraizado que a
   * exija deve falhar fechado quando ela está ausente. NUNCA deve vazar para
   * `summary`/`notes`/evidência — é caminho absoluto local (dado sensível).
   */
  readonly rootPath?: string;
}

export interface CoderEditResult {
  readonly summary: string;
  readonly touchedResources: readonly string[];
  readonly notes?: readonly string[];
  readonly providerUsage?: import('@anima/core').ProviderReportedUsageV1;
  readonly providerCallCount?: number;
}

/** Uso de provider acumulado por uma chamada ao coder que FALHOU. Uma attempt paga que
 * falha também consumiu tokens: a evidência host-observada precisa registrá-los. */
export type CoderFailureUsage = Pick<CoderEditResult, 'providerUsage' | 'providerCallCount'>;

// Associação erro → uso, sem mutar o objeto de erro (que pode ser congelado/de terceiros).
const failureUsage = new WeakMap<object, CoderFailureUsage>();

/** Associa ao erro lançado o uso já consumido e devolve o MESMO erro para relançar. */
export function withCoderFailureUsage<E>(error: E, usage: CoderFailureUsage): E {
  if (error !== null && typeof error === 'object') failureUsage.set(error, usage);
  return error;
}

/** Uso de provider associado a um erro do coder (ou `{}` quando não há). */
export function coderFailureUsage(error: unknown): CoderFailureUsage {
  return error !== null && typeof error === 'object' ? failureUsage.get(error) ?? {} : {};
}

export interface CoderBackend {
  readonly id: string;
  /** Identidade conhecida pelo host para evidência; nunca vem da resposta do node. */
  readonly observation?: {
    readonly placement: 'local' | 'remote';
    readonly nodeId: string | null;
    readonly model: string;
    /** Seleção governada de modelo (downgrade observável), quando aplicada. */
    readonly modelSelection?: import('@anima/core').CoderModelSelectionEvidenceV1;
  };
  edit(request: CoderEditRequest, workspace: CoderWorkspace, signal: AbortSignal): Promise<CoderEditResult>;
}

/** Identidade estável de um backend de código: `provider:model`. FONTE ÚNICA — os
 * backends reais (Ollama, OpenAI) a usam para o próprio `id`, e o Resource Governor
 * a usa para PREVER, a partir do contrato, qual coder um item vai rodar (advisory
 * pré-execução). Assim a evidência (`backendId` observado) e a previsão nunca divergem. */
export type CoderProvider = 'ollama' | 'openai' | 'deepseek-harness' | 'codex-cli';
export const coderBackendId = (provider: CoderProvider, model: string): string => `${provider}:${model}`;

/** Backends de código permitidos no fluxo real de worktree (fonte única de runtime
 * para validar a config de deploy). Espelha `backendFor`. */
export const WORKTREE_CODER_BACKENDS: readonly CoderProvider[] = ['ollama', 'openai', 'deepseek-harness', 'codex-cli'];

/**
 * Resolve o backend de código do worktree a partir da configuração de DEPLOY
 * (`ANIMA_WORKTREE_CODER_BACKEND`), nunca de escolha por-proposta do usuário: qual
 * coder roda é detalhe de INFRAESTRUTURA (como o modelo, já resolvido por env), não
 * microgerência do usuário — o usuário autoriza o TRABALHO. Default: `ollama` (o
 * DeepSeek Harness NÃO é default). Valor ausente/vazio usa o default seguro;
 * valor não reconhecido falha fechado para não executar um provider diferente do
 * configurado. É a
 * superfície dev/admin coerente para escolher a capacidade já implementada sem um
 * dropdown cru de infraestrutura no chat.
 */
export function resolveConfiguredCoderBackend(env: Record<string, string | undefined> = process.env): CoderProvider {
  const raw = (env.ANIMA_CODER_PROVIDER ?? env.ANIMA_WORKTREE_CODER_BACKEND)?.trim();
  if (raw === undefined || raw === '') return 'ollama';
  if ((WORKTREE_CODER_BACKENDS as readonly string[]).includes(raw)) return raw as CoderProvider;
  throw new Error(`Backend de código configurado não é permitido: "${raw}".`);
}

/** Extrai `{"files":[{path,content}]}` da resposta de um modelo, aceitando só
 * caminhos do escopo permitido. Aceita JSON puro ou embutido em texto. É o
 * parser compartilhado pelos backends de modelo (Ollama, OpenAI). */
export function parseScopedFiles(raw: string, allowed: ReadonlySet<string>): { readonly path: string; readonly content: string }[] {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const candidate = text.startsWith('{') ? text : (text.match(/\{[\s\S]*\}/)?.[0] ?? '');
  try {
    const root = JSON.parse(candidate) as { files?: unknown };
    if (!Array.isArray(root.files)) return [];
    const out: { path: string; content: string }[] = [];
    for (const entry of root.files) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as { path?: unknown; content?: unknown };
      if (typeof item.path !== 'string' || typeof item.content !== 'string') continue;
      const path = item.path.replace(/\\/g, '/');
      if (allowed.has(path)) out.push({ path, content: item.content });
    }
    return out;
  } catch { return []; }
}

export interface ScriptedEdit { readonly path: string; readonly content: string; }

/**
 * Backend determinístico: aplica um conjunto fixo de edições. É a inteligência
 * usada nas provas automatizadas e nos testes — sem modelo, sem rede, sem custo
 * — para exercitar todo o adaptador de forma reproduzível. Uma edição cujo
 * caminho a guarda recusa faz o backend falhar fechado.
 */
export class ScriptedCoderBackend implements CoderBackend {
  readonly id: string;
  constructor(
    private readonly edits: readonly ScriptedEdit[],
    private readonly summary = 'Alteração determinística aplicada em worktree isolada.',
    id = 'scripted',
  ) { this.id = id; }

  async edit(_request: CoderEditRequest, workspace: CoderWorkspace, signal: AbortSignal): Promise<CoderEditResult> {
    const touched: string[] = [];
    for (const edit of this.edits) {
      if (signal.aborted) break;
      const ok = await workspace.writeFile(edit.path, edit.content);
      if (!ok) throw new Error(`Caminho recusado pelas guardas do worktree: ${edit.path}`);
      touched.push(edit.path.replace(/\\/g, '/'));
    }
    return { summary: this.summary, touchedResources: touched };
  }
}
