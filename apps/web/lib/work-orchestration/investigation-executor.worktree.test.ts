/** @jest-environment node */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCoderTaskSpec, validateWorkExecutorTranscript, type WorkExecutorRequest, type WorkExecutorSignal } from '@anima/core';
import { InvestigationExecutorAdapter, readProhibitedInvestigationRefs, resolveInvestigationEvidence } from './investigation-executor';
import { runProcess } from './worktree';
import type { CodexCliProcessRunner } from './codex-cli-coder';

jest.setTimeout(30_000);
const git = async (repo: string, args: readonly string[]) => {
  const result = await runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs: 15_000 });
  if (result.exitCode !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const inconclusive = { schemaVersion: 1, findings: [], gaps: ['History unavailable.'], outcome: 'inconclusive' };
describe('investigation host with real git', () => {
  let repo: string, sha: string;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'anima-investigation-test-'));
    await git(repo, ['init', '-b', 'main']);
    await git(repo, ['config', 'user.name', 'fixture']); await git(repo, ['config', 'user.email', 'fixture@test.invalid']);
    await git(repo, ['config', 'commit.gpgsign', 'false']);
    await writeFile(join(repo, 'file.txt'), 'first\nsecond\n'); await writeFile(join(repo, '.gitignore'), 'ignored.txt\n');
    await git(repo, ['add', '.']); await git(repo, ['commit', '-m', 'fixture']); sha = await git(repo, ['rev-parse', 'HEAD']);
  });
  afterEach(async () => { if (repo) await rm(repo, { recursive: true, force: true }); });
  const request = (): WorkExecutorRequest => ({ workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 1, capability: 'research', effectClass: 'read_only',
    objective: 'Investigate', includedScope: ['file.txt'], excludedScope: ['secrets'], permissions: ['workspace_read'], target: { kind: 'project', reference: 'fixture' },
    validationCriteria: [{ label: 'refs' }], limits: { maxDurationMinutes: 1 }, contextReferences: [],
    taskSpec: buildCoderTaskSpec({ workItemId: 'work-1', approvedProposalVersion: 1, proposal: { summary: 'Investigate', objective: 'Investigate', includedScope: ['file.txt'], excludedScope: ['secrets'], expectedEffects: [], risks: [] }, spec: { validationCriteria: [{ label: 'refs' }] }, verifierRequirement: 'advisory', contextReferences: [] }) });
  async function execute(action?: (snapshot: string, args: readonly string[]) => Promise<unknown>, output: unknown = inconclusive) {
    const run: CodexCliProcessRunner = async (_file, args, options) => {
      expect(args.slice(0, 8)).toEqual(['exec', '--sandbox', 'read-only', '-c', 'approval_policy=never', '--ephemeral', '--cd', options.cwd]);
      expect(options.env).not.toHaveProperty('OPENAI_API_KEY'); expect(options.timeoutMs).toBeGreaterThan(0);
      await action?.(options.cwd, args);
      await writeFile(args[args.indexOf('-o') + 1]!, JSON.stringify(output));
      return { command: 'fake', exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, cancelled: false };
    };
    const adapter = new InvestigationExecutorAdapter({ targets: { resolve: () => ({ repoRoot: repo, baseSha: sha }) }, run, environmentSource: { ANIMA_CODEX_CLI_PATH: 'codex', OPENAI_API_KEY: 'secret' } });
    const signals: WorkExecutorSignal[] = [];
    for await (const signal of adapter.execute(request(), new AbortController().signal)) signals.push(signal);
    expect((await git(repo, ['worktree', 'list', '--porcelain'])).split('\n').filter(l => l.startsWith('worktree '))).toHaveLength(1);
    return signals;
  }
  test('valid inconclusive emits result; live operator activity and old programming refs do not create false positives', async () => {
    await git(repo, ['branch', 'anima-work/old']); await writeFile(join(repo, 'operator.txt'), 'operator');
    const signals = await execute(async () => { await git(repo, ['branch', 'operator-branch']); });
    expect(signals[0]).toMatchObject({ kind: 'result', investigation: { outcome: 'inconclusive', hostVerification: { snapshotClean: true, snapshotDetached: true, baseSha: sha, prohibitedRefsBefore: ['refs/heads/anima-work/old'] } } });
    expect(signals[0]).not.toHaveProperty('worktreeHandoff'); expect(validateWorkExecutorTranscript(signals)).toBeNull();
    expect(await git(repo, ['status', '--porcelain'])).toContain('operator.txt');
  });
  test.each(['file.txt', 'untracked.txt', 'ignored.txt'])('snapshot mutation %s is non-retryable, including untracked and ignored files', async file => {
    expect((await execute(async snapshot => { await writeFile(join(snapshot, file), 'mutation'); }))[0]).toMatchObject({ kind: 'error', code: 'execution_failed', retryable: false });
  });
  test('symbolic HEAD at the same base is non-retryable', async () => {
    expect((await execute(async snapshot => { await git(snapshot, ['symbolic-ref', 'HEAD', 'refs/heads/main']); }))[0]).toMatchObject({ kind: 'error', retryable: false });
  });
  test('detached HEAD at another commit is non-retryable', async () => {
    await writeFile(join(repo, 'file.txt'), 'new\n'); await git(repo, ['add', '.']); await git(repo, ['commit', '-m', 'second']);
    const later = await git(repo, ['rev-parse', 'HEAD']);
    expect((await execute(async snapshot => { await git(snapshot, ['checkout', '--detach', later]); }))[0]).toMatchObject({ kind: 'error', retryable: false });
  });
  test.each(['refs/heads/anima-work/new', 'refs/tags/attempt-1'])('prohibited ref %s is non-retryable', async ref => {
    expect((await execute(async snapshot => { await git(snapshot, ['update-ref', ref, sha]); }))[0]).toMatchObject({ kind: 'error', retryable: false });
    expect(await readProhibitedInvestigationRefs(repo, 'attempt-1')).toContain(ref);
  });
  test.each([
    { kind: 'commit', commit: 'f'.repeat(40) },
    { kind: 'file_at_commit', path: 'missing.txt', lines: null },
    { kind: 'file_at_commit', path: 'file.txt', lines: { start: 1, end: 3 } },
    { kind: 'file_at_commit', path: '.', lines: null },
  ])('unresolvable/invalid evidence %p is retryable', async evidence => {
    const output = { schemaVersion: 1, outcome: 'conclusive', gaps: [], findings: [{ statement: 'Finding', status: 'established', evidence: [{ commit: sha, ...evidence }] }] };
    expect((await execute(undefined, output))[0]).toMatchObject({ kind: 'error', retryable: true });
  });
  test('resolves evidence at a commit and valid line range independent of live contents', async () => {
    await writeFile(join(repo, 'file.txt'), 'operator changed live checkout');
    const output = { schemaVersion: 1, outcome: 'conclusive', gaps: [], findings: [{ statement: 'Two lines', status: 'inferred', evidence: [{ kind: 'file_at_commit', commit: sha, path: 'file.txt', lines: { start: 1, end: 2 } }] }] };
    expect((await execute(undefined, output))[0]).toMatchObject({ kind: 'result' });
    expect(await resolveInvestigationEvidence(repo, { schemaVersion: 1, outcome: 'conclusive', gaps: [], findings: [{ statement: 'Commit', status: 'established', evidence: [{ kind: 'commit', commit: sha }] }] })).toBe(true);
  });
  test('invalid structure is retryable and effects take precedence over malformed output', async () => {
    expect((await execute(undefined, { ...inconclusive, gaps: [] }))[0]).toMatchObject({ kind: 'error', retryable: true });
    expect((await execute(async snapshot => { await writeFile(join(snapshot, 'untracked.txt'), 'bad'); }, { ...inconclusive, gaps: [] }))[0]).toMatchObject({ kind: 'error', retryable: false });
  });
});
