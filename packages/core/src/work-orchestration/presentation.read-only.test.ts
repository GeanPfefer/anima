import type { Json } from '@anima/types';
import { investigationFixture, investigationItem } from './__fixtures__/investigation-review';
import { projectIntegrationBoundary } from './integration-decision';
import { deriveWorkProgressPhase, projectWorkIntegration, reconstructWorkPresentation, type WorkIntegrationProjection } from './presentation';
import type { WorkEvent, WorkItem } from './types';

const fixture = investigationFixture();
const event = (id: string, type: WorkEvent['type'], data: Json = {}, proposalVersion = 2): WorkEvent => ({
  id, type, workItemId: investigationItem.id, author: 'system', proposalVersion,
  payload: { schema_version: 1, data }, occurredAt: new Date('2026-10-08T00:00:00Z'),
});
const history: readonly WorkEvent[] = [
  event('proposal', 'work_proposed', {}, 1), event('revision', 'proposal_revised'),
  { ...event('approval', 'work_approved'), author: 'user' },
  event('start', 'execution_started', { claim_id: 'claim', attempt_id: 'attempt', executor_id: 'investigation-v1' }),
  fixture.result, fixture.verifier,
];
const source = [{ kind: 'message', id: investigationItem.sourceMessageId }];
const completed: WorkItem = { ...investigationItem, state: 'completed' };
const pending: WorkIntegrationProjection = {
  status: 'awaiting_decision', acceptedResultEventId: fixture.result.id,
  decision: null, availableDecisions: ['authorize', 'refuse'], publication: null,
};

describe('apresentação read_only sem integração de código', () => {
  test('completed/read_only mantém resultado/aceite e encerra a fase sem affordance de integração', () => {
    const events = [...history, fixture.accepted];
    const before = JSON.stringify({ completed, events });
    const presentation = reconstructWorkPresentation(completed, events, source);
    expect(presentation).toMatchObject({
      provenance: { status: 'complete' }, acceptedResult: { eventId: fixture.result.id },
      execution: { status: 'submitted_for_review' }, integration: null, availableActions: [],
      progress: { phase: 'done', label: 'Concluído', active: false, terminal: true },
    });
    // O leitor histórico continua registrando o aceite; só a apresentação o distingue de integração.
    expect(projectIntegrationBoundary(events)?.status).toBe('result_accepted');
    expect(JSON.stringify({ completed, events })).toBe(before);
  });

  test('review/read_only continua em revisão, sem inferir aceite ou integração', () => {
    expect(reconstructWorkPresentation(investigationItem, history, source)).toMatchObject({
      acceptedResult: null, integration: null, availableActions: ['accept_result', 'request_result_changes'],
      progress: { phase: 'reviewing', label: 'Revisando', terminal: false },
    });
  });

  test.each(['awaiting_decision', 'authorized', 'branch_published', 'review_request_created', 'refused'] as const)(
    'completed/read_only permanece terminal mesmo com integração %s fornecida', status => {
      const decision = { ...event('decision', 'integration_decided', {
        accepted_result_event_id: fixture.result.id, decision_id: 'decision', decision: status === 'refused' ? 'refuse' : 'authorize',
      }), author: 'user' as const };
      const events = [...history, fixture.accepted, ...(status === 'awaiting_decision' ? [] : [decision])];
      expect(projectWorkIntegration(completed, events)).toBeNull();
      expect(deriveWorkProgressPhase({ item: completed, execution: null, integration: { ...pending, status } })).toMatchObject({ phase: 'done', terminal: true });
    },
  );

  test('fase ignora projeção de integração obsoleta também em review/read_only', () => {
    const execution = reconstructWorkPresentation(investigationItem, history, source).execution ?? null;
    expect(deriveWorkProgressPhase({ item: investigationItem, execution, integration: pending })).toMatchObject({ phase: 'reviewing', terminal: false });
  });

  test.each<WorkItem['intent']>([{}, { execution_spec: { executor: 'worktree-v1' } }])('programação %j preserva integração governada após aceite', intent => {
    const programming: WorkItem = { ...completed, capability: 'programming', intent };
    const result = event(fixture.result.id, 'result_submitted', {
      summary: 'Código produzido', result_references: ['commit:' + 'a'.repeat(40)],
      work_item_id: programming.id, attempt_id: 'attempt', approved_proposal_version: 2,
      handoff_reference: 'worktree:attempt',
    });
    const started = event('start', 'execution_started', { claim_id: 'claim', attempt_id: 'attempt', executor_id: 'worktree-v1' });
    const events = [...history.slice(0, 3), started, result, fixture.accepted];
    const presentation = reconstructWorkPresentation(programming, events, source);
    expect(presentation).toMatchObject({
      integration: { status: 'awaiting_decision', availableDecisions: ['authorize', 'refuse'] },
      progress: { phase: 'ready_to_integrate', label: 'Pronto para integrar', terminal: false },
    });
    expect(deriveWorkProgressPhase({ item: programming, execution: null, integration: { ...pending, status: 'authorized' } }).phase).toBe('integrating');
    expect(deriveWorkProgressPhase({ item: programming, execution: null, integration: { ...pending, status: 'refused' } }).phase).toBe('done');
  });
});
