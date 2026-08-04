/** @jest-environment node */
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitWorktree, parseGateCommand, runGate, runProcess, safeJoin } from './worktree';

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
});
