/** @jest-environment node */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCoderTaskSpec,
  buildHostObservedCoderEvidence,
  decideRecovery,
  validateWorkExecutorTranscript,
  type ObservedCoderInput,
  type ObservedGateInput,
  type WorkCapability,
  type WorkExecutorRequest,
  type WorkExecutorSignal,
} from '@anima/core';
import { renderCoderTaskSection } from './coder-backend';
import { CLAUDE_CODE_DEFAULT_MODEL, ClaudeCodeCoderBackend } from './claude-code-coder';
import type { NativeCliProcessRunner } from './native-cli-coder';
import { WorktreeExecutorAdapter, type WorktreeTargetResolver } from './worktree-executor';
import { runProcess } from './worktree';

// ============================================================
// Prova técnica local SEM Claude Code real, sem assinatura e sem provider:
// ClaudeCodeCoderBackend (executável falso) → mudança observada pelo host → escopo →
// gate do host → resultado revisável. O executável falso é `node <script>`, lançado
// pelo MESMO `runProcess` (sem shell) da produção.
// ============================================================

jest.setTimeout(60_000);

const git = (repo: string, args: readonly string[]) => runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs: 30_000 });

async function makeRepo(): Promise<{ repo: string; sha: string; resolver: WorktreeTargetResolver }> {
  const repo = await mkdtemp(join(tmpdir(), 'anima-claude-e2e-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'test']);
  await git(repo, ['config', 'user.email', 'test@anima.local']);
  await git(repo, ['config', 'commit.gpgsign', 'false']);
  // Gate do HOST: passa só se src/added.ts exporta `two = 2`.
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.0', private: true, scripts: { test: 'node gate.js' } }, null, 2));
  await writeFile(join(repo, 'gate.js'), "const fs=require('fs');const p='src/added.ts';process.exit(fs.existsSync(p)&&fs.readFileSync(p,'utf8').includes('two = 2')?0:1);\n");
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src', 'other.ts'), 'export const other = 0;\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'inicial']);
  const sha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  return { repo, sha, resolver: { resolve: reference => reference === 'anima' ? { repoRoot: repo, sha } : null } };
}

let counter = 0;
const request = (maxDurationMinutes = 1): WorkExecutorRequest => {
  const base: Omit<WorkExecutorRequest, 'taskSpec'> = {
    attemptId: `att-claude-${Date.now()}-${counter++}`,
    workItemId: 'item-claude',
    approvedProposalVersion: 1,
    capability: 'programming' as WorkCapability,
    objective: 'Adicionar a constante two',
    includedScope: ['src/added.ts'],
    excludedScope: ['src/other.ts'],
    target: { kind: 'project', reference: 'anima' },
    permissions: ['workspace_read', 'workspace_write_isolated'],
    validationCriteria: [{ label: 'testes', command: 'npm test' }],
    limits: { maxDurationMinutes },
    contextReferences: [],
  };
  return { ...base, taskSpec: buildCoderTaskSpec({
    workItemId: base.workItemId, approvedProposalVersion: base.approvedProposalVersion,
    proposal: { summary: base.objective, objective: base.objective, includedScope: base.includedScope, excludedScope: base.excludedScope, expectedEffects: ['two = 2'], risks: [] },
    spec: { validationCriteria: base.validationCriteria }, verifierRequirement: 'advisory', contextReferences: base.contextReferences,
  }) };
};

async function collect(adapter: WorktreeExecutorAdapter, req: WorkExecutorRequest): Promise<WorkExecutorSignal[]> {
  const signals: WorkExecutorSignal[] = [];
  for await (const value of adapter.execute(req, new AbortController().signal)) signals.push(value);
  return signals;
}

describe('ClaudeCodeCoderBackend → WorktreeExecutorAdapter (executável falso)', () => {
  let ctx: Awaited<ReturnType<typeof makeRepo>>;
  let dir: string;
  beforeAll(async () => { ctx = await makeRepo(); dir = await mkdtemp(join(tmpdir(), 'anima-claude-fakebin-')); });
  afterAll(async () => { await rm(ctx.repo, { recursive: true, force: true }); await rm(dir, { recursive: true, force: true }); });

  /** "Claude Code" falso: grava o que recebeu (fora da worktree), escreve `files` no cwd e sai com `exit`. */
  const fakeClaude = async (name: string, files: Record<string, string>, exit: number | 'hang' = 0): Promise<{ run: NativeCliProcessRunner; record: string }> => {
    const record = join(dir, `${name}.json`);
    const script = join(dir, `${name}.js`);
    await writeFile(script, [
      "const fs = require('fs'); const path = require('path');",
      `fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));`,
      `for (const [rel, content] of Object.entries(${JSON.stringify(files)})) { fs.mkdirSync(path.dirname(rel), { recursive: true }); fs.writeFileSync(rel, content); }`,
      `process.stdout.write(${JSON.stringify(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 3 }))});`,
      exit === 'hang' ? 'setInterval(() => {}, 1000);' : `process.exit(${exit});`,
    ].join('\n'));
    return { record, run: (_file, args, options) => runProcess(process.execPath, [script, ...args], options) };
  };

  const adapterWith = (run: NativeCliProcessRunner, observers: { gates?: ObservedGateInput[]; coder?: ObservedCoderInput[] } = {}) =>
    new WorktreeExecutorAdapter({
      targets: ctx.resolver,
      backend: new ClaudeCodeCoderBackend({ config: { executable: 'claude', model: CLAUDE_CODE_DEFAULT_MODEL }, run, environmentSource: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } }),
      emitCheckpoint: true,
      onGateObserved: gate => observers.gates?.push(gate),
      onCoderObserved: coder => observers.coder?.push(coder),
    });

  test('ponta a ponta: mudança observada pelo host → escopo → gate do host → resultado revisável', async () => {
    const { run, record } = await fakeClaude('ok', { 'src/added.ts': 'export const two = 2;\n' });
    const gates: ObservedGateInput[] = [];
    const coder: ObservedCoderInput[] = [];
    const req = request();
    const signals = await collect(adapterWith(run, { gates, coder }), req);

    expect(validateWorkExecutorTranscript(signals)).toBeNull();
    expect(signals.map(s => s.kind)).toEqual(['checkpoint', 'result']);
    const result = signals.at(-1)!;
    if (result.kind !== 'result') throw new Error('esperava result');
    expect(result.validations).toEqual([{ label: 'testes', outcome: 'passed' }]);
    // O backend não atestou arquivos: quem observou foi o git do host.
    expect(result.worktreeHandoff?.changedFiles).toEqual(['src/added.ts']);
    expect(result.worktreeHandoff?.status).toBe('succeeded');
    // Gate rodou no HOST e o coder foi observado com a identidade do backend.
    expect(gates).toEqual([expect.objectContaining({ label: 'testes', exitCode: 0 })]);
    expect(coder).toEqual([expect.objectContaining({ backendId: 'claude-code:default', outcome: 'succeeded' })]);
    // Sem identidade de placement (o host não atesta o nó de inferência de um CLI nativo): `{remote, nodeId:null}`
    // era recusado por buildHostObservedCoderEvidence e a evidência do coder se perdia.
    expect(coder[0]).not.toHaveProperty('placement');
    expect(coder[0]).not.toHaveProperty('nodeId');
    expect(buildHostObservedCoderEvidence({ workItemId: 'w' as never, attemptId: 'a', approvedProposalVersion: 1 as never, observedAt: new Date().toISOString(), ...coder[0]! }).ok).toBe(true);

    // O "Claude Code" rodou na worktree isolada, nunca no checkout principal, e recebeu a task spec.
    const seen = JSON.parse(await readFile(record, 'utf8')) as { cwd: string; args: string[] };
    expect(seen.cwd.toLowerCase()).not.toBe(ctx.repo.toLowerCase());
    expect(seen.args.slice(0, 5)).toEqual(['-p', '--output-format', 'json', '--no-session-persistence', '--restricted']);
    expect(seen.args.at(-1)).toContain(renderCoderTaskSection({ taskSpec: req.taskSpec, validationCommands: [{ label: 'testes', program: 'npm', args: ['test'] }] })!);
    // Checkout principal intacto.
    await expect(stat(join(ctx.repo, 'src', 'added.ts'))).rejects.toBeTruthy();
    expect((await git(ctx.repo, ['status', '--porcelain'])).stdout.trim()).toBe('');
  });

  test('mudança fora do escopo continua rejeitada pelo WorktreeExecutor (contract_violation)', async () => {
    const { run } = await fakeClaude('scope', { 'src/added.ts': 'export const two = 2;\n', 'src/other.ts': 'export const other = 1;\n' });
    const signals = await collect(adapterWith(run), request());
    expect(signals.at(-1)).toMatchObject({ kind: 'error', code: 'contract_violation' });
    expect(signals.some(s => s.kind === 'result')).toBe(false);
  });

  test('exit 0 não é gate aprovado: gate do host reprova a mudança errada', async () => {
    const { run } = await fakeClaude('wrong', { 'src/added.ts': 'export const two = 3;\n' });
    const gates: ObservedGateInput[] = [];
    const signals = await collect(adapterWith(run, { gates }), request());
    expect(signals.at(-1)).toMatchObject({ kind: 'error', code: 'execution_failed' });
    expect(signals.some(s => s.kind === 'result')).toBe(false);
    expect(gates).toEqual([expect.objectContaining({ label: 'testes', exitCode: 1 })]);
  });

  test('exit não-zero falha fechado: nenhum gate roda e nada é entregue', async () => {
    const { run } = await fakeClaude('crash', { 'src/added.ts': 'export const two = 2;\n' }, 7);
    const gates: ObservedGateInput[] = [];
    const signals = await collect(adapterWith(run, { gates }), request());
    const terminal = signals.at(-1)!;
    expect(terminal).toMatchObject({ kind: 'error', code: 'execution_failed' });
    if (terminal.kind === 'error') expect(terminal.message).toMatch(/Claude Code terminou com exit 7/);
    expect(gates).toHaveLength(0);
  });

  test('deadline global mata o Claude Code pendurado e o host preserva o candidato (timeout terminal)', async () => {
    const { run } = await fakeClaude('hang', { 'src/added.ts': 'export const two = 2;\n' }, 'hang');
    const gates: ObservedGateInput[] = [];
    const req = request(0.15);
    const signals = await collect(adapterWith(run, { gates }), req);
    const terminal = signals.at(-1)!;
    expect(terminal).toMatchObject({ kind: 'error', code: 'execution_failed', retryable: false });
    if (terminal.kind !== 'error') throw new Error('esperava error');
    expect(terminal.message).toMatch(/\[runner_timeout\].*Candidato preservado no commit [0-9a-f]{40}/);
    // Recovery canônica classifica pelo marcador allowlisted: timeout, nunca code_failure/unknown.
    expect(decideRecovery({ code: terminal.code, safeMessage: terminal.message, retryable: terminal.retryable, attemptsUsed: 1, maxAttempts: 3, repeatedSameFailure: false }))
      .toMatchObject({ failureKind: 'timeout', normalizedCode: 'runner_timeout' });
    expect(gates).toHaveLength(0);
    expect((await git(ctx.repo, ['show', '--name-only', '--format=', `anima-work/${req.attemptId}`])).stdout.trim()).toBe('src/added.ts');
  });

  test('turno sem alteração: o host observa zero arquivos e não entrega result', async () => {
    const { run } = await fakeClaude('noop', {});
    const signals = await collect(adapterWith(run), request());
    expect(signals.at(-1)?.kind).toBe('error');
    expect(signals.some(s => s.kind === 'result')).toBe(false);
  });
});
