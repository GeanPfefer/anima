import { isValidPendingVerificationDecision, pendingVerificationDecisionContext, projectPendingVerificationCandidate } from './pending-verification-recovery';
import { WorkOrchestrationService } from './service';
import type { WorkOrchestrationRepository } from './repository';
import type { WorkEvent, WorkItem } from './types';

const at = new Date('2026-09-28T00:00:00Z');
const item = (over: Partial<WorkItem> = {}, required = true): WorkItem => ({
  id: 'w', userId: 'u', sourceMessageId: 'm', state: 'in_progress', impactLevel: 'low', capability: 'programming', originalRequest: 'x',
  intent: { execution_spec: required ? { verifier_requirement: 'required_fail_closed' } : {} } as unknown as WorkItem['intent'],
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
  proposalVersion: 1, createdAt: at, updatedAt: at, ...over,
});
const event = (id: string, type: WorkEvent['type'], data: Record<string, unknown>, over: Partial<WorkEvent> = {}): WorkEvent =>
  ({ id, workItemId: 'w', type, author: 'system', proposalVersion: 1, payload: { schema_version: 1, data } as unknown as WorkEvent['payload'], occurredAt: at, ...over });
const base: readonly WorkEvent[] = [
  event('s1', 'execution_started', { attempt_id: 'a1' }),
  event('r1', 'result_submitted', { attempt_id: 'a1' }, { author: 'executor' }),
];

describe('projectPendingVerificationCandidate', () => {
  test('deriva o candidato exato (resultado mais recente, attempt e versão vigentes)', () => {
    expect(projectPendingVerificationCandidate(item(), base)).toEqual({ pending: true, candidate: { workItemId: 'w', resultEventId: 'r1', attemptId: 'a1', proposalVersion: 1 } });
  });
  test('advisory ⇒ não se aplica (review normal)', () => {
    expect(projectPendingVerificationCandidate(item({}, false), base)).toEqual({ pending: false, gap: 'advisory_lane' });
  });
  test.each(['review', 'completed', 'changes_requested', 'cancelled'] as const)('estado %s ⇒ não pendente', (state) => {
    expect(projectPendingVerificationCandidate(item({ state }), base)).toEqual({ pending: false, gap: 'not_in_progress' });
  });
  test('sem resultado ⇒ result_missing', () => {
    expect(projectPendingVerificationCandidate(item(), base.slice(0, 1))).toEqual({ pending: false, gap: 'result_missing' });
  });
  test('versão stale ⇒ result_stale', () => {
    expect(projectPendingVerificationCandidate(item({ proposalVersion: 2 }), base)).toEqual({ pending: false, gap: 'result_stale' });
  });
  test('attempt mais nova que o resultado ⇒ attempt_mismatch', () => {
    expect(projectPendingVerificationCandidate(item(), [...base, event('s2', 'execution_started', { attempt_id: 'a2' })]))
      .toEqual({ pending: false, gap: 'attempt_mismatch' });
  });
  test('já resolvido por humano ⇒ already_resolved', () => {
    const resolved = event('h', 'changes_requested', { origin: 'pending_verification_recovery', resolved_result_event_id: 'r1' }, { author: 'user' });
    expect(projectPendingVerificationCandidate(item(), [...base, resolved])).toEqual({ pending: false, gap: 'already_resolved' });
  });
  test('request_changes de review comum (sem origin) não conta como resolução do candidato', () => {
    const review = event('h', 'changes_requested', { reviewed_result_event_id: 'r1' }, { author: 'user' });
    expect(projectPendingVerificationCandidate(item(), [...base, review])).toMatchObject({ pending: true });
  });
});

describe('decisão humana', () => {
  test('só request_changes (com texto) ou cancel; nenhum verify/accept', () => {
    expect(isValidPendingVerificationDecision({ type: 'request_changes', requestedChanges: 'refazer' })).toBe(true);
    expect(isValidPendingVerificationDecision({ type: 'request_changes', requestedChanges: '  ' })).toBe(false);
    expect(isValidPendingVerificationDecision({ type: 'cancel' })).toBe(true);
    expect(isValidPendingVerificationDecision({ type: 'cancel', reason: '' })).toBe(false);
    expect(isValidPendingVerificationDecision({ type: 'accept' })).toBe(false);
    expect(isValidPendingVerificationDecision({ type: 'verify' })).toBe(false);
  });
  test('contexto usa o vocabulário do review', () => {
    expect(pendingVerificationDecisionContext({ type: 'request_changes', requestedChanges: ' x ' })).toEqual({ requested_changes: 'x' });
    expect(pendingVerificationDecisionContext({ type: 'cancel' })).toEqual({});
    expect(pendingVerificationDecisionContext({ type: 'cancel', reason: ' r ' })).toEqual({ reason: 'r' });
  });
  test('serviço recusa decisão inválida sem tocar o repositório', async () => {
    const resolvePendingVerification = jest.fn();
    const service = new WorkOrchestrationService({ resolvePendingVerification } as unknown as WorkOrchestrationRepository);
    const result = await service.resolvePendingVerification({ workItemId: 'w', resultEventId: 'r1', decision: { type: 'accept' } as never });
    expect(result.ok).toBe(false);
    expect(resolvePendingVerification).not.toHaveBeenCalled();
  });
});
