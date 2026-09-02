import type {
  ReviewWorkResultCommand,
  WorkContextSnapshot,
  WorkEvent,
  WorkItem,
  WorkOperationResult,
} from '@anima/core';
import { runStatus, runWorkReview, runWorkShow, type WorkOrchestrationPort } from './app';
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
function fakePort(overrides: Partial<WorkOrchestrationPort> & { reviewSpy?: { called: boolean } } = {}): WorkOrchestrationPort {
  const spy = overrides.reviewSpy;
  return {
    getItem: overrides.getItem ?? (async () => ok(reviewItem)),
    listEvents: overrides.listEvents ?? (async () => ok<readonly WorkEvent[]>([resultEvent])),
    listContexts: overrides.listContexts ?? (async () => ok<readonly WorkContextSnapshot[]>([])),
    findResumableWorkItems: overrides.findResumableWorkItems ?? (async () => ok<readonly WorkItem[]>([])),
    reviewResult: overrides.reviewResult ?? (async (command: ReviewWorkResultCommand) => {
      if (spy) spy.called = true;
      return ok({ ...reviewItem, state: 'changes_requested' });
    }),
  };
}

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
