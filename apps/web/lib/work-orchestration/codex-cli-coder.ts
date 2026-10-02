import { coderBackendId, renderCoderTaskSection, type CoderBackend, type CoderEditRequest, type CoderEditResult, type CoderWorkspace } from './coder-backend';
import { summarizeCommandOutput } from './output-sanitization';
import { runProcess, type CommandResult } from './worktree';

// ============================================================
// Akita Baseline V1 — primeiro executor externo: Codex CLI por trás de CoderBackend.
//
// O ANIMA NÃO roda laço agêntico aqui. `codex exec` usa o PRÓPRIO harness nativo
// (READ/SEARCH/EDIT/EXEC, contexto, tool calls) dentro da worktree isolada e devolve
// o controle. Este adaptador só: monta a instrução determinística (a MESMA seção
// canônica `renderCoderTaskSection` dos demais backends), lança o processo sem shell
// com cwd = worktree e ambiente mínimo, espera exit/deadline/cancelamento e sanitiza
// o diagnóstico.
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
export const CODEX_CLI_DEFAULT_MODEL = 'default';

/**
 * Teto da instrução passada como ARGUMENTO. No Windows a linha de comando inteira é
 * limitada a 32 767 caracteres (com escape de aspas); acima disso o spawn falharia de
 * forma opaca. Excedeu ⇒ falha fechada ANTES de spawnar (stdin fica para quando houver
 * necessidade concreta).
 */
export const CODEX_CLI_PROMPT_MAX_CHARS = 24_000;

const DIAGNOSTIC_MAX_CHARS = 600;
const DIAGNOSTIC_MAX_LINES = 8;

/**
 * Variáveis herdadas pelo Codex (allowlist, case-insensitive). Só o necessário para o
 * processo existir (sistema/PATH/temp), achar a autenticação JÁ configurada pelo
 * operador (perfil do usuário + `CODEX_HOME`) e alcançar a rede via proxy/certificados
 * corporativos quando houver. Deliberadamente FORA: `OPENAI_API_KEY` (faria o Codex
 * cobrar por API em vez da assinatura), Supabase, chaves do ANIMA e qualquer outro
 * segredo da aplicação.
 */
const CODEX_ENV_ALLOWLIST: readonly string[] = [
  // Sistema / processo
  'PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'OS',
  'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS',
  'TEMP', 'TMP', 'TMPDIR',
  // Perfil do usuário (onde mora a autenticação do Codex)
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'USERNAME', 'USER', 'LOGNAME',
  'CODEX_HOME',
  // Locale
  'LANG', 'LC_ALL', 'LC_CTYPE',
  // Rede do operador (proxy/CA), sem credencial própria do ANIMA
  'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
];

/** Ambiente mínimo do processo filho, montado por allowlist (nunca `...process.env`). */
export function buildCodexCliEnvironment(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const allowed = new Set(CODEX_ENV_ALLOWLIST.map(name => name.toLowerCase()));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.length > 0 && allowed.has(name.toLowerCase())) env[name] = value;
  }
  // Saída sem cores: o diagnóstico sanitizado não precisa de sequências ANSI.
  env.NO_COLOR = '1';
  return env;
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
  if (/\.(?:cmd|bat|ps1)$/i.test(executable)) {
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
 */
export function buildCodexExecArgs(config: CodexCliConfig, rootPath: string, prompt: string): readonly string[] {
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

const list = (paths: readonly string[]): string => paths.length > 0 ? paths.map(path => `- ${path}`).join('\n') : '- (nenhum)';

/**
 * Instrução determinística: a seção canônica da especificação aprovada (idêntica à de
 * Ollama/OpenAI/DSH) + somente as regras operacionais deste executor. Sem `taskSpec`
 * (chamada direta sem Work Item), cai no objetivo — nada é inventado.
 */
export function buildCodexCliPrompt(request: CoderEditRequest): string {
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
export type CodexCliProcessRunner = (
  file: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs: number; readonly signal?: AbortSignal; readonly env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

export interface CodexCliCoderOptions {
  readonly config: CodexCliConfig;
  /** Default: `runProcess` (spawn sem shell). */
  readonly run?: CodexCliProcessRunner;
  /** Fonte do ambiente filtrado; default `process.env`. */
  readonly environmentSource?: Record<string, string | undefined>;
}

const sanitizeDiagnostic = (result: CommandResult, rootPath: string): string | undefined =>
  summarizeCommandOutput(
    result.stdout.split(rootPath).join('<worktree>'),
    result.stderr.split(rootPath).join('<worktree>'),
    { maxChars: DIAGNOSTIC_MAX_CHARS, maxLines: DIAGNOSTIC_MAX_LINES, dropFooters: false, redactPaths: true },
  );

export class CodexCliCoderBackend implements CoderBackend {
  readonly id: string;
  readonly observation: NonNullable<CoderBackend['observation']>;
  private readonly config: CodexCliConfig;
  private readonly run: CodexCliProcessRunner;
  private readonly environmentSource: Record<string, string | undefined>;

  constructor(options: CodexCliCoderOptions) {
    this.config = options.config;
    this.id = coderBackendId('codex-cli', options.config.model);
    // Inferência é do provider do Codex (remota); worktree e efeitos continuam locais.
    this.observation = { placement: 'remote', nodeId: null, model: options.config.model };
    this.run = options.run ?? runProcess;
    this.environmentSource = options.environmentSource ?? process.env;
  }

  async edit(request: CoderEditRequest, workspace: CoderWorkspace, signal: AbortSignal): Promise<CoderEditResult> {
    // Backend ENRAIZADO: sem a worktree real, falha fechado — nunca roda no checkout principal.
    const rootPath = workspace.rootPath;
    if (typeof rootPath !== 'string' || rootPath.length === 0) {
      throw new Error('O Codex CLI exige uma worktree local enraizada (workspace.rootPath ausente).');
    }
    if (signal.aborted) throw new Error('Codex CLI não iniciado: tentativa cancelada.');

    const deadlineAtMs = request.deadlineAtMs ?? Date.now() + (request.maxDurationMs ?? 30 * 60_000);
    const timeoutMs = deadlineAtMs - Date.now();
    if (!(timeoutMs > 0)) throw new Error('[runner_timeout] Codex CLI não iniciado: deadline global da tentativa esgotado.');

    const prompt = buildCodexCliPrompt(request);
    if (prompt.length > CODEX_CLI_PROMPT_MAX_CHARS) {
      throw new Error(`Instrução do Codex CLI excede ${CODEX_CLI_PROMPT_MAX_CHARS} caracteres (${prompt.length}); não iniciado.`);
    }

    const result = await this.run(this.config.executable, buildCodexExecArgs(this.config, rootPath, prompt), {
      cwd: rootPath,
      timeoutMs,
      signal,
      env: buildCodexCliEnvironment(this.environmentSource) as NodeJS.ProcessEnv,
    });

    const seconds = Math.round(result.durationMs / 1000);
    if (result.cancelled || signal.aborted) throw new Error(`Codex CLI cancelado pelo host após ${seconds}s.`);
    // Deadline: marcador de timeout do coder ⇒ o host preserva o candidato e encerra.
    if (result.timedOut) throw new Error(`[runner_timeout] Codex CLI encerrado pelo deadline global após ${seconds}s.`);
    if (result.exitCode !== 0) {
      const diagnostic = sanitizeDiagnostic(result, rootPath);
      throw new Error(`Codex CLI terminou com exit ${result.exitCode}${diagnostic ? `: ${diagnostic}` : ''}`);
    }

    return {
      // Flui para o sinal `result` persistido: sem caminho absoluto, sem saída do modelo.
      summary: `Codex CLI (${this.id}) encerrou o turno com exit 0 em ${seconds}s; a validação é dos gates do host.`,
      // O host observa o escopo real via git; o adaptador não atesta arquivos.
      touchedResources: [],
      notes: ['turn-outcome:exited-0', `duration-s:${seconds}`],
    };
  }
}
