/** @jest-environment node */
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitWorktree, isTransientWorktreeError, parseGateCommand, runGate, runProcess, safeJoin } from './worktree';

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

describe('isTransientWorktreeError — resiliência da criação de worktree', () => {
  // Falhas de filesystem transitórias na criação (Windows: AV/indexador segura o TEMP
  // recém-criado; locks de ref) DEVEM re-tentar. É a causa observada do attempt
  // a719efd0: `git worktree add` recusado com "fatal: cannot create directory ...".
  test('retenta em "cannot create directory: Permission denied"', () =>
    expect(isTransientWorktreeError("Preparing worktree (new branch 'anima-work/x')\nfatal: cannot create directory at 'C:/Users/x/AppData/Local/Temp/anima-wt-ab/tree': Permission denied")).toBe(true));
  test('retenta em "Access is denied" (Windows)', () =>
    expect(isTransientWorktreeError('fatal: cannot create leading directories: Access is denied')).toBe(true));
  test('retenta em lock de ref', () =>
    expect(isTransientWorktreeError("fatal: cannot lock ref 'refs/heads/anima-work/x': Unable to create '.git/.../x.lock': File exists")).toBe(true));
  test('retenta em arquivo em uso por outro processo (Windows)', () =>
    expect(isTransientWorktreeError('error: the file is being used by another process')).toBe(true));
  // Erros DETERMINÍSTICOS não re-tentam: repetir só reproduziria a mesma falha.
  test('NÃO retenta em SHA inválido', () =>
    expect(isTransientWorktreeError("fatal: invalid reference: deadbeef")).toBe(false));
  test('NÃO retenta em referência inexistente', () =>
    expect(isTransientWorktreeError("fatal: not a valid object name 'nope'")).toBe(false));
  test('NÃO retenta em erro vazio', () => expect(isTransientWorktreeError('')).toBe(false));
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

  test('linkNodeModules religa tamb�m node_modules f�sicos dos workspaces e dispose preserva os alvos reais', async () => {
    await mkdir(join(ctx.repo, 'node_modules', 'root-pkg'), { recursive: true });
    await mkdir(join(ctx.repo, 'apps', 'web', 'node_modules', 'web-pkg'), { recursive: true });
    await mkdir(join(ctx.repo, 'apps', 'mobile', 'node_modules', 'mobile-pkg'), { recursive: true });

    await writeFile(
      join(ctx.repo, 'node_modules', 'root-pkg', 'sentinel.txt'),
      'ROOT-PRESERVAR',
    );
    await writeFile(
      join(ctx.repo, 'apps', 'web', 'node_modules', 'web-pkg', 'sentinel.txt'),
      'WEB-PRESERVAR',
    );
    await writeFile(
      join(ctx.repo, 'apps', 'mobile', 'node_modules', 'mobile-pkg', 'sentinel.txt'),
      'MOBILE-PRESERVAR',
    );

    const worktree = await GitWorktree.create({
      repoRoot: ctx.repo,
      sha: ctx.sha,
      branch: `anima-work/nm-workspaces-${Date.now()}`,
    });

    try {
      expect(await worktree.linkNodeModules()).toBe(true);

      expect(
        await readFile(
          join(worktree.root, 'node_modules', 'root-pkg', 'sentinel.txt'),
          'utf8',
        ),
      ).toBe('ROOT-PRESERVAR');

      expect(
        await readFile(
          join(worktree.root, 'apps', 'web', 'node_modules', 'web-pkg', 'sentinel.txt'),
          'utf8',
        ),
      ).toBe('WEB-PRESERVAR');

      expect(
        await readFile(
          join(worktree.root, 'apps', 'mobile', 'node_modules', 'mobile-pkg', 'sentinel.txt'),
          'utf8',
        ),
      ).toBe('MOBILE-PRESERVAR');
    } finally {
      await worktree.dispose({ deleteBranch: true });
    }

    expect(
      await readFile(
        join(ctx.repo, 'node_modules', 'root-pkg', 'sentinel.txt'),
        'utf8',
      ),
    ).toBe('ROOT-PRESERVAR');

    expect(
      await readFile(
        join(ctx.repo, 'apps', 'web', 'node_modules', 'web-pkg', 'sentinel.txt'),
        'utf8',
      ),
    ).toBe('WEB-PRESERVAR');

    expect(
      await readFile(
        join(ctx.repo, 'apps', 'mobile', 'node_modules', 'mobile-pkg', 'sentinel.txt'),
        'utf8',
      ),
    ).toBe('MOBILE-PRESERVAR');

    await rm(join(ctx.repo, 'node_modules'), { recursive: true, force: true });
    await rm(join(ctx.repo, 'apps', 'web', 'node_modules'), { recursive: true, force: true });
    await rm(join(ctx.repo, 'apps', 'mobile', 'node_modules'), { recursive: true, force: true });
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

describe('GitWorktree — retomada de checkpoint (startSha)', () => {
  let ctx: Awaited<ReturnType<typeof makeRepo>>;
  beforeAll(async () => { ctx = await makeRepo(); });
  afterAll(async () => { await ctx.cleanup(); });

  test('parte do checkpoint, mede o diff contra a base e restaura ao checkpoint', async () => {
    // (1) Tentativa original: edita e commita um checkpoint durável C sobre a base B.
    const first = await GitWorktree.create({ repoRoot: ctx.repo, sha: ctx.sha, branch: `anima-work/orig-${Date.now()}` });
    await first.writeWorkspaceFile('packages/core/src/checkpoint.ts', 'export const c = 1;\n');
    const checkpointSha = await first.commit('anima(checkpoint): edit inicial');
    expect(checkpointSha).toMatch(/^[a-f0-9]{40}$/);
    await first.dispose({ deleteBranch: false });

    // (2) Sucessor RETOMA de C, com a base ainda B.
    const resumed = await GitWorktree.create({
      repoRoot: ctx.repo, sha: ctx.sha, startSha: checkpointSha!, branch: `anima-work/resume-${Date.now()}`,
    });
    // A árvore parte do checkpoint: o arquivo do checkpoint já existe (tolerante a
    // CRLF do autocrlf do git no Windows — o que importa é a presença do conteúdo).
    expect((await resumed.readWorkspaceFile('packages/core/src/checkpoint.ts'))?.replace(/\r\n/g, '\n')).toBe('export const c = 1;\n');
    // O diff contra a BASE já inclui o edit do checkpoint (B→C) — a proveniência
    // do que foi autorizado a mudar não é escondida pela retomada.
    expect(await resumed.changedFiles()).toContain('packages/core/src/checkpoint.ts');

    // (3) O sucessor ESTENDE: um novo edit soma ao diff contra a base.
    await resumed.writeWorkspaceFile('packages/core/src/successor.ts', 'export const s = 2;\n');
    expect(await resumed.changedFiles()).toEqual(
      expect.arrayContaining(['packages/core/src/checkpoint.ts', 'packages/core/src/successor.ts']),
    );

    // (4) restoreToBase volta ao CHECKPOINT (estado inicial), não à base original:
    // preserva o edit do checkpoint e descarta só a mutação parcial do sucessor.
    expect(await resumed.restoreToBase()).toBe(true);
    expect((await resumed.readWorkspaceFile('packages/core/src/checkpoint.ts'))?.replace(/\r\n/g, '\n')).toBe('export const c = 1;\n');
    expect(await resumed.readWorkspaceFile('packages/core/src/successor.ts')).toBeNull();
    await resumed.dispose({ deleteBranch: true });
  });
});

describe('GitWorktree.changedEntriesSinceStart — status por arquivo (A/M/D/R)', () => {
  let ctx: Awaited<ReturnType<typeof makeRepo>>;
  beforeAll(async () => { ctx = await makeRepo(); });
  afterAll(async () => { await ctx.cleanup(); });

  test('adição (A) e modificação (M)', async () => {
    const worktree = await GitWorktree.create({ repoRoot: ctx.repo, sha: ctx.sha, branch: `anima-work/am-${Date.now()}` });
    try {
      await worktree.writeWorkspaceFile('packages/core/src/nova.ts', 'export const n = 1;\n');
      await worktree.writeWorkspaceFile('packages/core/src/existing.ts', 'export const one = 2;\n');
      const byPath = new Map((await worktree.changedEntriesSinceStart()).map(e => [e.path, e.status]));
      expect(byPath.get('packages/core/src/nova.ts')).toBe('A');
      expect(byPath.get('packages/core/src/existing.ts')).toBe('M');
    } finally { await worktree.dispose({ deleteBranch: true }); }
  });

  test('deleção (D) é reportada com status D (conteúdo legitimamente ausente)', async () => {
    const worktree = await GitWorktree.create({ repoRoot: ctx.repo, sha: ctx.sha, branch: `anima-work/del-${Date.now()}` });
    try {
      await rm(join(worktree.root, 'packages', 'core', 'src', 'existing.ts'));
      const entry = (await worktree.changedEntriesSinceStart()).find(e => e.path === 'packages/core/src/existing.ts');
      expect(entry?.status).toBe('D');
      expect(await worktree.readWorkspaceFile('packages/core/src/existing.ts')).toBeNull();
    } finally { await worktree.dispose({ deleteBranch: true }); }
  });

  test('rename (R) reporta o destino e a origem, com detecção -M', async () => {
    const worktree = await GitWorktree.create({ repoRoot: ctx.repo, sha: ctx.sha, branch: `anima-work/ren-${Date.now()}` });
    try {
      await rm(join(worktree.root, 'packages', 'core', 'src', 'existing.ts'));
      await worktree.writeWorkspaceFile('packages/core/src/renamed.ts', 'export const one = 1;\n');
      const entry = (await worktree.changedEntriesSinceStart()).find(e => e.status === 'R');
      expect(entry).toBeDefined();
      expect(entry!.path).toBe('packages/core/src/renamed.ts');
      expect(entry!.oldPath).toBe('packages/core/src/existing.ts');
    } finally { await worktree.dispose({ deleteBranch: true }); }
  });
});

describe('GitWorktree.searchText / listFiles — busca host-executada confinada (V3)', () => {
  let ctx: Awaited<ReturnType<typeof makeRepo>>;
  let wt: GitWorktree;
  beforeEach(async () => {
    ctx = await makeRepo();
    wt = await GitWorktree.create({ repoRoot: ctx.repo, sha: ctx.sha, branch: `anima-work/search-${Date.now()}-${Math.random().toString(36).slice(2)}` });
  });
  afterEach(async () => { await wt.dispose({ deleteBranch: true }).catch(() => {}); await ctx.cleanup(); });

  test('searchText encontra símbolo em arquivo rastreado, com caminho relativo e linha', async () => {
    const res = await wt.searchText({ query: 'export const one', maxResults: 10, isRegex: false });
    const hit = res.matches.find(m => m.path === 'packages/core/src/existing.ts');
    expect(hit).toBeTruthy();
    expect(hit!.line).toBe(1);
    expect(hit!.preview).toContain('one = 1');
  });

  test('searchText sem ocorrência devolve vazio (não erro)', async () => {
    const res = await wt.searchText({ query: 'SIMBOLO_INEXISTENTE_ZZZ', maxResults: 10, isRegex: false });
    expect(res.matches).toEqual([]);
    expect(res.truncated).toBe(false);
  });

  test('listFiles por glob lista só arquivos rastreados que casam o padrão', async () => {
    const res = await wt.listFiles({ pattern: 'packages/**/*.ts', maxResults: 50 });
    expect(res.paths).toContain('packages/core/src/existing.ts');
    expect(res.paths.every(p => p.endsWith('.ts'))).toBe(true);
  });

  test('searchText nunca retorna caminho fora da worktree (só arquivos rastreados sob a raiz)', async () => {
    const res = await wt.searchText({ query: 'export', maxResults: 50, isRegex: false });
    for (const m of res.matches) {
      expect(m.path.startsWith('..')).toBe(false);
      expect(/^[A-Za-z]:/.test(m.path)).toBe(false);
    }
  });

  test('truncamento explícito quando há mais matches que o cap', async () => {
    await wt.writeWorkspaceFile('packages/core/src/a.ts', 'const MARCA = 1;\n');
    await wt.writeWorkspaceFile('packages/core/src/b.ts', 'const MARCA = 2;\n');
    await wt.writeWorkspaceFile('packages/core/src/c.ts', 'const MARCA = 3;\n');
    await git(wt.root, ['add', '-A']);
    const res = await wt.searchText({ query: 'MARCA', maxResults: 2, isRegex: false });
    expect(res.matches.length).toBe(2);
    expect(res.truncated).toBe(true);
  });
});

describe('GitWorktree.runCommand — execução governada confinada (V3, 3ª fatia)', () => {
  let ctx: Awaited<ReturnType<typeof makeRepo>>;
  let wt: GitWorktree;
  beforeEach(async () => {
    ctx = await makeRepo();
    wt = await GitWorktree.create({ repoRoot: ctx.repo, sha: ctx.sha, branch: `anima-work/exec-${Date.now()}-${Math.random().toString(36).slice(2)}` });
  });
  afterEach(async () => { await wt.dispose({ deleteBranch: true }).catch(() => {}); await ctx.cleanup(); });

  test('git status/diff read-only rodam no root da worktree e capturam saída', async () => {
    const status = await wt.runCommand({ program: 'git', args: ['status', '--porcelain'], timeoutMs: 15_000 });
    expect(status.exitCode).toBe(0);
    await wt.writeWorkspaceFile('packages/core/src/existing.ts', 'export const one = 2;\n');
    const diff = await wt.runCommand({ program: 'git', args: ['diff'], timeoutMs: 15_000 });
    expect(diff.exitCode).toBe(0);
    expect(diff.stdout).toContain('one = 2');
  });

  test('node roda e captura stdout/exitCode', async () => {
    const r = await wt.runCommand({ program: 'node', args: ['--version'], timeoutMs: 15_000 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^v\d+/);
  });

  test('timeout cancela o processo (timedOut)', async () => {
    const r = await wt.runCommand({ program: 'node', args: ['-e', 'setTimeout(function(){}, 10000)'], timeoutMs: 500 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).not.toBe(0);
  });
});
