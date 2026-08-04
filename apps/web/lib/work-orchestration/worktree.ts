import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

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

/** Executa um processo sem shell, capturando saída com timeout e cancelamento
 * cooperativo. Nunca lança por código de saída — a falha é um dado. */
export function runProcess(
  file: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs: number; readonly signal?: AbortSignal; readonly env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  const command = [file, ...args].join(' ');
  return new Promise(resolveResult => {
    const started = Date.now();
    const child = spawn(file, [...args], { cwd: options.cwd, shell: false, windowsHide: true, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false, timedOut = false, cancelled = false;
    const done = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolveResult({ command, exitCode, stdout: stdout.slice(0, MAX_CAPTURE), stderr: stderr.slice(0, MAX_CAPTURE), durationMs: Date.now() - started, timedOut, cancelled });
    };
    const onAbort = (): void => { cancelled = true; child.kill(); };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs);
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { if (stdout.length < MAX_CAPTURE) stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { if (stderr.length < MAX_CAPTURE) stderr += chunk; });
    child.on('error', () => done(-1));
    child.on('close', code => done(code ?? -1));
  });
}

// Allowlist explícita de comandos de gate. Só npm test/typecheck/build/lint,
// opcionalmente escopado por workspace ou com argumentos passthrough restritos.
// Qualquer outra coisa é recusada fechada, antes de spawnar.
const GATE_PATTERN = /^npm(?:\.cmd)? (?:run (?:typecheck|test|build|lint)|test)(?: --workspace=[@a-z0-9._/-]+)?(?: -- [\w./@()\\:*?=-]+(?: [\w./@()\\:*?=-]+)*)?$/i;

export function parseGateCommand(command: string): { readonly file: string; readonly args: string[] } | null {
  if (typeof command !== 'string' || !GATE_PATTERN.test(command.trim())) return null;
  const tokens = command.trim().split(/\s+/);
  const [head, ...rest] = tokens;
  // No Windows o executável é npm.cmd; normaliza para não depender do que o
  // planejador escreveu, preservando a intenção (test/run ...).
  const file = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = head!.toLowerCase() === 'npm.cmd' || head!.toLowerCase() === 'npm' ? rest : tokens;
  return { file, args };
}

/** Roda um comando de gate permitido no worktree. Comando fora da allowlist é
 * recusado sem spawnar (exitCode -2, cancelado=false). */
export function runGate(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
  const parsed = parseGateCommand(command);
  if (!parsed) return Promise.resolve({ command, exitCode: -2, stdout: '', stderr: 'Comando de gate fora da allowlist.', durationMs: 0, timedOut: false, cancelled: false });
  return runProcess(parsed.file, parsed.args, { cwd, timeoutMs, signal });
}

const git = (repo: string, args: readonly string[], signal?: AbortSignal): Promise<CommandResult> =>
  runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs: 60_000, signal });

/** Uma worktree git descartável ancorada num SHA. Cria uma branch nova e um
 * diretório temporário; o repositório e o workspace original nunca mudam. */
export class GitWorktree {
  private nodeModulesLink: string | null = null;
  private constructor(readonly repoRoot: string, readonly root: string, readonly branch: string, private readonly base: string) {}

  static async create(input: { readonly repoRoot: string; readonly sha: string; readonly branch: string; readonly signal?: AbortSignal }): Promise<GitWorktree> {
    const base = await mkdtemp(join(tmpdir(), 'anima-wt-'));
    const root = join(base, 'tree');
    // Checkout completo do SHA numa branch nova. node_modules é ignorado pelo
    // git, então não é copiado — é religado depois por linkNodeModules().
    const created = await git(input.repoRoot, ['worktree', 'add', '-b', input.branch, root, input.sha], input.signal);
    if (created.exitCode !== 0) {
      await rm(base, { recursive: true, force: true }).catch(() => {});
      throw new Error(`Falha ao criar worktree: ${created.stderr.trim() || created.stdout.trim() || created.exitCode}`);
    }
    return new GitWorktree(input.repoRoot, root, input.branch, base);
  }

  /** Resolve um caminho relativo dentro da raiz, com as guardas de segurança. */
  resolve(relPath: string): string | null { return safeJoin(this.root, relPath); }

  async readWorkspaceFile(relPath: string): Promise<string | null> {
    const target = this.resolve(relPath);
    if (!target) return null;
    try { return await readFile(target, 'utf8'); } catch { return null; }
  }

  async writeWorkspaceFile(relPath: string, content: string): Promise<boolean> {
    const target = this.resolve(relPath);
    if (target === null) return false;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { encoding: 'utf8' });
    return true;
  }

  /** Liga o `node_modules` real do repositório na worktree (junction no Windows,
   * symlink fora), para o gate npm rodar com o toolchain real sem instalar. */
  async linkNodeModules(signal?: AbortSignal): Promise<boolean> {
    const source = join(this.repoRoot, 'node_modules');
    if (!(await stat(source).then(s => s.isDirectory(), () => false))) return false;
    const link = join(this.root, 'node_modules');
    try {
      await symlink(source, link, 'junction');
      this.nodeModulesLink = link;
      return true;
    } catch { return false; }
  }

  async stageAll(signal?: AbortSignal): Promise<void> { await git(this.root, ['add', '-A'], signal); }

  async changedFiles(signal?: AbortSignal): Promise<readonly string[]> {
    await this.stageAll(signal);
    const result = await git(this.root, ['diff', '--cached', '--name-only'], signal);
    return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }

  async diff(signal?: AbortSignal): Promise<string> {
    await this.stageAll(signal);
    const result = await git(this.root, ['diff', '--cached', '--no-color'], signal);
    return result.stdout;
  }

  /** Cria um commit na branch descartável capturando o estado atual e devolve o
   * SHA — nunca é feito push. Devolve `null` se não há nada para commitar. */
  async commit(message: string, signal?: AbortSignal): Promise<string | null> {
    await this.stageAll(signal);
    const staged = await git(this.root, ['diff', '--cached', '--quiet'], signal);
    if (staged.exitCode === 0) return null;
    const committed = await git(this.root, ['-c', 'user.name=anima-worktree', '-c', 'user.email=worktree@anima.local', 'commit', '--no-gpg-sign', '-m', message], signal);
    if (committed.exitCode !== 0) return null;
    const head = await git(this.root, ['rev-parse', 'HEAD'], signal);
    return head.exitCode === 0 ? head.stdout.trim() : null;
  }

  /** Remove a worktree e o diretório temporário. A ligação de node_modules é
   * desfeita ANTES, para nunca deletar o node_modules real por dentro dela.
   * A branch é preservada por padrão (referência revisável, nunca pushada). */
  async dispose(options: { readonly deleteBranch?: boolean } = {}): Promise<void> {
    if (this.nodeModulesLink) {
      // Remover só a junction/symlink, jamais o alvo. rm sem recursive apaga o link.
      await rm(this.nodeModulesLink, { force: true }).catch(async () => {
        await rm(this.nodeModulesLink!, { recursive: false, force: true }).catch(() => {});
      });
      this.nodeModulesLink = null;
    }
    await git(this.repoRoot, ['worktree', 'remove', '--force', this.root]).catch(() => {});
    await git(this.repoRoot, ['worktree', 'prune']).catch(() => {});
    await rm(this.base, { recursive: true, force: true }).catch(() => {});
    if (options.deleteBranch) await git(this.repoRoot, ['branch', '-D', this.branch]).catch(() => {});
  }
}
