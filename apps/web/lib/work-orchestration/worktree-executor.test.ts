/** @jest-environment node */
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildHostObservedGateEvidence,
  buildWorktreeHandoff,
  validateWorkExecutorTranscript,
  verifyWorkResult,
  type ObservedGateInput,
  type WorkCapability,
  type WorkExecutorRequest,
  type WorkExecutorSignal,
  type WorktreeHandoffV1,
} from '@anima/core';
import { runProcess } from './worktree';
import { ScriptedCoderBackend, type CoderBackend, type CoderEditResult, type CoderWorkspace } from './coder-backend';
import { WorktreeExecutorAdapter, type WorktreeTargetResolver } from './worktree-executor';

// Operações git reais podem ficar lentas sob carga paralela; folga o timeout
// para não flakar por contenção (o padrão de 5s do jest é curto demais aqui).
jest.setTimeout(30_000);

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
    if (result.kind === 'result') {
      expect(result.validations).toEqual([{ label: 'testes', outcome: 'passed' }]);
      // INT-05: o resultado carrega o handoff durável, coerente com o git real.
      expect(result.worktreeHandoff).toBeDefined();
      const h = result.worktreeHandoff!;
      expect({ workItemId: h.workItemId, attemptId: h.attemptId, baseSha: h.baseSha, branch: h.branch, status: h.status })
        .toEqual({ workItemId: req.workItemId, attemptId: req.attemptId, baseSha: ctx.sha, branch: `anima-work/${req.attemptId}`, status: 'succeeded' });
      expect(h.changedFiles).toContain('src/added.ts');
      expect(h.gates.some(g => g.outcome === 'passed')).toBe(true);
      expect(h).not.toHaveProperty('createdAt');
      const branchSha = (await git(ctx.repo, ['rev-parse', `anima-work/${req.attemptId}`])).stdout.trim();
      expect(h.commitSha).toBe(branchSha); // commitSha durável == commit real da branch
    }

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

  test('backend que retorna sucesso sem tocar arquivo vira error, nunca um result de revisão vazio', async () => {
    // Defesa em profundidade: um backend pode alegar sucesso e não escrever nada.
    // A worktree sem mudança não pode virar um result que iria a revisão humana.
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([]) });
    const signals = await collect(adapter, request(), new AbortController().signal);
    const terminal = signals.at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') {
      expect(terminal.code).toBe('execution_failed');
      expect(terminal.retryable).toBe(false);
      expect(terminal.message).toContain('nenhuma alteração');
    }
    // Nenhum result é emitido: o desfecho é fechado, não uma revisão de nada.
    expect(signals.some(s => s.kind === 'result')).toBe(false);
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
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

  test('SHA-base inexistente/inalcançável é recusado (execution_failed)', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: { resolve: () => ({ repoRoot: ctx.repo, sha: 'b'.repeat(40) }) }, backend: new ScriptedCoderBackend([added]) });
    const terminal = (await collect(adapter, request(), new AbortController().signal)).at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') expect(terminal.code).toBe('execution_failed');
  });

  test('backend em caminho sensível falha fechado (execution_failed)', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([{ path: '../escape.ts', content: 'x' }]) });
    const terminal = (await collect(adapter, request(), new AbortController().signal)).at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') expect(terminal.code).toBe('execution_failed');
  });

  test('retomada: carriedContext chega ao backend e um checkpoint é emitido', async () => {
    let received: unknown = 'ausente';
    const backend: CoderBackend = {
      id: 'capture',
      async edit(req, ws): Promise<CoderEditResult> { received = req.carriedContext; await ws.writeFile(added.path, added.content); return { summary: 'ok', touchedResources: [added.path] }; },
    };
    const carriedContext = { isNewAttempt: true as const, continueFromCheckpoint: true as const, remainingSteps: ['terminar'], nextStep: 'terminar', risks: [], touchedResources: [], previousFailures: [] };
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend, emitCheckpoint: true });
    const req = request({ carriedContext });
    const signals = await collect(adapter, req, new AbortController().signal);
    expect(received).toEqual(carriedContext);
    expect(signals.some(s => s.kind === 'checkpoint')).toBe(true);
    expect(signals.at(-1)!.kind).toBe('result');
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]);
  });

  test('concorrência no mesmo alvo: attemptIds distintos, branches isoladas', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([added]) });
    const [reqA, reqB] = [request(), request()];
    const [a, b] = await Promise.all([collect(adapter, reqA, new AbortController().signal), collect(adapter, reqB, new AbortController().signal)]);
    expect(a.at(-1)!.kind).toBe('result');
    expect(b.at(-1)!.kind).toBe('result');
    expect(reqA.attemptId).not.toBe(reqB.attemptId);
    for (const id of [reqA.attemptId, reqB.attemptId]) {
      expect((await git(ctx.repo, ['branch', '--list', `anima-work/${id}`])).stdout).toContain(id);
      await git(ctx.repo, ['branch', '-D', `anima-work/${id}`]);
    }
    // Original permanece intacto após duas execuções concorrentes.
    expect((await git(ctx.repo, ['status', '--porcelain'])).stdout.trim()).toBe('');
  });

  test('idempotência: repetir o mesmo attemptId falha fechado sem reaplicar', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([added]) });
    const req = request();
    expect((await collect(adapter, req, new AbortController().signal)).at(-1)!.kind).toBe('result');
    // A segunda vez com a MESMA tentativa colide na branch e recusa — nunca
    // reaplica nem produz um segundo resultado.
    const second = (await collect(adapter, req, new AbortController().signal)).at(-1)!;
    expect(second.kind).toBe('error');
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]);
  });

  test('falha na aplicação do lote: restaura ao base, execution_failed, nada commitado, sem gate', async () => {
    // Backend que escreve (estado parcial) e então lança — exercita o caminho de
    // falha da aplicação. O executor deve chamar restoreToBase antes de finalizar.
    const writeThenThrow: CoderBackend = {
      id: 'write-then-throw',
      edit: async (_req, workspace: CoderWorkspace): Promise<CoderEditResult> => {
        await workspace.writeFile('src/added.ts', 'parcial\n');
        throw new Error('falha proposital do backend');
      },
    };
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: writeThenThrow, emitCheckpoint: true });
    const req = request();
    const signals = await collect(adapter, req, new AbortController().signal);
    // Nenhum checkpoint (edit falhou), nenhum result, nenhum gate: só o erro.
    expect(signals.map(s => s.kind)).toEqual(['error']);
    expect((signals[0] as Extract<WorkExecutorSignal, { kind: 'error' }>).code).toBe('execution_failed');
    // Nada commitado: a branch preservada aponta exatamente ao SHA-base.
    const tip = await git(ctx.repo, ['rev-parse', `anima-work/${req.attemptId}`]);
    expect(tip.stdout.trim()).toBe(ctx.sha);
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });

  test('sucesso multi-arquivo: o commit contém todas as alterações', async () => {
    const backend = new ScriptedCoderBackend([
      { path: 'src/added.ts', content: 'export const two = 2;\n' },
      { path: 'src/more.ts', content: 'export const three = 3;\n' },
    ]);
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend, emitCheckpoint: false });
    const req = request({ includedScope: ['src/added.ts', 'src/more.ts'] });
    const signals = await collect(adapter, req, new AbortController().signal);
    expect(signals.at(-1)!.kind).toBe('result');
    const files = await git(ctx.repo, ['show', '--name-only', '--format=', `anima-work/${req.attemptId}`]);
    expect(files.stdout).toContain('src/added.ts');
    expect(files.stdout).toContain('src/more.ts');
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });

  test('cancelamento DURANTE a aplicação: restaura ao base, emite cancelled, nada commitado, sem gate', async () => {
    const controller = new AbortController();
    // Backend escreve estado parcial e cancela a tentativa no meio da aplicação.
    const abortMidEdit: CoderBackend = {
      id: 'abort-mid-edit',
      edit: async (_req, workspace: CoderWorkspace): Promise<CoderEditResult> => {
        await workspace.writeFile('src/added.ts', 'parcial durante cancelamento\n');
        controller.abort();
        throw new Error('abortado durante a edição');
      },
    };
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: abortMidEdit, emitCheckpoint: true });
    const req = request();
    const signals = await collect(adapter, req, controller.signal);
    // A restauração (não-cancelável) é tentada ANTES de classificar; desfecho: cancelled.
    expect(signals.map(s => s.kind)).toEqual(['cancelled']);
    // Nenhum gate/commit/result: a branch preservada aponta exatamente ao SHA-base.
    const tip = await git(ctx.repo, ['rev-parse', `anima-work/${req.attemptId}`]);
    expect(tip.stdout.trim()).toBe(ctx.sha);
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });
});

describe('WorktreeExecutorAdapter — evidência de gate observada de primeira parte (ponta a ponta)', () => {
  let ctx: Awaited<ReturnType<typeof makeNpmRepo>>;
  beforeAll(async () => { ctx = await makeNpmRepo(); });
  afterAll(async () => { await ctx.cleanup(); });
  const added = { path: 'src/added.ts', content: 'export const two = 2;\n' };

  // Coletor host-side idêntico ao que a rota /supervisor-turn injeta.
  const runWithObserver = async (req: WorkExecutorRequest) => {
    const observed: ObservedGateInput[] = [];
    const adapter = new WorktreeExecutorAdapter({
      targets: ctx.resolver, backend: new ScriptedCoderBackend([added]),
      onGateObserved: o => observed.push(o),
    });
    const signals = await collect(adapter, req, new AbortController().signal);
    return { observed, terminal: signals.at(-1)! };
  };

  test('gate REAL que passa: host observa exitCode 0 e o Verifier confirma independentemente', async () => {
    const req = request(); // npm test → exit 0
    const { observed, terminal } = await runWithObserver(req);
    // 1) O adaptador reportou a observação BRUTA de primeira parte do host.
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ label: 'testes', exitCode: 0, timedOut: false, cancelled: false });
    expect(observed[0]!.command).toContain('test');
    // 2) A evidência construída dos fatos observados deriva 'passed'.
    const built = buildHostObservedGateEvidence({ workItemId: req.workItemId, attemptId: req.attemptId, approvedProposalVersion: req.approvedProposalVersion, gates: observed, observedAt: new Date().toISOString() });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.gates[0]!.outcome).toBe('passed');
    // 3) O Verifier, com o handoff atestado REAL + a evidência observada, confirma o gate.
    expect(terminal.kind).toBe('result');
    const handoff = (terminal as { worktreeHandoff?: WorktreeHandoffV1 }).worktreeHandoff!;
    const report = verifyWorkResult({
      expected: { workItemId: req.workItemId, attemptId: req.attemptId, approvedProposalVersion: req.approvedProposalVersion },
      authorized: { includedScope: req.includedScope, excludedScope: req.excludedScope, validationCriteria: req.validationCriteria },
      handoff, observedGates: built.value,
    });
    expect(report.findings.map(f => f.code)).toContain('gates_independently_observed');
    expect(report.verdict).toBe('verified');
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });

  test('gate REAL que falha: host observa exitCode≠0 e o Verifier detecta a mentira do atestado', async () => {
    const req = request({ validationCriteria: [{ label: 'build', command: 'npm run build' }] }); // exit 1
    const { observed, terminal } = await runWithObserver(req);
    // O adaptador honesto termina em erro (sem result) — mas a observação do host EXISTE.
    expect(terminal.kind).toBe('error');
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ label: 'build', timedOut: false, cancelled: false });
    expect(observed[0]!.exitCode).not.toBe(0);
    const built = buildHostObservedGateEvidence({ workItemId: req.workItemId, attemptId: req.attemptId, approvedProposalVersion: req.approvedProposalVersion, gates: observed, observedAt: new Date().toISOString() });
    expect(built.ok && built.value.gates[0]!.outcome).toBe('failed');
    if (!built.ok) return;
    // Adversário: um handoff que MENTE que o mesmo gate passou. A observação é REAL;
    // só a atestação é fabricada, como um executor mal-comportado faria.
    const lying = buildWorktreeHandoff({
      workItemId: req.workItemId, attemptId: req.attemptId, approvedProposalVersion: req.approvedProposalVersion,
      executorId: 'worktree-v1', backendId: 'fake', model: null,
      baseSha: 'a'.repeat(40), branch: `anima-work/${req.attemptId}`, commitSha: 'b'.repeat(40), status: 'succeeded',
      changedFiles: ['src/added.ts'], diffFiles: [{ path: 'src/added.ts', insertions: 1, deletions: 0 }],
      gates: [{ label: 'build', command: 'npm run build', exitCode: 0, outcome: 'passed' }],
    });
    expect(lying.ok).toBe(true);
    if (!lying.ok) return;
    const report = verifyWorkResult({
      expected: { workItemId: req.workItemId, attemptId: req.attemptId, approvedProposalVersion: req.approvedProposalVersion },
      authorized: { includedScope: req.includedScope, excludedScope: req.excludedScope, validationCriteria: req.validationCriteria },
      handoff: lying.value, observedGates: built.value,
    });
    const codes = report.findings.map(f => f.code);
    expect(codes).toContain('attested_gate_contradicts_observed');
    expect(codes).toContain('gate_failed');
    expect(report.verdict).toBe('rejected');
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });
});
