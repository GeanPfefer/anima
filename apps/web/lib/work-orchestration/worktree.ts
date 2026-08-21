import { spawn } from 'node:child_process';
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, rmdir, stat, symlink, unlink, writeFile } from 'node:fs/promises';
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
// Charset restrito nos passthrough: sem metacaracteres de encadeamento,
// redirecionamento ou expansão (`& | ; > < $ * ? ( )`), então nem com shell há
// como injetar um segundo comando.
const GATE_PATTERN = /^npm(?:\.cmd)? (?:run (?:typecheck|test|build|lint)|test)(?: --workspace=[@a-z0-9._/-]+)?(?: -- [\w./@:=-]+(?: [\w./@:=-]+)*)?$/i;

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
 * recusado sem spawnar (exitCode -2). No Windows npm é batch (npm.cmd) e o Node
 * atual recusa spawnar batch sem shell; como o comando já passou pela allowlist
 * estrita (sem metacaracteres de encadeamento), rodamos com shell só ali. */
export function runGate(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
  const parsed = parseGateCommand(command);
  if (!parsed) return Promise.resolve({ command, exitCode: -2, stdout: '', stderr: 'Comando de gate fora da allowlist.', durationMs: 0, timedOut: false, cancelled: false });
  return runProcess(parsed.file, parsed.args, { cwd, timeoutMs, signal, shell: process.platform === 'win32' });
}

const git = (repo: string, args: readonly string[], signal?: AbortSignal): Promise<CommandResult> =>
  runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs: 60_000, signal });

/** Uma worktree git descartável ancorada num SHA. Cria uma branch nova e um
 * diretório temporário; o repositório e o workspace original nunca mudam. */
export class GitWorktree {
  private nodeModulesLinks: string[] = [];
  private constructor(readonly repoRoot: string, readonly root: string, readonly branch: string, private readonly base: string, private readonly baseSha: string) {}

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
    return new GitWorktree(input.repoRoot, root, input.branch, base, input.sha);
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

  /** Diff estruturado (numstat) do estado atual vs base: por arquivo, caminho +
   * inserções/deleções (-1 quando binário). Contagens apenas — nunca linhas
   * cruas —, para alimentar o resumo do handoff durável (INT-05). Deve ser lido
   * ANTES do commit (usa o índice staged vs HEAD). */
  async diffNumstat(signal?: AbortSignal): Promise<readonly { readonly path: string; readonly insertions: number; readonly deletions: number }[]> {
    await this.stageAll(signal);
    const result = await git(this.root, ['diff', '--cached', '--numstat'], signal);
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
    const staged = await git(this.root, ['diff', '--cached', '--quiet'], signal);
    if (staged.exitCode === 0) return null;
    const committed = await git(this.root, ['-c', 'user.name=anima-worktree', '-c', 'user.email=worktree@anima.local', 'commit', '--no-gpg-sign', '-m', message], signal);
    if (committed.exitCode !== 0) return null;
    const head = await git(this.root, ['rev-parse', 'HEAD'], signal);
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
      const reset = await git(this.root, ['reset', '--hard', this.baseSha]);
      const clean = await git(this.root, ['clean', '-fdx']);
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
    await git(this.repoRoot, ['worktree', 'remove', '--force', this.root]).catch(() => {});
    await git(this.repoRoot, ['worktree', 'prune']).catch(() => {});
    await rm(this.base, { recursive: true, force: true }).catch(() => {});
    if (options.deleteBranch) await git(this.repoRoot, ['branch', '-D', this.branch]).catch(() => {});
  }
}
