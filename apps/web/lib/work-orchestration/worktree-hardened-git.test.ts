/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitWorktree } from './worktree';

// T1-R2 P2-3: o repositório externo é de terceiros. `git worktree add` roda o hook `post-checkout`, e o commit roda
// `pre-commit`/`post-commit`; `core.fsmonitor` executa um comando em operações de índice. Para o target externo (hardenedGit)
// nada disso pode executar. O CONTROLE (sem hardenedGit) prova que o hook dispara neste ambiente — sem ele o teste seria vácuo.
jest.setTimeout(60_000);

const sandboxes: string[] = [];
afterAll(() => { for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();

const sh = (path: string) => path.replace(/\\/g, '/');
function repoWithHostileHooks(): { root: string; sha: string; markers: { postCheckout: string; preCommit: string; postCommit: string; fsmonitor: string } } {
  const base = mkdtempSync(join(tmpdir(), 't1-hook-')); sandboxes.push(base);
  mkdirSync(join(base, 'repo'));
  const root = realpathSync.native(join(base, 'repo'));
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'a.txt'), 'a\n'); git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'inicial');
  const markers = { postCheckout: join(base, 'MARK-post-checkout'), preCommit: join(base, 'MARK-pre-commit'), postCommit: join(base, 'MARK-post-commit'), fsmonitor: join(base, 'MARK-fsmonitor') };
  const hook = (name: string, marker: string) => writeFileSync(join(root, '.git', 'hooks', name), `#!/bin/sh\necho executed > "${sh(marker)}"\nexit 0\n`, { mode: 0o755 });
  hook('post-checkout', markers.postCheckout); hook('pre-commit', markers.preCommit); hook('post-commit', markers.postCommit);
  // fsmonitor hostil: comando arbitrário que o Git executaria ao consultar o índice
  writeFileSync(join(root, '.git', 'fsm.sh'), `#!/bin/sh\necho executed > "${sh(markers.fsmonitor)}"\nexit 0\n`, { mode: 0o755 });
  git(root, 'config', 'core.fsmonitor', sh(join(root, '.git', 'fsm.sh')));
  return { root, sha: git(root, 'rev-parse', 'HEAD'), markers };
}

describe('Git do Host sobre o repositório principal de um target externo', () => {
  test('CONTROLE: sem hardenedGit o hook post-checkout do repositório executa (o teste não é vácuo)', async () => {
    const repo = repoWithHostileHooks();
    const wt = await GitWorktree.create({ repoRoot: repo.root, sha: repo.sha, branch: 'anima-work/control' });
    try { expect(existsSync(repo.markers.postCheckout)).toBe(true); } finally { await wt.dispose({ deleteBranch: true }); }
  });

  test('hardenedGit: criar a worktree NÃO executa post-checkout; commit NÃO executa pre/post-commit; dispose NÃO executa fsmonitor', async () => {
    const repo = repoWithHostileHooks();
    const wt = await GitWorktree.create({ repoRoot: repo.root, sha: repo.sha, branch: 'anima-work/hardened', hardenedGit: true });
    try {
      expect(existsSync(join(wt.root, 'a.txt'))).toBe(true);               // a worktree foi criada de verdade
      expect(git(repo.root, 'branch', '--list', 'anima-work/hardened')).toContain('anima-work/hardened');
      expect(existsSync(repo.markers.postCheckout)).toBe(false);           // P2-3: hook de criação não rodou
      writeFileSync(join(wt.root, 'b.txt'), 'b\n');
      const committed = await wt.commit('anima(checkpoint): b');
      expect(committed).toMatch(/^[0-9a-f]{40}$/);                          // o commit aconteceu
      expect(existsSync(repo.markers.preCommit)).toBe(false);              // hooks de commit não rodaram
      expect(existsSync(repo.markers.postCommit)).toBe(false);
    } finally {
      await wt.dispose({ deleteBranch: true });
    }
    expect(existsSync(repo.markers.fsmonitor)).toBe(false);                // fsmonitor hostil nunca foi consultado
    expect(existsSync(repo.markers.postCheckout)).toBe(false);
    expect(git(repo.root, 'branch', '--list', 'anima-work/hardened')).toBe(''); // dispose também limpou pelo Git endurecido
  });
});
