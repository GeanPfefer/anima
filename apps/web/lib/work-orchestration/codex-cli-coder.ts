import { coderBackendId, type CoderBackend, type CoderEditRequest, type CoderEditResult, type CoderWorkspace } from './coder-backend';
import {
  NATIVE_CLI_DEFAULT_MODEL,
  NATIVE_CLI_PROMPT_MAX_CHARS,
  buildAllowlistedEnvironment,
  buildNativeCliPrompt,
  isShellWrapperPath,
  runNativeCliTurn,
  type AiMemoryServerProbe,
  type AiMemoryWrapConfig,
  type NativeCliProcessRunner,
} from './native-cli-coder';

// ============================================================
// Akita Baseline V1 — primeiro executor externo: Codex CLI por trás de CoderBackend.
//
// O ANIMA NÃO roda laço agêntico aqui. `codex exec` usa o PRÓPRIO harness nativo
// (READ/SEARCH/EDIT/EXEC, contexto, tool calls) dentro da worktree isolada e devolve
// o controle. Este adaptador só: monta a instrução determinística (a MESMA seção
// canônica `renderCoderTaskSection` dos demais backends), lança o processo sem shell
// com cwd = worktree e ambiente mínimo, espera exit/deadline/cancelamento e sanitiza
// o diagnóstico (mecânica comum em `native-cli-coder.ts`).
//
// Tudo o mais continua com o host (WorktreeExecutorAdapter): git observado (diff contra
// o SHA-base, independe de o Codex ter commitado), escopo (contract_violation), gates,
// checkpoint/handoff e Verifier. Exit 0 significa apenas "o turno terminou" — NUNCA
// gate aprovado. O backend não atesta arquivos tocados (`touchedResources: []`).
//
// Contenção: sandbox/aprovação nativos do Codex (`workspace-write`, `never`) + worktree
// descartável + inspeção git do host. Não é um sandbox perfeito e não pretende ser.
// ============================================================

/** Modelo "sem `-m`": o Codex usa o modelo do próprio config/perfil do operador. */
export const CODEX_CLI_DEFAULT_MODEL = NATIVE_CLI_DEFAULT_MODEL;

/** Teto da instrução por argumento (limite de linha de comando do Windows). */
export const CODEX_CLI_PROMPT_MAX_CHARS = NATIVE_CLI_PROMPT_MAX_CHARS;

/**
 * Além da base comum, só `CODEX_HOME` (onde mora a autenticação do Codex).
 * Deliberadamente FORA: `OPENAI_API_KEY`/`CODEX_API_KEY` (fariam o Codex cobrar por API
 * em vez da assinatura), Supabase, chaves do ANIMA e qualquer outro segredo da aplicação.
 */
const CODEX_ENV_EXTRA: readonly string[] = ['CODEX_HOME'];

/** Ambiente mínimo do processo filho, montado por allowlist (nunca `...process.env`). */
export function buildCodexCliEnvironment(source: Record<string, string | undefined> = process.env): Record<string, string> {
  return buildAllowlistedEnvironment(CODEX_ENV_EXTRA, source);
}

export interface CodexCliConfig {
  /** Executável NATIVO do Codex (caminho absoluto ou nome resolvido pelo PATH). */
  readonly executable: string;
  /** Modelo explícito (`-m`); `CODEX_CLI_DEFAULT_MODEL` ⇒ sem `-m`. */
  readonly model: string;
  /** Perfil explícito do config do Codex (`--profile`), quando fornecido. */
  readonly profile?: string;
}

export type CodexCliConfigResult =
  | { readonly ok: true; readonly value: CodexCliConfig }
  | { readonly ok: false; readonly error: string };

/**
 * Config do operador por env de DEPLOY: `ANIMA_CODEX_CLI_PATH` (default `codex`, via
 * PATH), `ANIMA_CODEX_CLI_PROFILE` opcional. O modelo vem do contrato (fonte única),
 * com fallback para `ANIMA_CODEX_CLI_MODEL` e por fim `default` (config do Codex).
 * Wrappers `.cmd/.bat/.ps1` exigiriam shell intermediário: recusados (fail-closed) —
 * aponte para o executável nativo.
 */
export function resolveCodexCliConfig(
  contractModel: string | null,
  env: Record<string, string | undefined> = process.env,
): CodexCliConfigResult {
  const executable = env.ANIMA_CODEX_CLI_PATH?.trim() || 'codex';
  if (isShellWrapperPath(executable)) {
    return { ok: false, error: 'ANIMA_CODEX_CLI_PATH aponta para um wrapper de shell (.cmd/.bat/.ps1); configure o executável nativo do Codex.' };
  }
  const model = contractModel?.trim() || env.ANIMA_CODEX_CLI_MODEL?.trim() || CODEX_CLI_DEFAULT_MODEL;
  const profile = env.ANIMA_CODEX_CLI_PROFILE?.trim();
  return { ok: true, value: { executable, model, ...(profile ? { profile } : {}) } };
}

/**
 * Argumentos de `codex exec` (sem shell, sem interpolação). Determinísticos:
 * sandbox `workspace-write`, aprovação `never` (sem prompt interativo nem escalada),
 * raiz explícita, modelo/perfil só quando fornecidos, instrução como último argumento.
 *
 * `aiMemoryWrapped`: o `ai-memory run` reescreve `exec <args>` para `exec resume <id> <args>`
 * ao voltar ao Codex, e `codex exec resume` (0.159) NÃO aceita `--sandbox` nem `--cd`. Nesse
 * modo o sandbox vai por `-c sandbox_mode=workspace-write` (aceito por exec E exec resume) e a
 * raiz é o cwd do processo (a worktree). Sem wrap, os args são exatamente os de antes.
 */
export function buildCodexExecArgs(config: CodexCliConfig, rootPath: string, prompt: string, aiMemoryWrapped = false): readonly string[] {
  if (aiMemoryWrapped) {
    return [
      'exec',
      '-c', 'sandbox_mode=workspace-write',
      '-c', 'approval_policy=never',
      ...(config.model !== CODEX_CLI_DEFAULT_MODEL ? ['--model', config.model] : []),
      prompt,
    ];
  }
  return [
    'exec',
    '--sandbox', 'workspace-write',
    '-c', 'approval_policy=never',
    '--cd', rootPath,
    ...(config.model !== CODEX_CLI_DEFAULT_MODEL ? ['--model', config.model] : []),
    ...(config.profile ? ['--profile', config.profile] : []),
    prompt,
  ];
}

/** Instrução determinística (comum aos executores nativos). */
export const buildCodexCliPrompt = (request: CoderEditRequest): string => buildNativeCliPrompt(request);

/** Lançador de processo (mesma assinatura de `runProcess`). Injetável em teste. */
export type CodexCliProcessRunner = NativeCliProcessRunner;

export interface CodexCliCoderOptions {
  readonly config: CodexCliConfig;
  /** Default: `runProcess` (spawn sem shell). */
  readonly run?: CodexCliProcessRunner;
  /** Fonte do ambiente filtrado; default `process.env`. */
  readonly environmentSource?: Record<string, string | undefined>;
  /** Wrap opt-in pelo `ai-memory run` (continuidade cross-harness); ausente ⇒ lançamento direto. */
  readonly aiMemory?: AiMemoryWrapConfig;
  /** Sonda do servidor ai-memory (teste). */
  readonly aiMemoryProbe?: AiMemoryServerProbe;
}

export class CodexCliCoderBackend implements CoderBackend {
  readonly id: string;
  readonly observation: NonNullable<CoderBackend['observation']>;
  private readonly config: CodexCliConfig;
  private readonly run: CodexCliProcessRunner | undefined;
  private readonly environmentSource: Record<string, string | undefined>;
  private readonly aiMemory: AiMemoryWrapConfig | undefined;
  private readonly aiMemoryProbe: AiMemoryServerProbe | undefined;

  constructor(options: CodexCliCoderOptions) {
    this.config = options.config;
    this.id = coderBackendId('codex-cli', options.config.model);
    // Inferência é do provider do Codex (remota); worktree e efeitos continuam locais.
    this.observation = { placement: 'remote', nodeId: null, model: options.config.model };
    this.run = options.run;
    this.environmentSource = options.environmentSource ?? process.env;
    this.aiMemory = options.aiMemory;
    this.aiMemoryProbe = options.aiMemoryProbe;
  }

  async edit(request: CoderEditRequest, workspace: CoderWorkspace, signal: AbortSignal): Promise<CoderEditResult> {
    const wrap = this.aiMemory;
    // `exec resume` não aceita `--profile`: com wrap, perfil explícito falha fechado (nunca é descartado em silêncio).
    if (wrap && this.config.profile) throw new Error('Codex CLI com ai-memory não suporta ANIMA_CODEX_CLI_PROFILE (codex exec resume não aceita --profile).');
    const { seconds, aiMemoryNotes } = await runNativeCliTurn({
      label: 'Codex CLI',
      executable: this.config.executable,
      buildArgs: (rootPath, prompt) => buildCodexExecArgs(this.config, rootPath, prompt, Boolean(wrap)),
      env: buildCodexCliEnvironment(this.environmentSource),
      ...(this.run ? { run: this.run } : {}),
      request,
      rootPath: workspace.rootPath,
      signal,
      ...(wrap ? { aiMemory: { config: wrap, harness: 'codex' as const, ...(this.aiMemoryProbe ? { probe: this.aiMemoryProbe } : {}) } } : {}),
    });
    return {
      // Flui para o sinal `result` persistido: sem caminho absoluto, sem saída do modelo.
      summary: `Codex CLI (${this.id}) encerrou o turno com exit 0 em ${seconds}s; a validação é dos gates do host.`,
      // O host observa o escopo real via git; o adaptador não atesta arquivos.
      touchedResources: [],
      notes: ['turn-outcome:exited-0', `duration-s:${seconds}`, ...aiMemoryNotes],
    };
  }
}
