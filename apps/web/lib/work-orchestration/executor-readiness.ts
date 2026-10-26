import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import { WORKTREE_CODER_BACKENDS, type CoderProvider } from './coder-backend';
import { buildClaudeCodeEnvironment, resolveClaudeCodeConfig } from './claude-code-coder';
import { buildCodexCliEnvironment, classifyCodexLoginStatus, resolveCodexCliConfig } from './codex-cli-coder';
import { buildWslLoginStatusInvocation, buildWslVersionInvocation, classifyWslProbeFailure, resolveInvestigationTransport } from './investigation-wsl-transport';
import type { ExecutorObservation } from './executor-discovery';
import { resolveOllamaCoderRuntimeConfig } from './ollama-coder-config';
import { runProcess } from './worktree';

// ============================================================
// Seam de READINESS dos executores (Self-Dev CLI V1). READ-ONLY: só sonda
// (`--version`, `auth status`, GET /api/tags) e devolve fatos como códigos estáveis.
// Todas as dependências de I/O são injetáveis; nenhum probe lê nem devolve segredo,
// token, e-mail ou organização — a saída dos binários é interpretada e descartada.
// Todo probe tem timeout curto e limitado. O OpenAI NUNCA é chamado.
// ============================================================

export const READINESS_VERSION_TIMEOUT_MS = 10_000;
export const READINESS_AUTH_TIMEOUT_MS = 15_000;
export const READINESS_HTTP_TIMEOUT_MS = 3_000;

export interface ReadinessProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface ExecutorReadinessDeps {
  /** Lançador de processo sem shell (default: `runProcess`). */
  readonly run: (file: string, args: readonly string[], options: { readonly cwd: string; readonly timeoutMs: number; readonly env: Record<string, string> }) => Promise<ReadinessProcessResult>;
  readonly fileExists: (path: string) => boolean;
  readonly platform: string;
  readonly env: Record<string, string | undefined>;
  readonly cwd: string;
  /** GET HTTP do Ollama; devolve só o status. Lança em falha de rede/timeout. */
  readonly httpGet: (url: string, timeoutMs: number) => Promise<{ readonly status: number }>;
}

/** Dependências reais (processo, filesystem, rede). Só o entrypoint as usa. */
export function createNodeExecutorReadinessDeps(env: Record<string, string | undefined> = process.env): ExecutorReadinessDeps {
  return {
    run: (file, args, options) => runProcess(file, args, { ...options, env: options.env as NodeJS.ProcessEnv }),
    fileExists: path => existsSync(path),
    platform: process.platform,
    env,
    cwd: process.cwd(),
    httpGet: async (url, timeoutMs) => {
      const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
      return { status: response.status };
    },
  };
}

const ready = (provider: CoderProvider): ExecutorObservation => ({ provider, availability: 'ready', reasonUnavailable: null });
const unavailable = (provider: CoderProvider, reason: string): ExecutorObservation => ({ provider, availability: 'unavailable', reasonUnavailable: reason });
const unknown = (provider: CoderProvider, reason: string): ExecutorObservation => ({ provider, availability: 'unknown', reasonUnavailable: reason });

const isPathLike = (executable: string): boolean => /[\\/]/.test(executable);

/** `--version` com exit 0; devolve o código de falha estável ou null quando passou. */
async function checkVersion(deps: ExecutorReadinessDeps, executable: string, env: Record<string, string>): Promise<string | null> {
  if (isPathLike(executable) && !deps.fileExists(executable)) return 'executable_not_found';
  const result = await deps.run(executable, ['--version'], { cwd: deps.cwd, timeoutMs: READINESS_VERSION_TIMEOUT_MS, env });
  if (result.timedOut) return 'version_probe_timeout';
  return result.exitCode === 0 ? null : 'version_check_failed';
}

/**
 * Transporte WSL opt-in (investigation-v1): a observação de `codex-cli` passa a refletir o Codex Linux que o
 * investigation realmente usa (distro acessível + `--version` + login por assinatura), reutilizando a MESMA
 * interpretação de login do pré-voo do adaptador. Limitação: o provider `codex-cli` tem uma única observação;
 * com o transporte WSL configurado ela NÃO atesta o binário nativo do Windows (usado pelo coder `workspace-write`).
 */
async function probeCodexViaWsl(deps: ExecutorReadinessDeps, wsl: Parameters<typeof buildWslVersionInvocation>[0]): Promise<ExecutorObservation> {
  const env = buildCodexCliEnvironment(deps.env);
  const version = buildWslVersionInvocation(wsl);
  const versionResult = await deps.run(version.file, version.args, { cwd: deps.cwd, timeoutMs: READINESS_VERSION_TIMEOUT_MS, env });
  if (versionResult.timedOut || versionResult.exitCode !== 0) return unavailable('codex-cli', classifyWslProbeFailure(versionResult));
  const login = buildWslLoginStatusInvocation(wsl);
  switch (classifyCodexLoginStatus(await deps.run(login.file, login.args, { cwd: deps.cwd, timeoutMs: READINESS_AUTH_TIMEOUT_MS, env }))) {
    case 'subscription': return ready('codex-cli');
    case 'timeout': return unavailable('codex-cli', 'wsl_auth_probe_timeout');
    case 'not_logged_in': return unavailable('codex-cli', 'wsl_codex_not_logged_in');
    case 'api_key': return unavailable('codex-cli', 'codex_login_not_subscription');
    case 'unrecognized': return unknown('codex-cli', 'codex_login_mode_unrecognized');
  }
}

async function probeCodex(deps: ExecutorReadinessDeps): Promise<ExecutorObservation> {
  if (deps.env.ANIMA_CODEX_CLI_TRANSPORT) {
    const coderConfig = resolveCodexCliConfig(null, deps.env, deps.platform as NodeJS.Platform);
    if (!coderConfig.ok) return unavailable('codex-cli', 'codex_transport_invalid');
    if (coderConfig.value.wsl) return probeCodexViaWsl(deps, coderConfig.value.wsl);
  }
  const transport = resolveInvestigationTransport(deps.env, deps.platform as NodeJS.Platform);
  if (!transport.ok) return unavailable('codex-cli', 'investigation_transport_invalid');
  if (transport.value) return probeCodexViaWsl(deps, transport.value);
  const config = resolveCodexCliConfig(null, deps.env);
  if (!config.ok) return unavailable('codex-cli', 'executable_is_shell_wrapper');
  const env = buildCodexCliEnvironment(deps.env);
  const versionFailure = await checkVersion(deps, config.value.executable, env);
  if (versionFailure) return unavailable('codex-cli', versionFailure);
  const login = await deps.run(config.value.executable, ['login', 'status'], { cwd: deps.cwd, timeoutMs: READINESS_AUTH_TIMEOUT_MS, env });
  switch (classifyCodexLoginStatus(login)) {
    case 'timeout': return unavailable('codex-cli', 'auth_probe_timeout');
    case 'not_logged_in': return unavailable('codex-cli', 'codex_not_logged_in');
    case 'api_key': return unavailable('codex-cli', 'codex_login_not_subscription');
    case 'subscription': return ready('codex-cli');
    case 'unrecognized': return unknown('codex-cli', 'codex_login_mode_unrecognized');
  }
}

const pathVariable = (env: Record<string, string>): string => {
  const key = Object.keys(env).find(name => name.toLowerCase() === 'path');
  return key ? env[key] ?? '' : '';
};

/** Git Bash localizável: `CLAUDE_CODE_GIT_BASH_PATH` ou derivado do `git.exe` no PATH do filho. */
function gitBashLocatable(deps: ExecutorReadinessDeps, env: Record<string, string>): boolean {
  const configured = env.CLAUDE_CODE_GIT_BASH_PATH?.trim();
  if (configured) return deps.fileExists(configured);
  for (const directory of pathVariable(env).split(';').map(entry => entry.trim()).filter(Boolean)) {
    if (!deps.fileExists(win32.join(directory, 'git.exe'))) continue;
    // git em `<root>\cmd` ou `<root>\bin` ⇒ `<root>\bin\bash.exe`; em `<root>\mingw64\bin` ⇒ `<root>\bin\bash.exe`.
    const candidates = [win32.join(directory, '..', 'bin', 'bash.exe'), win32.join(directory, '..', '..', 'bin', 'bash.exe')];
    if (candidates.some(candidate => deps.fileExists(candidate))) return true;
  }
  return false;
}

async function probeClaude(deps: ExecutorReadinessDeps): Promise<ExecutorObservation> {
  const config = resolveClaudeCodeConfig(null, deps.env);
  if (!config.ok) return unavailable('claude-code', 'executable_is_shell_wrapper');
  const env = buildClaudeCodeEnvironment(deps.env);
  const versionFailure = await checkVersion(deps, config.value.executable, env);
  if (versionFailure) return unavailable('claude-code', versionFailure);
  if (deps.platform === 'win32' && !gitBashLocatable(deps, env)) return unavailable('claude-code', 'git_bash_not_found');
  const auth = await deps.run(config.value.executable, ['auth', 'status'], { cwd: deps.cwd, timeoutMs: READINESS_AUTH_TIMEOUT_MS, env });
  if (auth.timedOut) return unavailable('claude-code', 'auth_probe_timeout');
  let loggedIn: unknown;
  try {
    const parsed: unknown = JSON.parse(auth.stdout.trim());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return unavailable('claude-code', 'auth_status_invalid');
    loggedIn = (parsed as { loggedIn?: unknown }).loggedIn;
  } catch {
    return unavailable('claude-code', 'auth_status_invalid');
  }
  return loggedIn === true ? ready('claude-code') : unavailable('claude-code', 'claude_not_logged_in');
}

async function probeOllama(deps: ExecutorReadinessDeps): Promise<ExecutorObservation> {
  const config = resolveOllamaCoderRuntimeConfig(deps.env.ANIMA_WORKTREE_CODER_MODEL?.trim() || 'qwen3-coder:latest', deps.env);
  if (!config.ok) return unavailable('ollama', 'ollama_config_invalid');
  try {
    const response = await deps.httpGet(`${config.value.url}/api/tags`, READINESS_HTTP_TIMEOUT_MS);
    return response.status >= 200 && response.status < 300 ? ready('ollama') : unavailable('ollama', 'ollama_http_error');
  } catch {
    return unavailable('ollama', 'ollama_unreachable');
  }
}

/** Nunca chama a API: só a presença (booleana) da chave. A authority paga é humana, por item. */
function probeOpenAI(deps: ExecutorReadinessDeps): ExecutorObservation {
  const key = deps.env.OPENAI_API_KEY;
  return typeof key === 'string' && key.trim().length > 0
    ? unknown('openai', 'paid_authority_required_per_item')
    : unavailable('openai', 'openai_api_key_absent');
}

export async function probeExecutorReadiness(provider: CoderProvider, deps: ExecutorReadinessDeps): Promise<ExecutorObservation> {
  try {
    switch (provider) {
      case 'codex-cli': return await probeCodex(deps);
      case 'claude-code': return await probeClaude(deps);
      case 'ollama': return await probeOllama(deps);
      case 'openai': return probeOpenAI(deps);
      case 'deepseek-harness': return unavailable('deepseek-harness', 'parked_not_operational');
    }
  } catch {
    return unavailable(provider, 'probe_failed');
  }
}

export async function probeAllExecutors(deps: ExecutorReadinessDeps): Promise<readonly ExecutorObservation[]> {
  return Promise.all(WORKTREE_CODER_BACKENDS.map(provider => probeExecutorReadiness(provider, deps)));
}
