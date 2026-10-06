import type { NativeCliFailureV1 } from '@anima/core';
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

// ------------------------------------------------------------
// AI-MEMORY WRAP V1 (opt-in, default DESLIGADO). Reuse do `ai-memory run` (2.4.1) SÓ para
// continuidade cross-harness (Claude ↔ Codex) NA MESMA worktree: o ai-memory vira o processo
// pai do harness nativo, injeta o resume/seleção de sessão nativa e entrega o delta não visto
// via hooks. O ANIMA não importa o ledger: no máximo registra REFERÊNCIAS em `notes`.
// O servidor (`ai-memory serve`) é pré-condição operacional externa; inacessível ⇒ fail-closed.
// ------------------------------------------------------------

/** Escopo fixo do ANIMA no ai-memory (evita a estratégia `basename` partir a memória). */
export const AI_MEMORY_WORKSPACE = 'anima';
export const AI_MEMORY_PROJECT = 'anima';

export type AiMemoryHarness = 'claude' | 'codex';

export interface AiMemoryWrapConfig {
  /** Executável nativo do `ai-memory` (não wrapper de shell). */
  readonly executable: string;
  /** URL HTTP loopback do `ai-memory serve` (sem credencial). */
  readonly serverUrl: string;
  /** Data dir do ai-memory (`AI_MEMORY_DATA_DIR`). */
  readonly dataDir: string;
  /** `new` ⇒ `--new <name>` (cria; nome existente = 409); `continue` ⇒ `--workstream <name>`. */
  readonly workstream: { readonly mode: 'new' | 'continue'; readonly name: string };
  /** Settings JSON com os hooks do ai-memory para o Claude Code (`--settings`); obrigatório no wrap do Claude. */
  readonly claudeSettingsFile?: string;
}

export type AiMemoryWrapConfigResult =
  | { readonly ok: true; readonly value: AiMemoryWrapConfig | null }
  | { readonly ok: false; readonly error: string };

const WORKSTREAM_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LOOPBACK_HTTP = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}\/?$/i;

/**
 * Config opt-in por env de DEPLOY/operador. `ANIMA_AI_MEMORY_PATH` ausente ⇒ wrap DESLIGADO
 * (`value: null`) e os backends se comportam exatamente como sem ai-memory. Presente ⇒ todos
 * os demais campos obrigatórios são validados e qualquer lacuna falha fechado (nunca liga
 * pela metade): `ANIMA_AI_MEMORY_SERVER_URL` (HTTP loopback), `ANIMA_AI_MEMORY_DATA_DIR`,
 * `ANIMA_AI_MEMORY_WORKSTREAM` (nome), `ANIMA_AI_MEMORY_WORKSTREAM_MODE` (`new`|`continue`),
 * `ANIMA_AI_MEMORY_CLAUDE_SETTINGS` (opcional aqui; o backend Claude o exige).
 */
export function resolveAiMemoryWrapConfig(env: Record<string, string | undefined> = process.env): AiMemoryWrapConfigResult {
  const executable = env.ANIMA_AI_MEMORY_PATH?.trim();
  if (!executable) return { ok: true, value: null };
  if (isShellWrapperPath(executable)) return { ok: false, error: 'ANIMA_AI_MEMORY_PATH aponta para um wrapper de shell (.cmd/.bat/.ps1); configure o executável nativo do ai-memory.' };
  const serverUrl = env.ANIMA_AI_MEMORY_SERVER_URL?.trim() ?? '';
  if (!LOOPBACK_HTTP.test(serverUrl)) return { ok: false, error: 'ANIMA_AI_MEMORY_SERVER_URL precisa ser uma URL HTTP loopback (http://127.0.0.1:<porta>).' };
  const dataDir = env.ANIMA_AI_MEMORY_DATA_DIR?.trim();
  if (!dataDir) return { ok: false, error: 'ANIMA_AI_MEMORY_DATA_DIR é obrigatório quando o ai-memory está habilitado.' };
  const name = env.ANIMA_AI_MEMORY_WORKSTREAM?.trim() ?? '';
  if (!WORKSTREAM_NAME.test(name)) return { ok: false, error: 'ANIMA_AI_MEMORY_WORKSTREAM ausente ou inválido (letras, dígitos, . _ -; até 64).' };
  const mode = env.ANIMA_AI_MEMORY_WORKSTREAM_MODE?.trim();
  if (mode !== 'new' && mode !== 'continue') return { ok: false, error: 'ANIMA_AI_MEMORY_WORKSTREAM_MODE precisa ser "new" ou "continue".' };
  const claudeSettingsFile = env.ANIMA_AI_MEMORY_CLAUDE_SETTINGS?.trim();
  return { ok: true, value: { executable, serverUrl: serverUrl.replace(/\/$/, ''), dataDir, workstream: { mode, name }, ...(claudeSettingsFile ? { claudeSettingsFile } : {}) } };
}

/**
 * `ai-memory run` com as flags do wrapper ANTES do harness e os args nativos encaminhados
 * byte a byte depois dele. `--no-autowire`: nunca toca config global dos harnesses.
 */
export function buildAiMemoryRunArgs(
  config: AiMemoryWrapConfig,
  harness: AiMemoryHarness,
  nativeExecutable: string,
  nativeArgs: readonly string[],
): readonly string[] {
  return [
    'run',
    '--no-autowire',
    '--workspace', AI_MEMORY_WORKSPACE,
    '--project', AI_MEMORY_PROJECT,
    config.workstream.mode === 'new' ? '--new' : '--workstream', config.workstream.name,
    '--executable', nativeExecutable,
    harness,
    ...nativeArgs,
  ];
}

/** Sonda de disponibilidade do servidor (injetável em teste). */
export type AiMemoryServerProbe = (serverUrl: string, signal: AbortSignal) => Promise<boolean>;

const AI_MEMORY_PROBE_TIMEOUT_MS = 3_000;

/** `GET /healthz` do `ai-memory serve` (2.4.1), com teto curto; qualquer falha ⇒ indisponível. */
export const probeAiMemoryServer: AiMemoryServerProbe = async (serverUrl, signal) => {
  try {
    const response = await fetch(`${serverUrl}/healthz`, { signal: AbortSignal.any([signal, AbortSignal.timeout(AI_MEMORY_PROBE_TIMEOUT_MS)]) });
    return response.ok;
  } catch { return false; }
};

const ANSI = /\x1b\[[0-9;]*m/g;
const SAFE_REF = /^[A-Za-z0-9._:+-]{1,80}$/;

/**
 * Referências (nunca conteúdo) do turno wrapped: workstream configurado, modo e harness, mais
 * a versão e a contagem de eventos que o próprio `ai-memory run` já imprime no stderr. Sem
 * scraping de ledger; tokens fora do padrão seguro são descartados.
 */
export function aiMemoryTurnNotes(config: AiMemoryWrapConfig, harness: AiMemoryHarness, stderr: string): readonly string[] {
  const text = stderr.replace(ANSI, '');
  const version = /ai-memory starting version="([^"]+)"/.exec(text)?.[1];
  const saved = new RegExp(`workstream '${config.workstream.name.replace(/[.]/g, '\\.')}' saved (\\d+) new event`).exec(text)?.[1];
  return [
    `ai-memory:workstream:${config.workstream.name}`,
    `ai-memory:mode:${config.workstream.mode}`,
    `ai-memory:harness:${harness}`,
    ...(version && SAFE_REF.test(version) ? [`ai-memory:version:${version}`] : []),
    ...(saved ? [`ai-memory:saved-events:${saved}`] : []),
  ];
}

export class NativeCliFailureError extends Error {
  constructor(message: string, readonly nativeCliFailure: NativeCliFailureV1) {
    super(message);
    this.name = 'NativeCliFailureError';
  }
}

export type NativeCliFailureClassifier = (stdout: string, exitCode: number) => NativeCliFailureV1;

export interface NativeCliTurnInput {
  readonly classifyFailure?: NativeCliFailureClassifier;
  /** Nome humano nas mensagens (ex.: "Codex CLI"). */
  readonly label: string;
  readonly executable: string;
  readonly buildArgs: (rootPath: string, prompt: string) => readonly string[];
  readonly env: Record<string, string>;
  readonly run?: NativeCliProcessRunner;
  readonly request: CoderEditRequest;
  readonly rootPath: string | undefined;
  readonly signal: AbortSignal;
  /** Wrap opt-in pelo `ai-memory run`; ausente ⇒ lançamento direto, como sempre. */
  readonly aiMemory?: {
    readonly config: AiMemoryWrapConfig;
    readonly harness: AiMemoryHarness;
    readonly probe?: AiMemoryServerProbe;
  };
}

export interface NativeCliTurnOutput {
  readonly result: CommandResult;
  readonly rootPath: string;
  readonly seconds: number;
  /** Referências do ai-memory quando wrapped; vazio sem wrap. */
  readonly aiMemoryNotes: readonly string[];
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

  const nativeArgs = input.buildArgs(rootPath, prompt);
  const wrap = input.aiMemory;
  if (wrap && !(await (wrap.probe ?? probeAiMemoryServer)(wrap.config.serverUrl, signal))) {
    // Pré-condição externa: sem servidor não há continuidade gerenciada; nunca cai em lançamento direto.
    throw new Error(`${label} não iniciado: servidor ai-memory inacessível (fail-closed).`);
  }
  if (signal.aborted) throw new Error(`${label} não iniciado: tentativa cancelada.`);
  // O probe é um await: o restante é RECALCULADO do mesmo deadline absoluto antes do spawn.
  // Vencido durante o probe ⇒ mesmo `[runner_timeout]` de antes, sem lançar ai-memory/harness.
  const launchTimeoutMs = wrap ? deadlineAtMs - Date.now() : timeoutMs;
  if (!(launchTimeoutMs > 0)) throw new Error(`[runner_timeout] ${label} não iniciado: deadline global da tentativa esgotado.`);
  // Wrapped: o ai-memory é o processo PAI (mesmo cwd, mesmo env filtrado + só o necessário
  // para achar o servidor/data dir); o harness nativo vira `--executable`. O encerramento por
  // deadline/cancelamento derruba a ÁRVORE (taskkill /T no Windows), incluindo o harness.
  const executable = wrap ? wrap.config.executable : input.executable;
  const args = wrap ? buildAiMemoryRunArgs(wrap.config, wrap.harness, input.executable, nativeArgs) : nativeArgs;
  const env = wrap
    ? { ...input.env, AI_MEMORY_SERVER_URL: wrap.config.serverUrl, AI_MEMORY_DATA_DIR: wrap.config.dataDir }
    : input.env;

  const result = await (input.run ?? runProcess)(executable, args, {
    cwd: rootPath,
    timeoutMs: launchTimeoutMs,
    signal,
    env: env as NodeJS.ProcessEnv,
  });

  const seconds = Math.round(result.durationMs / 1000);
  if (result.cancelled || signal.aborted) throw new Error(`${label} cancelado pelo host após ${seconds}s.`);
  if (result.timedOut) throw new Error(`[runner_timeout] ${label} encerrado pelo deadline global após ${seconds}s.`);
  if (result.exitCode !== 0) {
    if (input.classifyFailure && !wrap) {
      const failure = input.classifyFailure(result.stdout, result.exitCode);
      const prefix = `${label} terminou com exit ${result.exitCode}`;
      if (failure.category !== 'unknown_native_cli_failure') {
        throw new NativeCliFailureError(`${prefix} [${failure.category}].`, failure);
      }
      const diagnostic = sanitizeNativeCliDiagnostic({ stdout: '', stderr: result.stderr }, rootPath);
      throw new NativeCliFailureError(`${prefix}${diagnostic ? `: ${diagnostic}` : ''}`, failure);
    }
    const diagnostic = sanitizeNativeCliDiagnostic(result, rootPath);
    throw new Error(`${label}${wrap ? ' (via ai-memory)' : ''} terminou com exit ${result.exitCode}${diagnostic ? `: ${diagnostic}` : ''}`);
  }
  return { result, rootPath, seconds, aiMemoryNotes: wrap ? aiMemoryTurnNotes(wrap.config, wrap.harness, result.stderr) : [] };
}
