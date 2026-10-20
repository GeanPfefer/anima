import { buildWslCodexInvocation, buildWslLoginStatusInvocation, buildWslVersionInvocation, resolveInvestigationTransport, windowsPathToWsl, type InvestigationWslConfig } from './investigation-wsl-transport';
import { runProcess } from './worktree';
import type { NativeCliFailureV1 } from '@anima/core';
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
  readonly wsl?: InvestigationWslConfig;
  /** Modelo explícito (`-m`); `CODEX_CLI_DEFAULT_MODEL` ⇒ sem `-m`. */
  readonly model: string;
  /** Perfil explícito do config do Codex (`--profile`), quando fornecido. */
  readonly profile?: string;
  /** Sandbox do Windows (`windows.sandbox`) a declarar explicitamente: o config pessoal é ignorado, então o valor não vem dele. Default `elevated`. */
  readonly windowsSandbox?: CodexWindowsSandbox;
}

export type CodexWindowsSandbox = 'elevated' | 'unelevated';

/**
 * Fronteira do AGENTE (processo `codex` rodando como o operador, fora do sandbox). O sandbox só contém os comandos de shell; as
 * ferramentas do próprio agente (view_image, MCP/plugins/apps do config pessoal e da conta, hooks, navegador, computer-use, web) rodam com
 * a identidade do operador e leem/agem fora do workspace. Provado em laboratório (E1/E2): `view_image` leu arquivo protegido; o
 * config pessoal expôs node_repl, cua_repl, MCP runpod (create_pod/delete_pod) e conectores da conta; um `.codex/config.toml` plantado
 * no workspace fez o Codex lançar um MCP arbitrário como o operador. `--ignore-user-config` (a autenticação continua em CODEX_HOME) fecha
 * as três últimas; `--disable` remove as ferramentas nativas. Feature desconhecida falha ALTO (versão incompatível ⇒ erro, nunca
 * ferramenta aberta em silêncio).
 */
export const CODEX_AGENT_DISABLED_FEATURES: readonly string[] = [
  'view_image', 'apps', 'plugins', 'remote_plugin', 'tool_suggest', 'browser_use', 'browser_use_external', 'computer_use',
  'in_app_browser', 'hooks', 'multi_agent', 'multi_agent_v2', 'goals', 'image_generation', 'skill_search',
];

export function codexAgentIsolationArgs(config: CodexCliConfig, platform: NodeJS.Platform = process.platform): readonly string[] {
  return [
    '--ignore-user-config', '--ignore-rules',
    ...CODEX_AGENT_DISABLED_FEATURES.flatMap(feature => ['--disable', feature]),
    '-c', 'web_search="disabled"',
    ...(platform === 'win32' && !config.wsl ? ['-c', `windows.sandbox="${config.windowsSandbox ?? 'elevated'}"`] : []),
  ];
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
  platform: NodeJS.Platform = process.platform,
): CodexCliConfigResult {
  const transport = resolveInvestigationTransport({ ...env, ANIMA_INVESTIGATION_CODEX_TRANSPORT: env.ANIMA_CODEX_CLI_TRANSPORT }, platform);
  if (!transport.ok) return transport;
  const executable = transport.value?.wslExecutable ?? (env.ANIMA_CODEX_CLI_PATH?.trim() || 'codex');
  if (isShellWrapperPath(executable)) {
    return { ok: false, error: 'ANIMA_CODEX_CLI_PATH aponta para um wrapper de shell (.cmd/.bat/.ps1); configure o executável nativo do Codex.' };
  }
  const model = contractModel?.trim() || env.ANIMA_CODEX_CLI_MODEL?.trim() || CODEX_CLI_DEFAULT_MODEL;
  const profile = env.ANIMA_CODEX_CLI_PROFILE?.trim();
  const windowsSandbox = env.ANIMA_CODEX_WINDOWS_SANDBOX?.trim().toLowerCase();
  if (windowsSandbox && windowsSandbox !== 'elevated' && windowsSandbox !== 'unelevated') {
    return { ok: false, error: 'ANIMA_CODEX_WINDOWS_SANDBOX deve ser elevated ou unelevated.' };
  }
  return { ok: true, value: { executable, model, ...(profile ? { profile } : {}), ...(windowsSandbox ? { windowsSandbox: windowsSandbox as CodexWindowsSandbox } : {}), ...(transport.value ? { wsl: transport.value } : {}) } };
}

/**
 * Perfil NATIVO de permissões do Codex Linux (0.162) usado no transporte WSL. O `workspace-write` legado deixa o sistema de
 * arquivos inteiro LEGÍVEL aos comandos do agente (inclui `~/.codex/auth.json`, `/mnt/c`, `.env.local`). O perfil troca isso por
 * lista de permissão: só o sistema mínimo, a toolchain do Codex, os alvos dos node_modules (leitura) e a worktree (escrita) existem
 * na visão de montagem do comando; o resto é invisível/negado. `.git` e `.codex` da worktree permanecem somente-leitura (provado).
 * Rede dos comandos negada. `--sandbox`/`sandbox_mode` NÃO podem coexistir com `default_permissions` (o Codex recusa).
 */
export const CODEX_WSL_PROFILE_NAME = 'anima_single_item';
/** Única linha de versão em que o perfil foi provado; outra versão ⇒ recusa (nunca "melhor esforço"). */
export const CODEX_WSL_PROFILE_VERSION = /^codex-cli 0\.162\.\d+$/;
const WSL_PROFILE_PATH = /^\/[A-Za-z0-9._+ \-/]{1,400}$/;

/** `<prefixo>/bin/codex` ⇒ `<prefixo>` (toolchain: codex, node e libs). Prefixo raso, em /mnt ou no CODEX_HOME é recusado. */
export function codexWslToolchainRoot(cliPath: string): string | null {
  const match = /^(\/.+)\/bin\/codex$/.exec(cliPath);
  const prefix = match?.[1];
  if (!prefix || prefix.split('/').filter(Boolean).length < 3) return null;
  if (prefix === '/mnt' || prefix.startsWith('/mnt/') || prefix.split('/').includes('.codex') || prefix.split('/').includes('..')) return null;
  return prefix;
}

/** Lista de permissão do perfil; qualquer caminho fora do formato estrito falha (também fecha injeção no TOML inline). */
function codexWslProfileConfigArgs(config: CodexCliConfig, linuxRoot: string, dependencyRoots: readonly string[]): readonly string[] {
  const toolchain = config.wsl ? codexWslToolchainRoot(config.wsl.cliPath) : null;
  if (!toolchain) throw new Error('codex_wsl_isolation_toolchain_invalid');
  const readOnly = [toolchain, ...dependencyRoots];
  const all = [linuxRoot, ...readOnly];
  if (all.some(path => !WSL_PROFILE_PATH.test(path) || path.split('/').includes('..'))) throw new Error('codex_wsl_isolation_path_invalid');
  const entries = [`":minimal"="read"`, ...readOnly.map(path => `"${path}"="read"`), `"${linuxRoot}"="write"`];
  const name = CODEX_WSL_PROFILE_NAME;
  return [
    '-c', `permissions.${name}.filesystem={${entries.join(', ')}}`,
    '-c', `permissions.${name}.network.enabled=false`,
  ];
}

export function codexWslPermissionArgs(config: CodexCliConfig, linuxRoot: string, dependencyRoots: readonly string[]): readonly string[] {
  return ['-c', `default_permissions="${CODEX_WSL_PROFILE_NAME}"`, ...codexWslProfileConfigArgs(config, linuxRoot, dependencyRoots)];
}

/**
 * Argumentos de `codex exec` (sem shell, sem interpolação). Determinísticos:
 * sandbox `workspace-write`, aprovação `never` (sem prompt interativo nem escalada),
 * raiz explícita, modelo/perfil só quando fornecidos, instrução como último argumento.
 *
 * `aiMemoryWrapped`: o `ai-memory run` reescreve `exec <args>` para `exec resume <id> <args>`
 * ao voltar ao Codex, e `codex exec resume` (0.159) NÃO aceita `--sandbox` nem `--cd`. Nesse
 * modo o sandbox vai por `-c sandbox_mode=workspace-write` (aceito por exec E exec resume) e a
 * raiz é o cwd do processo (a worktree). No caminho direto, `--json` habilita
 * o diagnóstico terminal; os demais argumentos permanecem iguais.
 */
export function buildCodexExecArgs(config: CodexCliConfig, rootPath: string, prompt: string, aiMemoryWrapped = false, dependencyRoots: readonly string[] = []): readonly string[] {
  // WSL: perfil nativo (idêntico em exec e exec resume; só `-c`, que ambos aceitam). Demais transportes: sandbox legado, inalterado.
  const permissions = config.wsl ? codexWslPermissionArgs(config, rootPath, dependencyRoots) : null;
  if (aiMemoryWrapped) {
    return [
      'exec',
      ...(permissions ?? ['-c', 'sandbox_mode=workspace-write']),
      '-c', 'approval_policy=never',
      ...(config.model !== CODEX_CLI_DEFAULT_MODEL ? ['--model', config.model] : []),
      ...codexAgentIsolationArgs(config),
      prompt,
    ];
  }
  return [
    'exec',
    ...(permissions ?? ['--sandbox', 'workspace-write']),
    '-c', 'approval_policy=never',
    '--cd', rootPath,
    '--json',
    ...(config.model !== CODEX_CLI_DEFAULT_MODEL ? ['--model', config.model] : []),
    ...(config.profile ? ['--profile', config.profile] : []),
    ...codexAgentIsolationArgs(config),
    prompt,
  ];
}

/** Public JSONL has no error enum: deliberately narrow textual heuristics.
 * Changed messages fall back to unknown; only the LAST terminal decides. */
export function classifyCodexCliFailure(stdout: string, exitCode: number): NativeCliFailureV1 {
  let threadId: string | undefined;
  let terminalMessage: unknown;
  for (const line of stdout.split(/\r?\n/)) {
    let event: unknown;
    try { event = JSON.parse(line); } catch { continue; }
    if (typeof event !== 'object' || event === null || Array.isArray(event)) continue;
    const v = event as Record<string, unknown>;
    if (v.type === 'thread.started' && typeof v.thread_id === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(v.thread_id)) threadId = v.thread_id;
    if (v.type === 'turn.failed') {
      const error = v.error;
      terminalMessage = typeof error === 'object' && error !== null && !Array.isArray(error)
        ? (error as Record<string, unknown>).message : undefined;
    }
  }
  let category: NativeCliFailureV1['category'] = 'unknown_native_cli_failure';
  if (typeof terminalMessage === 'string') {
    if (/^You[\u2019']ve hit your usage limit\./.test(terminalMessage)) category = 'usage_limit_exceeded';
    else if (/\b401\b/.test(terminalMessage) && /\bUnauthorized\b/.test(terminalMessage)) category = 'unauthorized';
  }
  return { version: 1, category, exitCode, ...(threadId ? { threadId } : {}) };
}

export type CodexLoginStatus = 'subscription' | 'api_key' | 'not_logged_in' | 'timeout' | 'unrecognized';

/** Interpreta `codex login status` (nativo OU via WSL). Fonte única de readiness e do pré-voo do investigation. */
export function classifyCodexLoginStatus(login: { readonly exitCode: number; readonly timedOut: boolean; readonly stdout: string; readonly stderr: string }): CodexLoginStatus {
  if (login.timedOut) return 'timeout';
  if (login.exitCode !== 0) return 'not_logged_in';
  const output = `${login.stdout} ${login.stderr}`;
  if (/api[ _-]?key/i.test(output)) return 'api_key';
  return /chatgpt/i.test(output) ? 'subscription' : 'unrecognized';
}

/** Instrução determinística (comum aos executores nativos). */
export const buildCodexCliPrompt = (request: CoderEditRequest): string => buildNativeCliPrompt(request);

/** Lançador de processo (mesma assinatura de `runProcess`). Injetável em teste. */
export type CodexCliProcessRunner = NativeCliProcessRunner;

export interface CodexCliCoderOptions {
  readonly requireSubscription?: boolean;
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
  private readonly config: CodexCliConfig;
  private readonly run: CodexCliProcessRunner | undefined;
  private readonly environmentSource: Record<string, string | undefined>;
  private readonly aiMemory: AiMemoryWrapConfig | undefined;
  private readonly aiMemoryProbe: AiMemoryServerProbe | undefined;

  constructor(options: CodexCliCoderOptions) {
    this.requireSubscription = options.requireSubscription === true;
    this.config = options.config;
    this.id = coderBackendId('codex-cli', options.config.model);
    // SEM `observation` (identidade de placement): `placement:'remote'` exige um `nodeId` estável que o host
    // atesta (Ollama: nó configurado; OpenAI: 'openai-api'), e o host NÃO atesta o nó de inferência de um CLI
    // nativo; `local` seria falso. `{remote, nodeId:null}` era recusado por buildHostObservedCoderEvidence e a
    // evidência do coder sumia em silêncio (lane mandatado ficava em evidence_incomplete). Ausência é legado válido;
    // backend/modelo seguem no `backendId` (`provider:model`).
    this.run = options.run;
    this.environmentSource = options.environmentSource ?? process.env;
    this.aiMemory = options.aiMemory;
    this.aiMemoryProbe = options.aiMemoryProbe;
  }

  private readonly requireSubscription: boolean;

  /**
   * Antes de CADA turno WSL: (1) a versão do Codex é a única em que o perfil foi provado; (2) o MESMO perfil, aplicado por
   * `codex sandbox`, nega de fato a credencial do Linux e o Windows montado e enxerga a worktree. Qualquer falha ⇒ o agente não
   * sobe (nunca cai no `workspace-write` legado nem roda sem prova).
   */
  private async proveWslIsolation(linuxRoot: string, dependencyRoots: readonly string[], request: CoderEditRequest, cwd: string, signal: AbortSignal, run: CodexCliProcessRunner): Promise<void> {
    const wsl = this.config.wsl!;
    const env = buildCodexCliEnvironment(this.environmentSource) as NodeJS.ProcessEnv;
    const step = async (invocation: { readonly file: string; readonly args: readonly string[] }) => {
      const remainingMs = request.deadlineAtMs === undefined ? 15_000 : request.deadlineAtMs - Date.now();
      if (signal.aborted) throw new Error('Codex CLI: cancelado antes da prova de isolamento.');
      if (remainingMs <= 0) throw new Error('Codex CLI: deadline excedido antes da prova de isolamento.');
      const result = await run(invocation.file, invocation.args, { cwd, timeoutMs: Math.min(15_000, remainingMs), signal, env });
      if (result.cancelled || signal.aborted) throw new Error('Codex CLI: cancelado durante a prova de isolamento.');
      return result;
    };
    const version = await step(buildWslVersionInvocation(wsl));
    if (version.exitCode !== 0 || version.timedOut || !CODEX_WSL_PROFILE_VERSION.test(version.stdout.trim())) throw new Error('codex_wsl_isolation_version_unsupported');
    const probe = [
      `for p in "/home/${wsl.user}/.codex/auth.json" "$HOME/.codex/auth.json" /mnt/c/Windows/win.ini; do`,
      'if head -c 0 "$p" 2>/dev/null; then echo ANIMA_PROFILE_LEAK; exit 3; fi; done;',
      'test -r . || exit 4; echo ANIMA_PROFILE_OK',
    ].join(' ');
    const canary = buildWslCodexInvocation(wsl, [
      'sandbox', '-P', CODEX_WSL_PROFILE_NAME, ...codexWslProfileConfigArgs(this.config, linuxRoot, dependencyRoots),
      '-C', linuxRoot, '--', '/usr/bin/sh', '-c', probe,
    ], linuxRoot);
    const proof = await step(canary);
    if (proof.exitCode !== 0 || proof.timedOut || !proof.stdout.includes('ANIMA_PROFILE_OK') || proof.stdout.includes('ANIMA_PROFILE_LEAK')) throw new Error('codex_wsl_isolation_unproved');
  }

  async edit(request: CoderEditRequest, workspace: CoderWorkspace, signal: AbortSignal): Promise<CoderEditResult> {
    const wrap = this.aiMemory;
    if (wrap && this.config.wsl) throw new Error('Codex WSL coder não suporta ai-memory wrap.');
    // `exec resume` não aceita `--profile`: com wrap, perfil explícito falha fechado (nunca é descartado em silêncio).
    if (wrap && this.config.profile) throw new Error('Codex CLI com ai-memory não suporta ANIMA_CODEX_CLI_PROFILE (codex exec resume não aceita --profile).');
    const linuxRoot = this.config.wsl ? windowsPathToWsl(workspace.rootPath ?? '') : null;
    if (this.config.wsl && !linuxRoot) throw new Error('Worktree Windows não traduzível para WSL.');
    const run = this.run ?? runProcess;
    const dependencyRoots = this.config.wsl ? (workspace.dependencyReadRoots ?? []).map(root => windowsPathToWsl(root)) : [];
    if (dependencyRoots.some(root => root === null)) throw new Error('codex_wsl_isolation_path_invalid');
    if (this.requireSubscription) {
      if (!this.config.wsl || this.config.model !== 'default' || this.config.profile || wrap || !workspace.rootPath) {
        throw new Error('single_item_codex_contract_invalid');
      }
      const remainingMs = request.deadlineAtMs === undefined ? 15_000 : request.deadlineAtMs - Date.now();
      if (remainingMs <= 0) throw new Error('Codex CLI: deadline excedido antes da autenticação.');
      const login = buildWslLoginStatusInvocation(this.config.wsl);
      const status = await run(login.file, login.args, { cwd: workspace.rootPath, timeoutMs: Math.min(15_000, remainingMs),
        signal, env: buildCodexCliEnvironment(this.environmentSource) as NodeJS.ProcessEnv });
      if (classifyCodexLoginStatus(status) !== 'subscription' || status.cancelled || signal.aborted) {
        throw new Error('single_item_codex_authentication_unproved');
      }
    }
    if (this.config.wsl && linuxRoot) await this.proveWslIsolation(linuxRoot, dependencyRoots as string[], request, workspace.rootPath ?? '', signal, run);
    const { seconds, aiMemoryNotes } = await runNativeCliTurn({
      label: 'Codex CLI',
      ...(!wrap ? { classifyFailure: classifyCodexCliFailure } : {}),
      executable: this.config.executable,
      buildArgs: (rootPath, prompt) => {
        const args = buildCodexExecArgs(this.config, linuxRoot ?? rootPath, prompt, Boolean(wrap), dependencyRoots as string[]);
        return this.config.wsl && linuxRoot ? buildWslCodexInvocation(this.config.wsl, args, linuxRoot).args : args;
      },
      env: buildCodexCliEnvironment(this.environmentSource),
      run,
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
