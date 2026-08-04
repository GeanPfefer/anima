/** @jest-environment node */
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWorkExecutorTranscript, type WorkCapability, type WorkExecutorRequest, type WorkExecutorSignal } from '@anima/core';
import { runProcess } from './worktree';
import { ScriptedCoderBackend, type CoderBackend, type CoderEditResult, type CoderWorkspace } from './coder-backend';
import { WorktreeExecutorAdapter, type WorktreeTargetResolver } from './worktree-executor';

const git = (repo: string, args: readonly string[]) => runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs: 30_000 });

// Repositório temporário com scripts npm triviais (test/typecheck passam, build
// falha) — exercita o gate npm REAL sem depender de node_modules.
async function makeNpmRepo(): Promise<{ repo: string; sha: string; resolver: WorktreeTargetResolver; cleanup: () => Promise<void> }> {
  const repo = await mkdtemp(join(tmpdir(), 'anima-npm-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'test']);
  await git(repo, ['config', 'user.email', 'test@anima.local']);
  await git(repo, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(repo, 'package.json'), JSON.stringify({
    name: 'fixture', version: '0.0.0', private: true,
    scripts: { test: 'node -e "process.exit(0)"', typecheck: 'node -e "process.exit(0)"', build: 'node -e "process.exit(1)"' },
  }, null, 2));
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src', 'existing.ts'), 'export const one = 1;\n');
  await writeFile(join(repo, '.gitignore'), 'node_modules/\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'inicial']);
  const head = await git(repo, ['rev-parse', 'HEAD']);
  const sha = head.stdout.trim();
  return { repo, sha, resolver: { resolve: reference => reference === 'anima' ? { repoRoot: repo, sha } : null }, cleanup: () => rm(repo, { recursive: true, force: true }) };
}

let counter = 0;
const request = (overrides: Partial<WorkExecutorRequest> = {}): WorkExecutorRequest => ({
  attemptId: `att-${Date.now()}-${counter++}`,
  workItemId: 'item-1',
  approvedProposalVersion: 1,
  capability: 'programming' as WorkCapability,
  objective: 'Adicionar uma função pura e seu teste',
  includedScope: ['src/added.ts'],
  excludedScope: ['src/other.ts'],
  target: { kind: 'project', reference: 'anima' },
  permissions: ['workspace_read', 'workspace_write_isolated'],
  validationCriteria: [{ label: 'testes', command: 'npm test' }],
  limits: { maxDurationMinutes: 1 },
  contextReferences: [],
  ...overrides,
});

async function collect(adapter: WorktreeExecutorAdapter, req: WorkExecutorRequest, signal: AbortSignal): Promise<WorkExecutorSignal[]> {
  const signals: WorkExecutorSignal[] = [];
  for await (const value of adapter.execute(req, signal)) signals.push(value);
  return signals;
}

describe('WorktreeExecutorAdapter', () => {
  let ctx: Awaited<ReturnType<typeof makeNpmRepo>>;
  beforeAll(async () => { ctx = await makeNpmRepo(); });
  afterAll(async () => { await ctx.cleanup(); });

  const added = { path: 'src/added.ts', content: 'export const two = 2;\n' };

  test('sucesso: edita, valida pelo gate real e entrega result — original intacto', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([added]), emitCheckpoint: true });
    const req = request();
    const signals = await collect(adapter, req, new AbortController().signal);

    expect(validateWorkExecutorTranscript(signals)).toBeNull();
    expect(signals.map(s => s.kind)).toEqual(['checkpoint', 'result']);
    const result = signals.at(-1)!;
    expect(result.kind).toBe('result');
    if (result.kind === 'result') expect(result.validations).toEqual([{ label: 'testes', outcome: 'passed' }]);

    // Workspace ORIGINAL comprovadamente inalterado.
    await expect(stat(join(ctx.repo, 'src', 'added.ts'))).rejects.toBeTruthy();
    expect((await git(ctx.repo, ['status', '--porcelain'])).stdout.trim()).toBe('');
    // A branch descartável ficou como referência, com o commit.
    expect((await git(ctx.repo, ['branch', '--list', `anima-work/${req.attemptId}`])).stdout).toContain(req.attemptId);
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]);
  });

  test('gate falhando vira error (sem result de revisão)', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([added]) });
    const signals = await collect(adapter, request({ validationCriteria: [{ label: 'build', command: 'npm run build' }] }), new AbortController().signal);
    const terminal = signals.at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') expect(terminal.code).toBe('execution_failed');
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
  });

  test('alteração fora do escopo aprovado vira contract_violation', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([{ path: 'src/evil.ts', content: 'x' }]) });
    const terminal = (await collect(adapter, request(), new AbortController().signal)).at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') expect(terminal.code).toBe('contract_violation');
  });

  test('permissão insuficiente vira invalid_request antes de criar worktree', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([added]) });
    const terminal = (await collect(adapter, request({ permissions: ['workspace_read'] }), new AbortController().signal)).at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') expect(terminal.code).toBe('invalid_request');
  });

  test('comando de gate fora da allowlist vira invalid_request', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([added]) });
    const terminal = (await collect(adapter, request({ validationCriteria: [{ label: 'x', command: 'curl http://x' }] }), new AbortController().signal)).at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') expect(terminal.code).toBe('invalid_request');
  });

  test('cancelamento cooperativo durante a edição vira cancelled', async () => {
    const controller = new AbortController();
    const backend: CoderBackend = {
      id: 'aborting',
      async edit(_req, _ws, _signal): Promise<CoderEditResult> { controller.abort(); return { summary: '', touchedResources: [] }; },
    };
    const terminal = (await collect(new WorktreeExecutorAdapter({ targets: ctx.resolver, backend }), request(), controller.signal)).at(-1)!;
    expect(terminal.kind).toBe('cancelled');
  });

  test('a workspace original permanece intacta mesmo estando suja', async () => {
    // Suja o original com um arquivo não commitado.
    await writeFile(join(ctx.repo, 'src', 'dirty.ts'), 'export const dirty = true;\n');
    try {
      const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([added]) });
      const req = request();
      const signals = await collect(adapter, req, new AbortController().signal);
      expect(signals.at(-1)!.kind).toBe('result');
      // O arquivo sujo continua lá, intocado, e o worktree não o viu.
      expect((await stat(join(ctx.repo, 'src', 'dirty.ts'))).isFile()).toBe(true);
      await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]);
    } finally {
      await rm(join(ctx.repo, 'src', 'dirty.ts'), { force: true });
    }
  });

  test('backend em caminho sensível falha fechado (execution_failed)', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([{ path: '../escape.ts', content: 'x' }]) });
    const terminal = (await collect(adapter, request(), new AbortController().signal)).at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') expect(terminal.code).toBe('execution_failed');
  });
});
