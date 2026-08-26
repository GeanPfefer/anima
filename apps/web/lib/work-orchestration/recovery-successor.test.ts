import type { RecoverySuccessorCandidate, WorkItem, WorkRecoveryAssessment } from '@anima/core';
import { proposeRecoverySuccessor } from './recovery-successor';

const original: WorkItem = {
  id: '0cedae21-433d-4842-8fbd-9045c5128bcf', userId: 'u', sourceMessageId: 'm', state: 'failed', impactLevel: 'structural', capability: 'programming',
  originalRequest: 'local-first', proposalVersion: 2, createdAt: new Date(), updatedAt: new Date(),
  proposal: { schemaVersion: 1, data: { summary: 'amplo', objective: 'amplo', includedScope: ['a', 'b', 'c'], excludedScope: ['x'], expectedEffects: ['e'], risks: ['r'] } },
  intent: { execution_spec: { schema_version: 1, target: { kind: 'project', reference: 'anima' }, permissions: ['workspace_read'],
    validation_criteria: [{ label: 'test', command: 'npm test' }], limits: { max_attempts: 2 }, depends_on_work_item_ids: [] } },
};
const assessment: WorkRecoveryAssessment = { workItemId: original.id, proposalVersion: 2, failureEventId: 'f', sourceAttemptId: 'a', attemptsUsed: 2, maxAttempts: 2,
  decision: { failureKind: 'model_capability_limit', normalizedCode: 'ollama_read_round_limit', action: 'decompose', reason: 'task_should_be_decomposed' } };
const candidate: RecoverySuccessorCandidate = {
  impactLevel: 'structural', capability: 'programming', recoveryReason: 'limite de leitura', recoverySequence: 1,
  idempotencyKey: 'a4000000-0000-4000-8000-000000000001',
  proposal: { schemaVersion: 1, data: { summary: 'menor', objective: 'menor', includedScope: ['a'], excludedScope: ['b'], expectedEffects: ['e'], risks: ['r'] } },
  intent: { execution_spec: { schema_version: 1, target: { kind: 'project', reference: 'anima' }, permissions: ['workspace_read'],
    validation_criteria: [{ label: 'test', command: 'npm test' }], limits: { max_attempts: 2 }, depends_on_work_item_ids: [] } },
};

test('candidato válido chama somente a RPC de proposed com envelope canônico', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: { successorWorkItemId: 's', lineageId: 'l', recoverySequence: 1, replayed: false }, error: null });
  await expect(proposeRecoverySuccessor({ rpc } as never, original, assessment, candidate)).resolves.toEqual({
    ok: true, successorWorkItemId: 's', lineageId: 'l', recoverySequence: 1, replayed: false,
  });
  expect(rpc).toHaveBeenCalledWith('propose_recovery_successor', expect.objectContaining({
    p_original_work_item_id: original.id, p_recovery_sequence: 1, p_idempotency_key: candidate.idempotencyKey,
    p_proposal: expect.objectContaining({ schema_version: 1, data: expect.objectContaining({ included_scope: ['a'] }) }),
  }));
});

test('candidato que amplia escopo falha localmente sem tocar o banco', async () => {
  const rpc = jest.fn();
  const invalid = { ...candidate, proposal: original.proposal };
  const result = await proposeRecoverySuccessor({ rpc } as never, original, assessment, invalid);
  expect(result).toMatchObject({ ok: false, code: 'candidate_invalid', gaps: expect.arrayContaining(['scope_not_strictly_smaller']) });
  expect(rpc).not.toHaveBeenCalled();
});

test('erro e envelope inválido da RPC falham fechado', async () => {
  const failed = jest.fn().mockResolvedValue({ data: null, error: { message: 'conflict' } });
  await expect(proposeRecoverySuccessor({ rpc: failed } as never, original, assessment, candidate)).resolves.toMatchObject({ ok: false, code: 'persistence_failed' });
  const invalid = jest.fn().mockResolvedValue({ data: { replayed: true }, error: null });
  await expect(proposeRecoverySuccessor({ rpc: invalid } as never, original, assessment, candidate)).resolves.toMatchObject({ ok: false, code: 'response_invalid' });
});

