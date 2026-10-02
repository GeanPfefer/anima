import { renderCoderTaskSection, type CoderEditRequest } from './coder-backend';
import { summarizeCommandOutput } from './output-sanitization';
import { runProcess, type CommandResult } from './worktree';

// ============================================================
// Akita Baseline V1 — o MÍNIMO comum aos executores NATIVOS de código (Codex CLI,
// Claude Code): instrução determinística, ambiente por allowlist, um turno de processo
// sem shell com deadline/cancelamento, e diagnóstico sanitizado. Não é framework de
// CLIs: cada adaptador continua dono das próprias flags, config e interpretação do
// desfecho. O ANIMA não roda laço agêntico aqui — o harness é o da ferramenta.
// ============================================================

/** Modelo "sem flag de modelo": a ferramenta usa o modelo do próprio config do operador. */
export const NATIVE_CLI_DEFAULT_MODEL = 'default';

/**
 * Teto da instrução passada como ARGUMENTO. No Windows a linha de comando inteira é
 * limitada a 32 767 caracteres (com escape de aspas); acima disso o spawn falharia de
 * forma opaca. Excedeu ⇒ falha fechada ANTES de spawnar.
 */
export const NATIVE_CLI_PROMPT_MAX_CHARS = 24_000;

const DIAGNOSTIC_MAX_CHARS = 600;
const DIAGNOSTIC_MAX_LINES = 8;

/**
 * Base da allowlist de ambiente (case-insensitive): o processo existir (sistema/PATH/
 * temp), achar a config/autenticação JÁ feita pelo operador no perfil do usuário,
 * locale e rede do operador (proxy/CA). Cada adaptador acrescenta só o próprio diretório
 * de config. Fora por construção: chaves de API, Supabase, RunPod e segredos do ANIMA.
 */
export const NATIVE_CLI_BASE_ENV_ALLOWLIST: readonly string[] = [
  // Sistema / processo
  'PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'OS',
  'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS',
  'TEMP', 'TMP', 'TMPDIR',
  // Perfil do usuário (onde mora a autenticação da ferramenta)
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'USERNAME', 'USER', 'LOGNAME',
  // Locale
  'LANG', 'LC_ALL', 'LC_CTYPE',
  // Rede do operador (proxy/CA), sem credencial própria do ANIMA
  'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
];

/** Ambiente mínimo do filho, montado por allowlist (nunca `...process.env`) + `fixed`. */
export function buildAllowlistedEnvironment(
  extraAllowlist: readonly string[],
  source: Record<string, string | undefined>,
  fixed: Record<string, string> = {},
): Record<string, string> {
  const allowed = new Set([...NATIVE_CLI_BASE_ENV_ALLOWLIST, ...extraAllowlist].map(name => name.toLowerCase()));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.length > 0 && allowed.has(name.toLowerCase())) env[name] = value;
  }
  // Saída sem cores: o diagnóstico sanitizado não precisa de sequências ANSI.
  return { ...env, NO_COLOR: '1', ...fixed };
}

/** Wrappers `.cmd/.bat/.ps1` exigiriam shell intermediário: recusados (fail-closed). */
export const isShellWrapperPath = (executable: string): boolean => /\.(?:cmd|bat|ps1)$/i.test(executable);

const list = (paths: readonly string[]): string => paths.length > 0 ? paths.map(path => `- ${path}`).join('\n') : '- (nenhum)';

/**
 * Instrução determinística: a seção canônica da especificação aprovada (idêntica à de
 * Ollama/OpenAI/DSH) + somente as regras operacionais do executor nativo. Sem `taskSpec`
 * (chamada direta sem Work Item), cai no objetivo — nada é inventado.
 */
export function buildNativeCliPrompt(request: CoderEditRequest): string {
  const taskSection = renderCoderTaskSection(request) ?? `Objetivo:\n${request.objective}`;
  const feedback = request.hostValidationFeedback;
  const feedbackSection = !feedback
    ? null
    : feedback.kind === 'no-change'
      ? 'Feedback do host: a tentativa anterior terminou sem nenhuma alteração observada pelo git. Realize a mudança solicitada.'
      : [
          `Feedback do host: o gate "${feedback.failedGate.label}" (${feedback.failedGate.command}) falhou com exit ${feedback.failedGate.exitCode}.`,
          ...(feedback.diagnostic ? [`Diagnóstico sanitizado:\n${feedback.diagnostic}`] : []),
          'Corrija a mudança para que o gate passe.',
        ].join('\n');
  return [
    taskSection,
    ...(feedbackSection ? [feedbackSection] : []),
    [
      'Regras operacionais deste executor:',
      '- Trabalhe exclusivamente no diretório atual (a worktree fornecida); não leia nem escreva fora dele.',
      '- Realize a mudança solicitada acima.',
      `- Escreva somente dentro do escopo permitido:\n${list(request.includedScope)}`,
      `- Nunca altere o escopo excluído:\n${list(request.excludedScope)}`,
      '- Não faça commit, push, merge, rebase nem troque de branch.',
      '- A validação final, o commit e a integração são do host: ele observa o git e roda os gates depois que você terminar.',
    ].join('\n'),
  ].join('\n\n');
}

/** Lançador de processo (mesma assinatura de `runProcess`): sem shell, com timeout e
 * cancelamento que derrubam a árvore. Injetável em teste. */
export type NativeCliProcessRunner = (
  file: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs: number; readonly signal?: AbortSignal; readonly env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

/** Diagnóstico de falha: caminho da worktree vira `<worktree>`, redaction única do repo, limitado. */
export const sanitizeNativeCliDiagnostic = (result: Pick<CommandResult, 'stdout' | 'stderr'>, rootPath: string): string | undefined =>
  summarizeCommandOutput(
    result.stdout.split(rootPath).join('<worktree>'),
    result.stderr.split(rootPath).join('<worktree>'),
    { maxChars: DIAGNOSTIC_MAX_CHARS, maxLines: DIAGNOSTIC_MAX_LINES, dropFooters: false, redactPaths: true },
  );

export interface NativeCliTurnInput {
  /** Nome humano nas mensagens (ex.: "Codex CLI"). */
  readonly label: string;
  readonly executable: string;
  readonly buildArgs: (rootPath: string, prompt: string) => readonly string[];
  readonly env: Record<string, string>;
  readonly run?: NativeCliProcessRunner;
  readonly request: CoderEditRequest;
  readonly rootPath: string | undefined;
  readonly signal: AbortSignal;
}

export interface NativeCliTurnOutput {
  readonly result: CommandResult;
  readonly rootPath: string;
  readonly seconds: number;
}

/**
 * UM turno do executor nativo, fail-closed: exige a worktree enraizada (nunca o checkout
 * principal), respeita o deadline GLOBAL da tentativa e o cancelamento do host, recusa
 * instrução acima do teto. Cancelamento/timeout/exit≠0 lançam; o timeout carrega o
 * marcador canônico `[runner_timeout]` (o executor preserva o candidato). Exit 0 só
 * significa "o turno terminou" — o veredito é dos gates do host.
 */
export async function runNativeCliTurn(input: NativeCliTurnInput): Promise<NativeCliTurnOutput> {
  const { label, request, signal } = input;
  const rootPath = input.rootPath;
  if (typeof rootPath !== 'string' || rootPath.length === 0) {
    throw new Error(`O ${label} exige uma worktree local enraizada (workspace.rootPath ausente).`);
  }
  if (signal.aborted) throw new Error(`${label} não iniciado: tentativa cancelada.`);

  const deadlineAtMs = request.deadlineAtMs ?? Date.now() + (request.maxDurationMs ?? 30 * 60_000);
  const timeoutMs = deadlineAtMs - Date.now();
  if (!(timeoutMs > 0)) throw new Error(`[runner_timeout] ${label} não iniciado: deadline global da tentativa esgotado.`);

  const prompt = buildNativeCliPrompt(request);
  if (prompt.length > NATIVE_CLI_PROMPT_MAX_CHARS) {
    throw new Error(`Instrução do ${label} excede ${NATIVE_CLI_PROMPT_MAX_CHARS} caracteres (${prompt.length}); não iniciado.`);
  }

  const result = await (input.run ?? runProcess)(input.executable, input.buildArgs(rootPath, prompt), {
    cwd: rootPath,
    timeoutMs,
    signal,
    env: input.env as NodeJS.ProcessEnv,
  });

  const seconds = Math.round(result.durationMs / 1000);
  if (result.cancelled || signal.aborted) throw new Error(`${label} cancelado pelo host após ${seconds}s.`);
  if (result.timedOut) throw new Error(`[runner_timeout] ${label} encerrado pelo deadline global após ${seconds}s.`);
  if (result.exitCode !== 0) {
    const diagnostic = sanitizeNativeCliDiagnostic(result, rootPath);
    throw new Error(`${label} terminou com exit ${result.exitCode}${diagnostic ? `: ${diagnostic}` : ''}`);
  }
  return { result, rootPath, seconds };
}
