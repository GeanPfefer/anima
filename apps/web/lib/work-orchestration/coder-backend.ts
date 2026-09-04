import type { ObservedGateInput, WorkExecutorRequest } from '@anima/core';

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
  readonly onTranscript?: (transcript: import('@anima/core').CoderTranscript) => void;
  readonly objective: string;
  readonly includedScope: readonly string[];
  readonly excludedScope: readonly string[];
  /** Contexto informativo de uma tentativa anterior; nunca amplia escopo. */
  readonly carriedContext?: WorkExecutorRequest['carriedContext'];
  /**
   * Host-observed validation feedback from the CURRENT execution attempt.
   * This is not persisted resumption context, does not create a new attempt,
   * and never expands scope or permissions.
   */
  readonly hostValidationFeedback?: HostValidationFeedback;
}

/** Superfície confinada de arquivos entregue ao backend. Ler/escrever fora da
 * raiz do worktree ou em caminhos sensíveis já é recusado pelas guardas. */
export interface CoderWorkspace {
  readFile(relPath: string): Promise<string | null>;
  writeFile(relPath: string, content: string): Promise<boolean>;
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
export type CoderProvider = 'ollama' | 'openai' | 'deepseek-harness';
export const coderBackendId = (provider: CoderProvider, model: string): string => `${provider}:${model}`;

/** Backends de código permitidos no fluxo real de worktree (fonte única de runtime
 * para validar a config de deploy). Espelha `backendFor`. */
export const WORKTREE_CODER_BACKENDS: readonly CoderProvider[] = ['ollama', 'openai', 'deepseek-harness'];

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
