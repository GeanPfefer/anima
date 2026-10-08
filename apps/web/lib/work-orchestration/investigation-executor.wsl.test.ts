/** @jest-environment node */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCoderTaskSpec, type WorkExecutorRequest, type WorkExecutorSignal } from '@anima/core';
import { InvestigationExecutorAdapter } from './investigation-executor';
import { runProcess } from './worktree';
import type { CodexCliProcessRunner } from './codex-cli-coder';

jest.setTimeout(30_000);
const describeWindows = process.platform === 'win32' ? describe : describe.skip;
const git = async (repo: string, args: readonly string[]) => {
  const result = await runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs: 15_000 });
  if (result.exitCode !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const CLI = '/home/geanteco/.nvm/versions/node/v22.23.3/bin/codex';
const wslEnv = { ANIMA_INVESTIGATION_CODEX_TRANSPORT: 'wsl', ANIMA_CODEX_WSL_DISTRO: 'Ubuntu-24.04', ANIMA_CODEX_WSL_USER: 'geanteco', ANIMA_CODEX_WSL_CLI_PATH: CLI, SystemRoot: 'C:\\Windows', OPENAI_API_KEY: 'secret', CODEX_HOME: 'C:\\auth' };
const ok = (stdout = '') => ({ command: 'fake', exitCode: 0, stdout, stderr: '', durationMs: 1, timedOut: false, cancelled: false });
const inconclusive = { schemaVersion: 1, findings: [], gaps: ['History unavailable.'], outcome: 'inconclusive' };
/** Reverte a tradução para escrever onde o Codex Linux escreveria (o mesmo disco). */
const toWindows = (linux: string): string => linux.replace(/^\/mnt\/([a-z])\//, (_m, d: string) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\');

describeWindows('investigation WSL transport (host contracts preserved)', () => {
  let repo: string, sha: string;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'anima-investigation-wsl-test-'));
    await git(repo, ['init', '-b', 'main']);
    await git(repo, ['config', 'user.name', 'fixture']); await git(repo, ['config', 'user.email', 'fixture@test.invalid']); await git(repo, ['config', 'commit.gpgsign', 'false']);
    await writeFile(join(repo, 'file.txt'), 'first\nsecond\n');
    await git(repo, ['add', '.']); await git(repo, ['commit', '-m', 'fixture']); sha = await git(repo, ['rev-parse', 'HEAD']);
  });
  afterEach(async () => { if (repo) await rm(repo, { recursive: true, force: true }); });
  const request = (): WorkExecutorRequest => ({ workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 1, capability: 'research', effectClass: 'read_only',
    objective: 'Investigate "this" $(id)', includedScope: ['file.txt'], excludedScope: ['secrets'], permissions: ['workspace_read'], target: { kind: 'project', reference: 'fixture' },
    validationCriteria: [{ label: 'refs' }], limits: { maxDurationMinutes: 1 }, contextReferences: [],
    taskSpec: buildCoderTaskSpec({ workItemId: 'work-1', approvedProposalVersion: 1, proposal: { summary: 'Investigate', objective: 'Investigate "this" $(id)', includedScope: ['file.txt'], excludedScope: ['secrets'], expectedEffects: [], risks: [] }, spec: { validationCriteria: [{ label: 'refs' }] }, verifierRequirement: 'advisory', contextReferences: [] }) });
  const worktrees = async () => (await git(repo, ['worktree', 'list', '--porcelain'])).split('\n').filter(l => l.startsWith('worktree ')).length;
  const kindOf = (args: readonly string[]) => args.includes('login') ? 'login' : args.includes('/usr/bin/test') ? 'check' : 'codex';

  interface Script { login?: ReturnType<typeof ok>; check?: ReturnType<typeof ok>; codex?: (windowsSnapshot: string, windowsOutput: string, args: readonly string[], options: Parameters<CodexCliProcessRunner>[2]) => Promise<ReturnType<typeof ok>>; env?: Record<string, string | undefined>; signal?: AbortSignal }
  async function execute(script: Script = {}) {
    const calls: { file: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv | undefined }[] = [];
    const run: CodexCliProcessRunner = async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd, env: options.env });
      const kind = kindOf(args);
      if (kind === 'login') return script.login ?? ok('Logged in using ChatGPT');
      if (kind === 'check') return script.check ?? ok();
      const cd = args[args.indexOf('--cd', args.indexOf('--exec') + 1) + 1]!;
      const output = args[args.indexOf('-o') + 1]!;
      if (script.codex) return script.codex(toWindows(cd), toWindows(output), args, options);
      await writeFile(toWindows(output), JSON.stringify(inconclusive));
      return ok();
    };
    const adapter = new InvestigationExecutorAdapter({ targets: { resolve: () => ({ repoRoot: repo, baseSha: sha }) }, run, environmentSource: script.env ?? wslEnv });
    const signals: WorkExecutorSignal[] = [];
    for await (const signal of adapter.execute(request(), script.signal ?? new AbortController().signal)) signals.push(signal);
    return { signals, calls };
  }

  test('launches wsl.exe --exec with translated paths, read-only/never, verbatim prompt and no secrets; host verifies the snapshot', async () => {
    const { signals, calls } = await execute();
    expect(calls.map(c => kindOf(c.args))).toEqual(['login', 'check', 'codex']);
    const codex = calls[2]!;
    expect(codex.file).toBe('C:\\Windows\\System32\\wsl.exe');
    const exec = codex.args.indexOf('--exec');
    expect(codex.args.slice(0, exec)).toEqual(['-d', 'Ubuntu-24.04', '-u', 'geanteco', '--cd', codex.args[5]]);
    const tail = codex.args.slice(codex.args.indexOf(CLI) + 1);
    expect(tail.slice(0, 7)).toEqual(['exec', '--sandbox', 'read-only', '-c', 'approval_policy=never', '--ephemeral', '--cd']);
    const linuxSnapshot = tail[7]!;
    expect(linuxSnapshot).toMatch(/^\/mnt\/[a-z]\/.+\/anima-investigation-[A-Za-z0-9]+\/snapshot$/); expect(linuxSnapshot).not.toContain('\\');
    expect(codex.args[5]).toBe(linuxSnapshot);
    expect(tail[tail.indexOf('--output-schema') + 1]).toBe(linuxSnapshot.replace(/snapshot$/, 'schema.json'));
    expect(tail[tail.indexOf('-o') + 1]).toBe(linuxSnapshot.replace(/snapshot$/, 'result.json'));
    expect(tail.at(-1)).toContain('Question: Investigate "this" $(id)');
    expect(codex.env).not.toHaveProperty('OPENAI_API_KEY');
    expect(codex.args.join(' ')).not.toMatch(/\bbash\b|\bsh -c\b|--dangerously|danger-full-access|workspace-write/);
    expect(signals[0]).toMatchObject({ kind: 'result', investigation: { outcome: 'inconclusive', hostVerification: { snapshotClean: true, snapshotDetached: true, snapshotHead: sha, baseSha: sha } } });
    expect((signals[0] as unknown as { limitations: string[] }).limitations.join(' ')).toContain('WSL');
    expect(JSON.stringify(signals)).not.toMatch(/anima-investigation-|\/mnt\/|secret/);
    expect(await worktrees()).toBe(1);
  });

  test.each([
    ['WSL unavailable', { exitCode: 1, stdout: '', stderr: 'WSL error' }],
    ['not logged in', { exitCode: 1, stdout: 'Not logged in', stderr: '' }],
    ['API-key login', { exitCode: 0, stdout: 'Logged in using an API key', stderr: '' }],
    ['unrecognised mode', { exitCode: 0, stdout: 'ok', stderr: '' }],
    ['timeout', { exitCode: -1, stdout: '', stderr: '', timedOut: true }],
  ])('fails closed before creating any snapshot when preflight reports %s', async (_name, login) => {
    const { signals, calls } = await execute({ login: { ...ok(), ...login } });
    expect(signals[0]).toMatchObject({ kind: 'error', retryable: false });
    expect(calls).toHaveLength(1); expect(await worktrees()).toBe(1);
  });

  test('path-check failure fails closed without launching Codex and disposes the snapshot', async () => {
    const { signals, calls } = await execute({ check: { ...ok(), exitCode: 1 } });
    expect(signals[0]).toMatchObject({ kind: 'error' });
    expect(calls.map(c => kindOf(c.args))).toEqual(['login', 'check']); expect(await worktrees()).toBe(1);
  });

  test.each([
    { ANIMA_CODEX_WSL_DISTRO: undefined }, { ANIMA_INVESTIGATION_CODEX_TRANSPORT: 'ssh' }, { ANIMA_CODEX_WSL_CLI_PATH: 'codex' },
  ])('invalid transport configuration %p never launches anything', async override => {
    const { signals, calls } = await execute({ env: { ...wslEnv, ...override } });
    expect(signals[0]).toMatchObject({ kind: 'error', code: 'invalid_request', retryable: false }); expect(calls).toHaveLength(0);
  });

  test.each(['file.txt', 'untracked.txt'])('a snapshot mutation by Codex (%s) is still a non-retryable host violation', async file => {
    const { signals } = await execute({ codex: async (snapshot, output) => { await writeFile(join(snapshot, file), 'mutation'); await writeFile(output, JSON.stringify(inconclusive)); return ok(); } });
    expect(signals[0]).toMatchObject({ kind: 'error', retryable: false }); expect(await worktrees()).toBe(1);
  });

  test('timeout is retryable, never a result', async () => {
    const { signals } = await execute({ codex: async () => ({ ...ok(), exitCode: -1, timedOut: true }) });
    expect(signals[0]).toMatchObject({ kind: 'error', retryable: true }); expect(await worktrees()).toBe(1);
  });

  test('cancellation during the Codex run acknowledges, disposes and keeps the abort signal on the process', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const { signals } = await execute({ signal: controller.signal, codex: async (_s, _o, _a, options) => { seen = options.signal; controller.abort(); return { ...ok(), exitCode: -1, cancelled: true }; } });
    expect(seen).toBe(controller.signal);
    expect(signals[0]).toMatchObject({ kind: 'cancelled', acknowledged: true }); expect(await worktrees()).toBe(1);
  });

  test('missing or oversized result file maps to the existing transport diagnostics', async () => {
    const missing = await execute({ codex: async () => ok() });
    expect(missing.signals[0]).toMatchObject({ kind: 'error', investigationFailure: { stage: 'transport', reason: 'output_unavailable' } });
    const big = await execute({ codex: async (_s, output) => { await writeFile(output, 'x'.repeat(100_001)); return ok(); } });
    expect(big.signals[0]).toMatchObject({ kind: 'error', investigationFailure: { stage: 'transport', reason: 'output_too_large' } });
    expect(await worktrees()).toBe(1);
  });

  test('default (no transport variable) keeps the native invocation untouched', async () => {
    const { signals, calls } = await execute({ env: { ANIMA_CODEX_CLI_PATH: 'codex', OPENAI_API_KEY: 'secret' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.file).toBe('codex'); expect(calls[0]!.args.slice(0, 8)).toEqual(['exec', '--sandbox', 'read-only', '-c', 'approval_policy=never', '--ephemeral', '--cd', calls[0]!.cwd]);
    expect(signals[0]).toMatchObject({ kind: 'result' });
  });
});
