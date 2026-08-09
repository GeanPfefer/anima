import type { Json } from '@anima/types';
import {
  buildIntegrationPublicationRequest,
  buildWorktreeHandoff,
  decideIntegration,
  projectIntegrationBoundary,
  type WorkEvent,
  type WorkEventAuthor,
  type WorkEventType,
  type WorktreeHandoffV1,
} from '.';

// Read model da decisão de integração (ADR-002 / persistência): prova que
// `projectIntegrationBoundary` reconstrói uma `IntegrationBoundary` ratificada a
// partir do log de eventos, que ela é aceita pelo contrato ratificado (INT-03) e
// que uma fronteira autorizada projetada alimenta o substrato de publicação.

const WORK = 'work-1';
const VERSION = 3;
const RESULT_ID = 'result-event-1';

const event = (id: string, type: string, data: Record<string, unknown>, author: WorkEventAuthor = 'user'): WorkEvent => ({
  id,
  workItemId: WORK,
  type: type as unknown as WorkEventType,
  author,
  proposalVersion: VERSION,
  payload: { schema_version: 1, data } as unknown as Json,
  occurredAt: new Date('2026-08-09T10:00:00Z'),
});

const resultSubmitted = (): WorkEvent => event(RESULT_ID, 'result_submitted', {
  work_item_id: WORK, attempt_id: 'attempt-1', approved_proposal_version: VERSION,
  handoff_reference: 'worktree:project-anima:anima-work/attempt-1',
}, 'executor');

const resultAccepted = (acceptedId: string = RESULT_ID): WorkEvent =>
  event('acceptance-1', 'result_accepted', { accepted_result_event_id: acceptedId });

const integrationDecided = (decision: string, overrides: Record<string, unknown> = {}): WorkEvent =>
  event('decision-event-1', 'integration_decided', {
    work_item_id: WORK, attempt_id: 'attempt-1', approved_proposal_version: VERSION,
    accepted_result_event_id: RESULT_ID, decision, decision_id: 'integration-decision-1', ...overrides,
  });

const handoff = (): WorktreeHandoffV1 => {
  const result = buildWorktreeHandoff({
    workItemId: WORK, attemptId: 'attempt-1', approvedProposalVersion: VERSION,
    executorId: 'worktree-v1', backendId: 'ollama-coder', model: null,
    baseSha: 'a'.repeat(40), branch: 'anima-work/attempt-1', commitSha: 'b'.repeat(40),
    status: 'succeeded', changedFiles: ['src/x.ts'],
    diffFiles: [{ path: 'src/x.ts', insertions: 3, deletions: 0 }],
    gates: [{ label: 'test', command: 'npm test', exitCode: 0, outcome: 'passed' }],
  });
  if (!result.ok) throw new Error(result.explanation);
  return result.value;
};

describe('projectIntegrationBoundary — read model da persistência (ADR-002)', () => {
  test('sem aceite não há fronteira de integração', () => {
    expect(projectIntegrationBoundary([resultSubmitted()])).toBeNull();
    expect(projectIntegrationBoundary([])).toBeNull();
  });

  test('aceite cujo resultado não está no log é fail-closed', () => {
    expect(projectIntegrationBoundary([resultAccepted('inexistente')])).toBeNull();
  });

  test('resultado aceito projeta uma fronteira result_accepted correlacionada', () => {
    const boundary = projectIntegrationBoundary([resultSubmitted(), resultAccepted()]);
    expect(boundary).toMatchObject({
      status: 'result_accepted',
      correlation: { attemptId: 'attempt-1', workItemId: WORK, approvedProposalVersion: VERSION },
      acceptance: { acceptedResultEventId: RESULT_ID, correlation: { origin: 'user' } },
    });
    expect(boundary?.handoff.resultEventId).toBe(RESULT_ID);
  });

  test('a fronteira projetada é aceita pelo contrato ratificado (INT-03)', () => {
    const boundary = projectIntegrationBoundary([resultSubmitted(), resultAccepted()]);
    if (!boundary) throw new Error('esperava fronteira aceita');
    const decided = decideIntegration(boundary, {
      workItemState: 'completed', decisionId: 'integration-decision-1', decision: 'authorize',
      correlation: { attemptId: 'attempt-1', workItemId: WORK, approvedProposalVersion: VERSION, origin: 'user' },
    });
    expect(decided).toMatchObject({ ok: true, value: { status: 'integration_authorized' } });
  });

  test('decisão de autorização projeta integration_authorized e alimenta a publicação', () => {
    const boundary = projectIntegrationBoundary([resultSubmitted(), resultAccepted(), integrationDecided('authorize')]);
    expect(boundary).toMatchObject({ status: 'integration_authorized', integrationDecision: { decisionId: 'integration-decision-1', decision: 'authorize' } });
    if (!boundary) throw new Error('esperava fronteira autorizada');
    const request = buildIntegrationPublicationRequest(boundary, handoff());
    expect(request).toMatchObject({ ok: true, value: { authorizationDecisionId: 'integration-decision-1', branch: 'anima-work/attempt-1' } });
  });

  test('decisão de recusa projeta integration_refused', () => {
    const boundary = projectIntegrationBoundary([resultSubmitted(), resultAccepted(), integrationDecided('refuse')]);
    expect(boundary).toMatchObject({ status: 'integration_refused', integrationDecision: { decision: 'refuse' } });
    // Uma fronteira recusada não gera publicação.
    if (!boundary) throw new Error('esperava fronteira recusada');
    expect(buildIntegrationPublicationRequest(boundary, handoff())).toMatchObject({ ok: false, defect: 'not_authorized' });
  });

  test('decisão obsoleta (aponta outro resultado) é ignorada — fica em result_accepted', () => {
    const stale = integrationDecided('authorize', { accepted_result_event_id: 'outro-resultado' });
    const boundary = projectIntegrationBoundary([resultSubmitted(), resultAccepted(), stale]);
    expect(boundary).toMatchObject({ status: 'result_accepted' });
    expect(boundary).not.toHaveProperty('integrationDecision');
  });

  test('decisão malformada não corrompe a fronteira — permanece result_accepted', () => {
    const badDecision = integrationDecided('maybe');
    expect(projectIntegrationBoundary([resultSubmitted(), resultAccepted(), badDecision])).toMatchObject({ status: 'result_accepted' });
    const blankId = integrationDecided('authorize', { decision_id: '   ' });
    expect(projectIntegrationBoundary([resultSubmitted(), resultAccepted(), blankId])).toMatchObject({ status: 'result_accepted' });
  });
});
