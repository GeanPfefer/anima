/** @jest-environment node */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitWorktree, validateDedicatedWorktreeParent, worktreeParentDir } from './worktree';
import { guardWorkspacePath, readGuardedFile, removeHostileWorkspaceLinks, scanWorkspaceTree, writeGuardedFile } from './workspace-guard';

// Prova adversarial da guarda do HOST sobre o workspace do candidato. Segredos FICTÍCIOS, diretórios descartáveis.
// Os links são removidos explicitamente (rmdir/unlink do LINK) antes da limpeza recursiva dos diretórios temporários.
jest.setTimeout(60_000); // Git real e sandbox real sob carga ampla da suíte
const SECRET = 'FAKE-SECRET-AAAA';

interface Rig { readonly dir: string; readonly ws: string; readonly outside: string; readonly secret: string }
const rigs: Rig[] = [];
function rig(): Rig {
  const dir = mkdtempSync(join(tmpdir(), 'anima-wsguard-'));
  const ws = join(dir, 'ws'); const outside = join(dir, 'outside');
  mkdirSync(ws); mkdirSync(outside);
  const secret = join(outside, '.env.local'); writeFileSync(secret, SECRET);
  writeFileSync(join(outside, 'victim.txt'), 'victim');
  writeFileSync(join(ws, 'ok.txt'), 'legit');
  const r = { dir, ws, outside, secret };
  rigs.push(r);
  return r;
}
function tryFileSymlink(target: string, path: string): boolean {
  try { symlinkSync(target, path, 'file'); return true; } catch { return false; }
}
afterEach(() => {
  for (const r of rigs.splice(0)) {
    for (const name of ['jn', 'jn2', 'sl', 'nm']) {
      const p = join(r.ws, name);
      try { const info = lstatSync(p); if (info.isSymbolicLink()) { try { rmdirSync(p); } catch { unlinkSync(p); } } } catch { /* ausente */ }
    }
    rmSync(r.dir, { recursive: true, force: true });
  }
});

describe('guarda do Host — varredura e leitura/escrita confinadas', () => {
  it('CONTROLE: árvore limpa passa; leitura e escrita legítimas funcionam (inclusive diretórios novos)', async () => {
    const r = rig();
    expect((await scanWorkspaceTree(r.ws)).ok).toBe(true);
    expect(await readGuardedFile(r.ws, join(r.ws, 'ok.txt'))).toBe('legit');
    expect(await writeGuardedFile(r.ws, join(r.ws, 'a', 'b', 'novo.txt'), 'x')).toBe(true);
    expect(readFileSync(join(r.ws, 'a', 'b', 'novo.txt'), 'utf8')).toBe('x');
    expect(await writeGuardedFile(r.ws, join(r.ws, 'ok.txt'), 'novo')).toBe(true);
  });

  it('junction para fora: a varredura acusa, nunca desce, e leitura/escrita/diretório-pai via junction são recusados', async () => {
    const r = rig();
    symlinkSync(r.outside, join(r.ws, 'jn'), 'junction');
    const scan = await scanWorkspaceTree(r.ws);
    expect(scan.ok).toBe(false);
    expect(scan.violations.map(v => v.kind)).toEqual(['link']); // só o link; o conteúdo de `outside` não foi varrido
    expect(await readGuardedFile(r.ws, join(r.ws, 'jn', '.env.local'))).toBeNull();
    expect(await writeGuardedFile(r.ws, join(r.ws, 'jn', 'PLANTED.txt'), 'x')).toBe(false);
    expect(await writeGuardedFile(r.ws, join(r.ws, 'jn', 'victim.txt'), 'PWNED')).toBe(false);
    expect(await writeGuardedFile(r.ws, join(r.ws, 'jn', 'novo', 'x.txt'), 'x')).toBe(false);
    expect(existsSync(join(r.outside, 'PLANTED.txt'))).toBe(false);
    expect(existsSync(join(r.outside, 'novo'))).toBe(false);
    expect(readFileSync(join(r.outside, 'victim.txt'), 'utf8')).toBe('victim');
    const g = await guardWorkspacePath(r.ws, join(r.ws, 'jn', 'victim.txt'));
    expect(g.ok).toBe(false);
  });

  it('symlink de arquivo apontando para o segredo é recusado (leitura e sobrescrita)', async () => {
    const r = rig();
    if (!tryFileSymlink(r.secret, join(r.ws, 'sl'))) return; // sem privilégio de symlink neste host
    expect((await scanWorkspaceTree(r.ws)).violations.map(v => v.kind)).toEqual(['link']);
    expect(await readGuardedFile(r.ws, join(r.ws, 'sl'))).toBeNull();
    expect(await writeGuardedFile(r.ws, join(r.ws, 'sl'), 'PWNED')).toBe(false);
    expect(readFileSync(r.secret, 'utf8')).toBe(SECRET);
  });

  it('hardlink para o segredo é recusado na varredura, na leitura e na escrita; o segredo permanece intacto', async () => {
    const r = rig();
    try { linkSync(r.secret, join(r.ws, 'hl.txt')); } catch { return; }
    const scan = await scanWorkspaceTree(r.ws);
    expect(scan.violations.map(v => v.kind)).toEqual(['hardlink']);
    expect(await readGuardedFile(r.ws, join(r.ws, 'hl.txt'))).toBeNull();
    expect(await writeGuardedFile(r.ws, join(r.ws, 'hl.txt'), 'PWNED')).toBe(false);
    expect(readFileSync(r.secret, 'utf8')).toBe(SECRET);
  });

  it('caminho fora da raiz e traversal lexical são recusados', async () => {
    const r = rig();
    expect((await guardWorkspacePath(r.ws, join(r.ws, '..', 'outside', 'victim.txt'))).ok).toBe(false);
    expect(await readGuardedFile(r.ws, r.secret)).toBeNull();
    expect(await writeGuardedFile(r.ws, join(r.outside, 'x.txt'), 'x')).toBe(false);
  });

  it('link permitido do Host só vale enquanto aponta para o destino esperado (o candidato pode recriá-lo)', async () => {
    const r = rig();
    const deps = join(r.dir, 'deps'); mkdirSync(deps);
    const link = join(r.ws, 'nm');
    symlinkSync(deps, link, 'junction');
    const allowed = [{ link, target: deps }];
    expect((await scanWorkspaceTree(r.ws, allowed)).ok).toBe(true);
    rmdirSync(link); symlinkSync(r.outside, link, 'junction'); // candidato reaponta
    const scan = await scanWorkspaceTree(r.ws, allowed);
    expect(scan.ok).toBe(false);
    expect(scan.violations[0]?.kind).toBe('link');
  });

  it('removeHostileWorkspaceLinks apaga o LINK e o nome do hardlink, nunca o conteúdo de fora', async () => {
    const r = rig();
    symlinkSync(r.outside, join(r.ws, 'jn'), 'junction');
    let hard = true; try { linkSync(r.secret, join(r.ws, 'hl.txt')); } catch { hard = false; }
    const removed = await removeHostileWorkspaceLinks(r.ws);
    expect(removed.length).toBe(hard ? 2 : 1);
    expect(existsSync(join(r.ws, 'jn'))).toBe(false);
    expect(existsSync(join(r.ws, 'hl.txt'))).toBe(false);
    expect(readFileSync(r.secret, 'utf8')).toBe(SECRET);
    expect(readFileSync(join(r.outside, 'victim.txt'), 'utf8')).toBe('victim');
    expect((await scanWorkspaceTree(r.ws)).ok).toBe(true);
  });
});

describe('GitWorktree — Git, restauração e remoção diante de reparse points do candidato', () => {
  const CLEAN = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', HOME: tmpdir(), USERPROFILE: tmpdir(), GIT_CONFIG_NOSYSTEM: '1' };
  const sh = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, env: CLEAN as unknown as NodeJS.ProcessEnv, encoding: 'utf8' });

  async function gitRig(): Promise<{ r: Rig; work: GitWorktree }> {
    const r = rig();
    const main = join(r.dir, 'main'); mkdirSync(main);
    sh(main, ['init', '-q', '-b', 'main']); sh(main, ['config', 'user.name', 't']); sh(main, ['config', 'user.email', 't@t']);
    writeFileSync(join(main, 'a.txt'), 'base\n'); sh(main, ['add', '-A']); sh(main, ['commit', '-q', '-m', 'base']);
    const work = await GitWorktree.create({ repoRoot: main, sha: sh(main, ['rev-parse', 'HEAD']).trim(), branch: `anima-guard-${Date.now()}` });
    return { r, work };
  }

  it('junction plantada: stageAll/changedFiles/commit RECUSAM (nada do segredo entra no índice); read/write/kind confinados', async () => {
    const { r, work } = await gitRig();
    symlinkSync(r.outside, join(work.root, 'jn'), 'junction');
    expect((await work.inspectBoundary()).ok).toBe(false);
    await expect(work.stageAll()).rejects.toThrow(/fronteira do Host/);
    await expect(work.changedFiles()).rejects.toThrow();
    await expect(work.commit('x')).rejects.toThrow();
    expect(sh(work.root.replace(/\\/g, '/'), ['-C', work.root, 'ls-files', '--cached']).includes('.env.local')).toBe(false);
    expect(await work.readWorkspaceFile('jn/.env.local')).toBeNull();
    expect(await work.writeWorkspaceFile('jn/PLANTED.txt', 'x')).toBe(false);
    expect(await work.workspacePathKind('jn/victim.txt')).toBe('other');
    expect(existsSync(join(r.outside, 'PLANTED.txt'))).toBe(false);
    await work.dispose(); // remove o link, não o alvo
    expect(readFileSync(r.secret, 'utf8')).toBe(SECRET);
    expect(readFileSync(join(r.outside, 'victim.txt'), 'utf8')).toBe('victim');
  });

  it('restoreToBase remove a junction hostil antes do `git clean -fdx` e preserva o conteúdo de fora', async () => {
    const { r, work } = await gitRig();
    symlinkSync(r.outside, join(work.root, 'jn'), 'junction');
    expect(await work.restoreToBase()).toBe(true);
    expect(existsSync(join(work.root, 'jn'))).toBe(false);
    expect(readFileSync(r.secret, 'utf8')).toBe(SECRET);
    expect(readFileSync(join(r.outside, 'victim.txt'), 'utf8')).toBe('victim');
    expect((await work.inspectBoundary()).ok).toBe(true);
    await work.dispose();
  });

  it('CONTROLE: node_modules do Host (junction permitida) não é violação; o mesmo link reapontado é', async () => {
    const { r, work } = await gitRig();
    mkdirSync(join(work.repoRoot, 'node_modules'));
    expect(await work.linkNodeModules()).toBe(true);
    expect((await work.inspectBoundary()).ok).toBe(true);
    await work.stageAll(); // não lança
    const nm = join(work.root, 'node_modules');
    rmdirSync(nm); symlinkSync(r.outside, nm, 'junction');
    expect((await work.inspectBoundary()).ok).toBe(false);
    await work.dispose();
    expect(readFileSync(r.secret, 'utf8')).toBe(SECRET);
  });
});

// Com o sandbox REAL do Codex (`ANIMA_TEST_GATE_SANDBOX_CODEX_PATH=<codex.exe>`): o executor consegue plantar um symlink no workspace
// (o perfil :workspace permite) e o Host o recusa. Sem a variável, o teste é pulado (mesma convenção de gate-isolation.test.ts).
const SANDBOX_EXE = process.env.ANIMA_TEST_GATE_SANDBOX_CODEX_PATH ?? '';
const sandboxIt = process.platform === 'win32' && SANDBOX_EXE && existsSync(SANDBOX_EXE) ? it : it.skip;

describe('executor sandboxed planta link — o Host recusa (sandbox real)', () => {
  const CLEAN = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', HOME: tmpdir(), USERPROFILE: tmpdir(), GIT_CONFIG_NOSYSTEM: '1' };
  const sh = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, env: CLEAN as unknown as NodeJS.ProcessEnv, encoding: 'utf8' });
  sandboxIt('symlink criado pelo executor dentro do workspace: varredura, leitura, escrita e stageAll recusam; o segredo fica intacto', async () => {
    const r = rig();
    const main = join(r.dir, 'main'); mkdirSync(main);
    sh(main, ['init', '-q', '-b', 'main']); sh(main, ['config', 'user.name', 't']); sh(main, ['config', 'user.email', 't@t']);
    writeFileSync(join(main, 'a.txt'), 'base\n'); sh(main, ['add', '-A']); sh(main, ['commit', '-q', '-m', 'base']);
    const work = await GitWorktree.create({ repoRoot: main, sha: sh(main, ['rev-parse', 'HEAD']).trim(), branch: `anima-guard-sbx-${Date.now()}` });
    const script = `require('fs').symlinkSync(${JSON.stringify(r.secret)}, ${JSON.stringify(join(work.root, 'sl.txt'))}, 'file')`;
    const res = spawnSync(SANDBOX_EXE, ['sandbox', '-P', ':workspace', '-C', work.root, '--', process.execPath, '-e', script], { encoding: 'utf8' });
    expect(existsSync(join(work.root, 'sl.txt')) || lstatSync(join(work.root, 'sl.txt'), { throwIfNoEntry: false }) !== undefined).toBe(res.status === 0);
    if (res.status === 0) {
      expect((await work.inspectBoundary()).violations.map(v => v.kind)).toEqual(['link']);
      expect(await work.readWorkspaceFile('sl.txt')).toBeNull();
      expect(await work.writeWorkspaceFile('sl.txt', 'PWNED')).toBe(false);
      await expect(work.stageAll()).rejects.toThrow(/fronteira do Host/);
      expect(readFileSync(r.secret, 'utf8')).toBe(SECRET);
    }
    await work.dispose();
  });
});

describe('worktreeParentDir — pai dedicado dos workspaces (ANIMA_WORKTREE_PARENT)', () => {
  it('ausente ⇒ comportamento atual; absoluto válido no mesmo volume vence', () => {
    expect(worktreeParentDir('G:/anima', 'C:/t', {})).toBe(join('G:/anima', '.worktrees'));
    expect(worktreeParentDir('G:/anima', 'G:/t', {})).toBe('G:/t');
    expect(worktreeParentDir('G:/anima', 'C:/t', { ANIMA_WORKTREE_PARENT: 'G:\\anima-workspaces' })).toBe(join('G:\\anima-workspaces'));
  });
  it.each([
    ['relativo', 'relativo\\x'], ['UNC', '\\\\host\\share\\x'], ['traversal', 'G:\\anima-workspaces\\..\\x'], ['outro volume', 'C:\\anima-workspaces'],
    ['raiz de unidade', 'G:\\'], ['o próprio repositório', 'G:\\anima'], ['ancestral do repositório', 'G:\\'], ['dentro de .git', 'G:\\anima\\.git\\wt'],
    ['caractere inválido', 'G:\\anima-workspaces\\a|b'],
  ])('configurado inválido (%s) ⇒ ERRO, nunca volta em silêncio ao padrão', (_name, value) => {
    expect(() => validateDedicatedWorktreeParent('G:\\anima', value)).toThrow(/ANIMA_WORKTREE_PARENT inválido/);
    expect(() => worktreeParentDir('G:/anima', 'C:/t', { ANIMA_WORKTREE_PARENT: value })).toThrow();
  });
  it('subdiretório do repositório que não seja .git é aceito (ex.: G:\\anima\\.worktrees)', () => {
    expect(validateDedicatedWorktreeParent('G:\\anima', 'G:\\anima\\.worktrees')).toBe(join('G:\\anima\\.worktrees'));
  });
});

describe('GitWorktree com pai dedicado — Host cria e controla; workspaces descartáveis; escapes recusados', () => {
  const CLEAN = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', HOME: tmpdir(), USERPROFILE: tmpdir(), GIT_CONFIG_NOSYSTEM: '1' };
  const sh = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, env: CLEAN as unknown as NodeJS.ProcessEnv, encoding: 'utf8' });
  const saved = process.env.ANIMA_WORKTREE_PARENT;
  afterEach(() => { if (saved === undefined) delete process.env.ANIMA_WORKTREE_PARENT; else process.env.ANIMA_WORKTREE_PARENT = saved; });

  function repo(r: Rig): { main: string; sha: string } {
    const main = join(r.dir, 'main'); mkdirSync(main);
    sh(main, ['init', '-q', '-b', 'main']); sh(main, ['config', 'user.name', 't']); sh(main, ['config', 'user.email', 't@t']);
    writeFileSync(join(main, 'a.txt'), 'base\n'); sh(main, ['add', '-A']); sh(main, ['commit', '-q', '-m', 'base']);
    return { main, sha: sh(main, ['rev-parse', 'HEAD']).trim() };
  }

  it('cria o pai ausente, coloca o workspace dentro dele (mkdtemp), funciona com Git e com junction de dependências, e dispose o remove', async () => {
    const r = rig(); const { main, sha } = repo(r);
    const dedicated = join(r.dir, 'workspaces');
    process.env.ANIMA_WORKTREE_PARENT = dedicated;
    mkdirSync(join(main, 'node_modules'));
    const work = await GitWorktree.create({ repoRoot: main, sha, branch: `anima-ded-${Date.now()}` });
    expect(work.root.toLowerCase().startsWith((dedicated + '\\').toLowerCase())).toBe(true);
    expect(await work.writeWorkspaceFile('b.txt', 'novo\n')).toBe(true);
    expect(await work.linkNodeModules()).toBe(true);
    expect((await work.inspectBoundary()).ok).toBe(true);
    expect(await work.commit('c')).toMatch(/^[0-9a-f]{40}$/);
    await work.dispose();
    expect(existsSync(work.root)).toBe(false);
    expect(existsSync(join(main, 'node_modules'))).toBe(true); // a junction foi removida, não o alvo
  });

  it('pai dedicado que é junction/symlink é recusado (o Host tem de ser dono de um diretório real)', async () => {
    const r = rig(); const { main, sha } = repo(r);
    const dedicated = join(r.dir, 'workspaces-link');
    symlinkSync(r.outside, dedicated, 'junction');
    process.env.ANIMA_WORKTREE_PARENT = dedicated;
    try {
      await expect(GitWorktree.create({ repoRoot: main, sha, branch: `anima-ded-link-${Date.now()}` })).rejects.toThrow(/ANIMA_WORKTREE_PARENT inválido/);
      expect(readFileSync(r.secret, 'utf8')).toBe(SECRET);
      expect(existsSync(join(r.outside, 'a.txt'))).toBe(false);
    } finally { rmdirSync(dedicated); }
  });

  it('candidato planta junction para fora no workspace dedicado: Git recusa, restore remove só o link, o segredo permanece', async () => {
    const r = rig(); const { main, sha } = repo(r);
    process.env.ANIMA_WORKTREE_PARENT = join(r.dir, 'workspaces');
    const work = await GitWorktree.create({ repoRoot: main, sha, branch: `anima-ded-esc-${Date.now()}` });
    symlinkSync(r.outside, join(work.root, 'jn'), 'junction');
    await expect(work.stageAll()).rejects.toThrow(/fronteira do Host/);
    expect(await work.writeWorkspaceFile('jn/PLANTED.txt', 'x')).toBe(false);
    expect(await work.restoreToBase()).toBe(true);
    expect(existsSync(join(work.root, 'jn'))).toBe(false);
    expect(readFileSync(r.secret, 'utf8')).toBe(SECRET);
    expect(existsSync(join(r.outside, 'PLANTED.txt'))).toBe(false);
    await work.dispose();
  });
});