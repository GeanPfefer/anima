import type { VerifierOpinionV1, WorkEvent, WorkItem, WorkOperationResult } from '@anima/core';
import { MANDATED_VERIFIER_TIMEOUT_MS, verifyAndReleaseCandidate, type MandatedVerificationDeps } from './mandated-verification';
import type { VerifierOpinionOutcome, VerifierOpinionSink } from './verifier-opinion';

const item = (state: WorkItem['state'], required = true): WorkItem => ({
  id: 'work-1', userId: 'u', sourceMessageId: 'm', state, impactLevel: 'low', capability: 'programming',
  originalRequest: 'x',
  intent: { execution_spec: required ? { verifier_requirement: 'required_fail_closed' } : {} } as unknown as WorkItem['intent'],
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
  proposalVersion: 1, createdAt: new Date(), updatedAt: new Date(),
});

const opinion = (verdict: VerifierOpinionV1['verdict']): VerifierOpinionV1 => ({ verdict } as unknown as VerifierOpinionV1);
const ok = <T>(value: T): WorkOperationResult<T> => ({ ok: true, value });
const sink: VerifierOpinionSink = { record: jest.fn() };

/** `states`: estado lido na 1ª leitura e na releitura. */
function deps(over: {
  states?: [WorkItem['state'], WorkItem['state']];
  required?: boolean;
  outcome?: () => Promise<VerifierOpinionOutcome>;
  timeoutMs?: number;
  rereadFails?: boolean;
} = {}): MandatedVerificationDeps & { compute: jest.Mock } {
  const states = over.states ?? ['in_progress', 'review'];
  let reads = 0;
  const compute = jest.fn(over.outcome ?? (async () => ({ ok: true as const, action: 'recorded' as const, opinion: opinion('verified') })));
  return {
    getItem: jest.fn(async () => {
      reads += 1;
      if (reads > 1 && over.rereadFails) return { ok: false as const, error: { code: 'persistence_failure' as const, message: 'db', retryable: true } };
      return ok(item(states[Math.min(reads, 2) - 1]!, over.required ?? true));
    }),
    listEvents: jest.fn(async () => ok([] as readonly WorkEvent[])),
    sink,
    timeoutMs: over.timeoutMs,
    computeAndPersist: compute as unknown as MandatedVerificationDeps['computeAndPersist'],
    compute,
  };
}

describe('verifyAndReleaseCandidate — lane com Verifier obrigatório (V0.1)', () => {
  test('timeout explícito e limitado', () => {
    expect(MANDATED_VERIFIER_TIMEOUT_MS).toBeGreaterThan(0);
    expect(MANDATED_VERIFIER_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
  });

  test('2. verified persistido + liberação RELIDA ⇒ released', async () => {
    await expect(verifyAndReleaseCandidate('work-1', deps())).resolves.toEqual({ status: 'released', verdict: 'verified' });
  });

  test('3. rejected persistido e liberado para inspeção ⇒ released com veredito rejected (aceite segue bloqueado)', async () => {
    const d = deps({ outcome: async () => ({ ok: true, action: 'recorded', opinion: opinion('rejected') }) });
    await expect(verifyAndReleaseCandidate('work-1', d)).resolves.toEqual({ status: 'released', verdict: 'rejected' });
  });

  test('4. inconclusive ⇒ retido', async () => {
    const d = deps({ states: ['in_progress', 'in_progress'], outcome: async () => ({ ok: true, action: 'recorded', opinion: opinion('inconclusive') }) });
    await expect(verifyAndReleaseCandidate('work-1', d)).resolves.toEqual({ status: 'held', reason: 'not_conclusive' });
  });

  test('5. Verifier lança ⇒ retido', async () => {
    const d = deps({ outcome: async () => { throw new Error('boom'); } });
    await expect(verifyAndReleaseCandidate('work-1', d)).resolves.toEqual({ status: 'held', reason: 'verifier_threw', detail: 'boom' });
  });

  test('6. timeout ⇒ retido (não espera o transporte)', async () => {
    const d = deps({ timeoutMs: 20, outcome: () => new Promise<VerifierOpinionOutcome>(() => undefined) });
    await expect(verifyAndReleaseCandidate('work-1', d)).resolves.toEqual({ status: 'held', reason: 'verifier_timeout' });
  });

  test('7. persistência recusada ⇒ retido (parecer em memória não conta)', async () => {
    const d = deps({ outcome: async () => ({ ok: false, stage: 'persist', reason: 'rpc refused' }) });
    await expect(verifyAndReleaseCandidate('work-1', d)).resolves.toEqual({ status: 'held', reason: 'persist_failed', detail: 'rpc refused' });
  });

  test('sem resultado a verificar ⇒ retido', async () => {
    const d = deps({ outcome: async () => ({ ok: false, stage: 'skipped', reason: 'no durable result to verify' }) });
    await expect(verifyAndReleaseCandidate('work-1', d)).resolves.toMatchObject({ status: 'held', reason: 'verifier_skipped' });
  });

  test('8. read-back diverge (persistido verified mas item não está em review) ⇒ retido', async () => {
    const d = deps({ states: ['in_progress', 'in_progress'] });
    await expect(verifyAndReleaseCandidate('work-1', d)).resolves.toEqual({ status: 'held', reason: 'release_not_observed', detail: 'in_progress' });
  });

  test('read-back falha ⇒ retido', async () => {
    const d = deps({ rereadFails: true });
    await expect(verifyAndReleaseCandidate('work-1', d)).resolves.toMatchObject({ status: 'held', reason: 'readback_failed' });
  });

  test('16. nunca aceita: só computa e persiste o parecer', async () => {
    const d = deps();
    await verifyAndReleaseCandidate('work-1', d);
    expect(d.compute).toHaveBeenCalledTimes(1);
    expect(Object.keys(d)).not.toContain('reviewResult');
  });

  test('18. lane advisory: comportamento anterior (fail-open, sem releitura)', async () => {
    const d = deps({ required: false, states: ['review', 'review'], outcome: async () => { throw new Error('boom'); } });
    await expect(verifyAndReleaseCandidate('work-1', d)).resolves.toEqual({ status: 'advisory', opinion: null });
    expect(d.getItem).toHaveBeenCalledTimes(1);
  });
});

describe('verifyAndReleaseCandidate — Pending Verification Human Recovery V0', () => {
  test.each(['changes_requested', 'cancelled'] as const)('17. candidato encerrado pelo humano (%s) ⇒ não re-verifica', async (state) => {
    const d = deps({ states: [state, state] });
    await expect(verifyAndReleaseCandidate('work-1', d)).resolves.toEqual({ status: 'held', reason: 'candidate_not_pending', detail: state });
    expect(d.compute).not.toHaveBeenCalled();
  });

  test('17. candidato marcado como resolvido (item de volta a in_progress) ⇒ não re-verifica', async () => {
    const at = new Date();
    const events: readonly WorkEvent[] = [
      { id: 'e-start', workItemId: 'work-1', type: 'execution_started', author: 'system', proposalVersion: 1, payload: { schema_version: 1, data: { attempt_id: 'a-1' } }, occurredAt: at },
      { id: 'e-result', workItemId: 'work-1', type: 'result_submitted', author: 'executor', proposalVersion: 1, payload: { schema_version: 1, data: { attempt_id: 'a-1' } }, occurredAt: at },
      { id: 'e-human', workItemId: 'work-1', type: 'changes_requested', author: 'user', proposalVersion: 1, payload: { schema_version: 1, data: { origin: 'pending_verification_recovery', resolved_result_event_id: 'e-result', requested_changes: 'x' } }, occurredAt: at },
    ];
    const d = { ...deps({ states: ['in_progress', 'in_progress'] }), listEvents: jest.fn(async () => ok(events)) };
    await expect(verifyAndReleaseCandidate('work-1', d)).resolves.toEqual({ status: 'held', reason: 'candidate_resolved_by_human' });
    expect(d.compute).not.toHaveBeenCalled();
  });
});
