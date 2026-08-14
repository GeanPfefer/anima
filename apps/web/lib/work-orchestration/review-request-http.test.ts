import { buildWorktreeHandoff, type BranchPublicationReceipt, type ReviewRequestReceipt, type ReviewRequestProvider, type WorkEvent } from '@anima/core';
import type { Json } from '@anima/types';
import { classifyReviewRequestError, runAuthorizedReviewRequest } from './review-request-http';
import { ReviewRequestPrecondition } from './authorized-review-request';
import { ReviewRequestFailure } from './github-review-request';

const BASE = 'a'.repeat(40), COMMIT = 'b'.repeat(40), WORK = 'work-1', ATTEMPT = 'attempt-1', RESULT = 'result-1', AUTH = 'auth-1';
const event = (id: string, type: WorkEvent['type'], data: Record<string, unknown>, author: WorkEvent['author'] = 'user'): WorkEvent =>
  ({ id, workItemId: WORK, type, author, proposalVersion: 1, payload: { schema_version: 1, data } as unknown as Json, occurredAt: new Date() });
const handoff = () => { const value = buildWorktreeHandoff({ workItemId: WORK, attemptId: ATTEMPT, approvedProposalVersion: 1, executorId: 'worktree-v1', backendId: 'fake', model: null, baseSha: BASE, branch: `anima-work/${ATTEMPT}`, commitSha: COMMIT, status: 'succeeded', changedFiles: ['x.ts'], diffFiles: [{ path: 'x.ts', insertions: 1, deletions: 0 }], gates: [{ label: 'test', command: 'npm test', exitCode: 0, outcome: 'passed' }] }); if (!value.ok) throw new Error(); return value.value; };
const target = { providerId: 'provider', repositoryId: 'repo', remoteName: 'origin', baseBranch: 'main' };
const branchReceipt = (): BranchPublicationReceipt => ({ kind: 'branch_publication', receiptId: 'r1', idempotencyKey: `integration-publication:${AUTH}:${COMMIT}:branch`, providerId: 'provider', repositoryId: 'repo', remoteName: 'origin', remoteBranch: `anima-work/${ATTEMPT}`, commitSha: COMMIT, baseBranch: 'main', verifiedBaseSha: BASE, disposition: 'created' });
const reviewReceipt = (): ReviewRequestReceipt => ({ kind: 'review_request', receiptId: 'rr1', idempotencyKey: `integration-publication:${AUTH}:${COMMIT}:review`, providerId: 'provider', repositoryId: 'repo', remoteName: 'origin', reviewId: '7', reviewReference: 'https://github.com/anima/repo/pull/7', state: 'open', sourceBranch: `anima-work/${ATTEMPT}`, sourceCommitSha: COMMIT, baseBranch: 'main', verifiedBaseSha: BASE, disposition: 'created' });
const baseEvents = (): WorkEvent[] => [
  event(RESULT, 'result_submitted', { work_item_id: WORK, attempt_id: ATTEMPT, approved_proposal_version: 1, handoff_reference: 'worktree:test', executor_signal: { kind: 'result', worktreeHandoff: handoff() } }, 'executor'),
  event('accept', 'result_accepted', { accepted_result_event_id: RESULT }),
  event('decision', 'integration_decided', { work_item_id: WORK, attempt_id: ATTEMPT, approved_proposal_version: 1, accepted_result_event_id: RESULT, decision: 'authorize', decision_id: AUTH }),
];
const branchPublished = () => event('published', 'branch_published', { authorization_decision_id: AUTH, accepted_result_event_id: RESULT, attempt_id: ATTEMPT, receipt: branchReceipt() }, 'system');
const reviewCreated = () => event('reviewed', 'review_request_created', { authorization_decision_id: AUTH, accepted_result_event_id: RESULT, attempt_id: ATTEMPT, receipt: reviewReceipt() }, 'system');
const withBranch = (): WorkEvent[] => [...baseEvents(), branchPublished()];
const provider = (over: Partial<ReviewRequestProvider> = {}): ReviewRequestProvider => ({ id: 'provider', inspectBranch: jest.fn(), publishBranch: jest.fn(), inspectReviewRequest: jest.fn().mockResolvedValue(null), createReviewRequest: jest.fn().mockResolvedValue(reviewReceipt()), ...over });

describe('classifyReviewRequestError', () => {
  test.each([['authorization_not_found', 404], ['handoff_not_found', 404], ['branch_not_published', 404], ['item_mismatch', 409], ['receipt_projection_conflict', 409], ['remote_drift', 409]] as const)('precondição %s → %d', (code, status) => {
    expect(classifyReviewRequestError(new ReviewRequestPrecondition(code, 'x'))).toMatchObject({ status, code, retryable: false });
  });
  test.each([['provider_unavailable', 502], ['rate_limited', 502], ['credentials_missing', 500], ['not_authorized', 500], ['repository_not_found', 500], ['invalid_request', 500], ['conflict', 409], ['validation_failed', 409], ['review_unverified', 409]] as const)('falha do provider %s → %d', (code, status) => {
    const classified = classifyReviewRequestError(new ReviewRequestFailure(code, 'msg'));
    expect(classified.status).toBe(status);
    expect(classified.retryable).toBe(status === 502);
  });
  test.each([['42501', 403], ['P0002', 404], ['55000', 409], ['22023', 400]] as const)('erro Postgres %s → %d com mensagem controlada', (pg, status) => {
    const classified = classifyReviewRequestError({ code: pg, message: 'segredo do schema' });
    expect(classified.status).toBe(status);
    expect(classified.message).not.toContain('segredo');
  });
  test('erro inesperado → 500, nunca mascarado como 409', () => {
    expect(classifyReviewRequestError(new Error('boom'))).toMatchObject({ status: 500, retryable: true });
    expect(classifyReviewRequestError(null)).toMatchObject({ status: 500 });
  });
});

describe('runAuthorizedReviewRequest', () => {
  const run = (over: Partial<Parameters<typeof runAuthorizedReviewRequest>[0]> = {}) => runAuthorizedReviewRequest({
    workItemId: WORK, target, provider: provider(), readEvents: async () => withBranch(), persist: jest.fn().mockResolvedValue({ action: 'recorded', eventSeq: 9 }), ...over,
  });

  test('criação nova → 200 com prova pública e persistência, sem vazar token/repoRoot', async () => {
    const result = await run();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, value: { status: 'created', reviewRequest: { repositoryId: 'repo', remoteName: 'origin', reviewId: '7', reviewReference: 'https://github.com/anima/repo/pull/7', sourceBranch: `anima-work/${ATTEMPT}`, sourceCommitSha: COMMIT, baseBranch: 'main', state: 'open', disposition: 'created' }, persistence: { action: 'recorded', eventSeq: 9 } } });
    expect(JSON.stringify(result.body)).not.toContain('tok');
  });
  test('branch não publicada → 404 branch_not_published, provider de review não é chamado', async () => {
    const p = provider();
    const result = await run({ readEvents: async () => baseEvents(), provider: p });
    expect(result.status).toBe(404);
    expect((result.body as { error: { code: string } }).error.code).toBe('branch_not_published');
    expect(p.createReviewRequest).not.toHaveBeenCalled();
  });
  test('review já persistido reconciliado → 200 already_persisted sem criar nem persistir de novo', async () => {
    const persist = jest.fn();
    const p = provider({ inspectReviewRequest: jest.fn().mockResolvedValue(reviewReceipt()), createReviewRequest: jest.fn() });
    const result = await run({ readEvents: async () => [...withBranch(), reviewCreated()], provider: p, persist });
    expect(result.status).toBe(200);
    expect((result.body as { value: { status: string } }).value.status).toBe('already_persisted');
    expect(p.createReviewRequest).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
  test('review persistido some e OUTRO PR ocupa a branch → 409 remote_drift, sem criar nem persistir', async () => {
    // O PR #7 persistido foi fechado; um PR #8 ocupa a mesma branch@commit→base.
    // A inspeção devolve um receipt válido, porém com identidade divergente. A
    // liveness precisa falhar fechado: o fato persistido não descreve mais a
    // realidade, e a resposta não pode afirmar que #7 segue aberto.
    const persist = jest.fn();
    const divergent: ReviewRequestReceipt = { ...reviewReceipt(), reviewId: '8', reviewReference: 'https://github.com/anima/repo/pull/8', disposition: 'already_existed' };
    const p = provider({ inspectReviewRequest: jest.fn().mockResolvedValue(divergent), createReviewRequest: jest.fn() });
    const result = await run({ readEvents: async () => [...withBranch(), reviewCreated()], provider: p, persist });
    expect(result.status).toBe(409);
    expect((result.body as { error: { code: string } }).error.code).toBe('remote_drift');
    expect(p.createReviewRequest).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
  test('autorização ausente (log vazio) → 404, sem chamar o provider', async () => {
    const p = provider();
    const result = await run({ readEvents: async () => [], provider: p });
    expect(result.status).toBe(404);
    expect(p.createReviewRequest).not.toHaveBeenCalled();
  });
  test('provider indisponível → 502 retryável', async () => {
    const p = provider({ createReviewRequest: jest.fn().mockRejectedValue(new ReviewRequestFailure('provider_unavailable', 'x')) });
    expect((await run({ provider: p })).status).toBe(502);
  });
  test('conflito de persistência (55000) → 409', async () => {
    const persist = jest.fn().mockRejectedValue({ code: '55000', message: 'x' });
    expect((await run({ persist })).status).toBe(409);
  });
  test('erro inesperado do provider → 500, não 409', async () => {
    const p = provider({ createReviewRequest: jest.fn().mockRejectedValue(new Error('boom')) });
    expect((await run({ provider: p })).status).toBe(500);
  });
});
