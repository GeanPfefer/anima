import { spawn } from 'node:child_process';
import { lstat, mkdtemp, mkdir, open, readFile, readdir, rm, rmdir, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { deriveGateTestReport, type GateTestReportV1, isAllowedGateCommand } from '@anima/core';
import { delimiter, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { buildGateEnvironment, planIsolatedInvocation, resolveGateSandbox } from './gate-isolation';
import { scrubbedGitEnvironment } from './trusted-git';
import { type AllowedWorkspaceLink, guardWorkspacePath, readGuardedFile, removeHostileWorkspaceLinks, scanWorkspaceTree, WorkspaceBoundaryError, type WorkspaceScan, writeGuardedFile } from './workspace-guard';

// ============================================================
// Primitivas de execução em git worktree isolada (ADR-001, Opção A).
//
// Nada aqui aplica, faz merge ou push. O worktree é sempre uma cópia
// descartável a partir de um SHA autorizado; o workspace original nunca é
// tocado, mesmo quando está sujo. Comandos passam por allowlist explícita e
// nunca por shell (sem interpolação). Escrita é confinada à raiz do worktree,
// com bloqueio de traversal e de arquivos/segmentos sensíveis.
// ============================================================

export interface CommandResult {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
}

const MAX_CAPTURE = 200_000;

// Segmentos e arquivos sensíveis: nem o backend escreve neles, nem o gate os lê
// de propósito. Espelha a denylist das ferramentas de leitura do GPT.
const SECRET_SEGMENTS = new Set(['.git', 'node_modules', '.next', '.worktrees', '.claude', '.venv']);
const SECRET_FILE = /(^|\/)(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|jks|keystore)|id_(?:rsa|ed25519))$/i;

/** Normaliza um caminho relativo e garante que fica dentro da raiz, sem
 * traversal e sem tocar segmentos/arquivos sensíveis. Devolve o caminho
 * absoluto seguro ou `null` (falha fechada). */
export function safeJoin(root: string, relPath: string): string | null {
  if (typeof relPath !== 'string' || relPath.length === 0) return null;
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) return null;
  const segments = normalized.toLowerCase().split('/');
  if (segments.includes('..') || segments.some(segment => SECRET_SEGMENTS.has(segment)) || SECRET_FILE.test(`/${normalized}`)) return null;
  const target = resolve(root, normalized);
  const rel = relative(root, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

/** Teto de busca/listagem no workspace; o host pode só REDUZIR (restante do deadline). */
const LOOKUP_TIMEOUT_MS = 15_000;
const lookupTimeout = (host?: { readonly timeoutMs?: number }): number =>
  typeof host?.timeoutMs === 'number' && Number.isFinite(host.timeoutMs) && host.timeoutMs > 0
    ? Math.max(1, Math.min(LOOKUP_TIMEOUT_MS, host.timeoutMs))
    : LOOKUP_TIMEOUT_MS;

/** Folga entre matar a árvore e forçar o desfecho caso o `close` não chegue. */
const KILL_GRACE_MS = 5_000;

/** Executa um processo sem shell, capturando saída com timeout e cancelamento
 * cooperativo. Nunca lança por código de saída — a falha é um dado. */
export function runProcess(
  file: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs: number; readonly signal?: AbortSignal; readonly env?: NodeJS.ProcessEnv; readonly shell?: boolean },
): Promise<CommandResult> {
  const command = [file, ...args].join(' ');
  return new Promise(resolveResult => {
    const started = Date.now();
    // Com shell, passa a linha inteira como um único argumento (sem array), a
    // forma recomendada: evita o DeprecationWarning de args não escapados. A
    // segurança vem da allowlist estrita a montante, não do escape.
    const child = options.shell
      ? spawn(command, { cwd: options.cwd, shell: true, windowsHide: true, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(file, [...args], { cwd: options.cwd, shell: false, windowsHide: true, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false, timedOut = false, cancelled = false;
    const done = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      options.signal?.removeEventListener('abort', onAbort);
      resolveResult({ command, exitCode, stdout: stdout.slice(0, MAX_CAPTURE), stderr: stderr.slice(0, MAX_CAPTURE), durationMs: Date.now() - started, timedOut, cancelled });
    };
    // Encerramento da ÁRVORE: no Windows com shell, `child.kill()` mata só o cmd.exe e
    // o neto (node/jest) segura o pipe aberto — o timeout não cortava nada e o
    // `close` esperava o processo terminar sozinho. `taskkill /T /F` derruba a árvore.
    // Rede de segurança: se o `close` não vier, resolve mesmo assim após uma folga.
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (): void => {
      if (process.platform === 'win32' && child.pid !== undefined) {
        try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill()); }
        catch { child.kill(); }
      } else {
        child.kill();
      }
      forceTimer ??= setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); done(-1); }, KILL_GRACE_MS);
    };
    const onAbort = (): void => { cancelled = true; terminate(); };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, options.timeoutMs);
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { if (stdout.length < MAX_CAPTURE) stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { if (stderr.length < MAX_CAPTURE) stderr += chunk; });
    child.on('error', () => done(-1));
    child.on('close', code => done(code ?? -1));
  });
}

// Allowlist explícita de comandos de gate: fonte única no core
// (`isAllowedGateCommand`, gate-command-allowlist-v1), a MESMA aplicada pelo
// Envelope V1 de auto-aprovação. Qualquer outra coisa é recusada fechada, antes de
// spawnar.

export function parseGateCommand(command: string): { readonly file: string; readonly args: string[] } | null {
  if (!isAllowedGateCommand(command)) return null;
  const tokens = command.trim().split(/\s+/);
  const [head, ...rest] = tokens;
  // No Windows o executável é npm.cmd; normaliza para não depender do que o
  // planejador escreveu, preservando a intenção (test/run ...).
  const file = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = head!.toLowerCase() === 'npm.cmd' || head!.toLowerCase() === 'npm' ? rest : tokens;
  return { file, args };
}

/** Acrescenta flags exclusivamente do host ao passthrough do Jest. */
export function withJestJsonReport(args: readonly string[], outputFile: string): string[] | null {
  if (!(args[0] === 'test' || (args[0] === 'run' && args[1] === 'test'))
    || !/^[A-Za-z0-9_./:\-]+$/.test(outputFile)
    || args.some(arg => /^--(?:json(?:=|$)|outputFile(?:=|$)|coverage)/.test(arg))) return null;
  return [...args, ...(args.includes('--') ? [] : ['--']), '--json', `--outputFile=${outputFile}`];
}

export interface GateReportOptions { readonly jestReportFile?: string; }
export type CapturedGateResult = CommandResult & { readonly testReport?: GateTestReportV1 };

/** Leitura bounded fora da worktree; nenhuma falha de captura modifica o gate. */
export async function captureJestReport(
  rootDir: string,
  run: (options?: GateReportOptions) => Promise<CommandResult>,
): Promise<CapturedGateResult> {
  let directory: string;
  try { directory = await mkdtemp(join(tmpdir(), 'anima-jest-')); }
  catch { return run(); }
  try {
    const file = join(directory, 'report.json').replace(/\\/g, '/');
    const safe = withJestJsonReport(['test'], file) !== null;
    const result = await run(safe ? { jestReportFile: file } : undefined);
    if (!safe || result.timedOut || result.cancelled) return result;
    try {
      const handle = await open(file, 'r');
      try {
        const limit = 8 * 1024 * 1024;
        if ((await handle.stat()).size > limit) return result;
        const buffer = Buffer.alloc(limit + 1);
        let size = 0;
        while (size < buffer.length) {
          const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
          if (!bytesRead) break;
          size += bytesRead;
        }
        if (size > limit) return result;
        const raw: unknown = JSON.parse(buffer.subarray(0, size).toString('utf8'));
        const derived = deriveGateTestReport(raw, { rootDir });
        return derived.status === 'ok' ? { ...result, testReport: derived.report } : result;
      } finally { await handle.close(); }
    } catch { return result; }
  } finally { await rm(directory, { recursive: true, force: true }).catch(() => {}); }
}

/** Roda um comando de gate permitido no worktree. Comando fora da allowlist é
 * recusado sem spawnar (exitCode -2). No Windows npm é batch (npm.cmd) e o Node
 * atual recusa spawnar batch sem shell; como o comando já passou pela allowlist
 * estrita (sem metacaracteres de encadeamento), rodamos com shell só ali. */
export function runGate(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal, options?: GateReportOptions): Promise<CommandResult> {
  const parsed = parseGateCommand(command);
  if (!parsed) return Promise.resolve({ command, exitCode: -2, stdout: '', stderr: 'Comando de gate fora da allowlist.', durationMs: 0, timedOut: false, cancelled: false });
  if (!options?.jestReportFile) return runIsolated(parsed.file, parsed.args, { cwd, timeoutMs, signal, shell: process.platform === 'win32' });
  const args = withJestJsonReport(parsed.args, options.jestReportFile);
  return runIsolated(parsed.file, args ?? parsed.args, { cwd, timeoutMs, signal, shell: process.platform === 'win32' })
    .then(result => ({ ...result, command }));
}

/**
 * Executa CÓDIGO DO CANDIDATO (gate, comando do harness): ambiente por allowlist (sem segredos do control plane) e, quando
 * `ANIMA_GATE_SANDBOX` está configurado, sob o sandbox do SO. Configurado e indisponível ⇒ falha fechada (exitCode -3), sem spawn.
 * `process.env` NUNCA é herdado aqui.
 */
export function runIsolated(
  file: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs: number; readonly signal?: AbortSignal; readonly shell: boolean; readonly envOverrides?: Record<string, string> },
): Promise<CommandResult> {
  const command = [file, ...args].join(' ');
  const sandbox = resolveGateSandbox(process.env);
  if (sandbox.kind === 'unavailable') {
    return Promise.resolve({ command, exitCode: -3, stdout: '', stderr: `Sandbox de gate indisponível (${sandbox.reason}); execução recusada.`, durationMs: 0, timedOut: false, cancelled: false });
  }
  const plan = planIsolatedInvocation({ file, args, cwd: options.cwd, shell: options.shell }, sandbox, buildGateEnvironment(process.env, options.envOverrides ?? {}));
  return runProcess(plan.file, plan.args, { cwd: options.cwd, timeoutMs: options.timeoutMs, signal: options.signal, shell: plan.shell, env: plan.env as NodeJS.ProcessEnv })
    .then(result => ({ ...result, command }));
}

/**
 * Ambiente do Git sobre o candidato: construído do zero (sem segredos, sem GIT_* herdado, config GLOBAL do usuário desligada).
 * A config de SISTEMA (gravável só por Administradores; no Git for Windows traz `core.autocrlf`/`core.symlinks`) é mantida para que
 * o conteúdo restaurado/commitado tenha as mesmas quebras de linha com que a worktree foi criada.
 */
function candidateGitEnvironment(): NodeJS.ProcessEnv {
  const { env } = scrubbedGitEnvironment(process.env);
  delete env.GIT_CONFIG_NOSYSTEM; delete env.GIT_CONFIG_SYSTEM;
  return env;
}

// Diretório administrativo da worktree, lido do repositório PRINCIPAL: o arquivo `gitdir` de cada entrada em `<repo>/.git/worktrees` aponta para `<worktree>/.git`.
async function resolveWorktreeGitDir(repoRoot: string, root: string): Promise<string | null> {
  try {
    const mainGit = join(repoRoot, '.git');
    if (!(await stat(mainGit)).isDirectory()) return null;
    const norm = (p: string): string => resolve(p.trim()).replace(/\\/g, '/').toLowerCase();
    const expected = norm(join(root, '.git'));
    const base = join(mainGit, 'worktrees');
    for (const name of await readdir(base)) {
      const pointer = await readFile(join(base, name, 'gitdir'), 'utf8').catch(() => '');
      if (pointer && norm(pointer) === expected) return join(base, name);
    }
  } catch { /* fail closed */ }
  return null;
}

const git = (repo: string, args: readonly string[], signal?: AbortSignal): Promise<CommandResult> =>
  runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs: 60_000, signal });

/**
 * A falha de `git worktree add` é RECUPERÁVEL por nova tentativa? A criação da
 * worktree escreve num diretório TEMP recém-criado e nos arquivos administrativos de
 * `.git/worktrees`; no Windows, o antivírus/indexador ocasionalmente segura esse
 * diretório recém-criado por alguns milissegundos, e o git falha fechado com um erro
 * de FILESYSTEM transitório ("cannot create directory: Permission denied", "Access is
 * denied", lock de ref, arquivo em uso). Esses casos somem numa nova tentativa. Erros
 * DETERMINÍSTICOS (SHA inválido, argumento malformado) NÃO casam aqui e sobem na hora,
 * sem re-tentar. Puro e testável — não amplia nenhuma permissão. */
/**
 * Valida o pai DEDICADO dos workspaces (ANIMA_WORKTREE_PARENT). Configurado e inválido ⇒ ERRO (nunca volta em silêncio ao TEMP/.worktrees,
 * que seriam outra fronteira de segurança). Exige: caminho absoluto de unidade (sem UNC, sem `..`, sem raiz de unidade), no MESMO volume do
 * repositório (junctions de node_modules), nunca o repositório, um ancestral dele ou algo dentro do `.git`. Os workspaces individuais são
 * sempre `mkdtemp` dentro dele; o runner não escolhe caminho algum.
 */
export function validateDedicatedWorktreeParent(repoRoot: string, configured: string): string {
  const fail = (why: string): never => { throw new Error(`ANIMA_WORKTREE_PARENT inválido (${why}).`); };
  if (!/^[A-Za-z]:[\\/]/.test(configured) && !(process.platform !== 'win32' && configured.startsWith('/'))) fail('deve ser caminho absoluto local');
  if (configured.startsWith('\\\\') || configured.startsWith('//')) fail('UNC recusado');
  if (configured.split(/[\\/]+/).includes('..')) fail('segmento ".." recusado');
  if (/[\0<>"|?*]/.test(configured)) fail('caracteres inválidos');
  const parent = resolve(configured);
  const repo = resolve(repoRoot);
  const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
  const volume = (p: string): string => norm(parse(p).root);
  if (norm(parent) === norm(parse(parent).root)) fail('raiz de unidade recusada');
  if (volume(parent) !== volume(repo)) fail('precisa estar no mesmo volume do repositório');
  const rel = relative(norm(repo), norm(parent));
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && (rel === '.git' || rel.startsWith('.git\\') || rel.startsWith('.git/')))) fail('não pode ser o repositório nem estar em .git');
  const up = relative(norm(parent), norm(repo));
  if (up === '' || (!up.startsWith('..') && !isAbsolute(up))) fail('não pode ser o repositório nem um ancestral dele');
  return parent;
}
/**
 * Diretório-pai das worktrees efêmeras. Por padrão o TEMP do SO; quando o TEMP está em
 * OUTRO volume que o repositório (Windows: C:\…\Temp × G:\repo), usa `<repo>/.worktrees`.
 * Junctions de node_modules entre volumes quebram a resolução de módulos de bundlers — o
 * webpack do `next build` passa a resolver `./G:/…` a partir de C: — e o gate REAL do
 * framework falharia por ambiente, nunca pelo código. `.worktrees` já é ignorado pelas
 * leituras do coder (SECRET_SEGMENTS). Puro e testável.
 */
export function worktreeParentDir(repoRoot: string, tempDir: string = tmpdir(), env: Record<string, string | undefined> = process.env): string {
  // Pai DEDICADO dos workspaces de execução (ex.: o único diretório com ACE de escrita para o sandbox, fora do checkout protegido).
  const dedicated = env.ANIMA_WORKTREE_PARENT?.trim();
  if (dedicated) return validateDedicatedWorktreeParent(repoRoot, dedicated);
  const volume = (path: string): string => parse(resolve(path)).root.toLowerCase();
  return volume(tempDir) === volume(repoRoot) ? tempDir : join(repoRoot, '.worktrees');
}

export function isTransientWorktreeError(stderr: string): boolean {
  const text = stderr.toLowerCase();
  return (
    text.includes('permission denied') ||
    text.includes('access is denied') ||
    text.includes('operation not permitted') ||
    text.includes('cannot create directory') ||
    text.includes('could not create') ||
    text.includes('unable to create') ||
    text.includes('cannot lock ref') ||
    text.includes('being used by another process') ||
    text.includes('used by another process') ||
    text.includes('resource temporarily unavailable') ||
    text.includes('resource busy') ||
    text.includes('device or resource busy')
  );
}

/** Espera cancelável — o AbortSignal da tentativa encurta o backoff sem lançar. */
const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>(resolve => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = (): void => { clearTimeout(timer); resolve(); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** Uma worktree git descartável ancorada num SHA. Cria uma branch nova e um
 * diretório temporário; o repositório e o workspace original nunca mudam. */
export class GitWorktree {
  private nodeModulesLinks: string[] = [];
  private readonly nodeModulesTargets = new Map<string, string>();
  private constructor(
    readonly repoRoot: string, readonly root: string, readonly branch: string,
    private readonly base: string,
    // `baseSha` é a BASE AUTORIZADA do diff (o que a execução tinha permissão de
    // mudar, medido sempre contra ela). `startSha` é o ESTADO INICIAL da árvore —
    // igual à base numa tentativa nova, ou o commit do checkpoint numa RETOMADA.
    private readonly baseSha: string, private readonly startSha: string,
  ) {}

  static async create(input: {
    readonly repoRoot: string; readonly sha: string; readonly branch: string;
    /** Estado inicial da árvore quando RETOMANDO de um checkpoint durável. Ausente
     * ⇒ nova tentativa a partir da base (comportamento idêntico ao anterior). O
     * diff continua sendo medido contra `sha` (a base autorizada), não contra este. */
    readonly startSha?: string;
    readonly signal?: AbortSignal;
  }): Promise<GitWorktree> {
    const start = input.startSha ?? input.sha;
    // Checkout completo do estado inicial numa branch nova. Numa retomada, esse
    // estado é o commit do checkpoint da tentativa anterior; a nova branch parte
    // dele, mas o diff da tentativa continua contra a base autorizada. node_modules
    // é ignorado pelo git, então é religado depois por linkNodeModules().
    //
    // A criação é RESILIENTE a falha de filesystem TRANSITÓRIA (Windows: AV/indexador
    // segura o diretório TEMP recém-criado por instantes, e o git falha fechado com
    // "cannot create directory: Permission denied"). Re-tenta um número BOUNDED de vezes,
    // sempre com um diretório TEMP NOVO e após limpar o estado parcial (prune + apagar a
    // branch), com backoff curto e cancelável. Não amplia permissão nenhuma: é o mesmo
    // comando, apenas repetido. Erro determinístico não casa `isTransientWorktreeError` e
    // sobe na primeira tentativa. O caminho de SUCESSO é idêntico ao anterior.
    const maxAttempts = 3;
    let lastError = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const parent = worktreeParentDir(input.repoRoot);
      await mkdir(parent, { recursive: true });
      if (process.env.ANIMA_WORKTREE_PARENT?.trim()) {
        // O Host é dono do pai dedicado: ele tem de ser um diretório REAL (não link) e o workspace criado tem de ficar dentro dele.
        const info = await lstat(parent);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('ANIMA_WORKTREE_PARENT inválido (não é diretório real).');
      }
      const base = await mkdtemp(join(parent, 'anima-wt-'));
      const root = join(base, 'tree');
      const created = await git(input.repoRoot, ['worktree', 'add', '-b', input.branch, root, start], input.signal);
      if (created.exitCode === 0) {
        return new GitWorktree(input.repoRoot, root, input.branch, base, input.sha, start);
      }
      lastError = created.stderr.trim() || created.stdout.trim() || String(created.exitCode);
      await rm(base, { recursive: true, force: true }).catch(() => {});
      const canRetry = attempt < maxAttempts && !input.signal?.aborted && isTransientWorktreeError(lastError);
      if (!canRetry) break;
      // Limpa qualquer estado parcial que uma criação abortada possa ter deixado antes
      // de repetir com o MESMO nome de branch (idempotência): entrada administrativa órfã
      // (`prune`, pois o diretório TEMP já foi removido) e a branch, se chegou a existir.
      await git(input.repoRoot, ['worktree', 'prune'], input.signal).catch(() => {});
      await git(input.repoRoot, ['branch', '-D', input.branch], input.signal).catch(() => {});
      await sleep(150 * attempt, input.signal);
    }
    throw new Error(`Falha ao criar worktree: ${lastError}`);
  }

  private trustedGitDirPromise: Promise<string | null> | undefined;

  /**
   * Git do HOST sobre a worktree do CANDIDATO. O conteúdo da worktree (inclusive o arquivo `.git`, que o candidato pode apagar e
   * recriar com `gitdir:` para um repositório próprio, com hooks/fsmonitor/config hostis) NÃO é confiável. Por isso:
   * `--git-dir` é o diretório administrativo registrado pelo repositório PRINCIPAL (fora do alcance do candidato), `--work-tree` explícito
   * (o `.git` da worktree nunca é lido), hooks/fsmonitor desligados, ambiente de Git construído do zero (sem segredos do Host)
   * e processo iniciado fora da worktree. Sem diretório confiável ⇒ recusa (exitCode -4), nunca recorre ao `.git` da worktree.
   */
  private candidateGit(args: readonly string[], signal?: AbortSignal, timeoutMs = 60_000): Promise<CommandResult> {
    this.trustedGitDirPromise ??= resolveWorktreeGitDir(this.repoRoot, this.root);
    return this.trustedGitDirPromise.then(gitDir => {
      if (!gitDir) return { command: `git ${args.join(' ')}`, exitCode: -4, stdout: '', stderr: 'Diretório Git confiável da worktree não encontrado; recusado.', durationMs: 0, timedOut: false, cancelled: false };
      return runProcess('git', ['--no-pager', '--no-replace-objects', `--git-dir=${gitDir}`, `--work-tree=${this.root}`, '-C', this.root,
        '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.untrackedCache=false', '-c', 'protocol.allow=never', ...args],
      { cwd: tmpdir(), timeoutMs, signal, env: candidateGitEnvironment() });
    });
  }

  /** Resolve um caminho relativo dentro da raiz, com as guardas de segurança. */
  resolve(relPath: string): string | null { return safeJoin(this.root, relPath); }

  /** Links que o PRÓPRIO Host criou (node_modules) e que continuam apontando para o destino esperado. */
  private allowedLinks(): readonly AllowedWorkspaceLink[] {
    return [...this.nodeModulesTargets].map(([link, target]) => ({ link, target }));
  }

  /** Varre a worktree sem seguir links: symlink/junction/hardlink fora dos node_modules do Host são violações. */
  inspectBoundary(): Promise<WorkspaceScan> { return scanWorkspaceTree(this.root, this.allowedLinks()); }

  async readWorkspaceFile(relPath: string): Promise<string | null> {
    const target = this.resolve(relPath);
    if (!target) return null;
    return readGuardedFile(this.root, target, this.allowedLinks());
  }

  /** Classifica um path EXATO sem expandi-lo como diretório/prefixo/glob. */
  async workspacePathKind(relPath: string): Promise<'file' | 'directory' | 'other' | 'missing'> {
    const target = this.resolve(relPath);
    if (!target) return 'missing';
    try {
      const guarded = await guardWorkspacePath(this.root, target, this.allowedLinks());
      if (!guarded.ok) return 'other';
      if (!guarded.exists) return 'missing';
      const info = await lstat(target);
      if (info.isFile()) return info.nlink > 1 ? 'other' : 'file';
      if (info.isDirectory()) return 'directory';
      return 'other';
    } catch {
      return 'missing';
    }
  }

  async writeWorkspaceFile(relPath: string, content: string): Promise<boolean> {
    const target = this.resolve(relPath);
    if (target === null) return false;
    return writeGuardedFile(this.root, target, content, this.allowedLinks());
  }

  /**
   * Busca textual/símbolo host-executada (Coding Harness V3) sobre os arquivos
   * RASTREADOS da worktree, via `git grep`. Confinada por construção: git grep só
   * enxerga arquivos versionados sob a raiz (node_modules/.git etc. são
   * ignorados/não-rastreados, logo nunca aparecem). O modelo NUNCA roda shell — o
   * host executa e devolve caminho + linha + trecho. `pathGlob` usa pathspec glob
   * (`:(glob)`), então `**` funciona. Resultado é bounded (cap de volume). Cancela
   * com o `signal` do host.
   */
  async searchText(
    input: { readonly query: string; readonly pathGlob?: string; readonly maxResults: number; readonly isRegex: boolean },
    signal?: AbortSignal,
    host?: { readonly timeoutMs?: number },
  ): Promise<{ matches: { path: string; line: number; preview: string }[]; truncated: boolean }> {
    const cap = Math.max(1, Math.min(Math.floor(input.maxResults) || 1, 200));
    const args = ['grep', '--no-color', '-n', '-I', input.isRegex ? '-E' : '-F', '-e', input.query];
    if (typeof input.pathGlob === 'string' && input.pathGlob.trim().length > 0) {
      args.push('--', `:(glob)${input.pathGlob.trim()}`);
    }
    const result = await this.candidateGit(args, signal, lookupTimeout(host));
    // git grep: exit 0 = houve match; 1 = nenhum; outros = erro → resultado vazio.
    if (result.exitCode !== 0 && result.exitCode !== 1) return { matches: [], truncated: false };
    const matches: { path: string; line: number; preview: string }[] = [];
    let truncated = false;
    for (const raw of result.stdout.split(/\r?\n/)) {
      if (!raw) continue;
      const m = /^(.+?):(\d+):(.*)$/.exec(raw);
      if (!m) continue;
      if (matches.length >= cap) { truncated = true; break; }
      matches.push({ path: m[1]!.replace(/\\/g, '/'), line: Number(m[2]), preview: m[3]!.slice(0, 300) });
    }
    return { matches, truncated };
  }

  /**
   * Executa um comando JÁ validado pela command policy (Coding Harness V3, 3ª fatia),
   * confinado à raiz da worktree (cwd = this.root). O modelo NUNCA vê shell: recebe-se
   * `{program, args}` estruturado. Sem `shell` exceto os batch shims do Windows
   * (npm/pnpm/npx/tsc/jest/vitest são `.cmd`) — e mesmo aí os args já passaram pelo
   * charset seguro da policy (sem metacaractere de encadeamento). O PATH inclui o
   * `node_modules/.bin` da worktree, para os binários locais (tsc/jest/vitest)
   * resolverem sem instalar nada. stdout/stderr/exit code/timeout são capturados por
   * `runProcess` (bounded em MAX_CAPTURE; o laço aplica o cap menor da policy).
   */
  async runCommand(
    input: { readonly program: string; readonly args: readonly string[]; readonly timeoutMs: number },
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    const isWin = process.platform === 'win32';
    const WIN_BATCH = new Set(['npm', 'pnpm', 'npx', 'tsc', 'jest', 'vitest']);
    const useShell = isWin && WIN_BATCH.has(input.program);
    const file = useShell ? `${input.program}.cmd` : input.program;
    const binDir = join(this.root, 'node_modules', '.bin');
    const basePath = process.env.PATH ?? process.env.Path ?? '';
    return runIsolated(file, [...input.args], { cwd: this.root, timeoutMs: input.timeoutMs, signal, shell: useShell, envOverrides: { PATH: `${binDir}${delimiter}${basePath}`, Path: `${binDir}${delimiter}${basePath}` } });
  }

  /**
   * Listagem host-executada de arquivos RASTREADOS por padrão glob, via
   * `git ls-files` (pathspec `:(glob)`). Mesmo confinamento do `searchText`.
   */
  async listFiles(
    input: { readonly pattern: string; readonly maxResults: number },
    signal?: AbortSignal,
    host?: { readonly timeoutMs?: number },
  ): Promise<{ paths: string[]; truncated: boolean }> {
    const cap = Math.max(1, Math.min(Math.floor(input.maxResults) || 1, 500));
    const pattern = input.pattern.trim();
    const args = ['ls-files', '--', pattern.length > 0 ? `:(glob)${pattern}` : '.'];
    const result = await this.candidateGit(args, signal, lookupTimeout(host));
    if (result.exitCode !== 0) return { paths: [], truncated: false };
    const paths: string[] = [];
    let truncated = false;
    for (const raw of result.stdout.split(/\r?\n/)) {
      const p = raw.trim();
      if (!p) continue;
      if (paths.length >= cap) { truncated = true; break; }
      paths.push(p.replace(/\\/g, '/'));
    }
    return { paths, truncated };
  }

  /**
   * Religa os node_modules fisicos ja instalados no repositorio autorizado:
   * a raiz e os node_modules proprios de workspaces sob apps/* e packages/*.
   *
   * Nao instala dependencias nem compartilha outputs derivados; apenas reproduz
   * o layout de dependencias necessario para executar o toolchain na worktree.
   */
  async linkNodeModules(signal?: AbortSignal): Promise<boolean> {
    await this.unlinkNodeModules();

    const candidates: Array<{ source: string; link: string }> = [];

    const rootSource = join(this.repoRoot, 'node_modules');
    if (await stat(rootSource).then(info => info.isDirectory(), () => false)) {
      candidates.push({
        source: rootSource,
        link: join(this.root, 'node_modules'),
      });
    }

    for (const group of ['apps', 'packages']) {
      const groupRoot = join(this.repoRoot, group);
      const entries = await readdir(groupRoot, { withFileTypes: true }).catch(() => []);

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const source = join(groupRoot, entry.name, 'node_modules');
        const exists = await stat(source).then(info => info.isDirectory(), () => false);
        if (!exists) continue;

        candidates.push({
          source,
          link: join(this.root, group, entry.name, 'node_modules'),
        });
      }
    }

    if (candidates.length === 0) return false;

    try {
      for (const candidate of candidates) {
        if (signal?.aborted) throw new Error('cancelled');

        await mkdir(dirname(candidate.link), { recursive: true });
        await symlink(candidate.source, candidate.link, 'junction');
        this.nodeModulesLinks.push(candidate.link);
        this.nodeModulesTargets.set(candidate.link, candidate.source);
      }

      return true;
    } catch {
      await this.unlinkNodeModules();
      return false;
    }
  }

  /**
   * Remove SOMENTE as ligacoes de node_modules criadas pelo host, nunca os alvos.
   * A ordem reversa cobre primeiro os workspaces e por ultimo a raiz.
   */
  async unlinkNodeModules(): Promise<void> {
    const links = [...this.nodeModulesLinks].reverse();
    this.nodeModulesLinks = [];
    this.nodeModulesTargets.clear();

    for (const link of links) {
      try {
        const info = await lstat(link);
        if (process.platform === 'win32' && info.isDirectory()) {
          await rmdir(link).catch(() => unlink(link).catch(() => {}));
        } else {
          await unlink(link).catch(() => rmdir(link).catch(() => {}));
        }
      } catch {
        // ligacao ja ausente
      }
    }
  }

  async stageAll(signal?: AbortSignal, observe?: (result: CommandResult) => void): Promise<void> {
    // git add -A segue junctions no Windows e indexaria conteúdo de fora da worktree: recusa antes de tocar o índice.
    const scan = await this.inspectBoundary();
    if (!scan.ok) throw new WorkspaceBoundaryError(scan.violations);
    const result = await this.candidateGit(['add', '-A'], signal);
    observe?.(result);
  }

  /** Materializa somente a árvore do índice, sem criar commit ou referência. */
  async stagedTreeSha(signal?: AbortSignal): Promise<string | null> {
    try {
      let staged = false;
      await this.stageAll(signal, result => { staged = result.exitCode === 0 && !result.timedOut && !result.cancelled; });
      if (!staged) return null;
      const tree = await this.candidateGit(['write-tree'], signal);
      const sha = tree.stdout.trim();
      return tree.exitCode === 0 && !tree.timedOut && !tree.cancelled && /^[a-f0-9]{40}$/.test(sha) ? sha : null;
    } catch { return null; }
  }

  async changedFiles(signal?: AbortSignal): Promise<readonly string[]> {
    await this.stageAll(signal);
    const result = await this.candidateGit(['diff', '--cached', '--name-only', this.baseSha], signal);
    return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }

  /** Arquivos alterados POR ESTA tentativa, medidos contra o estado inicial da
   * árvore. Numa retomada isso exclui o diff herdado do checkpoint; numa tentativa
   * nova é idêntico a changedFiles(). Usado para enforcement de escopo e no-op,
   * nunca para esconder a proveniência B→checkpoint do handoff final. */
  async changedFilesSinceStart(signal?: AbortSignal): Promise<readonly string[]> {
    await this.stageAll(signal);
    const result = await this.candidateGit(['diff', '--cached', '--name-only', this.startSha], signal);
    return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }

  async diff(signal?: AbortSignal): Promise<string> {
    await this.stageAll(signal);
    const result = await this.candidateGit(['diff', '--cached', '--no-color', this.baseSha], signal);
    return result.stdout;
  }

  /**
   * Status Git por arquivo alterado POR ESTA tentativa (vs estado inicial), com
   * detecção de rename (`-M`). Para A/M/D/T o `path` é o próprio arquivo; para
   * R/C o `path` é o DESTINO (novo nome) e `oldPath` a origem. Alimenta a leitura
   * fail-closed do executor: uma deleção legitimamente não tem conteúdo; A/M/R/C/T
   * DEVEM ser legíveis.
   */
  async changedEntriesSinceStart(signal?: AbortSignal): Promise<readonly { readonly status: string; readonly path: string; readonly oldPath?: string }[]> {
    await this.stageAll(signal);
    const result = await this.candidateGit(['diff', '--cached', '--name-status', '-M', this.startSha], signal);
    const out: { status: string; path: string; oldPath?: string }[] = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split('\t');
      const code = (parts[0] ?? '').trim();
      const status = code.charAt(0).toUpperCase();
      if (status === 'R' || status === 'C') {
        const oldPath = (parts[1] ?? '').replace(/\\/g, '/');
        const path = (parts[2] ?? '').replace(/\\/g, '/');
        if (path) out.push({ status, path, oldPath });
      } else {
        const path = (parts[1] ?? '').replace(/\\/g, '/');
        if (path && status) out.push({ status, path });
      }
    }
    return out;
  }

  /** Diff estruturado (numstat) do estado atual vs base: por arquivo, caminho +
   * inserções/deleções (-1 quando binário). Contagens apenas — nunca linhas
   * cruas —, para alimentar o resumo do handoff durável (INT-05). Deve ser lido
   * O índice é sempre comparado ao SHA-base, inclusive quando um checkpoint
   * intermediário já foi commitado na branch. */
  async diffNumstat(signal?: AbortSignal): Promise<readonly { readonly path: string; readonly insertions: number; readonly deletions: number }[]> {
    await this.stageAll(signal);
    const result = await this.candidateGit(['diff', '--cached', '--numstat', this.baseSha], signal);
    const out: { path: string; insertions: number; deletions: number }[] = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split('\t');
      if (parts.length < 3) continue;
      const [ins, del, ...rest] = parts;
      const path = rest.join('\t').replace(/\\/g, '/');
      const toCount = (value: string): number => (value === '-' ? -1 : (Number.isInteger(Number(value)) ? Number(value) : 0));
      out.push({ path, insertions: toCount(ins!), deletions: toCount(del!) });
    }
    return out;
  }

  /** Cria um commit na branch descartável capturando o estado atual e devolve o
   * SHA — nunca é feito push. Devolve `null` se não há nada para commitar. */
  async commit(message: string, signal?: AbortSignal): Promise<string | null> {
    await this.stageAll(signal);
    const staged = await this.candidateGit(['diff', '--cached', '--quiet'], signal);
    if (staged.exitCode === 0) return null;
    const committed = await this.candidateGit(['-c', 'user.name=anima-worktree', '-c', 'user.email=worktree@anima.local', 'commit', '--no-gpg-sign', '-m', message], signal);
    if (committed.exitCode !== 0) return null;
    const head = await this.candidateGit(['rev-parse', 'HEAD'], signal);
    return head.exitCode === 0 ? head.stdout.trim() : null;
  }

  /**
   * Restaura a worktree ao ESTADO-BASE (o SHA de criação). É a autoridade única
   * de restauração (outcome atomicity): a camada que possui a worktree a chama
   * quando a aplicação de um lote falha, ANTES de finalizar o caminho de falha.
   *
   * NÃO é atomicidade de visibilidade: durante escritas sequenciais pode existir
   * estado intermediário parcial em disco; esta função garante o DESFECHO — ou o
   * lote inteiro permanece, ou a worktree volta ao base.
   *
   * Mecanismo: desfaz o link de node_modules PRIMEIRO (para o `clean -fdx` nunca
   * recursar pelo junction e apagar o node_modules real), `git reset --hard`
   * ao SHA-base (rastreados) e `git clean -fdx` (não-rastreados E ignorados —
   * remove também arquivos criados sob `.gitignore`). Nesta fase a worktree só
   * contém as edições do backend; nenhuma infra ignorada existe ainda.
   *
   * NÃO recebe o AbortSignal da tentativa, DE PROPÓSITO: cleanup preserva o
   * invariant da worktree e não é trabalho produtivo — o cancelamento da tentativa
   * jamais pode cancelar a restauração (o `runProcess` mataria um `reset`/`clean`
   * cujo signal já estivesse abortado). É primitiva de limpeza simples e total,
   * limitada apenas pelo timeout interno do helper `git`.
   *
   * Contrato de erro: NUNCA rejeita. Devolve `true` só se reset E clean sucederem;
   * `false` para qualquer falha de restauração — o chamador registra e mantém a
   * worktree condenada ao `dispose`; jamais converte em sucesso.
   */
  async restoreToBase(): Promise<boolean> {
    try {
      await this.unlinkNodeModules();
      await removeHostileWorkspaceLinks(this.root);
      // Restaura ao ESTADO INICIAL da tentativa. Numa tentativa nova isso é a
      // própria base; numa RETOMADA é o commit do checkpoint anterior — nunca a
      // base original, que descartaria o trabalho retomado que se está estendendo.
      const reset = await this.candidateGit(['reset', '--hard', this.startSha]);
      const clean = await this.candidateGit(['clean', '-fdx']);
      return reset.exitCode === 0 && clean.exitCode === 0;
    } catch {
      return false;
    }
  }

  /** Restaura ao commit durável de um checkpoint da própria branch. Usado quando
   * um repair posterior falha: descarta somente a mutação parcial do repair e
   * preserva o estado que o checkpoint já anunciou como transferível. */
  async restoreToCheckpoint(commitSha: string): Promise<boolean> {
    try {
      await this.unlinkNodeModules();
      await removeHostileWorkspaceLinks(this.root);
      const reset = await this.candidateGit(['reset', '--hard', commitSha]);
      const clean = await this.candidateGit(['clean', '-fdx']);
      return reset.exitCode === 0 && clean.exitCode === 0;
    } catch {
      return false;
    }
  }

  /** Remove a worktree e o diretório temporário. A ligação de node_modules é
   * desfeita ANTES, para nunca deletar o node_modules real por dentro dela.
   * A branch é preservada por padrão (referência revisável, nunca pushada). */
  async dispose(options: { readonly deleteBranch?: boolean } = {}): Promise<void> {
    await this.unlinkNodeModules();
    await removeHostileWorkspaceLinks(this.root).catch(() => []);
    await git(this.repoRoot, ['worktree', 'remove', '--force', this.root]).catch(() => {});
    await git(this.repoRoot, ['worktree', 'prune']).catch(() => {});
    await rm(this.base, { recursive: true, force: true }).catch(() => {});
    if (options.deleteBranch) await git(this.repoRoot, ['branch', '-D', this.branch]).catch(() => {});
  }
}
