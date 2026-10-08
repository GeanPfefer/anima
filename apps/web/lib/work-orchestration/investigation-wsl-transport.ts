import { posix, win32 } from 'node:path';

// ============================================================
// Transporte WSL opt-in do `investigation-v1`.
//
// O host (Windows) continua dono do snapshot Git, do deadline, do cancelamento e de TODA
// a verificação posterior. Este módulo só traduz a invocação do Codex CLI para
// `wsl.exe --exec …`: sem shell (nem no Windows nem no Linux), argumentos sempre como
// elementos de array e caminhos traduzidos de forma pura e validada.
//
// Ausência de `ANIMA_INVESTIGATION_CODEX_TRANSPORT` (ou `native`) ⇒ comportamento atual.
// ============================================================

export const INVESTIGATION_TRANSPORT_ENV = 'ANIMA_INVESTIGATION_CODEX_TRANSPORT';

export interface InvestigationWslConfig {
  /** `wsl.exe` resolvido por SystemRoot (nunca por PATH quando SystemRoot existe). */
  readonly wslExecutable: string;
  readonly distro: string;
  readonly user: string;
  /** Caminho Linux ABSOLUTO do `codex` (o diretório dele carrega o `node` correto). */
  readonly cliPath: string;
}

export type InvestigationTransportResult =
  | { readonly ok: true; readonly value: InvestigationWslConfig | null }
  | { readonly ok: false; readonly error: string };

const DISTRO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const USER = /^[a-z_][a-z0-9_-]{0,31}$/;
const LINUX_PATH = /^\/[A-Za-z0-9._+\-/]{1,400}$/;

/** Opt-in explícito: tudo exigido, nada com default. Qualquer inconsistência falha fechada. */
export function resolveInvestigationTransport(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): InvestigationTransportResult {
  const mode = env[INVESTIGATION_TRANSPORT_ENV]?.trim().toLowerCase();
  if (!mode || mode === 'native') return { ok: true, value: null };
  if (mode !== 'wsl') return { ok: false, error: `${INVESTIGATION_TRANSPORT_ENV} deve ser ausente, native ou wsl.` };
  if (platform !== 'win32') return { ok: false, error: 'O transporte WSL só existe em hosts Windows.' };
  const distro = env.ANIMA_CODEX_WSL_DISTRO?.trim() ?? '';
  const user = env.ANIMA_CODEX_WSL_USER?.trim() ?? '';
  const cliPath = env.ANIMA_CODEX_WSL_CLI_PATH?.trim() ?? '';
  if (!DISTRO.test(distro)) return { ok: false, error: 'ANIMA_CODEX_WSL_DISTRO ausente ou inválida.' };
  if (!USER.test(user)) return { ok: false, error: 'ANIMA_CODEX_WSL_USER ausente ou inválido.' };
  if (!LINUX_PATH.test(cliPath) || cliPath.split('/').includes('..') || cliPath.endsWith('/')) return { ok: false, error: 'ANIMA_CODEX_WSL_CLI_PATH deve ser um caminho Linux absoluto limpo.' };
  const systemRoot = env.SystemRoot?.trim() || env.SYSTEMROOT?.trim();
  return { ok: true, value: { wslExecutable: systemRoot ? win32.join(systemRoot, 'System32', 'wsl.exe') : 'wsl.exe', distro, user, cliPath } };
}

/** `C:\a\b` → `/mnt/c/a/b`. Só unidade local absoluta; UNC, relativo, `..`, controle e `:` extra recusados. */
export function windowsPathToWsl(path: string): string | null {
  const match = /^([A-Za-z]):[\\/]([^]*)$/.exec(path);
  if (!match) return null;
  const segments = match[2]!.split(/[\\/]+/).filter(segment => segment !== '' && segment !== '.');
  // eslint-disable-next-line no-control-regex
  if (segments.some(segment => segment === '..' || /[\u0000-\u001f:*?"<>|]/.test(segment))) return null;
  return posix.join('/mnt', match[1]!.toLowerCase(), ...segments);
}

/** Prefixo comum de `wsl.exe` (distro e usuário explícitos). */
const base = (config: InvestigationWslConfig): string[] => ['-d', config.distro, '-u', config.user];

/** Variáveis de API pagas nunca chegam ao Codex Linux: a assinatura é a única credencial. */
const SCRUB = ['-u', 'OPENAI_API_KEY', '-u', 'CODEX_API_KEY'] as const;

/** `wsl.exe -d D -u U [--cd cwd] --exec /usr/bin/env … <codex> <args>` — `--exec` não usa shell. */
export function buildWslCodexInvocation(config: InvestigationWslConfig, codexArgs: readonly string[], linuxCwd: string): { readonly file: string; readonly args: readonly string[] } {
  const nodeDir = posix.dirname(config.cliPath);
  return {
    file: config.wslExecutable,
    args: [...base(config), '--cd', linuxCwd, '--exec', '/usr/bin/env', ...SCRUB, `PATH=${nodeDir}:/usr/local/bin:/usr/bin:/bin`, config.cliPath, ...codexArgs],
  };
}

/** `codex --version` na distro (readiness). */
export const buildWslVersionInvocation = (config: InvestigationWslConfig): { readonly file: string; readonly args: readonly string[] } => ({
  file: config.wslExecutable,
  args: [...base(config), '--exec', '/usr/bin/env', ...SCRUB, `PATH=${posix.dirname(config.cliPath)}:/usr/local/bin:/usr/bin:/bin`, config.cliPath, '--version'],
});

/** Pré-voo de autenticação: `codex login status` na distro (exit 0 exigido). */
export const buildWslLoginStatusInvocation = (config: InvestigationWslConfig): { readonly file: string; readonly args: readonly string[] } => ({
  file: config.wslExecutable,
  args: [...base(config), '--exec', '/usr/bin/env', ...SCRUB, `PATH=${posix.dirname(config.cliPath)}:/usr/local/bin:/usr/bin:/bin`, config.cliPath, 'login', 'status'],
});

/** Pré-voo de caminhos: o Linux enxerga snapshot e schema e consegue gravar no diretório do resultado. */
export const buildWslPathCheckInvocation = (config: InvestigationWslConfig, snapshot: string, schema: string, outputDir: string): { readonly file: string; readonly args: readonly string[] } => ({
  file: config.wslExecutable,
  args: [...base(config), '--exec', '/usr/bin/test', '-d', snapshot, '-a', '-f', schema, '-a', '-d', outputDir, '-a', '-w', outputDir],
});
