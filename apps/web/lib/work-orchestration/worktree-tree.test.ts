/** @jest-environment node */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitWorktree, runProcess } from './worktree';

jest.setTimeout(30_000);
const git = (repo: string, args: readonly string[]) => runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs: 30_000 });

describe('árvore staged real', () => {
  let repo: string;
  let tree: GitWorktree;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'anima-tree-'));
    await git(repo, ['init', '-b', 'main']);
    await git(repo, ['config', 'user.name', 'teste']);
    await git(repo, ['config', 'user.email', 'teste@anima.local']);
    await git(repo, ['config', 'commit.gpgsign', 'false']);
    await writeFile(join(repo, 'a.txt'), 'inicial\n');
    await writeFile(join(repo, '.gitignore'), 'ignored.txt\n');
    await git(repo, ['add', '-A']);
    await git(repo, ['commit', '-m', 'inicial']);
    const sha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
    tree = await GitWorktree.create({ repoRoot: repo, sha, branch: 'arvore' });
  });
  afterEach(async () => {
    try { if (tree) await tree.dispose({ deleteBranch: true }); }
    finally { if (repo) await rm(repo, { recursive: true, force: true }); }
  });
  test('mantém árvore determinística para conteúdo idêntico', async () => {
    const first = await tree.stagedTreeSha();
    expect(first).toMatch(/^[a-f0-9]{40}$/);
    expect(await tree.stagedTreeSha()).toBe(first);
  });
  test('muda árvore ao editar arquivo rastreado', async () => {
    const before = await tree.stagedTreeSha();
    await writeFile(join(tree.root, 'a.txt'), 'alterado\n');
    expect(await tree.stagedTreeSha()).not.toBe(before);
  });
  test('inclui arquivo novo ainda não rastreado', async () => {
    const before = await tree.stagedTreeSha();
    await writeFile(join(tree.root, 'novo.txt'), 'novo\n');
    const after = await tree.stagedTreeSha();
    expect(after).toMatch(/^[a-f0-9]{40}$/);
    expect(after).not.toBe(before);
    expect((await git(tree.root, ['ls-tree', after!, 'novo.txt'])).stdout).toContain('novo.txt');
  });
  test('exclui arquivo ignorado da árvore', async () => {
    const before = await tree.stagedTreeSha();
    await writeFile(join(tree.root, 'ignored.txt'), 'ignorado\n');
    expect(await tree.stagedTreeSha()).toBe(before);
  });
  test('iguala árvore do índice à árvore do commit correspondente', async () => {
    await writeFile(join(tree.root, 'a.txt'), 'versão final\n');
    const staged = await tree.stagedTreeSha();
    await git(tree.root, ['commit', '-m', 'Atualize conteúdo']);
    expect((await git(tree.root, ['rev-parse', 'HEAD^{tree}'])).stdout.trim()).toBe(staged);
  });
  test('devolve null para repositório inválido', async () => {
    await tree.dispose({ deleteBranch: true });
    expect(await tree.stagedTreeSha()).toBeNull();
  });
});
