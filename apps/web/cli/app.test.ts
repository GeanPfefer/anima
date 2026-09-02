import type {
  ResolveWorkApprovalCommand,
  ReviewWorkResultCommand,
  WorkContextSnapshot,
  WorkEvent,
  WorkItem,
  WorkOperationResult,
} from '@anima/core';
import type { ReviewCorrectionResult } from '@/lib/work-orchestration/review-correction-orchestration';
import { runStatus, runWorkApprove, runWorkCorrect, runWorkReview, runWorkShow, type WorkOrchestrationPort } from './app';
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
