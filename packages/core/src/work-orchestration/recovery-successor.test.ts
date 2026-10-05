import type { WorkItem, WorkIntent, WorkProposal } from './types';
import type { WorkRecoveryAssessment } from './recovery-successor-types';
import { validateCorrectionSuccessor, validateRecoverySuccessor, type RecoverySuccessorCandidate } from './recovery-successor';

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



test('validação independente de reopened_scope não confia na derivação', () => {
  const current = { ...original, state: 'changes_requested' as const };
  const reopened = 'packages/types/src/database.ts';
  const rootAuthority = { includedScope: [...original.proposal.data.includedScope, reopened], excludedScope: ['cloud'] };
  const forged = candidate({ proposal: { ...proposal, data: { ...proposal.data, includedScope: [reopened] } },
    intent: { ...intent, execution_spec: { ...(intent.execution_spec as object), correction_scope: {
      rework_scope: [reopened], remaining_scope: [], effective_scope: [reopened], reopened_scope: [reopened], rework_source: 'structured',
    } } } });
  expect(validateCorrectionSuccessor(current, forged, { rootAuthority }).valid).toBe(true);
  for (const options of [undefined, { rootAuthority: { ...rootAuthority, excludedScope: [reopened] } },
    { rootAuthority: { includedScope: original.proposal.data.includedScope, excludedScope: [] } }]) {
    expect(validateCorrectionSuccessor(current, forged, options)).toMatchObject({ valid: false, gaps: expect.arrayContaining(['correction_scope_invalid']) });
  }
  const excludedCandidate = { ...forged, proposal: { ...forged.proposal, data: { ...forged.proposal.data, excludedScope: [reopened] } } };
  expect(validateCorrectionSuccessor(current, excludedCandidate, { rootAuthority })).toMatchObject({ valid: false, gaps: expect.arrayContaining(['correction_scope_invalid']) });
  const outsideCandidate = { ...forged, proposal: { ...forged.proposal, data: { ...forged.proposal.data, includedScope: [reopened, 'never.ts'] } } };
  expect(validateCorrectionSuccessor(current, outsideCandidate, { rootAuthority })).toMatchObject({ valid: false, gaps: expect.arrayContaining(['correction_scope_invalid']) });
});


test('observedChangedFiles fecha arquivos inesperados mesmo sem inherited no spec', () => {
  const current = { ...original, state: 'changes_requested' as const };
  const correction = candidate({ intent: { execution_spec: { ...(intent.execution_spec as object), correction_scope: {
    rework_scope: [...proposal.data.includedScope], remaining_scope: [], effective_scope: [...proposal.data.includedScope],
  } } } });
  expect(validateCorrectionSuccessor(current, correction).valid).toBe(true);
  expect(validateCorrectionSuccessor(current, correction, { observedChangedFiles: original.proposal.data.includedScope }).valid).toBe(true);
  expect(validateCorrectionSuccessor(current, correction, { observedChangedFiles: [...original.proposal.data.includedScope, 'never.ts'] }))
    .toMatchObject({ valid: false, gaps: expect.arrayContaining(['correction_scope_invalid']) });
  const malformed = candidate({ ...correction, intent: { execution_spec: { ...(correction.intent.execution_spec as object), correction_scope: {
    rework_scope: [...proposal.data.includedScope], remaining_scope: [], effective_scope: [...proposal.data.includedScope], inherited_preserved_scope: 'never.ts',
  } } } });
  expect(validateCorrectionSuccessor(current, malformed)).toMatchObject({ valid: false, gaps: expect.arrayContaining(['correction_scope_invalid']) });
});
