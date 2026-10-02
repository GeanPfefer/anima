import { coderBackendId, type CoderBackend, type CoderEditRequest, type CoderEditResult, type CoderWorkspace } from './coder-backend';
import {
  NATIVE_CLI_DEFAULT_MODEL,
  buildAllowlistedEnvironment,
  buildNativeCliPrompt,
  isShellWrapperPath,
  runNativeCliTurn,
  type NativeCliProcessRunner,
} from './native-cli-coder';

// ============================================================
// Akita Baseline V1 — segundo executor nativo: Claude Code por trás de CoderBackend.
//
// Mesma filosofia do Codex CLI: `claude -p` roda o PRÓPRIO harness (READ/SEARCH/EDIT/
// EXEC, contexto, tool calls) na worktree isolada e devolve o controle. O ANIMA só monta
// a instrução canônica (`renderCoderTaskSection` + regras operacionais), lança sem shell
// com cwd = worktree e ambiente por allowlist, espera exit/deadline/cancelamento e
// sanitiza o diagnóstico. Git observado, escopo, gates, handoff e Verifier são do host.
//
// Contenção (flags verificadas no `claude --help` 2.1.286): `--restricted` (file tools
// confinadas aos diretórios de trabalho, settings de user/project/local ignorados,
// bypassPermissions recusado, escrita em settings/git/config só por pessoa ou handler),
// `--tools` limitando o conjunto a Read/Edit/Write/Glob/Grep/Bash, `--permission-mode
// acceptEdits` (edições no cwd sem prompt) e `--permission-prompts none` (qualquer coisa
// que pediria aprovação é negada — não há pessoa no `-p`). Bash só para os comandos
// allowlisted de validação/inspeção. No Windows nativo NÃO há sandbox de SO como no
// Linux/WSL: a contenção forte continua sendo worktree descartável + git do host.
//
// O único dado lido da saída é o envelope final `--output-format json` (`is_error`,
// `subtype`, `num_turns`, modelos usados): exit 0 com `is_error` é falha fechada. Não é
// protocolo de transcript; tool calls não são interpretadas.
// ============================================================

/** Modelo "sem `--model`": o Claude Code usa o modelo do próprio config do operador. */
export const CLAUDE_CODE_DEFAULT_MODEL = NATIVE_CLI_DEFAULT_MODEL;

/** Ferramentas nativas disponíveis no turno (`--tools`). Sem web, sem MCP, sem agentes. */
export const CLAUDE_CODE_TOOLS = 'Read,Edit,Write,Glob,Grep,Bash';

/**
 * Comandos Bash permitidos sem prompt (`--allowedTools`): validação e inspeção git
 * read-only. Todo o resto que pediria aprovação é negado por `--permission-prompts none`
 * (sem commit/push/rede). Edições no cwd vêm de `acceptEdits`.
 */
export const CLAUDE_CODE_ALLOWED_TOOLS: readonly string[] = [
  'Bash(npm test:*)',
  'Bash(npm run typecheck:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
];

/**
 * Além da base comum: `CLAUDE_CONFIG_DIR` (onde mora o login da assinatura feito pelo
 * operador) e `CLAUDE_CODE_GIT_BASH_PATH` (shell do Bash tool no Windows). Deliberadamente
 * FORA: `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` (cobrariam API em vez da assinatura),
 * `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_OAUTH_TOKEN`, as variáveis `CLAUDE_CODE_*`/`CLAUDECODE`
 * de uma sessão hospedeira (tokens de mensageria, ids de sessão), Supabase, RunPod e
 * segredos do ANIMA.
 */
const CLAUDE_ENV_EXTRA: readonly string[] = ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_GIT_BASH_PATH'];

/** Ambiente mínimo do filho por allowlist; o autoupdater fica desligado durante o turno. */
export function buildClaudeCodeEnvironment(source: Record<string, string | undefined> = process.env): Record<string, string> {
  return buildAllowlistedEnvironment(CLAUDE_ENV_EXTRA, source, { DISABLE_AUTOUPDATER: '1' });
}

export interface ClaudeCodeConfig {
  /** Executável NATIVO do Claude Code (caminho absoluto ou nome resolvido pelo PATH). */
  readonly executable: string;
  /** Modelo explícito (`--model`); `CLAUDE_CODE_DEFAULT_MODEL` ⇒ sem `--model`. */
  readonly model: string;
}

export type ClaudeCodeConfigResult =
  | { readonly ok: true; readonly value: ClaudeCodeConfig }
  | { readonly ok: false; readonly error: string };

/**
 * Config do operador por env de DEPLOY: `ANIMA_CLAUDE_CODE_PATH` (default `claude`, via
 * PATH). O modelo vem do contrato (fonte única), com fallback para
 * `ANIMA_CLAUDE_CODE_MODEL` e por fim `default`. Wrappers `.cmd/.bat/.ps1` recusados.
 */
export function resolveClaudeCodeConfig(
  contractModel: string | null,
  env: Record<string, string | undefined> = process.env,
): ClaudeCodeConfigResult {
  const executable = env.ANIMA_CLAUDE_CODE_PATH?.trim() || 'claude';
  if (isShellWrapperPath(executable)) {
    return { ok: false, error: 'ANIMA_CLAUDE_CODE_PATH aponta para um wrapper de shell (.cmd/.bat/.ps1); configure o executável nativo do Claude Code.' };
  }
  const model = contractModel?.trim() || env.ANIMA_CLAUDE_CODE_MODEL?.trim() || CLAUDE_CODE_DEFAULT_MODEL;
  return { ok: true, value: { executable, model } };
}

/**
 * Argumentos de `claude -p` (sem shell, sem interpolação). O cwd do processo é a
 * worktree (o Claude Code não tem flag de cwd). As opções variádicas (`--tools`,
 * `--allowedTools`) vêm ANTES de opções de valor único, para nunca engolirem a
 * instrução, que é o último argumento.
 */
export function buildClaudeCodeArgs(config: ClaudeCodeConfig, prompt: string): readonly string[] {
  return [
    '-p',
    '--output-format', 'json',
    '--no-session-persistence',
    '--restricted',
    '--tools', CLAUDE_CODE_TOOLS,
    '--allowedTools', CLAUDE_CODE_ALLOWED_TOOLS.join(','),
    '--permission-mode', 'acceptEdits',
    '--permission-prompts', 'none',
    ...(config.model !== CLAUDE_CODE_DEFAULT_MODEL ? ['--model', config.model] : []),
    prompt,
  ];
}

/** Instrução determinística (comum aos executores nativos). */
export const buildClaudeCodePrompt = (request: CoderEditRequest): string => buildNativeCliPrompt(request);

/** Envelope final do `--output-format json`; só os campos de desfecho são lidos. */
interface ClaudeCodeResultEnvelope {
  readonly is_error?: unknown;
  readonly subtype?: unknown;
  readonly num_turns?: unknown;
  readonly modelUsage?: unknown;
}

const parseEnvelope = (stdout: string): ClaudeCodeResultEnvelope | null => {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ClaudeCodeResultEnvelope : null;
  } catch { return null; }
};

const SAFE_TOKEN = /^[A-Za-z0-9._:\[\]-]{1,80}$/;

export interface ClaudeCodeCoderOptions {
  readonly config: ClaudeCodeConfig;
  /** Default: `runProcess` (spawn sem shell). */
  readonly run?: NativeCliProcessRunner;
  /** Fonte do ambiente filtrado; default `process.env`. */
  readonly environmentSource?: Record<string, string | undefined>;
}

export class ClaudeCodeCoderBackend implements CoderBackend {
  readonly id: string;
  readonly observation: NonNullable<CoderBackend['observation']>;
  private readonly config: ClaudeCodeConfig;
  private readonly run: NativeCliProcessRunner | undefined;
  private readonly environmentSource: Record<string, string | undefined>;

  constructor(options: ClaudeCodeCoderOptions) {
    this.config = options.config;
    this.id = coderBackendId('claude-code', options.config.model);
    // Inferência é do provider do Claude Code (remota); worktree e efeitos continuam locais.
    this.observation = { placement: 'remote', nodeId: null, model: options.config.model };
    this.run = options.run;
    this.environmentSource = options.environmentSource ?? process.env;
  }

  async edit(request: CoderEditRequest, workspace: CoderWorkspace, signal: AbortSignal): Promise<CoderEditResult> {
    const { result, seconds } = await runNativeCliTurn({
      label: 'Claude Code',
      executable: this.config.executable,
      buildArgs: (_rootPath, prompt) => buildClaudeCodeArgs(this.config, prompt),
      env: buildClaudeCodeEnvironment(this.environmentSource),
      ...(this.run ? { run: this.run } : {}),
      request,
      rootPath: workspace.rootPath,
      signal,
    });

    const envelope = parseEnvelope(result.stdout);
    const subtype = typeof envelope?.subtype === 'string' && SAFE_TOKEN.test(envelope.subtype) ? envelope.subtype : null;
    // Exit 0 com erro declarado pelo próprio Claude Code (ex.: auth, limite de turnos) é
    // falha fechada; sucesso continua sendo decisão dos gates do host.
    if (envelope?.is_error === true || (subtype !== null && subtype !== 'success')) {
      throw new Error(`Claude Code encerrou o turno em erro (subtype=${subtype ?? 'desconhecido'}) após ${seconds}s.`);
    }
    const models = envelope?.modelUsage && typeof envelope.modelUsage === 'object' && !Array.isArray(envelope.modelUsage)
      ? Object.keys(envelope.modelUsage).filter(name => SAFE_TOKEN.test(name))
      : [];
    const turns = typeof envelope?.num_turns === 'number' && Number.isInteger(envelope.num_turns) ? envelope.num_turns : null;

    return {
      // Flui para o sinal `result` persistido: sem caminho absoluto, sem saída do modelo.
      summary: `Claude Code (${this.id}) encerrou o turno com exit 0 em ${seconds}s; a validação é dos gates do host.`,
      // O host observa o escopo real via git; o adaptador não atesta arquivos.
      touchedResources: [],
      notes: [
        'turn-outcome:exited-0',
        `duration-s:${seconds}`,
        envelope ? `result-subtype:${subtype ?? 'ausente'}` : 'result-envelope:unparsed',
        ...(turns !== null ? [`num-turns:${turns}`] : []),
        ...models.map(name => `model:${name}`),
      ],
    };
  }
}
