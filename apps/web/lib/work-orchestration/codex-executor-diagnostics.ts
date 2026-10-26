
import { buildCodexCliEnvironment, CODEX_WSL_PROFILE_VERSION, resolveCodexCliConfig } from './codex-cli-coder';
import type { ExecutorObservation } from './executor-discovery';
import { READINESS_VERSION_TIMEOUT_MS, type ExecutorReadinessDeps } from './executor-readiness';
import { buildWslVersionInvocation, classifyWslProbeFailure, resolveInvestigationTransport } from './investigation-wsl-transport';

// ============================================================
// Diagnóstico do executor Codex CLI (Project Builder V1-04) — READ-ONLY.
//
// Responde, sem iniciar attempt nem tocar worktree/banco: qual transporte está EFETIVO, qual distribuição/usuário/binário, qual
// versão, e — quando indisponível — a causa ESPECÍFICA (instalação, configuração, WSL, binário, version check). Reaproveita a
// resolução de configuração e a observação de readiness já existentes; a única sondagem nova é um `--version`.
// Nunca devolve segredo: só nomes de variáveis, distro/usuário/caminho do binário (configuração, não credencial) e códigos.
// ============================================================

export type CodexTransportKind = 'wsl' | 'native' | 'invalid';

export interface CodexExecutorDiagnostic {
  readonly transport: CodexTransportKind;
  /** Grupo de variáveis que decidiu o transporte. */
  readonly configSource: 'ANIMA_CODEX_CLI_TRANSPORT' | 'ANIMA_INVESTIGATION_CODEX_TRANSPORT' | 'default';
  readonly distro: string | null;
  readonly user: string | null;
  /** WSL: caminho Linux do `codex`. Nativo: executável resolvido (`codex` via PATH ou ANIMA_CODEX_CLI_PATH). */
  readonly binary: string | null;
  readonly version: string | null;
  /** O perfil nativo do Single-Item só foi provado em `codex-cli 0.162.x`. */
  readonly profileCompatible: boolean | null;
  readonly availability: ExecutorObservation['availability'];
  /** Código de readiness já observado (estável). */
  readonly reason: string | null;
  /** Causa específica da indisponibilidade (instalação/configuração/WSL/binário/version check), se houver. */
  readonly cause: string | null;
  /** Orientação curta e sem segredo. */
  readonly hint: string | null;
}

const HINT_CONFIG = 'Configure o transporte WSL em apps/web/.env.codex-wsl.local (modelo: .env.codex-wsl.example; veja docs/operacao/codex-wsl-config-persistente.md).';

const first = (text: string): string | null => {
  const line = text.replace(/\u0000/g, '').split(/\r?\n/).map(l => l.trim()).find(Boolean);
  return line && line.length <= 80 ? line : null;
};

/**
 * Diagnóstico a partir do ambiente do processo e da observação de readiness. Faz no máximo UM `--version` (read-only). Não lê `login`
 * (a observação já traz o estado de autenticação) e nunca inicia coder, worktree ou attempt.
 */
export async function diagnoseCodexExecutor(deps: ExecutorReadinessDeps, observation: ExecutorObservation): Promise<CodexExecutorDiagnostic> {
  const base = { availability: observation.availability, reason: observation.reasonUnavailable } as const;
  const platform = deps.platform as NodeJS.Platform;
  const explicit = Boolean(deps.env.ANIMA_CODEX_CLI_TRANSPORT);
  const config = resolveCodexCliConfig(null, deps.env, platform);
  if (explicit && !config.ok) {
    return { ...base, transport: 'invalid', configSource: 'ANIMA_CODEX_CLI_TRANSPORT', distro: null, user: null, binary: null, version: null, profileCompatible: null,
      cause: 'codex_transport_invalid', hint: `${config.error} ${HINT_CONFIG}` };
  }
  const viaCli = explicit && config.ok && config.value.wsl ? config.value.wsl : null;
  const investigation = viaCli ? null : resolveInvestigationTransport(deps.env, platform);
  if (investigation && !investigation.ok) {
    return { ...base, transport: 'invalid', configSource: 'ANIMA_INVESTIGATION_CODEX_TRANSPORT', distro: null, user: null, binary: null, version: null, profileCompatible: null,
      cause: 'investigation_transport_invalid', hint: `${investigation.error} ${HINT_CONFIG}` };
  }
  const wsl = viaCli ?? (investigation?.ok ? investigation.value : null);
  const env = buildCodexCliEnvironment(deps.env);

  if (wsl) {
    const configSource = (viaCli ? 'ANIMA_CODEX_CLI_TRANSPORT' : 'ANIMA_INVESTIGATION_CODEX_TRANSPORT') as CodexExecutorDiagnostic['configSource'];
    const common = { ...base, transport: 'wsl' as const, configSource, distro: wsl.distro, user: wsl.user, binary: wsl.cliPath };
    if (/[\\/]/.test(wsl.wslExecutable) && !deps.fileExists(wsl.wslExecutable)) {
      return { ...common, version: null, profileCompatible: null, cause: 'wsl_not_installed', hint: 'wsl.exe não foi encontrado neste host; instale/habilite o WSL.' };
    }
    const invocation = buildWslVersionInvocation(wsl);
    const result = await deps.run(invocation.file, invocation.args, { cwd: deps.cwd, timeoutMs: READINESS_VERSION_TIMEOUT_MS, env });
    if (result.timedOut || result.exitCode !== 0) {
      const cause = classifyWslProbeFailure(result);
      return { ...common, version: null, profileCompatible: null, cause, hint: hintFor(cause) };
    }
    const version = first(result.stdout);
    const profileCompatible = version !== null && CODEX_WSL_PROFILE_VERSION.test(version);
    return { ...common, version, profileCompatible, cause: observation.availability === 'ready' ? null : observation.reasonUnavailable,
      hint: observation.availability === 'ready' ? (profileCompatible ? null : 'Versão fora da linha 0.162.x em que o perfil do Single-Item foi provado.') : hintFor(observation.reasonUnavailable) };
  }

  // Nativo (sem transporte WSL).
  if (!config.ok) {
    return { ...base, transport: 'invalid', configSource: 'default', distro: null, user: null, binary: null, version: null, profileCompatible: null, cause: 'executable_is_shell_wrapper', hint: config.error };
  }
  const executable = config.value.executable;
  const common = { ...base, transport: 'native' as const, configSource: 'default' as const, distro: null, user: null, binary: executable };
  if (/[\\/]/.test(executable) && !deps.fileExists(executable)) {
    return { ...common, version: null, profileCompatible: null, cause: 'executable_not_found', hint: platform === 'win32' ? `Executável não encontrado. ${HINT_CONFIG}` : 'Executável não encontrado.' };
  }
  const result = await deps.run(executable, ['--version'], { cwd: deps.cwd, timeoutMs: READINESS_VERSION_TIMEOUT_MS, env });
  if (result.timedOut) return { ...common, version: null, profileCompatible: null, cause: 'version_probe_timeout', hint: null };
  if (result.exitCode === -1) {
    return { ...common, version: null, profileCompatible: null, cause: 'executable_not_found', hint: platform === 'win32' ? `Nenhum "codex" nativo foi lançado. ${HINT_CONFIG}` : 'Nenhum "codex" no PATH.' };
  }
  if (result.exitCode !== 0) return { ...common, version: null, profileCompatible: null, cause: 'version_check_failed', hint: null };
  return { ...common, version: first(result.stdout), profileCompatible: null, cause: observation.availability === 'ready' ? null : observation.reasonUnavailable, hint: null };
}

function hintFor(code: string | null): string | null {
  switch (code) {
    case 'wsl_launcher_unavailable': return 'wsl.exe não pôde ser lançado (instalação/habilitação do WSL).';
    case 'wsl_distro_not_found': return 'A distribuição configurada em ANIMA_CODEX_WSL_DISTRO não existe (use "wsl -l -q").';
    case 'wsl_user_not_found': return 'O usuário configurado em ANIMA_CODEX_WSL_USER não existe na distribuição.';
    case 'codex_binary_not_found': return 'O caminho em ANIMA_CODEX_WSL_CLI_PATH não existe na distribuição.';
    case 'wsl_version_probe_timeout': return 'A sondagem de versão excedeu o tempo (WSL parado ou sob pressão de memória).';
    case 'wsl_version_check_failed': return '`codex --version` falhou dentro do WSL.';
    case 'wsl_codex_not_logged_in': return 'O Codex do usuário Linux não está autenticado (assinatura).';
    case 'codex_login_not_subscription': return 'O Codex Linux está autenticado por chave de API; o ANIMA exige assinatura.';
    default: return null;
  }
}
