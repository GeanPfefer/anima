import { buildWorktreeHandoff, type BranchPublicationReceipt, type ProtectedIntegrationProvider, type WorkEvent } from '@anima/core';
import type { Json } from '@anima/types';
import { classifyBranchPublicationError, runAuthorizedBranchPublication } from './branch-publication-http';
import { BranchPublicationPrecondition } from './authorized-branch-publication';
import { BranchPublicationFailure } from './git-branch-publication';

const BASE = 'a'.repeat(40), COMMIT = 'b'.repeat(40), WORK = 'work-1', ATTEMPT = 'attempt-1', RESULT = 'result-1', AUTH = 'auth-1';
const event = (id: string, type: WorkEvent['type'], data: Record<string, unknown>, author: WorkEvent['author'] = 'user'): WorkEvent =>
  ({ id, workItemId: WORK, type, author, proposalVersion: 1, payload: { schema_version: 1, data } as unknown as Json, occurredAt: new Date() });
const handoff = () => { const value = buildWorktreeHandoff({ workItemId: WORK, attemptId: ATTEMPT, approvedProposalVersion: 1, executorId: 'worktree-v1', backendId: 'fake', model: null, baseSha: BASE, branch: `anima-work/${ATTEMPT}`, commitSha: COMMIT, status: 'succeeded', changedFiles: ['x.ts'], diffFiles: [{ path: 'x.ts', insertions: 1, deletions: 0 }], gates: [{ label: 'test', command: 'npm test', exitCode: 0, outcome: 'passed' }] }); if (!value.ok) throw new Error(); return value.value; };
const events = (): WorkEvent[] => [
  event(RESULT, 'result_submitted', { work_item_id: WORK, attempt_id: ATTEMPT, approved_proposal_version: 1, handoff_reference: 'worktree:test', executor_signal: { kind: 'result', worktreeHandoff: handoff() } }, 'executor'),
  event('accept', 'result_accepted', { accepted_result_event_id: RESULT }),
  event('decision', 'integration_decided', { work_item_id: WORK, attempt_id: ATTEMPT, approved_proposal_version: 1, accepted_result_event_id: RESULT, decision: 'authorize', decision_id: AUTH }),
];
const target = { providerId: 'provider', repositoryId: 'repo', remoteName: 'origin', baseBranch: 'main' };
const receipt = (): BranchPublicationReceipt => ({ kind: 'branch_publication', receiptId: 'r1', idempotencyKey: `integration-publication:${AUTH}:${COMMIT}:branch`, providerId: 'provider', repositoryId: 'repo', remoteName: 'origin', remoteBranch: `anima-work/${ATTEMPT}`, commitSha: COMMIT, baseBranch: 'main', verifiedBaseSha: BASE, disposition: 'created' });
const provider = (): ProtectedIntegrationProvider => ({ id: 'provider', inspectBranch: jest.fn().mockResolvedValue(null), publishBranch: jest.fn().mockResolvedValue(receipt()) });
const persistedEvent = () => event('published', 'branch_published', { authorization_decision_id: AUTH, accepted_result_event_id: RESULT, attempt_id: ATTEMPT, receipt: receipt() }, 'system');

describe('classifyBranchPublicationError', () => {
  test('precondição sobre o estado persistido → 409 com o código estável', () => {
    expect(classifyBranchPublicationError(new BranchPublicationPrecondition('authorization_not_found', 'x')))
      .toMatchObject({ status: 409, code: 'authorization_not_found', retryable: false });
  });
  test.each([
    ['remote_unavailable', 502], ['push_unverified', 502], ['invalid_request', 500],
    ['repository_mismatch', 409], ['remote_branch_conflict', 409], ['local_branch_missing', 409], ['base_mismatch', 409], ['local_commit_mismatch', 409],
  ] as const)('falha do provider %s → %d', (code, status) => {
    const classified = classifyBranchPublicationError(new BranchPublicationFailure(code, 'msg'));
    expect(classified.status).toBe(status);
    expect(classified.code).toBe(code);
    expect(classified.retryable).toBe(status === 502);
  });
  test.each([['42501', 403], ['P0002', 404], ['55000', 409], ['22023', 400]] as const)(
    'erro Postgres %s → %d com mensagem controlada (não ecoa o Postgres)',
    (pg, status) => {
      const classified = classifyBranchPublicationError({ code: pg, message: 'segredo do schema interno' });
      expect(classified.status).toBe(status);
      expect(classified.message).not.toContain('segredo');
    });
  test('erro inesperado nunca é mascarado como 409 → 500 retryável', () => {
    expect(classifyBranchPublicationError(new Error('boom'))).toMatchObject({ status: 500, retryable: true });
    expect(classifyBranchPublicationError(null)).toMatchObject({ status: 500 });
  });
});

describe('runAuthorizedBranchPublication', () => {
  const run = (over: Partial<Parameters<typeof runAuthorizedBranchPublication>[0]> = {}) => runAuthorizedBranchPublication({
    workItemId: WORK, target, provider: provider(), readEvents: async () => events(), persist: jest.fn().mockResolvedValue({ action: 'recorded', eventSeq: 4 }), ...over,
  });

  test('publicação nova → 200 com prova pública e persistência, sem vazar repoRoot', async () => {
    const result = await run();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, value: { status: 'published', publication: { repositoryId: 'repo', remoteName: 'origin', remoteBranch: `anima-work/${ATTEMPT}`, commitSha: COMMIT, baseBranch: 'main', disposition: 'created' }, persistence: { action: 'recorded', eventSeq: 4 } } });
  });
  test('fato já persistido reconciliado → 200 already_persisted sem persistir de novo', async () => {
    const persist = jest.fn();
    const p: ProtectedIntegrationProvider = { id: 'provider', inspectBranch: jest.fn().mockResolvedValue(receipt()), publishBranch: jest.fn() };
    const result = await run({ readEvents: async () => [...events(), persistedEvent()], provider: p, persist });
    expect(result.status).toBe(200);
    expect((result.body as { value: { status: string } }).value.status).toBe('already_persisted');
    expect(p.publishBranch).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
  test('autorização ausente (log vazio) → 409 not-publishable, sem chamar o provider', async () => {
    const p = provider();
    const result = await run({ readEvents: async () => [], provider: p });
    expect(result.status).toBe(409);
    expect(p.publishBranch).not.toHaveBeenCalled();
  });
  test('remote indisponível durante o push → 502 retryável', async () => {
    const p: ProtectedIntegrationProvider = { id: 'provider', inspectBranch: jest.fn().mockResolvedValue(null), publishBranch: jest.fn().mockRejectedValue(new BranchPublicationFailure('remote_unavailable', 'x')) };
    expect((await run({ provider: p })).status).toBe(502);
  });
  test('conflito de persistência (55000) após efeito comprovado → 409', async () => {
    const persist = jest.fn().mockRejectedValue({ code: '55000', message: 'x' });
    expect((await run({ persist })).status).toBe(409);
  });
  test('erro inesperado do provider → 500, não 409', async () => {
    const p: ProtectedIntegrationProvider = { id: 'provider', inspectBranch: jest.fn().mockResolvedValue(null), publishBranch: jest.fn().mockRejectedValue(new Error('boom')) };
    expect((await run({ provider: p })).status).toBe(500);
  });
});
