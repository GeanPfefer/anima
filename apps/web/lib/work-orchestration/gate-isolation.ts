import { buildAllowlistedEnvironment } from './native-cli-coder';

// ============================================================
// Isolamento de GATES e comandos do harness (código do CANDIDATO executado pelo Host).
//
// Antes: `runProcess` herdava `process.env` completo do Host (senha residente, senha do writer, chave de serviço, chaves de
// API) e rodava como o mesmo usuário do Host (lia `.env.local`). Aqui há DUAS camadas, ambas necessárias:
//   1. AMBIENTE por allowlist (mesma base dos executores nativos) + descarte defensivo de qualquer nome com cara de segredo.
//   2. SANDBOX do SO (opt-in explícito `ANIMA_GATE_SANDBOX=codex-windows`): o comando roda sob o sandbox do Codex para Windows
//      (usuário `CodexSandboxOffline`, perfil `:workspace`). Um ACE de NEGAÇÃO de leitura para `CodexSandboxUsers` nos arquivos de
//      segredo (`apps/web/.env.local`, `supabase/.env`) é o que impede a leitura — ver `scripts/gate-isolation-acl.ps1`.
// Remover variáveis NÃO basta: o processo ainda leria o arquivo original. Configurado e indisponível ⇒ FALHA FECHADA (nunca
// executa sem sandbox em silêncio).
// ============================================================

/** Além da base dos executores nativos: o mínimo que npm/node/jest/tsc precisam no Windows. */
export const GATE_ENV_EXTRA: readonly string[] = ['NODE_ENV', 'CI', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'CommonProgramFiles', 'ALLUSERSPROFILE', 'PUBLIC'];
/** Valores públicos por definição (Next.js os embute no bundle). */
const PUBLIC_PREFIX = /^NEXT_PUBLIC_/;
/** Rede de segurança: nunca atravessa, mesmo que alguém a coloque na allowlist. */
const SECRET_LIKE = /(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|SERVICE_ROLE|PRIVATE_?KEY|CREDENTIAL|SSH_)/i;
const PUBLIC_KEY_NAMES = /^NEXT_PUBLIC_.*(ANON|PUBLISHABLE)/i; // chaves públicas anon/publishable: não são segredo do control plane

export function buildGateEnvironment(source: Record<string, string | undefined>, fixed: Record<string, string> = {}): Record<string, string> {
  const base = buildAllowlistedEnvironment(GATE_ENV_EXTRA, source);
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.length > 0 && PUBLIC_PREFIX.test(name)) base[name] = value;
  }
  for (const name of Object.keys(base)) {
    if (SECRET_LIKE.test(name) && !PUBLIC_KEY_NAMES.test(name)) delete base[name];
  }
  return { ...base, ...fixed };
}

export type GateSandbox =
  | { readonly kind: 'off' }
  | { readonly kind: 'codex-windows'; readonly executable: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** `ANIMA_GATE_SANDBOX` ausente/`off` ⇒ sem sandbox (compatibilidade). `codex-windows` exige Windows e `ANIMA_GATE_SANDBOX_CODEX_PATH` absoluto. */
export function resolveGateSandbox(env: Record<string, string | undefined>, platform: NodeJS.Platform = process.platform): GateSandbox {
  const mode = env.ANIMA_GATE_SANDBOX?.trim().toLowerCase() || 'off';
  if (mode === 'off') return { kind: 'off' };
  if (mode !== 'codex-windows') return { kind: 'unavailable', reason: 'gate_sandbox_mode_unknown' };
  if (platform !== 'win32') return { kind: 'unavailable', reason: 'gate_sandbox_requires_windows' };
  const executable = env.ANIMA_GATE_SANDBOX_CODEX_PATH?.trim();
  if (!executable || !/^[A-Za-z]:[\\/]/.test(executable) || /\.(cmd|bat|ps1)$/i.test(executable)) return { kind: 'unavailable', reason: 'gate_sandbox_codex_path_invalid' };
  return { kind: 'codex-windows', executable };
}

export interface IsolatedInvocation {
  readonly file: string;
  readonly args: readonly string[];
  readonly shell: boolean;
  readonly env: Record<string, string>;
}

/**
 * Plano de execução isolado. Com sandbox, o comando interno vai após `--` e o processo externo é o Codex (sem shell);
 * batch shims (npm.cmd) passam por `cmd /c` DENTRO do sandbox. Sem sandbox, mantém `shell` e `file` originais.
 */
export function planIsolatedInvocation(
  input: { readonly file: string; readonly args: readonly string[]; readonly cwd: string; readonly shell: boolean },
  sandbox: GateSandbox,
  env: Record<string, string>,
): IsolatedInvocation {
  if (sandbox.kind !== 'codex-windows') return { file: input.file, args: input.args, shell: input.shell, env };
  const inner = input.shell ? ['cmd', '/c', [input.file, ...input.args].join(' ')] : [input.file, ...input.args];
  return { file: sandbox.executable, args: ['sandbox', '-P', ':workspace', '-C', input.cwd, '--', ...inner], shell: false, env };
}
