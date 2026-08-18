import { zstdDecompressSync } from 'node:zlib';
import type { HarnessTurnEnd } from '@anima/core';
import type {
  HarnessRunTurnInput,
  HarnessRunTurnResult,
  HarnessRuntime,
} from '../deepseek-harness-coder';
import { HARNESS_FOCUSED_DISABLED_PLUGINS, planHarnessInvocation, type HarnessInvocationInput } from './harness-invocation';

// ============================================================
// Driver REAL do `HarnessRuntime` (ligação viva, recorte experimental — ver
// docs/arquitetura/deepseek-harness-coder-backend.md). Roda o DeepSeek Harness
// como PROCESSO FILHO confinado no worktree, pelo contrato público VERIFICADO do
// CLI `dsh` (não importa módulo TS do dsh — só o spawna), então tipa e testa com
// I/O injetado (spawner + fs + descompressor fakes), sem dsh nem Ollama no teste.
//
// O host permanece autoridade: o cwd É o worktree (sandbox workspace-write), a
// rede fica off (envelope do planejador), o cancelamento mata o filho, e o
// desfecho do TURNO é EVIDÊNCIA — nunca veredito. Sucesso é decidido pelos gates
// do host, jamais pelo `turn/end` do Harness (`completed` ⇒ `completed-unverified`
// na classificação do core).
// ============================================================

/** Resultado bruto de um processo filho, do ponto de vista do host. */
export interface HarnessProcessResult {
  readonly exitCode: number | null;
  /** true quando o host abortou (matou) o filho — cancelamento do host. */
  readonly hostAborted: boolean;
}

/** Spawner injetável: roda um processo até terminar, matando-o se `signal` abortar. */
export interface HarnessSpawner {
  run(input: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  }): Promise<HarnessProcessResult>;
}

/** Superfície de arquivos injetável (para o patch, o $DSH_HOME e o log de sessão). */
export interface HarnessFileSystem {
  mkdirp(dir: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  /** Diretórios de sessão sob `$DSH_HOME/sessions/<cwd-sanitizado>/`, mais novos primeiro. */
  listSessionDirs(dshHome: string, cwd: string): Promise<readonly string[]>;
  /** Lê o `session.jsonl.zstd` de um diretório de sessão, ou null se ausente. */
  readSessionLog(sessionDir: string): Promise<Buffer | null>;
}

export interface DeepSeekHarnessRuntimeOptions {
  /** Caminho absoluto do executável node que roda o `dsh`. */
  readonly nodeExecPath: string;
  /** Caminho absoluto do binário `dsh` (node_modules/@deepseek-ai/dsh/lib/bin.js). */
  readonly dshBinPath: string;
  /** Caminho absoluto do plugin cordis versionado (`anima-harness-plugin.mjs`). */
  readonly pluginPath: string;
  /** Endpoint OpenAI-compat do Ollama (ex.: http://127.0.0.1:11434/v1). */
  readonly ollamaBaseUrl: string;
  /** Modelo Ollama (ex.: qwen3-coder:latest). */
  readonly model: string;
  /** Fábrica de um `$DSH_HOME` isolado por execução (diretório absoluto). */
  readonly dshHomeFactory: () => string;
  readonly spawner: HarnessSpawner;
  readonly fs: HarnessFileSystem;
  /** Injeção para teste; por padrão o zstd nativo do Node. */
  readonly decompress?: (buf: Buffer) => Buffer;
  /** Plugins de ferramenta distratores a desabilitar (catálogo focado); default
   * `HARNESS_FOCUSED_DISABLED_PLUGINS` — a correção com prova viva do tool-protocol. */
  readonly disabledToolPlugins?: readonly string[];
}

/**
 * Compõe o texto da tarefa one-shot do headless a partir do contrato do coder.
 * O escopo permitido/excluído e — no retry — a evidência OBSERVADA do host entram
 * como texto (o headless recebe uma única string). PURA e testável.
 */
export function composeHarnessTask(input: HarnessRunTurnInput): string {
  const parts: string[] = [
    input.objective.trim(),
    '',
    `Working directory is the repository root. Only edit files within this allowed scope:`,
    ...input.includedScope.map(path => `  - ${path}`),
  ];
  if (input.excludedScope.length > 0) {
    parts.push(`Do NOT modify these paths:`, ...input.excludedScope.map(path => `  - ${path}`));
  }
  const carried = input.carriedContext;
  if (carried) {
    parts.push(
      '',
      'This is a retry after the host observed a gate failure. Use the host-observed evidence below; do NOT claim tests pass — the host re-runs the gates and decides.',
      `Next step: ${carried.nextStep}`,
    );
    if (carried.previousFailures.length > 0) parts.push('Previous failures:', ...carried.previousFailures.map(f => `  - ${f}`));
    if (carried.remainingSteps.length > 0) parts.push('Remaining steps:', ...carried.remainingSteps.map(s => `  - ${s}`));
  }
  parts.push('', 'Make the change, then stop.');
  return parts.join('\n');
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Mapeia o `reason` de um evento `turn/end` do log de sessão para o `HarnessTurnEnd`
 * do core. `completed` continua NÃO sendo sucesso (o core classifica como
 * `completed-unverified`). `aborted` preserva a causa aninhada (`reason.kind`/
 * `reason.reason`) — é assim que o cancelamento do step budget (`{kind:'hook',
 * reason:'step-budget-exhausted:N'}`) fica observável. Kinds não-terminais
 * conhecidos (blocked/max-tokens/interrupted) e desconhecidos caem em `error`
 * (fail-closed: nunca vira `completed` por engano).
 */
export function mapTurnEndReason(reason: unknown): HarnessTurnEnd | null {
  const root = asRecord(reason);
  if (!root || typeof root.kind !== 'string') return null;
  if (root.kind === 'completed') return { kind: 'completed' };
  if (root.kind === 'aborted') {
    const cause = asRecord(root.reason);
    return {
      kind: 'aborted',
      reasonKind: cause && typeof cause.kind === 'string' ? cause.kind : null,
      reasonReason: cause && typeof cause.reason === 'string' ? cause.reason : null,
    };
  }
  return { kind: 'error' };
}

/** Extrai o ÚLTIMO `turn/end` de um log JSONL descompactado (envelope plano
 * `{type, ...}`). `null` quando não há `turn/end` (ex.: saída suja não deu flush). */
export function extractTurnEndFromLog(jsonl: string): HarnessTurnEnd | null {
  let found: HarnessTurnEnd | null = null;
  for (const line of jsonl.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: unknown;
    try { event = JSON.parse(trimmed); } catch { continue; }
    const record = asRecord(event);
    if (!record || record.type !== 'turn/end') continue;
    const mapped = mapTurnEndReason(record.reason);
    if (mapped) found = mapped;
  }
  return found;
}

/** Desfecho do turno a partir dos SINAIS DE PROCESSO (autoridade quando o log não
 * deu flush): host matou ⇒ aborted; saída 0 ⇒ completed; qualquer outra ⇒ error. */
export function deriveTurnEndFromProcess(result: HarnessProcessResult): HarnessTurnEnd {
  if (result.hostAborted) return { kind: 'aborted', reasonKind: 'signal', reasonReason: 'host-cancelled' };
  if (result.exitCode === 0) return { kind: 'completed' };
  return { kind: 'error' };
}

export class DeepSeekHarnessRuntime implements HarnessRuntime {
  private readonly decompress: (buf: Buffer) => Buffer;
  constructor(private readonly options: DeepSeekHarnessRuntimeOptions) {
    this.decompress = options.decompress ?? (buf => zstdDecompressSync(buf));
  }

  async runTurn(input: HarnessRunTurnInput): Promise<HarnessRunTurnResult> {
    const dshHome = this.options.dshHomeFactory();
    const patchPath = joinPath(dshHome, 'anima-harness-patch.yml');
    const invocation: HarnessInvocationInput = {
      worktreeRoot: input.rootPath,
      dshHome,
      patchPath,
      pluginPath: this.options.pluginPath,
      objective: composeHarnessTask(input),
      model: this.options.model,
      ollamaBaseUrl: this.options.ollamaBaseUrl,
      temperature: input.temperature,
      stepBudget: input.stepBudget,
      permissionMode: 'workspace-write',
      disableStrReplaceEditor: input.tools.disabled.includes('str_replace_editor'),
      disabledToolPlugins: this.options.disabledToolPlugins ?? HARNESS_FOCUSED_DISABLED_PLUGINS,
    };
    // planHarnessInvocation falha fechada fora do envelope — nunca roda sem confinamento.
    const plan = planHarnessInvocation(invocation);

    await this.options.fs.mkdirp(dshHome);
    await this.options.fs.writeFile(patchPath, plan.patchYaml);

    const result = await this.options.spawner.run({
      command: this.options.nodeExecPath,
      args: [this.options.dshBinPath, ...plan.args],
      cwd: input.rootPath,
      env: plan.env,
      signal: input.signal,
    });

    const sessionId = await this.latestSessionId(dshHome, input.rootPath);
    // Log primeiro (evidência rica: distingue aborted-por-orçamento de completed),
    // sinais de processo como autoridade de fallback quando o log não deu flush.
    const fromLog = result.hostAborted ? null : await this.readTurnEndFromLog(dshHome, input.rootPath);
    const turnEnd = fromLog ?? deriveTurnEndFromProcess(result);

    return { sessionId: sessionId ?? 'harness-session-unknown', turnEnd };
  }

  private async latestSessionId(dshHome: string, cwd: string): Promise<string | null> {
    const dirs = await this.options.fs.listSessionDirs(dshHome, cwd).catch(() => [] as readonly string[]);
    const first = dirs[0];
    if (!first) return null;
    const base = first.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
    return base.length > 0 ? base : null;
  }

  private async readTurnEndFromLog(dshHome: string, cwd: string): Promise<HarnessTurnEnd | null> {
    const dirs = await this.options.fs.listSessionDirs(dshHome, cwd).catch(() => [] as readonly string[]);
    for (const dir of dirs) {
      const raw = await this.options.fs.readSessionLog(dir).catch(() => null);
      if (!raw) continue;
      let text: string;
      try { text = this.decompress(raw).toString('utf8'); } catch { continue; }
      const turnEnd = extractTurnEndFromLog(text);
      if (turnEnd) return turnEnd;
    }
    return null;
  }
}

const joinPath = (dir: string, name: string): string => `${dir.replace(/[\\/]+$/, '')}/${name}`;
