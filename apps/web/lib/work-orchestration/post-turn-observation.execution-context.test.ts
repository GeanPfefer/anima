/** @jest-environment node */
import { finalizeSingleItemTurn, persistPostTurnHostObservations, type PostTurnObservationInput } from './post-turn-observation';
import { persistHostObservedGateEvidence } from './gate-evidence';
import { persistHostObservedCoderEvidence } from './coder-evidence';
import { observeAndPersistHostGitEvidence } from './host-evidence';
import { verifyAndReleaseCandidate } from './mandated-verification';
import { createWorkOrchestrationService } from './server';
import { persistHostObservedExecutionContext, resolveExecutionContextClaim, type ExecutionContextClaim } from './execution-context-evidence';

jest.mock('./gate-evidence', () => ({ persistHostObservedGateEvidence: jest.fn() }));
jest.mock('./coder-evidence', () => ({ persistHostObservedCoderEvidence: jest.fn() }));
jest.mock('./host-evidence', () => ({ observeAndPersistHostGitEvidence: jest.fn() }));
jest.mock('./server', () => ({ createWorkOrchestrationService: jest.fn() }));
jest.mock('./mandated-verification', () => ({ ...jest.requireActual('./mandated-verification'), verifyAndReleaseCandidate: jest.fn() }));
jest.mock('./execution-context-evidence', () => ({
  persistHostObservedExecutionContext: jest.fn(),
  resolveExecutionContextClaim: jest.fn(),
}));

const order: string[] = [];
const CLAIM: ExecutionContextClaim = {
  executionMode: 'unattended', actorKind: 'automated_runner',
  runner: { kind: 'single_item_cli', authenticatedUserId: '22222222-2222-4222-8222-222222222222', instanceId: 'i' },
};
const executionContextSink = { record: jest.fn() };
function input(extra: Partial<PostTurnObservationInput> = {}): PostTurnObservationInput {
  return {
    client: { rpc: jest.fn(async () => ({ error: null, data: { id: 'claim-own', work_item_id: 'own', attempt_id: 'attempt-own', approved_proposal_version: 2, release_reason: 'attempt_finished', released_at: '2026-10-16T12:00:00Z' } })) },
    result: { outcome: 'execution_interrupted', selection: { workItemId: 'own', approvedProposalVersion: 2 }, attemptId: 'attempt-own', claimId: 'claim-own', terminalKind: 'result', claimReleased: false, requiresAnotherTurn: false },
    contract: { executor: 'worktree', coderBackend: 'codex-cli', baseSha: '1'.repeat(40) },
    gateObservations: [{ label: 'test', exitCode: 0 }], coderObservations: [{ backendId: 'codex-cli:default', durationMs: 1, outcome: 'succeeded' }],
    systemWriter: { gateEvidence: {}, coderEvidence: {}, hostEvidence: {}, verifierOpinion: {}, executionContext: executionContextSink }, finalizationTimeoutMs: 50,
    ...extra,
  } as unknown as PostTurnObservationInput;
}
beforeEach(() => {
  order.length = 0; jest.resetAllMocks();
  (persistHostObservedGateEvidence as jest.Mock).mockImplementation(async () => { order.push('gate'); return { ok: true }; });
  (persistHostObservedCoderEvidence as jest.Mock).mockImplementation(async () => { order.push('coder'); return { ok: true }; });
  (observeAndPersistHostGitEvidence as jest.Mock).mockImplementation(async () => { order.push('git'); return { ok: true }; });
  (createWorkOrchestrationService as jest.Mock).mockReturnValue({ getItem: jest.fn(), listEvents: jest.fn() });
  (verifyAndReleaseCandidate as jest.Mock).mockImplementation(async () => { order.push('verifier'); return { status: 'released', verdict: 'verified' }; });
  (persistHostObservedExecutionContext as jest.Mock).mockImplementation(async () => { order.push('context'); return { ok: true, action: 'recorded' }; });
  (resolveExecutionContextClaim as jest.Mock).mockResolvedValue(null);
});

test('declaração explícita é persistida pelo sink do WRITER, correlacionada à attempt e à versão, antes das demais evidências', async () => {
  await persistPostTurnHostObservations(input({ executionContext: CLAIM }));
  expect(persistHostObservedExecutionContext).toHaveBeenCalledWith(
    { workItemId: 'own', attemptId: 'attempt-own', approvedProposalVersion: 2 }, CLAIM, executionContextSink);
  expect(order.slice(0, 2)).toEqual(['context', 'gate']);
  expect(resolveExecutionContextClaim).not.toHaveBeenCalled();
});

test('sem declaração explícita resolve do ambiente+RLS; sem modo declarado nenhum fato é inventado', async () => {
  await persistPostTurnHostObservations(input());
  expect(resolveExecutionContextClaim).toHaveBeenCalledWith(expect.anything(), 'own');
  expect(persistHostObservedExecutionContext).toHaveBeenCalledWith(expect.anything(), null, executionContextSink);
});

test('declaração null explícita registra nada (skipped) e não consulta o ambiente', async () => {
  await persistPostTurnHostObservations(input({ executionContext: null }));
  expect(resolveExecutionContextClaim).not.toHaveBeenCalled();
  expect(persistHostObservedExecutionContext).toHaveBeenCalledWith(expect.anything(), null, executionContextSink);
});

test.each([
  ['recusa do banco', async () => ({ ok: false, stage: 'persist', reason: 'unattended not supported: supervision lease exists' })],
  ['exceção do sink', async () => { throw new Error('rede'); }],
])('%s NÃO altera o desfecho: Verifier e liberação seguem normalmente (fail-open)', async (_name, impl) => {
  (persistHostObservedExecutionContext as jest.Mock).mockImplementation(impl);
  const r = await finalizeSingleItemTurn(input({ executionContext: CLAIM }));
  expect(r).toMatchObject({ outcome: 'execution_completed', claimReleased: true });
  expect(verifyAndReleaseCandidate).toHaveBeenCalledWith('own', expect.objectContaining({ requireVerified: true }));
});

test('falha ao resolver o ambiente também é não-fatal', async () => {
  (resolveExecutionContextClaim as jest.Mock).mockRejectedValue(new Error('rls'));
  const r = await finalizeSingleItemTurn(input());
  expect(r).toMatchObject({ outcome: 'execution_completed', claimReleased: true });
});

test('sem attempt correlacionada nada é registrado', async () => {
  const i = input({ executionContext: CLAIM });
  await persistPostTurnHostObservations({ ...i, result: { ...i.result, attemptId: undefined } as never });
  expect(persistHostObservedExecutionContext).not.toHaveBeenCalled();
});
