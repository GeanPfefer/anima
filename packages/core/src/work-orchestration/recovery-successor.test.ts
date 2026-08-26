import type { WorkItem, WorkIntent, WorkProposal } from './types';
import type { WorkRecoveryAssessment } from './recovery-successor-types';
import { validateRecoverySuccessor, type RecoverySuccessorCandidate } from './recovery-successor';

const original: WorkItem = {
  id: '0cedae21-433d-4842-8fbd-9045c5128bcf', userId: 'u', sourceMessageId: 'm', state: 'failed',
  impactLevel: 'structural', capability: 'programming', originalRequest: 'local first', proposalVersion: 2,
  proposal: { schemaVersion: 1, data: { summary: 'política completa', objective: 'routing + governor',
    includedScope: ['packages/core/src/work-routing.ts', 'packages/core/src/work-routing.test.ts', 'apps/web/resource-governor.ts', 'apps/web/resource-governor.test.ts'],
    excludedScope: ['cloud'], expectedEffects: ['política'], risks: ['capacidade'] } },
  intent: { execution_spec: { schema_version: 1, target: { kind: 'project', reference: 'anima' },
    permissions: ['workspace_read', 'workspace_write_isolated'], validation_criteria: [{ label: 'test', command: 'npm test' }],
    limits: { max_attempts: 2, max_duration_minutes: 45 }, depends_on_work_item_ids: [] } },
  createdAt: new Date(), updatedAt: new Date(),
};
const assessment: WorkRecoveryAssessment = { workItemId: original.id, proposalVersion: 2, failureEventId: 'f', sourceAttemptId: 'a', attemptsUsed: 2, maxAttempts: 2,
  decision: { failureKind: 'model_capability_limit', normalizedCode: 'ollama_read_round_limit', action: 'decompose', reason: 'task_should_be_decomposed' } };
const proposal: WorkProposal = { schemaVersion: 1, data: { summary: 'helper local-first', objective: 'helper puro',
  includedScope: ['packages/core/src/work-routing.ts', 'packages/core/src/work-routing.test.ts'], excludedScope: ['governor'], expectedEffects: ['helper'], risks: ['sem wiring'] } };
const intent: WorkIntent = { execution_spec: { schema_version: 1, target: { kind: 'project', reference: 'anima' },
  permissions: ['workspace_read', 'workspace_write_isolated'], validation_criteria: [{ label: 'test', command: 'npm test' }],
  limits: { max_attempts: 2, max_duration_minutes: 30 }, depends_on_work_item_ids: [] } };
const candidate = (overrides: Partial<RecoverySuccessorCandidate> = {}): RecoverySuccessorCandidate => ({
  impactLevel: 'structural', capability: 'programming', intent, proposal, recoveryReason: 'limite de leitura', recoverySequence: 1,
  idempotencyKey: 'a4000000-0000-4000-8000-000000000001', ...overrides,
});

test('aceita a fatia sucessora mínima do Item 1 sem ampliar autoridade', () => {
  expect(validateRecoverySuccessor(original, assessment, candidate())).toEqual({ valid: true, candidate: candidate() });
});

test.each([
  ['scope_not_strictly_smaller', candidate({ proposal: original.proposal })],
  ['target_changed', candidate({ intent: { execution_spec: { ...(intent.execution_spec as object), target: { kind: 'project', reference: 'outro' } } } })],
  ['permission_expanded', candidate({ intent: { execution_spec: { ...(intent.execution_spec as object), permissions: ['workspace_read', 'network'] } } })],
  ['attempt_budget_expanded', candidate({ intent: { execution_spec: { ...(intent.execution_spec as object), limits: { max_attempts: 3 } } } })],
  ['depends_on_failed_original', candidate({ intent: { execution_spec: { ...(intent.execution_spec as object), depends_on_work_item_ids: [original.id] } } })],
] as const)('recusa %s', (gap, value) => {
  const result = validateRecoverySuccessor(original, assessment, value);
  expect(result).toMatchObject({ valid: false });
  if (!result.valid) expect(result.gaps).toContain(gap);
});

test('não materializa quando a estratégia não é decomposição ou a autoridade financeira cresce', () => {
  const retry = { ...assessment, decision: { ...assessment.decision, action: 'retry' as const, reason: 'transient_retry_within_budget' as const } };
  expect(validateRecoverySuccessor(original, retry, candidate())).toMatchObject({ valid: false, gaps: ['decomposition_not_recommended'] });
  const paid = candidate({ intent: { ...intent, authority: 'paid_compute' } });
  const result = validateRecoverySuccessor(original, assessment, paid);
  expect(result).toMatchObject({ valid: false });
  if (!result.valid) expect(result.gaps).toContain('financial_authority_introduced');
});

