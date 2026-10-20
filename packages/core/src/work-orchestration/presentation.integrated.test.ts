import { deriveWorkProgressPhase, presentWorkItem, projectWorkIntegration } from './presentation';
import { integrationOperationKey } from './integration-effect';
import type { WorkEvent, WorkItem } from './types';

// Integração EFETIVADA (protocolo de efeito: integration_effect_authorized pelo usuário + integration_completed pelo sistema)
// precisa aparecer como `integrated` na projeção — e NUNCA como "pronto para integrar" — sem afirmar publicação no remoto.
// Qualquer receipt que não reproduza a autorização, o item, a versão ou o resultado aceito é ignorado (fail-closed).

const SHA_BASE = 'a'.repeat(40);
const SHA_RESULT = 'b'.repeat(40);
const REPO = 'https://github.com/GeanPfefer/anima';
const REF = 'refs/heads/dev';
const AUTH_ID = 'auth-1';

const item = {
  id: 'i', userId: 'u', sourceMessageId: 'm', state: 'completed', impactLevel: 'low', capability: 'programming', originalRequest: 'x',
  intent: {}, proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
  proposalVersion: 1, createdAt: new Date(), updatedAt: new Date(),
} as unknown as WorkItem;

const at = new Date('2026-10-20T20:00:00Z');
const result: WorkEvent = { id: 'r', workItemId: 'i', type: 'result_submitted', author: 'executor', proposalVersion: 1, occurredAt: at,
  payload: { schema_version: 1, data: { summary: 'feito', result_references: ['commit:b'], work_item_id: 'i', attempt_id: 'att-1', approved_proposal_version: 1, handoff_reference: 'worktree:att-1' } } };
const accepted: WorkEvent = { id: 'accepted', workItemId: 'i', type: 'result_accepted', author: 'user', proposalVersion: 1, occurredAt: at,
  payload: { schema_version: 1, data: { accepted_result_event_id: 'r' } } };

const operationKey = integrationOperationKey({ authorizationId: AUTH_ID, acceptedResultEventId: 'r', repositoryId: REPO, targetRef: REF, expectedTargetSha: SHA_BASE, resultCommitSha: SHA_RESULT, mode: 'ff_only' });
const authorized = (overrides: Record<string, unknown> = {}, author: WorkEvent['author'] = 'user'): WorkEvent => ({
  id: 'auth', workItemId: 'i', type: 'integration_effect_authorized', author, proposalVersion: 1, occurredAt: at,
  payload: { schema_version: 1, data: {
    authorization_id: AUTH_ID, operation_key: operationKey, work_item_id: 'i', approved_proposal_version: 1, attempt_id: 'att-1', accepted_result_event_id: 'r',
    result_commit_sha: SHA_RESULT, repository_id: REPO, target_ref: REF, expected_target_sha: SHA_BASE, mode: 'ff_only', ...overrides,
  } },
});
const receipt = (overrides: Record<string, unknown> = {}) => ({
  kind: 'integration_effect', operationKey, authorizationId: AUTH_ID, workItemId: 'i', proposalVersion: 1, attemptId: 'att-1', acceptedResultEventId: 'r',
  resultCommitSha: SHA_RESULT, repositoryId: REPO, targetRef: REF, mode: 'ff_only', previousTargetSha: SHA_BASE, resultingTargetSha: SHA_RESULT,
  mergeCommitSha: null, mergeParents: [], observed: true, disposition: 'effected', ...overrides,
});
const completed = (overrides: Record<string, unknown> = {}, author: WorkEvent['author'] = 'system'): WorkEvent => ({
  id: 'done', workItemId: 'i', type: 'integration_completed', author, proposalVersion: 1, occurredAt: at,
  payload: { schema_version: 1, data: { authorization_id: AUTH_ID, receipt: receipt(overrides) } },
});

const base = [result, accepted];

describe('projeção da integração efetivada (efeito ff_only)', () => {
  test('aceito sem nenhuma integração continua "aguardando decisão" (inalterado)', () => {
    expect(projectWorkIntegration(item, base)).toMatchObject({ status: 'awaiting_decision', availableDecisions: ['authorize', 'refuse'] });
  });

  test('autorização do efeito sem conclusão NÃO conta como integrado', () => {
    expect(projectWorkIntegration(item, [...base, authorized()])?.status).toBe('awaiting_decision');
  });

  test('autorização + receipt do sistema que a reproduz ⇒ integrated, sem ações e sem publicação', () => {
    const projection = projectWorkIntegration(item, [...base, authorized(), completed()]);
    expect(projection).toEqual({
      status: 'integrated', acceptedResultEventId: 'r', decision: null, availableDecisions: [], publication: null,
      integrationEffect: { mode: 'ff_only', targetRef: REF, resultCommitSha: SHA_RESULT, resultingTargetSha: SHA_RESULT, disposition: 'effected' },
    });
  });

  test('disposição reconciled também é integrado', () => {
    expect(projectWorkIntegration(item, [...base, authorized(), completed({ disposition: 'reconciled' })])?.integrationEffect?.disposition).toBe('reconciled');
  });

  test('a fase humana é concluído, não "pronto para integrar"', () => {
    const presentation = presentWorkItem(item, [...base, authorized(), completed()]);
    expect(presentation.integration?.status).toBe('integrated');
    expect(presentation.progress).toMatchObject({ phase: 'done', terminal: true });
    expect(deriveWorkProgressPhase({ item, execution: null, integration: presentation.integration ?? null }).phase).toBe('done');
  });

  test.each([
    ['recibo escrito por usuário (não pelo sistema)', () => [...base, authorized(), completed({}, 'user')]],
    ['autorização escrita pelo sistema (não pelo humano)', () => [...base, authorized({}, 'system'), completed()]],
    ['sem a autorização no log', () => [...base, completed()]],
    ['receipt de outro item', () => [...base, authorized(), completed({ workItemId: 'outro' })]],
    ['receipt de outra versão da proposta', () => [...base, authorized(), completed({ proposalVersion: 2 })]],
    ['receipt de outro resultado aceito', () => [...base, authorized(), completed({ acceptedResultEventId: 'x' })]],
    ['receipt cujo alvo final não é o commit do resultado', () => [...base, authorized(), completed({ resultingTargetSha: SHA_BASE })]],
    ['receipt com merge em modo ff_only', () => [...base, authorized(), completed({ mergeCommitSha: 'c'.repeat(40), mergeParents: [SHA_BASE, SHA_RESULT] })]],
    ['receipt de outra operação', () => [...base, authorized(), completed({ operationKey: 'outra' })]],
    ['receipt não observado', () => [...base, authorized(), completed({ observed: false })]],
    ['alvo fora de refs/heads/dev', () => [...base, authorized({ target_ref: 'refs/heads/main' }), completed({ targetRef: 'refs/heads/main' })]],
    ['autorização de outro item', () => [...base, authorized({ work_item_id: 'outro' }), completed()]],
  ])('ignora: %s (continua pronto para decidir)', (_name, build) => {
    expect(projectWorkIntegration(item, build())?.status).toBe('awaiting_decision');
  });

  test('item não concluído ou investigação read_only não projetam integração', () => {
    expect(projectWorkIntegration({ ...item, state: 'review' }, [...base, authorized(), completed()])).toBeNull();
    expect(projectWorkIntegration({ ...item, intent: { execution_spec: { effect_class: 'read_only' } } } as unknown as WorkItem, [...base, authorized(), completed()])?.status === 'integrated').toBe(false);
  });
});
