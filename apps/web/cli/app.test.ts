import { resolveCommandWorkReference, runWorkEvidence, runWorkWithdraw, runWorkList } from './app';
import { parseArgs, USAGE, type ParsedCommand } from './args';
import { resolveWorkReference } from '@/lib/work-orchestration/work-reference';
import type {
  ResolveWorkApprovalCommand,
  ReviewWorkResultCommand,
  WorkContextSnapshot,
  WorkEvent,
  WorkItem,
  WorkOperationResult,
} from '@anima/core';
import type { ReviewCorrectionResult } from '@/lib/work-orchestration/review-correction-orchestration';
import type { AuthorizeResumeResult } from '@/lib/work-orchestration/authorize-resume';
import { runBudgetStatus, runStatus, runWorkApprove, runWorkAuthorizeResume, runWorkCorrect, runWorkExecutors, runWorkReview, runWorkShow, type WorkOrchestrationPort } from './app';
import { renderHuman } from './render';
import { EXIT } from './exit-codes';

const ok = <T>(value: T): WorkOperationResult<T> => ({ ok: true, value });
const notFound = (): WorkOperationResult<never> => ({ ok: false, error: { code: 'work_item_not_found', message: 'ausente', retryable: false } });

const reviewItem = {
  id: 'i', userId: 'u', sourceMessageId: 'm', state: 'review', impactLevel: 'low', capability: 'programming',
  originalRequest: 'x', intent: {},
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
  proposalVersion: 2, createdAt: new Date(), updatedAt: new Date(),
} satisfies WorkItem;
const resultEvent = {
  id: 'r', workItemId: 'i', type: 'result_submitted', author: 'executor', proposalVersion: 2,
  payload: { schema_version: 1, data: { summary: 'feito', result_references: ['commit:a'] } }, occurredAt: new Date(),
} satisfies WorkEvent;

/** Duplo do application service: registra a chamada de reviewResult para provar que a
 * governança do adapter para ANTES do serviço quando o estado não permite. */
function fakePort(overrides: Partial<WorkOrchestrationPort> & { reviewSpy?: { called: boolean }; approveSpy?: { called: boolean } } = {}): WorkOrchestrationPort {
  const spy = overrides.reviewSpy;
  const approveSpy = overrides.approveSpy;
  return {
    getItem: overrides.getItem ?? (async () => ok(reviewItem)),
    listEvents: overrides.listEvents ?? (async () => ok<readonly WorkEvent[]>([resultEvent])),
    listContexts: overrides.listContexts ?? (async () => ok<readonly WorkContextSnapshot[]>([])),
    findResumableWorkItems: overrides.findResumableWorkItems ?? (async () => ok<readonly WorkItem[]>([])),
    reviewResult: overrides.reviewResult ?? (async (command: ReviewWorkResultCommand) => {
      if (spy) spy.called = true;
      return ok({ ...reviewItem, state: 'changes_requested' });
    }),
    resolveApproval: overrides.resolveApproval ?? (async (command: ResolveWorkApprovalCommand) => {
      if (approveSpy) approveSpy.called = true;
      return ok({ ...reviewItem, state: 'approved' });
    }),
    withdrawApprovedWork: overrides.withdrawApprovedWork ?? (async () => ok({ ...reviewItem, state: 'cancelled' })),
  };
}

// Item `proposed` com proveniência íntegra (work_proposed v1 + referência da mensagem).
const proposedItem = { ...reviewItem, state: 'proposed', proposalVersion: 1 } satisfies WorkItem;
const proposedEvents: readonly WorkEvent[] = [
  { id: 'p', workItemId: 'i', type: 'work_proposed', author: 'anima', proposalVersion: 1, payload: { schema_version: 1, data: {} }, occurredAt: new Date() },
];
const sourceContext: readonly WorkContextSnapshot[] = [
  { id: 'ctx', workItemId: 'i', version: 1, references: [{ kind: 'message', id: 'm' }], createdAt: new Date() },
];

describe('runners da CLI sobre o application service', () => {
  test('budget status apenas projeta o snapshot canônico sem mutação', async () => {
    let reads = 0;
    const result = await runBudgetStatus(async (id) => { reads += 1; expect(id).toBe('i'); return {
      observedAt: '2026-09-05T12:00:00Z', policyVersion: 'autonomous-work-budget-v1', costClass: 'external', admitted: false, reason: 'user_attempt_budget_exhausted', supervised:false, supervision:null, unattendedAdmitted:false, unattendedReason:'user_attempt_budget_exhausted',
      windows: { attemptsHours: 24, userRuntimeHours: 24, autonomousRuntimeMinutes: 60 },
      attempts: { item: { used: 2, limit: 3, remaining: 1, nextReleaseAt: '2026-09-05T13:00:00Z' }, user: { used: 6, remaining: 0, nextReleaseAt: '2026-09-05T12:30:00Z' }, external: { used: 4, remaining: 2, nextReleaseAt: '2026-09-05T12:40:00Z' } },
      runtime: { user24h: { usedSeconds: 300, remainingSeconds: 6900 }, external24h: { usedSeconds: 200, remainingSeconds: 7000 }, autonomous60m: { usedSeconds: 100, remainingSeconds: 2600 } },
      nextBudgetReleaseAt: '2026-09-05T12:30:00Z',
    }; }, 'i');
    expect(reads).toBe(1);
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.payload).toMatchObject({ kind: 'budget-status', admitted: false, reason: 'user_attempt_budget_exhausted', userAttempts24h: 6, userAttemptsRemaining: 0, externalAttempts24h: 4, externalAttemptsRemaining: 2, attempts: { user: { used: 6, remaining: 0 } } });
  });
  test('request_changes num item em review monta o comando e persiste pelo serviço', async () => {
    const spy = { called: false };
    const result = await runWorkReview(fakePort({ reviewSpy: spy }), 'i', { type: 'request_changes', requestedChanges: 'faltam provas' });
    expect(spy.called).toBe(true);
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.payload).toMatchObject({ ok: true, kind: 'review', decision: 'request_changes', state: 'changes_requested', reviewedResultEventId: 'r' });
  });

  test('request_changes num item que NÃO está em review é recusado por regra (exit 3) sem tocar o serviço', async () => {
    const spy = { called: false };
    const port = fakePort({ reviewSpy: spy, getItem: async () => ok({ ...reviewItem, state: 'in_progress' }) });
    const result = await runWorkReview(port, 'i', { type: 'request_changes', requestedChanges: 'x' });
    expect(spy.called).toBe(false);
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(result.payload).toMatchObject({ ok: false, kind: 'error', code: 'not_in_review' });
  });

  test('request_changes num resultado de versão anterior é recusado por regra (exit 3)', async () => {
    const stale = { ...resultEvent, proposalVersion: 1, payload: { schema_version: 1, data: { summary: 'antigo', result_references: [] } } } satisfies WorkEvent;
    const port = fakePort({ listEvents: async () => ok<readonly WorkEvent[]>([stale]) });
    const result = await runWorkReview(port, 'i', { type: 'accept' });
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(result.payload).toMatchObject({ ok: false, code: 'result_version_mismatch' });
  });

  test('conflito de versão no serviço vira recusa por regra (exit 3)', async () => {
    const port = fakePort({ reviewResult: async () => ({ ok: false, error: { code: 'version_conflict', message: 'conflito', retryable: false } }) });
    const result = await runWorkReview(port, 'i', { type: 'request_changes', requestedChanges: 'x' });
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(result.payload).toMatchObject({ ok: false, code: 'version_conflict' });
  });

  test('work show de item inexistente é erro operacional (exit 1)', async () => {
    const result = await runWorkShow(fakePort({ getItem: async () => notFound() }), 'zzz');
    expect(result.exitCode).toBe(EXIT.ERROR);
    expect(result.payload).toMatchObject({ ok: false, kind: 'error', code: 'work_item_not_found' });
  });

  test('work approve aprova uma PROPOSTA íntegra pelo resolveApproval (exit 0)', async () => {
    const approveSpy = { called: false };
    const port = fakePort({
      approveSpy,
      getItem: async () => ok(proposedItem),
      listEvents: async () => ok(proposedEvents),
      listContexts: async () => ok(sourceContext),
      resolveApproval: async () => { approveSpy.called = true; return ok({ ...proposedItem, state: 'approved' }); },
    });
    const result = await runWorkApprove(port, 'i');
    expect(approveSpy.called).toBe(true);
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.payload).toMatchObject({ ok: true, kind: 'approve', workItemId: 'i', state: 'approved' });
  });

  test('work approve num item que não está em proposed é recusado por regra (exit 3), sem tocar o serviço', async () => {
    const approveSpy = { called: false };
    const port = fakePort({ approveSpy, getItem: async () => ok(reviewItem), listContexts: async () => ok(sourceContext) });
    const result = await runWorkApprove(port, 'i');
    expect(approveSpy.called).toBe(false);
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(result.payload).toMatchObject({ ok: false, code: 'not_proposed' });
  });

  test('work withdraw retira um plano aprovado pela versão vigente (exit 0)', async () => {
    let calledWith: { workItemId: string; expectedProposalVersion: number; reason: string } | null = null;
    const port = fakePort({
      getItem: async () => ok({ ...reviewItem, state: 'approved' }),
      withdrawApprovedWork: async (command) => { calledWith = command; return ok({ ...reviewItem, state: 'cancelled' }); },
    });
    const { runWorkWithdraw } = await import('./app');
    const result = await runWorkWithdraw(port, 'i', 'plano obsoleto antes da execução');
    expect(calledWith).toMatchObject({ workItemId: 'i', expectedProposalVersion: 2, reason: 'plano obsoleto antes da execução' });
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.payload).toMatchObject({ ok: true, kind: 'withdraw', state: 'cancelled' });
  });

  test('work withdraw negado por regra (estado errado) vira exit 3', async () => {
    const { runWorkWithdraw } = await import('./app');
    const port = fakePort({
      getItem: async () => ok({ ...reviewItem, state: 'in_progress' }),
      withdrawApprovedWork: async () => ({ ok: false, error: { code: 'version_conflict', message: 'não é plano aprovado não iniciado', retryable: false } }),
    });
    const result = await runWorkWithdraw(port, 'i', 'x');
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(result.payload).toMatchObject({ ok: false, code: 'version_conflict' });
  });

  test('work retry num item RETRY_READY deriva versão+failureEvent e chama request_work_retry (exit 0)', async () => {
    let requested: { workItemId: string; expectedProposalVersion: number; failureEventId: string; retryRequestId: string } | null = null;
    const { runWorkRetry } = await import('./app');
    const retry = {
      readReadiness: async () => ({ status: 'RETRY_READY' as const, reason: null, proposalVersion: 1, failureEventId: 'ed49', attemptsUsed: 1, maxAttempts: 3, remainingAttempts: 2 }),
      requestRetry: async (input: { workItemId: string; expectedProposalVersion: number; failureEventId: string; retryRequestId: string }) => { requested = input; return { ok: true as const, replayed: false }; },
    };
    const result = await runWorkRetry(retry, 'i', () => 'req-uuid');
    expect(requested).toEqual({ workItemId: 'i', expectedProposalVersion: 1, failureEventId: 'ed49', retryRequestId: 'req-uuid' });
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.payload).toMatchObject({ ok: true, kind: 'retry', workItemId: 'i', failureEventId: 'ed49', retryRequestId: 'req-uuid', replayed: false, remainingAttempts: 2 });
  });

  test('work retry replay idempotente reflete o replay', async () => {
    const { runWorkRetry } = await import('./app');
    const retry = {
      readReadiness: async () => ({ status: 'RETRY_READY' as const, reason: null, proposalVersion: 1, failureEventId: 'ed49', attemptsUsed: 1, maxAttempts: 3, remainingAttempts: 2 }),
      requestRetry: async () => ({ ok: true as const, replayed: true }),
    };
    const result = await runWorkRetry(retry, 'i', () => 'req-uuid');
    expect(result.exitCode).toBe(EXIT.OK);
    expect((result.payload as { replayed: boolean }).replayed).toBe(true);
  });

  test('work retry num item NÃO RETRY_READY (ex.: budget) é recusado por regra (exit 3), sem chamar a RPC', async () => {
    const { runWorkRetry } = await import('./app');
    let called = false;
    const retry = {
      readReadiness: async () => ({ status: 'BLOCKED' as const, reason: 'attempt_budget_exhausted', proposalVersion: 1, failureEventId: 'ed49', attemptsUsed: 3, maxAttempts: 3, remainingAttempts: 0 }),
      requestRetry: async () => { called = true; return { ok: true as const, replayed: false }; },
    };
    const result = await runWorkRetry(retry, 'i', () => 'req-uuid');
    expect(called).toBe(false);
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(result.payload).toMatchObject({ ok: false, code: 'attempt_budget_exhausted' });
  });

  test('work retry de item inexistente (read_failed) é erro operacional (exit 1)', async () => {
    const { runWorkRetry } = await import('./app');
    const retry = {
      readReadiness: async () => ({ status: 'BLOCKED' as const, reason: 'read_failed', proposalVersion: 0, failureEventId: null, attemptsUsed: 0, maxAttempts: 0, remainingAttempts: 0 }),
      requestRetry: async () => ({ ok: true as const, replayed: false }),
    };
    const result = await runWorkRetry(retry, 'zzz', () => 'req-uuid');
    expect(result.exitCode).toBe(EXIT.ERROR);
    expect(result.payload).toMatchObject({ ok: false, code: 'read_failed' });
  });

  test('work retry: erro de precondição da RPC (55000) vira recusa por regra (exit 3)', async () => {
    const { runWorkRetry } = await import('./app');
    const retry = {
      readReadiness: async () => ({ status: 'RETRY_READY' as const, reason: null, proposalVersion: 1, failureEventId: 'ed49', attemptsUsed: 1, maxAttempts: 3, remainingAttempts: 2 }),
      requestRetry: async () => ({ ok: false as const, code: '55000', message: 'o item mudou' }),
    };
    const result = await runWorkRetry(retry, 'i', () => 'req-uuid');
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(result.payload).toMatchObject({ ok: false, code: '55000' });
  });

  test('work correct materializa o sucessor e NÃO o aprova (exit 0)', async () => {
    const capability = async (): Promise<ReviewCorrectionResult> => ({ ok: true, successorWorkItemId: 's1', lineageId: 'l1', recoverySequence: 1, replayed: false });
    const result = await runWorkCorrect(capability, 'i');
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.payload).toMatchObject({ ok: true, kind: 'work-correct', originalWorkItemId: 'i', successorWorkItemId: 's1', lineageId: 'l1', recoverySequence: 1, replayed: false });
  });

  test('work correct replay idempotente reflete o replay na mensagem', async () => {
    const capability = async (): Promise<ReviewCorrectionResult> => ({ ok: true, successorWorkItemId: 's1', lineageId: 'l1', recoverySequence: 1, replayed: true });
    const result = await runWorkCorrect(capability, 'i');
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.payload).toMatchObject({ ok: true, replayed: true });
    expect((result.payload as { message: string }).message).toContain('replay');
  });

  test('work correct num estado não corrigível é recusa por regra (exit 3)', async () => {
    const capability = async (): Promise<ReviewCorrectionResult> => ({ ok: false, reason: 'item_unavailable' });
    const result = await runWorkCorrect(capability, 'i');
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(result.payload).toMatchObject({ ok: false, code: 'item_unavailable' });
  });

  test('work correct com falha de persistência é erro operacional (exit 1)', async () => {
    const capability = async (): Promise<ReviewCorrectionResult> => ({ ok: false, reason: 'persistence_failed', message: 'db down' });
    const result = await runWorkCorrect(capability, 'i');
    expect(result.exitCode).toBe(EXIT.ERROR);
    expect(result.payload).toMatchObject({ ok: false, code: 'persistence_failed' });
  });

  test('work authorize-resume concede +1 e materializa o sucessor proposed (exit 0), sem aprovar', async () => {
    const capability = async (): Promise<AuthorizeResumeResult> => ({ ok: true, authorizationId: 'g1', successorWorkItemId: 's1', lineageId: 'l1', additionalAttempts: 1, aggregateCeiling: 4, previousConsumed: 3, replayed: false });
    const result = await runWorkAuthorizeResume(capability);
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.payload).toMatchObject({ ok: true, kind: 'work-authorize-resume', authorizationId: 'g1', successorWorkItemId: 's1', additionalAttempts: 1, aggregateCeiling: 4, previousConsumed: 3, replayed: false });
  });

  test('work authorize-resume replay idempotente reflete o replay', async () => {
    const capability = async (): Promise<AuthorizeResumeResult> => ({ ok: true, authorizationId: 'g1', successorWorkItemId: 's1', lineageId: 'l1', additionalAttempts: 1, aggregateCeiling: 4, previousConsumed: 3, replayed: true });
    const result = await runWorkAuthorizeResume(capability);
    expect(result.exitCode).toBe(EXIT.OK);
    expect((result.payload as { replayed: boolean }).replayed).toBe(true);
  });

  test('work authorize-resume recusada por regra (ex.: saldo ainda disponível) vira exit 3', async () => {
    const capability = async (): Promise<AuthorizeResumeResult> => ({ ok: false, code: 'budget_not_exhausted', message: 'use retry', rejected: true });
    const result = await runWorkAuthorizeResume(capability);
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(result.payload).toMatchObject({ ok: false, code: 'budget_not_exhausted' });
  });

  test('work authorize-resume com erro operacional (leitura) vira exit 1', async () => {
    const capability = async (): Promise<AuthorizeResumeResult> => ({ ok: false, code: 'read_failed', message: 'db down', rejected: false });
    const result = await runWorkAuthorizeResume(capability);
    expect(result.exitCode).toBe(EXIT.ERROR);
    expect(result.payload).toMatchObject({ ok: false, code: 'read_failed' });
  });

  test('status agrega os trabalhos retomáveis por estado', async () => {
    const items: readonly WorkItem[] = [
      reviewItem,
      { ...reviewItem, id: 'b', state: 'proposed' },
      { ...reviewItem, id: 'c', state: 'proposed' },
    ];
    const result = await runStatus(fakePort({ findResumableWorkItems: async () => ok(items) }), 'user-1', { NEXT_PUBLIC_SUPABASE_URL: 'http://x', ANIMA_AUTONOMY_ENABLED: 'enabled' });
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.payload).toMatchObject({ ok: true, kind: 'status', userId: 'user-1', autonomyEnabled: true, resumable: { total: 3, byState: { review: 1, proposed: 2 } } });
  });
});

describe('work resolve-pending (Pending Verification Human Recovery V0)', () => {
  const mandated = { ...reviewItem, state: 'in_progress', proposalVersion: 1, intent: { execution_spec: { verifier_requirement: 'required_fail_closed' } } } as unknown as WorkItem;
  const events: readonly WorkEvent[] = [
    { id: 's', workItemId: 'i', type: 'execution_started', author: 'system', proposalVersion: 1, payload: { schema_version: 1, data: { attempt_id: 'a' } }, occurredAt: new Date() },
    { id: 'r', workItemId: 'i', type: 'result_submitted', author: 'executor', proposalVersion: 1, payload: { schema_version: 1, data: { attempt_id: 'a' } }, occurredAt: new Date() },
  ];

  test('deriva o candidato e encaminha a decisão humana (exit 0)', async () => {
    const { runWorkResolvePending } = await import('./app');
    const resolvePendingVerification = jest.fn(async () => ok({ ...mandated, state: 'changes_requested' } as WorkItem));
    const result = await runWorkResolvePending({ getItem: async () => ok(mandated), listEvents: async () => ok(events), resolvePendingVerification },
      'i', { type: 'request_changes', requestedChanges: 'refazer' });
    expect(resolvePendingVerification).toHaveBeenCalledWith({ workItemId: 'i', resultEventId: 'r', decision: { type: 'request_changes', requestedChanges: 'refazer' } });
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.payload).toMatchObject({ ok: true, kind: 'resolve-pending', decision: 'request_changes', resultEventId: 'r', state: 'changes_requested' });
  });

  test('item em review não usa esta primitive: exit 3 sem chamar o serviço', async () => {
    const { runWorkResolvePending } = await import('./app');
    const resolvePendingVerification = jest.fn();
    const result = await runWorkResolvePending({ getItem: async () => ok({ ...mandated, state: 'review' } as WorkItem), listEvents: async () => ok(events), resolvePendingVerification },
      'i', { type: 'cancel' });
    expect(resolvePendingVerification).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(result.payload).toMatchObject({ ok: false, code: 'not_pending_verification:not_in_progress' });
  });
});

describe('work executors (discovery read-only)', () => {
  const SECRET = 'sk-secret-should-never-appear';
  const claudeItem = {
    ...reviewItem, state: 'approved', proposalVersion: 1,
    intent: { execution_spec: { executor: 'worktree', coder_backend: 'claude-code', model: 'sonnet-x' } },
  } as unknown as WorkItem;
  const observations = [
    { provider: 'ollama', availability: 'unavailable', reasonUnavailable: 'ollama_unreachable' },
    { provider: 'claude-code', availability: 'ready', reasonUnavailable: null },
    { provider: 'codex-cli', availability: 'ready', reasonUnavailable: null },
  ] as const;
  const at = () => new Date('2026-10-03T12:00:00.000Z');

  test('item com contrato claude-code: payload estável, recomendação contract_declared, exit 0', async () => {
    const probe = jest.fn(async () => observations);
    const result = await runWorkExecutors(fakePort({ getItem: async () => ok(claudeItem) }), probe, 'i', at);
    expect(result.exitCode).toBe(EXIT.OK);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(result.payload).toMatchObject({
      ok: true, kind: 'work-executors', workItemId: 'i', state: 'approved', proposalVersion: 1,
      contractBackend: 'claude-code', observedAt: '2026-10-03T12:00:00.000Z',
      recommendation: { provider: 'claude-code', backendId: 'claude-code:sonnet-x', rule: 'contract_declared', fallback: { provider: 'codex-cli' } },
      noRecommendation: null,
    });
    const candidates = (result.payload as unknown as { candidates: { provider: string }[] }).candidates;
    expect(candidates.map(c => c.provider)).toEqual(['ollama', 'openai', 'deepseek-harness', 'codex-cli', 'claude-code']);
  });

  test('renderização humana e --json derivam do mesmo payload, sem segredos', async () => {
    const result = await runWorkExecutors(fakePort({ getItem: async () => ok(claudeItem) }), async () => observations, 'i', at);
    const text = renderHuman(result.payload);
    expect(text).toContain('Recomendado: claude-code:sonnet-x (regra contract_declared)');
    expect(text).toContain('ollama_unreachable');
    const json = JSON.stringify(result.payload);
    expect(JSON.parse(json).kind).toBe('work-executors');
    expect(json + text).not.toContain(SECRET);
  });

  test('sem candidato pronto: exit 0, recommendation null e motivos', async () => {
    const result = await runWorkExecutors(fakePort({ getItem: async () => ok(claudeItem) }), async () => [], 'i', at);
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.payload).toMatchObject({ ok: true, recommendation: null, noRecommendation: { reason: 'no_ready_candidate' } });
  });

  test('item inexistente segue o erro operacional e não sonda', async () => {
    const probe = jest.fn(async () => observations);
    const result = await runWorkExecutors(fakePort({ getItem: async () => notFound() }), probe, 'zzz', at);
    expect(result.exitCode).toBe(EXIT.ERROR);
    expect(result.payload).toMatchObject({ ok: false, code: 'work_item_not_found' });
    expect(probe).not.toHaveBeenCalled();
  });

  test('é read-only: só lê o item', async () => {
    const reviewResult = jest.fn(); const resolveApproval = jest.fn(); const withdrawApprovedWork = jest.fn(); const listEvents = jest.fn();
    await runWorkExecutors(fakePort({ getItem: async () => ok(claudeItem), reviewResult, resolveApproval, withdrawApprovedWork, listEvents }), async () => observations, 'i', at);
    expect(reviewResult).not.toHaveBeenCalled();
    expect(resolveApproval).not.toHaveBeenCalled();
    expect(withdrawApprovedWork).not.toHaveBeenCalled();
    expect(listEvents).not.toHaveBeenCalled();
  });
});

const referenceId = '11111111-1111-1111-1111-111111111111';
const referenceIntent = { canonical_provenance: { kind: 'canonical_backlog', sourceId: 'SDC-01', document: 'docs/backlog.md', heading: 'SDC', canonicalObjective: 'Executor legível', planningGeneration: 1 } };
const referenceCandidate = { workItemId: referenceId, state: 'approved', proposalVersion: 1, createdAt: '2026-10-03', intent: referenceIntent };
const resolveReference = (input: string) => resolveWorkReference({ findByCanonicalSourceId: async () => [referenceCandidate] }, input);

test.each(['show', 'evidence', 'executors'])('work %s REF resolve antes do runner e preserva JSON', async sub => {
  const parsed = parseArgs(['work', sub, 'SDC-01', '--json']);
  if (!parsed.ok) throw new Error(parsed.error);
  const resolved = await resolveCommandWorkReference(parsed.command, resolveReference);
  if (!resolved.ok || !('id' in resolved.command)) throw new Error('não resolveu');
  const getItem = jest.fn(async (id: string) => { expect(id).toBe(referenceId); return ok({ ...reviewItem, id, intent: referenceIntent }); });
  const port = fakePort({ getItem });
  const result = sub === 'show' ? await runWorkShow(port, resolved.command.id)
    : sub === 'evidence' ? await runWorkEvidence(port, resolved.command.id)
    : await runWorkExecutors(port, async () => [], resolved.command.id);
  expect(result.exitCode).toBe(EXIT.OK);
  const json = JSON.parse(JSON.stringify(result.payload));
  expect(json).toMatchObject({ reference: 'SDC-01', title: 'Executor legível', [sub === 'executors' ? 'workItemId' : 'id']: referenceId });
  expect(renderHuman(result.payload).split('\n').slice(0, 3)).toEqual(['SDC-01 — Executor legível', 'Estado: review', `id interno: ${referenceId}`]);
});
test('withdraw mutável recebe UUID pelo mesmo caminho central sem efeito real', async () => {
  const resolved = await resolveCommandWorkReference({ kind: 'work-withdraw', id: 'SDC-01', reason: 'obsoleto', json: false }, resolveReference);
  if (!resolved.ok) throw new Error('não resolveu');
  const withdrawApprovedWork = jest.fn(async () => ok({ ...reviewItem, id: referenceId, state: 'cancelled' as const }));
  await runWorkWithdraw(fakePort({ getItem: async id => { expect(id).toBe(referenceId); return ok({ ...reviewItem, id, state: 'approved' as const }); }, withdrawApprovedWork }), resolved.command.id, resolved.command.reason);
  expect(withdrawApprovedWork).toHaveBeenCalledWith({ workItemId: referenceId, expectedProposalVersion: 2, reason: 'obsoleto' });
});
test('todos os comandos com id passam pela camada central e preservam opções', async () => {
  const kinds = ['budget-status', 'work-show', 'work-evidence', 'work-executors', 'work-approve', 'work-prepare-autonomous', 'work-accept', 'work-request-changes', 'work-correct', 'work-retry', 'work-replan', 'work-authorize-resume', 'work-withdraw', 'work-resolve-pending', 'work-supervise', 'work-unsupervise', 'work-set-compute', 'work-authorize-compute', 'work-recover-harness', 'work-recover-candidate'] as const;
  for (const kind of kinds) {
    const command = { kind, id: 'SDC-01', json: true } as ParsedCommand;
    const resolve = jest.fn(resolveReference);
    expect(await resolveCommandWorkReference(command, resolve)).toEqual({ ok: true, command: { ...command, id: referenceId } });
    expect(resolve).toHaveBeenCalledTimes(1);
  }
  const resolve = jest.fn(resolveReference);
  expect(await resolveCommandWorkReference({ kind: 'work-list', json: false }, resolve)).toEqual({ ok: true, command: { kind: 'work-list', json: false } });
  expect(resolve).not.toHaveBeenCalled();
});
test('erros têm code e exit; ambiguidade lista candidatos no texto e JSON sem despacho', async () => {
  for (const [input, candidates, code, exit] of [
    ['sdc-01', [], 'invalid_work_reference', EXIT.USAGE],
    ['AKT-04', [], 'work_reference_not_found', EXIT.ERROR],
    ['SDC-01', [referenceCandidate, { ...referenceCandidate, workItemId: '22222222-2222-2222-2222-222222222222' }], 'work_reference_ambiguous', EXIT.REJECTED],
  ] as const) {
    const runner = jest.fn();
    const resolved = await resolveCommandWorkReference({ kind: 'work-approve', id: input, json: true }, ref => resolveWorkReference({ findByCanonicalSourceId: async () => candidates }, ref));
    if (resolved.ok) { runner(resolved.command.id); throw new Error('escolheu item'); }
    expect(runner).not.toHaveBeenCalled();
    expect(resolved.result).toMatchObject({ exitCode: exit, payload: { code } });
    if (code === 'work_reference_ambiguous') {
      expect(JSON.parse(JSON.stringify(resolved.result.payload)).candidates).toHaveLength(2);
      expect(renderHuman(resolved.result.payload)).toContain(referenceId);
      expect(renderHuman(resolved.result.payload)).toContain('22222222-2222-2222-2222-222222222222');
    }
  }
});
test('UUID sem provenance permanece acessível e list prioriza fatos canônicos', async () => {
  const resolved = await resolveCommandWorkReference({ kind: 'work-show', id: referenceId, json: true }, resolveReference);
  if (!resolved.ok) throw new Error('não resolveu');
  const result = await runWorkShow(fakePort({ getItem: async () => ok({ ...reviewItem, id: referenceId }) }), resolved.command.id);
  expect(result.payload).toMatchObject({ id: referenceId, reference: null, title: null });
  expect(renderHuman(result.payload)).toContain('sem referência humana canônica');
  const list = await runWorkList(fakePort({ findResumableWorkItems: async () => ok([{ ...reviewItem, id: referenceId, intent: referenceIntent }, reviewItem]) }));
  expect(list.payload).toMatchObject({ items: [{ id: referenceId, reference: 'SDC-01', title: 'Executor legível' }, { reference: null, title: null }] });
  expect(renderHuman(list.payload).split('\n').slice(0, 3)).toEqual(['SDC-01 — Executor legível', 'Estado: review', `id interno: ${referenceId}`]);
});

test('approve usa o UUID resolvido e o serviço fake', async () => {
  const resolved = await resolveCommandWorkReference({ kind: 'work-approve', id: 'SDC-01', json: false }, resolveReference);
  if (!resolved.ok) throw new Error('não resolveu');
  const resolveApproval = jest.fn(async () => ok({ ...proposedItem, id: referenceId, state: 'approved' as const }));
  const result = await runWorkApprove(fakePort({ getItem: async id => { expect(id).toBe(referenceId); return ok({ ...proposedItem, id }); }, listEvents: async () => ok(proposedEvents.map(event => ({ ...event, workItemId: referenceId }))), listContexts: async () => ok(sourceContext), resolveApproval }), resolved.command.id);
  expect(result.exitCode).toBe(EXIT.OK);
  expect(resolveApproval).toHaveBeenCalledWith({ workItemId: referenceId, expectedProposalVersion: 1, decision: { type: 'approve' } });
});

test.each([
  ['work', 'correct', 'SDC-01', '--rework', 'apps/web/cli/app.ts', '--require-gate', 'npm test', '--json'],
  ['work', 'recover-candidate', 'SDC-01', '--diagnosis', 'diagnosis.json', '--json'],
])('central resolution preserves current command options: %j', async (...argv) => {
  const parsed = parseArgs(argv);
  if (!parsed.ok || !('id' in parsed.command)) throw new Error('invalid fixture');
  const resolve = jest.fn(resolveReference);
  expect(await resolveCommandWorkReference(parsed.command, resolve)).toEqual({
    ok: true, command: { ...parsed.command, id: referenceId },
  });
  expect(resolve).toHaveBeenCalledTimes(1);
});
import { runWorkProposeInvestigation } from './app';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildInvestigationProposal, type InvestigationPreparationDeps } from '@/lib/work-orchestration/investigation-preparation';
describe('propose-investigation runner e dispatch real',()=>{
 const input={question:'Qual o contrato?',baseSha:'a'.repeat(40)};
 const depsFor=():InvestigationPreparationDeps=>({readReferences:jest.fn(async()=>['INV-01','INV-02','INV-03']),commitExists:jest.fn(async()=>true),persistSourceMessage:jest.fn(async()=>'origin'),service:{createProposal:jest.fn(async command=>ok({...proposedItem,...command,id:'internal-investigation',state:'proposed' as const}))},now:()=>new Date('2026-10-05T12:00:00.000Z')});
 test('runner cria proposed, saída humana INV-NN sem UUID, JSON preserva diagnóstico',async()=>{
  const deps=depsFor(), result=await runWorkProposeInvestigation(input,deps);
  expect(result.exitCode).toBe(EXIT.OK);expect(result.payload).toMatchObject({kind:'work-propose-investigation',state:'proposed',reference:'INV-04',capability:'research',workItemId:'internal-investigation'});
  expect(renderHuman(result.payload)).toContain('INV-04 — Qual o contrato?'); expect(renderHuman(result.payload)).not.toContain('internal-investigation');
  expect(JSON.parse(JSON.stringify(result.payload))).toHaveProperty('workItemId','internal-investigation');
  expect(deps.service.createProposal).toHaveBeenCalledTimes(1);expect(deps.persistSourceMessage).toHaveBeenCalledTimes(1);
 });
 test('dispatch importável leva command.kind real à run function sem main ou authority',async()=>{
  const parsed=parseArgs(['work','propose-investigation','--question',input.question,'--base-sha',input.baseSha,'--json']);
  if(!parsed.ok || parsed.command.kind!=='work-propose-investigation') throw new Error('parser failed');
  const child = runCliModule(`
    const { dispatch } = await import('./cli/anima.ts');
    let identities = 0, proposals = 0, sources = 0;
    const result = await dispatch(${JSON.stringify(parsed.command)}, {
      resolveIdentity: async () => { identities++; return { ok: true, identity: { userId: 'u', client: {} } }; },
      service: {},
      investigationDeps: {
        readReferences: async () => ['INV-01', 'INV-02', 'INV-03'],
        commitExists: async () => true,
        persistSourceMessage: async () => { sources++; return 'origin'; },
        service: { createProposal: async command => { proposals++; return { ok: true, value: { ...command, id: 'internal-investigation', state: 'proposed', proposalVersion: 1 } }; } },
        now: () => new Date('2026-10-05T12:00:00.000Z'),
      },
    });
    console.log(JSON.stringify({ result, identities, proposals, sources }));
  `);
  expect(child.status).toBe(EXIT.OK);
  expect(child.stderr).toBe('');
  expect(JSON.parse(child.stdout)).toMatchObject({
    result: { payload: { kind: 'work-propose-investigation', reference: 'INV-04', state: 'proposed' } },
    identities: 1, proposals: 1, sources: 1,
  });
 });
 test('validação recusada não grava origem ou proposal',async()=>{
  const deps=depsFor();expect((await runWorkProposeInvestigation({...input,question:''},deps)).exitCode).toBe(EXIT.REJECTED);
  expect(deps.persistSourceMessage).not.toHaveBeenCalled();expect(deps.service.createProposal).not.toHaveBeenCalled();
 });
});

// Exercise native ESM through the same loader as the operational npm script.
function runCliModule(source: string) {
  return spawnSync(process.execPath, [
    '--no-warnings', '--experimental-transform-types', '--import', './scripts/ts-resolve.mjs',
    '--input-type=module', '--eval', source,
  ], { cwd: resolve(__dirname, '..'), encoding: 'utf8', timeout: 20000, windowsHide: true });
}

describe('entrypoint nativo da CLI', () => {
  test('importar não imprime, autentica ou define exitCode, mesmo com sufixo de outro entrypoint', () => {
    const child = runCliModule(`
      process.argv = [process.execPath, '/another/cli/anima.ts', 'status'];
      globalThis.fetch = () => { throw new Error('unexpected network'); };
      await import('./cli/anima.ts');
      if (process.exitCode !== undefined) throw new Error('main executed');
    `);
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(EXIT.OK);
    expect(child.stdout).toBe('');
    expect(child.stderr).toBe('');
  });

  test('o comando real do npm script e a execução direta chegam a main e dispatch help', () => {
    const webRoot = resolve(__dirname, '..');
    const pkg = JSON.parse(readFileSync(resolve(webRoot, 'package.json'), 'utf8')) as { scripts: { anima: string } };
    const [program, ...args] = pkg.scripts.anima.split(/\s+/);
    expect(program).toBe('node');
    for (const entry of ['cli/anima.ts', resolve(webRoot, 'cli', 'anima.ts')]) {
      const child = spawnSync(process.execPath, args.map(arg => arg === 'cli/anima.ts' ? entry : arg).concat('--help'), {
        cwd: webRoot, encoding: 'utf8', timeout: 20000, windowsHide: true,
      });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(EXIT.OK);
      expect(child.stderr).toBe('');
      expect(child.stdout).toBe(`${renderHuman({ ok: true, kind: 'help', usage: USAGE })}\n`);
    }
  });

  test('isMainModule compara URLs completas com caminhos relativos e separadores nativos', () => {
    const child = runCliModule(`
      import assert from 'node:assert/strict';
      import { resolve, sep } from 'node:path';
      import { pathToFileURL } from 'node:url';
      const { isMainModule } = await import('./cli/anima.ts');
      const entry = resolve('folder with spaces', 'entry #1.ts');
      assert.equal(entry.includes('/cli/anima.ts'), false);
      assert.equal(isMainModule(pathToFileURL(entry).href, entry), true);
      assert.equal(isMainModule(pathToFileURL(entry).href, ['folder with spaces', 'entry #1.ts'].join(sep)), true);
      assert.equal(isMainModule(pathToFileURL(entry).href, undefined), false);
      assert.equal(isMainModule(pathToFileURL(entry).href, resolve('other', 'entry #1.ts')), false);
      if (process.platform === 'win32') {
        assert.equal(entry.includes('\\\\'), true);
        assert.equal(isMainModule(pathToFileURL(entry).href, entry.replaceAll('\\\\', '/')), true);
      }
    `);
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(EXIT.OK);
    expect(child.stdout).toBe('');
    expect(child.stderr).toBe('');
  });
});
