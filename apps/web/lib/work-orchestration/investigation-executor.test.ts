/** @jest-environment node */
import * as worktree from './worktree';
import { inspectInvestigationEvidence } from './investigation-executor';
import { buildCoderTaskSpec, type WorkExecutorRequest, type WorkExecutorSignal } from '@anima/core';
import { buildInvestigationPrompt, hasNewProhibitedInvestigationRefs, InvestigationExecutorAdapter } from './investigation-executor';
import { CODEX_CLI_PROMPT_MAX_CHARS, buildCodexCliEnvironment } from './codex-cli-coder';

const request = (): WorkExecutorRequest => ({
  workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 1, capability: 'research', effectClass: 'read_only',
  objective: 'Explain the contract.', includedScope: ['src'], excludedScope: ['secrets'], permissions: ['workspace_read'],
  target: { kind: 'project', reference: 'fixture' }, validationCriteria: [{ label: 'references resolve' }], limits: { maxDurationMinutes: 1 }, contextReferences: [],
  taskSpec: buildCoderTaskSpec({ workItemId: 'work-1', approvedProposalVersion: 1,
    proposal: { summary: 'Investigate', objective: 'Explain the contract.', includedScope: ['src'], excludedScope: ['secrets'], expectedEffects: [], risks: [] },
    spec: { validationCriteria: [{ label: 'references resolve' }] }, verifierRequirement: 'advisory', contextReferences: [] }),
});
const collect = async (adapter: InvestigationExecutorAdapter, req = request(), signal = new AbortController().signal): Promise<WorkExecutorSignal[]> => {
  const values: WorkExecutorSignal[] = [];
  for await (const value of adapter.execute(req, signal)) values.push(value);
  return values;
};
describe('investigation adapter request boundary', () => {
  test.each([undefined, 'mutating', 'unknown', null])('refuses non-read-only class %p before resolving target or launching', async effectClass => {
    const resolve = jest.fn(() => null); const run = jest.fn();
    const adapter = new InvestigationExecutorAdapter({ targets: { resolve }, run });
    expect(await collect(adapter, { ...request(), effectClass } as WorkExecutorRequest)).toEqual([expect.objectContaining({ kind: 'error', code: 'invalid_request', retryable: false })]);
    expect(resolve).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });
  test.each([{ permissions: ['workspace_read', 'workspace_write_isolated'] }, { permissions: ['workspace_read', 'filesystem_write'] }, { permissions: ['workspace_read', 'unknown'] }, { permissions: [] }])('refuses permissions %p', async ({ permissions }) => {
    const run = jest.fn();
    const adapter = new InvestigationExecutorAdapter({ targets: { resolve: () => null }, run });
    expect(await collect(adapter, { ...request(), permissions })).toEqual([expect.objectContaining({ kind: 'error', code: 'invalid_request' })]);
    expect(run).not.toHaveBeenCalled();
  });
  test('rejects missing target/config and mandated lane', async () => {
    const run = jest.fn();
    const adapter = new InvestigationExecutorAdapter({ targets: { resolve: () => ({ repoRoot: '.', baseSha: 'a'.repeat(40) }) }, run, environmentSource: { ANIMA_CODEX_CLI_PATH: 'codex.cmd' } });
    expect((await collect(adapter))[0]).toMatchObject({ kind: 'error', code: 'invalid_request' });
    const mandated = new InvestigationExecutorAdapter({ targets: { resolve: () => ({ repoRoot: '.', baseSha: 'a'.repeat(40) }) }, run });
    const req = request();
    expect((await collect(mandated, { ...req, taskSpec: { ...req.taskSpec, verifierRequirement: 'required_fail_closed' } }))[0]).toMatchObject({ kind: 'error', code: 'invalid_request' });
    expect(run).not.toHaveBeenCalled();
  });
  test('pre-cancelled attempt never launches and replay retains correlation', async () => {
    const run = jest.fn(); const controller = new AbortController(); controller.abort();
    const adapter = new InvestigationExecutorAdapter({ targets: { resolve: () => ({ repoRoot: '.', baseSha: 'a'.repeat(40) }) }, run, environmentSource: {} });
    const first = await collect(adapter, request(), controller.signal);
    expect(first[0]).toMatchObject({ kind: 'cancelled', acknowledged: true, sequence: 1, origin: 'executor' });
    expect(await collect(adapter)).toEqual(first);
    expect((await collect(adapter, { ...request(), objective: 'Different question' }))[0]).toMatchObject({ code: 'attempt_payload_conflict' });
    expect(run).not.toHaveBeenCalled();
  });
  test('prompt declares source instruction and does not promise read confinement', () => {
    const prompt = buildInvestigationPrompt(request(), 'a'.repeat(40));
    expect(prompt).toContain('Question: Explain the contract.'); expect(prompt).toContain('not a guaranteed confidentiality boundary');
    expect(prompt).toContain('Do not EDIT'); expect(prompt).toContain('file@commit:lines');
    expect(buildCodexCliEnvironment({ PATH: 'path', CODEX_HOME: 'auth', OPENAI_API_KEY: 'secret', SUPABASE_SERVICE_ROLE_KEY: 'secret' })).toEqual({ PATH: 'path', CODEX_HOME: 'auth', NO_COLOR: '1' });
  });
  test('prompt requires confirmed ranges and forbids citations beyond EOF', () => {
    const prompt = buildInvestigationPrompt(request(), 'a'.repeat(40));
    expect(prompt).toContain('Omit lines (use null)');
    expect(prompt).toContain('confirmed by reading the file');
    expect(prompt).toContain('Never estimate the end of a file');
    expect(prompt).toContain('beyond the last line (EOF)');
    expect(prompt.length).toBeLessThan(CODEX_CLI_PROMPT_MAX_CHARS);
  });
  test('only newly introduced forbidden names invalidate the snapshot; ordinary concurrent refs are outside this check', () => {
    expect(hasNewProhibitedInvestigationRefs(['refs/heads/anima-work/previous'], ['refs/heads/anima-work/previous'])).toBe(false);
    expect(hasNewProhibitedInvestigationRefs([], ['refs/tags/attempt-1'])).toBe(true);
  });
});

describe('evidence host operation diagnostics', () => {
  afterEach(() => jest.restoreAllMocks());
  const result = { schemaVersion: 1 as const, outcome: 'conclusive' as const, gaps: [], findings: [{ statement: 'Model text', status: 'established' as const, evidence: [{ kind: 'file_at_commit' as const, commit: 'a'.repeat(40), path: 'private.txt', lines: { start: 1, end: 1 } }] }] };
  const response = (stdout: string) => ({ command: 'git', stdout, stderr: '', exitCode: 0, cancelled: false, timedOut: false, durationMs: 1 });
  test('non-blob object fails closed with indices', async () => {
    jest.spyOn(worktree, 'runProcess').mockResolvedValueOnce(response('commit')).mockResolvedValueOnce(response(`100644 blob ${'b'.repeat(40)}\tprivate.txt`)).mockResolvedValueOnce(response('tree'));
    expect(await inspectInvestigationEvidence('.', result)).toEqual({ ok: false, failure: { version: 1, stage: 'evidence', reason: 'evidence_object_not_blob', findingIndex: 0, evidenceIndex: 0 } });
  });
  test('git exception is classified without stack or stderr', async () => {
    jest.spyOn(worktree, 'runProcess').mockRejectedValue(new Error('private stack stderr'));
    const inspection = await inspectInvestigationEvidence('.', result);
    expect(inspection).toMatchObject({ ok: false, failure: { reason: 'evidence_git_unavailable' } });
    expect(JSON.stringify(inspection)).not.toContain('private');
  });
  test('content byte mismatch remains a hard failure', async () => {
    jest.spyOn(worktree, 'runProcess').mockResolvedValueOnce(response('commit')).mockResolvedValueOnce(response(`100644 blob ${'b'.repeat(40)}\tprivate.txt`)).mockResolvedValueOnce(response('blob')).mockResolvedValueOnce(response('10')).mockResolvedValueOnce(response('short'));
    expect(await inspectInvestigationEvidence('.', result)).toMatchObject({ ok: false, failure: { reason: 'evidence_content_invalid' } });
  });
});
