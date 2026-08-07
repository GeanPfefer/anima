/** @jest-environment node */
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitWorktree, parseGateCommand, runGate, runProcess, safeJoin } from './worktree';

// Operações git reais podem ficar lentas sob carga paralela; folga o timeout
// para não flakar por contenção (o padrão de 5s do jest é curto demais aqui).
jest.setTimeout(30_000);

const git = (repo: string, args: readonly string[]) => runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs: 30_000 });

async function makeRepo(): Promise<{ repo: string; sha: string; cleanup: () => Promise<void> }> {
  const repo = await mkdtemp(join(tmpdir(), 'anima-repo-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'test']);
  await git(repo, ['config', 'user.email', 'test@anima.local']);
  await git(repo, ['config', 'commit.gpgsign', 'false']);
  await mkdir(join(repo, 'packages', 'core', 'src'), { recursive: true });
  await writeFile(join(repo, 'packages', 'core', 'src', 'existing.ts'), 'export const one = 1;\n');
  await writeFile(join(repo, '.gitignore'), 'node_modules/\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'inicial']);
  const head = await git(repo, ['rev-parse', 'HEAD']);
  return { repo, sha: head.stdout.trim(), cleanup: () => rm(repo, { recursive: true, force: true }) };
}

describe('safeJoin — guardas de caminho', () => {
  const root = process.platform === 'win32' ? 'C:\\repo' : '/repo';
  test('aceita caminho relativo dentro da raiz', () => expect(safeJoin(root, 'packages/core/src/x.ts')).not.toBeNull());
  test('recusa traversal', () => expect(safeJoin(root, '../fora.ts')).toBeNull());
  test('recusa caminho absoluto', () => expect(safeJoin(root, process.platform === 'win32' ? 'C:\\x' : '/etc/passwd')).toBeNull());
  test('recusa segmento .git', () => expect(safeJoin(root, '.git/config')).toBeNull());
  test('recusa node_modules', () => expect(safeJoin(root, 'node_modules/x/index.js')).toBeNull());
  test('recusa .env', () => expect(safeJoin(root, 'apps/web/.env.local')).toBeNull());
  test('recusa arquivo de chave', () => expect(safeJoin(root, 'secrets/id_rsa')).toBeNull());
  test('recusa a própria raiz', () => expect(safeJoin(root, '.')).toBeNull());
});

describe('parseGateCommand — allowlist', () => {
  test('aceita npm run typecheck', () => expect(parseGateCommand('npm run typecheck')).not.toBeNull());
  test('aceita npm test', () => expect(parseGateCommand('npm test')).not.toBeNull());
  test('aceita workspace', () => expect(parseGateCommand('npm run typecheck --workspace=packages/core')).not.toBeNull());
  test('aceita passthrough', () => expect(parseGateCommand('npm test -- packages/core')).not.toBeNull());
  test('recusa comando arbitrário', () => expect(parseGateCommand('rm -rf /')).toBeNull());
  test('recusa git', () => expect(parseGateCommand('git push')).toBeNull());
  test('recusa npm install', () => expect(parseGateCommand('npm install malware')).toBeNull());
  test('recusa encadeamento', () => expect(parseGateCommand('npm test && rm x')).toBeNull());
});

describe('runGate — recusa fora da allowlist sem spawnar', () => {
  test('exitCode -2 para comando não permitido', async () => {
    const result = await runGate('curl http://x', tmpdir(), 5_000);
    expect(result.exitCode).toBe(-2);
    expect(result.durationMs).toBe(0);
  });
});

describe('runProcess — timeout e cancelamento', () => {
  // Processo único (node) que morre limpo ao ser morto — sem netos órfãos.
  const sleeper = { file: process.execPath, args: ['-e', 'setTimeout(()=>{},30000)'] };
  test('timeout mata o processo', async () => {
    const result = await runProcess(sleeper.file, sleeper.args, { cwd: tmpdir(), timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  }, 15_000);
  test('cancelamento por AbortSignal', async () => {
    const controller = new AbortController();
    const pending = runProcess(sleeper.file, sleeper.args, { cwd: tmpdir(), timeoutMs: 30_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 150);
    const result = await pending;
    expect(result.cancelled).toBe(true);
  }, 15_000);
});

describe('GitWorktree — ciclo de vida', () => {
  let ctx: Awaited<ReturnType<typeof makeRepo>>;
  beforeAll(async () => { ctx = await makeRepo(); });
  afterAll(async () => { await ctx.cleanup(); });

  test('cria worktree isolada, escreve, diffa e preserva o original', async () => {
    const worktree = await GitWorktree.create({ repoRoot: ctx.repo, sha: ctx.sha, branch: `anima-work/test-${Date.now()}` });
    try {
      // O arquivo pré-existente do SHA está presente na worktree.
      expect(await worktree.readWorkspaceFile('packages/core/src/existing.ts')).toContain('export const one');

      const wrote = await worktree.writeWorkspaceFile('packages/core/src/added.ts', 'export const two = 2;\n');
      expect(wrote).toBe(true);
      expect(await worktree.writeWorkspaceFile('../escape.ts', 'x')).toBe(false);
      expect(await worktree.writeWorkspaceFile('.git/hooks/evil', 'x')).toBe(false);

      const changed = await worktree.changedFiles();
      expect(changed).toContain('packages/core/src/added.ts');
      expect(await worktree.diff()).toContain('export const two = 2;');

      // O workspace ORIGINAL não foi tocado.
      await expect(stat(join(ctx.repo, 'packages', 'core', 'src', 'added.ts'))).rejects.toBeTruthy();
      const originalStatus = await git(ctx.repo, ['status', '--porcelain']);
      expect(originalStatus.stdout.trim()).toBe('');

      const commitSha = await worktree.commit('anima: mudança de prova');
      expect(commitSha).toMatch(/^[a-f0-9]{40}$/);
    } finally {
      await worktree.dispose({ deleteBranch: true });
    }
    // Após dispose a árvore de trabalho some.
    await expect(stat(worktree.root)).rejects.toBeTruthy();
    // E o repositório original segue com apenas um commit na branch main.
    const log = await git(ctx.repo, ['log', '--oneline', 'main']);
    expect(log.stdout.trim().split(/\r?\n/)).toHaveLength(1);
  });

  test('linkNodeModules religa o node_modules real e dispose NÃO o apaga', async () => {
    await mkdir(join(ctx.repo, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(ctx.repo, 'node_modules', 'pkg', 'sentinel.txt'), 'PRESERVAR');
    const worktree = await GitWorktree.create({ repoRoot: ctx.repo, sha: ctx.sha, branch: `anima-work/nm-${Date.now()}` });
    try {
      expect(await worktree.linkNodeModules()).toBe(true);
      // A ligação enxerga o sentinela do node_modules real.
      expect(await readFile(join(worktree.root, 'node_modules', 'pkg', 'sentinel.txt'), 'utf8')).toBe('PRESERVAR');
    } finally {
      await worktree.dispose({ deleteBranch: true });
    }
    // O node_modules REAL e o sentinela sobrevivem intactos ao dispose.
    expect(await readFile(join(ctx.repo, 'node_modules', 'pkg', 'sentinel.txt'), 'utf8')).toBe('PRESERVAR');
    await rm(join(ctx.repo, 'node_modules'), { recursive: true, force: true });
  });

  test('dispose preserva a branch por padrão como referência revisável', async () => {
    const branch = `anima-work/keep-${Date.now()}`;
    const worktree = await GitWorktree.create({ repoRoot: ctx.repo, sha: ctx.sha, branch });
    await worktree.writeWorkspaceFile('packages/core/src/kept.ts', 'export const three = 3;\n');
    await worktree.commit('anima: mudança preservada');
    await worktree.dispose();
    const branches = await git(ctx.repo, ['branch', '--list', branch]);
    expect(branches.stdout).toContain(branch);
    await git(ctx.repo, ['branch', '-D', branch]);
  });

  test('a worktree reflete o SHA autorizado, não o HEAD posterior', async () => {
    // Um commit posterior à "aprovação" move o HEAD do repositório original.
    await writeFile(join(ctx.repo, 'packages', 'core', 'src', 'after.ts'), 'export const after = 1;\n');
    await git(ctx.repo, ['add', '-A']);
    await git(ctx.repo, ['commit', '-m', 'depois da aprovacao']);
    // A worktree nasce do SHA autorizado (o primeiro commit), não do HEAD atual.
    const worktree = await GitWorktree.create({ repoRoot: ctx.repo, sha: ctx.sha, branch: `anima-work/sha-${Date.now()}` });
    try {
      expect(await worktree.readWorkspaceFile('packages/core/src/after.ts')).toBeNull();
      expect(await worktree.readWorkspaceFile('packages/core/src/existing.ts')).toContain('export const one');
    } finally {
      await worktree.dispose({ deleteBranch: true });
    }
  });
});

describe('GitWorktree.restoreToBase — outcome atomicity ao estado-base', () => {
  async function makeIgnoreRepo() {
    const repo = await mkdtemp(join(tmpdir(), 'anima-rb-'));
    await git(repo, ['init', '-b', 'main']);
    await git(repo, ['config', 'user.name', 'test']);
    await git(repo, ['config', 'user.email', 'test@anima.local']);
    await git(repo, ['config', 'commit.gpgsign', 'false']);
    await mkdir(join(repo, 'docs'), { recursive: true });
    await writeFile(join(repo, 'docs', 'existing.md'), '# Base\nlinha original\n');
    await writeFile(join(repo, '.gitignore'), 'node_modules/\ngenerated/\n');
    await git(repo, ['add', '-A']);
    await git(repo, ['commit', '-m', 'inicial']);
    const head = await git(repo, ['rev-parse', 'HEAD']);
    return { repo, sha: head.stdout.trim(), cleanup: () => rm(repo, { recursive: true, force: true }) };
  }

  let ctx: Awaited<ReturnType<typeof makeIgnoreRepo>>;
  let wt: GitWorktree;
  let baseExisting: string | null; // conteúdo do arquivo no base (bytes reais do checkout, ex. CRLF no Windows)
  beforeEach(async () => {
    ctx = await makeIgnoreRepo();
    wt = await GitWorktree.create({ repoRoot: ctx.repo, sha: ctx.sha, branch: `anima-work/rb-${Date.now()}-${Math.random().toString(36).slice(2)}` });
    baseExisting = await wt.readWorkspaceFile('docs/existing.md');
  });
  afterEach(async () => { await wt.dispose({ deleteBranch: true }).catch(() => {}); await ctx.cleanup(); });
  const status = async () => (await git(wt.root, ['status', '--porcelain'])).stdout.trim();

  test('1) worktree começa limpa no SHA-base', async () => {
    expect(await status()).toBe('');
    expect(await wt.readWorkspaceFile('docs/existing.md')).toBe(baseExisting);
  });

  test('2) write A + write B, restore → ambos exatamente no base', async () => {
    await wt.writeWorkspaceFile('docs/existing.md', 'MODIFICADO A');
    await wt.writeWorkspaceFile('docs/novo.md', 'B novo');
    expect(await status()).not.toBe('');
    expect(await wt.restoreToBase()).toBe(true);
    expect(await status()).toBe('');
    expect(await wt.readWorkspaceFile('docs/existing.md')).toBe(baseExisting);
    expect(await wt.readWorkspaceFile('docs/novo.md')).toBeNull();
  });

  test('3) write que altera o próprio arquivo e "falha" → restore volta ao base', async () => {
    await wt.writeWorkspaceFile('docs/existing.md', 'meio-caminho parcial'); // simula alteração parcial
    expect(await wt.restoreToBase()).toBe(true);
    expect(await wt.readWorkspaceFile('docs/existing.md')).toBe(baseExisting);
  });

  test('4) create_file + falha posterior → arquivo criado desaparece', async () => {
    await wt.writeWorkspaceFile('docs/criado.md', '# criado');
    expect(await wt.readWorkspaceFile('docs/criado.md')).toBe('# criado');
    expect(await wt.restoreToBase()).toBe(true);
    expect(await wt.readWorkspaceFile('docs/criado.md')).toBeNull();
  });

  test('5) create em caminho IGNORADO pelo git some com clean -fdx', async () => {
    await wt.writeWorkspaceFile('generated/saida.md', 'ignorado');
    expect(await wt.readWorkspaceFile('generated/saida.md')).toBe('ignorado');
    expect(await wt.restoreToBase()).toBe(true);
    expect(await wt.readWorkspaceFile('generated/saida.md')).toBeNull(); // -x removeu o ignorado
  });

  test('6) múltiplos creates + replaces → falha restaura tudo', async () => {
    await wt.writeWorkspaceFile('docs/existing.md', 'X');
    await wt.writeWorkspaceFile('docs/n1.md', 'a');
    await wt.writeWorkspaceFile('generated/n2.md', 'b');
    expect(await wt.restoreToBase()).toBe(true);
    expect(await status()).toBe('');
    expect(await wt.readWorkspaceFile('docs/existing.md')).toBe(baseExisting);
    expect(await wt.readWorkspaceFile('docs/n1.md')).toBeNull();
    expect(await wt.readWorkspaceFile('generated/n2.md')).toBeNull();
  });

  test('7) restore em worktree quebrada devolve false, nunca lança', async () => {
    await wt.dispose({ deleteBranch: true }); // remove a worktree
    await expect(wt.restoreToBase()).resolves.toBe(false);
  });

  // --- Commit 7: a restauração NÃO é cancelável pelo signal da tentativa ---

  test('8) worktree suja + signal da tentativa JÁ ABORTADO → restore ainda volta ao base', async () => {
    const controller = new AbortController();
    controller.abort(); // a tentativa foi cancelada
    await wt.writeWorkspaceFile('docs/existing.md', 'sujo por cancelamento');
    await wt.writeWorkspaceFile('docs/novo.md', 'criado durante cancelamento');
    // restoreToBase nem recebe o signal — a limpeza roda independentemente:
    expect(controller.signal.aborted).toBe(true);
    expect(await wt.restoreToBase()).toBe(true);
    expect(await status()).toBe('');
    expect(await wt.readWorkspaceFile('docs/existing.md')).toBe(baseExisting);
    expect(await wt.readWorkspaceFile('docs/novo.md')).toBeNull();
  });

  test('9) create_file + abort → criado desaparece mesmo com signal abortado', async () => {
    const controller = new AbortController();
    await wt.writeWorkspaceFile('docs/criado.md', '# criado');
    controller.abort();
    expect(await wt.restoreToBase()).toBe(true);
    expect(await wt.readWorkspaceFile('docs/criado.md')).toBeNull();
  });

  test('10) replace + abort → bytes voltam ao base mesmo com signal abortado', async () => {
    const controller = new AbortController();
    await wt.writeWorkspaceFile('docs/existing.md', 'ALTERADO e cancelado');
    controller.abort();
    expect(await wt.restoreToBase()).toBe(true);
    expect(await wt.readWorkspaceFile('docs/existing.md')).toBe(baseExisting);
  });
});
