import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { runProcess } from './worktree';

// ============================================================
// Git CONFIÁVEL para a conferência de integridade do aceite sob mandato (A2-0, R2).
//
// O runner (Codex/ollama no worktree do candidato) escreve no mesmo repositório que o writer inspeciona e herda o
// ambiente do launcher. Nada que ele controle pode mudar o que o Git do writer enxerga:
//   - o ambiente do processo Git é CONSTRUÍDO DO ZERO (lista fechada). Nenhuma variável GIT_* do pai é repassada;
//   - config de sistema/global desligadas; fsmonitor/hooks desligados por -c;
//   - `--no-replace-objects` + `GIT_NO_REPLACE_OBJECTS=1` (refs/replace e enxertos não reescrevem objetos);
//   - repositório por caminho EXPLÍCITO e confiável (`--git-dir`), vindo da configuração do processo do writer,
//     nunca de um campo do ledger ou do worktree do candidato;
//   - sem shell, sem stdin, com timeout.
// ============================================================

export type GitRunner = (args: readonly string[]) => Promise<{ readonly exitCode: number; readonly stdout: string }>;

// Git (inclusive o do Windows) aceita /dev/null como dispositivo nulo; o os.devNull do Windows (caminho de dispositivo) quebra o parse de config.
const devNull = '/dev/null';
/** Variáveis do pai que o Git pode precisar para EXISTIR no Windows/POSIX (nenhuma é GIT_*). */
const PASSTHROUGH = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR'] as const;

export interface ScrubbedGitEnvironment {
  readonly env: NodeJS.ProcessEnv;
  /** Nomes (sem valores) de variáveis GIT_* presentes no pai e descartadas — para auditoria. */
  readonly dropped: readonly string[];
}

/** Ambiente fechado do Git confiável. Puro: não lê `process.env` por conta própria. */
export function scrubbedGitEnvironment(parent: NodeJS.ProcessEnv): ScrubbedGitEnvironment {
  const dropped = Object.keys(parent).filter(key => /^GIT_/i.test(key)).sort();
  const env = {} as NodeJS.ProcessEnv;
  for (const key of PASSTHROUGH) if (typeof parent[key] === 'string' && parent[key] !== '') env[key] = parent[key];
  Object.assign(env, {
    HOME: tmpdir(), USERPROFILE: tmpdir(),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: devNull, GIT_CONFIG_GLOBAL: devNull,
    GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_ATTR_NOSYSTEM: '1',
    GIT_PAGER: 'cat', PAGER: 'cat', LC_ALL: 'C', LANG: 'C',
  });
  return { env, dropped };
}

export type TrustedRepository = { readonly ok: true; readonly gitDir: string } | { readonly ok: false; readonly reason: string };

/**
 * Valida o repositório confiável: caminho absoluto de um repositório (`<raiz>/.git` como DIRETÓRIO real, ou diretório bare).
 * Recusa `.git` que seja arquivo (`gitdir:` redireciona para onde o runner quiser).
 */
export function resolveTrustedRepository(repoRoot: string | undefined, stat: (path: string) => { isDirectory(): boolean; isFile(): boolean } | null = safeStat): TrustedRepository {
  if (!repoRoot || !isAbsolute(repoRoot)) return { ok: false, reason: 'trusted_repo_must_be_absolute' };
  const root = resolve(repoRoot);
  const dotGit = join(root, '.git');
  const dotGitStat = stat(dotGit);
  if (dotGitStat?.isDirectory()) return { ok: true, gitDir: dotGit };
  if (dotGitStat?.isFile()) return { ok: false, reason: 'trusted_repo_git_is_a_redirect_file' };
  // bare: HEAD + objects + refs na própria raiz
  if (stat(join(root, 'objects'))?.isDirectory() && stat(join(root, 'refs'))?.isDirectory() && stat(join(root, 'HEAD'))?.isFile()) return { ok: true, gitDir: root };
  return { ok: false, reason: 'trusted_repo_not_found' };
}

function safeStat(path: string): { isDirectory(): boolean; isFile(): boolean } | null {
  try { return statSync(path); } catch { return null; }
}

export interface TrustedGitOptions {
  readonly gitDir: string;
  readonly parentEnv?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly run?: typeof runProcess;
}

/** `git --git-dir=<confiável>` com ambiente limpo e opções de endurecimento antes de qualquer subcomando. */
export function createTrustedGitRunner(options: TrustedGitOptions): GitRunner {
  const { env } = scrubbedGitEnvironment(options.parentEnv ?? process.env);
  const run = options.run ?? runProcess;
  const hardening = [
    `--git-dir=${options.gitDir}`, '--no-replace-objects', '--no-pager',
    '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${devNull}`, '-c', 'core.untrackedCache=false', '-c', 'protocol.allow=never',
  ];
  return async (args) => {
    const result = await run('git', [...hardening, ...args], { cwd: tmpdir(), timeoutMs: options.timeoutMs ?? 30_000, env }).catch(() => null);
    return result && !result.timedOut && !result.cancelled ? { exitCode: result.exitCode, stdout: result.stdout } : { exitCode: -1, stdout: '' };
  };
}
