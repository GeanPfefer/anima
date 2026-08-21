import { projectAutonomousExecution, presentWorkItem, type WorkEvent, type WorkItem } from '.';

// UX-01 — o cartão de execução é PROJEÇÃO dos eventos persistidos. Estes testes
// provam que cada campo nasce de um evento e que a ausência de tentativa
// autônoma (ou execução comandada) não inventa cartão.

const item = {
  id: 'item-1', userId: 'u', sourceMessageId: 'm', state: 'in_progress', impactLevel: 'low', capability: 'programming',
  originalRequest: 'x',
  intent: { execution_spec: { schema_version: 1, target: { kind: 'project', reference: 'alvo' }, permissions: [], validation_criteria: [{ label: 'testes' }], limits: { max_attempts: 3, max_duration_minutes: 5 } } },
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: ['a.py'], excludedScope: ['deploy'], expectedEffects: [], risks: [] } },
  proposalVersion: 1, createdAt: new Date('2026-07-29T11:00:00Z'), updatedAt: new Date(),
} satisfies WorkItem;

let seq = 0;
const ev = (type: WorkEvent['type'], data: Record<string, unknown>, at = '2026-07-29T12:00:00.000Z'): WorkEvent => ({
  id: `e${seq++}`, workItemId: item.id, type, author: 'anima', proposalVersion: 1,
  payload: { schema_version: 1, data } as WorkEvent['payload'], occurredAt: new Date(at),
});
beforeEach(() => { seq = 0; });

const started = () => ev('execution_started', { work_item_id: item.id, attempt_id: 'att-1', approved_proposal_version: 1, origin: 'anima', executor_id: 'local-runner-v1', claim_id: 'claim-1' }, '2026-07-29T12:00:00.000Z');
const routed = () => ev('work_routing_decided', { attempt_id: 'att-1', decision: { selected: { routeId: 'r', executorId: 'local-runner-v1', providerRef: 'local-node', modelRef: 'qwen2.5-coder:14b', effort: 'standard' } } });
const checkpoint = (sequence: number, next: string, completed: string[], remaining: string[]) => ev('checkpoint_recorded', { attempt_id: 'att-1', signal_sequence: sequence, checkpoint: { schemaVersion: 1, completedSteps: completed, remainingSteps: remaining, nextStep: next } });

describe('projeção do cartão de execução autônoma', () => {
  test('sem execução autônoma o cartão é ausente (null)', () => {
    expect(projectAutonomousExecution(item, [ev('work_started', { attempt_id: 'att-1' })])).toBeNull();
  });

  test('execução comandada (sem claim_id) não gera cartão de controle', () => {
    const commanded = ev('execution_started', { attempt_id: 'att-c', executor_id: 'local-runner-v1', origin: 'anima' });
    expect(projectAutonomousExecution(item, [commanded])).toBeNull();
  });

  test('tentativa em curso projeta executor, esforço, início, limites e permite controle', () => {
    const projection = projectAutonomousExecution(item, [routed(), started()]);
    expect(projection).toMatchObject({
      attemptId: 'att-1', status: 'running', startedAt: '2026-07-29T12:00:00.000Z',
      executorId: 'local-runner-v1', providerRef: 'local-node', modelRef: 'qwen2.5-coder:14b', effort: 'standard',
      limits: { maxAttempts: 3, maxDurationMinutes: 5 },
      latestCheckpoint: null, pendingControl: null, appliedControl: null, budgetBlock: null, canRequestControl: true,
    });
  });

  test('sem decisão de rota, o executor ainda vem do execution_started', () => {
    const projection = projectAutonomousExecution(item, [started()]);
    expect(projection).toMatchObject({ executorId: 'local-runner-v1', providerRef: null, modelRef: null, effort: null });
  });

  test('projeta o checkpoint de maior sequência com contagens e próximo passo', () => {
    const projection = projectAutonomousExecution(item, [started(), checkpoint(1, 'passo 1', ['a'], ['b', 'c']), checkpoint(4, 'passo 4', ['a', 'b'], ['c'])]);
    expect(projection?.latestCheckpoint).toEqual({ signalSequence: 4, completedSteps: 2, remainingSteps: 1, nextStep: 'passo 4' });
  });

  test('pedido de pausa pendente aparece e bloqueia novo pedido de controle', () => {
    const projection = projectAutonomousExecution(item, [started(), checkpoint(1, 'p', ['a'], ['b']), ev('work_control_requested', { attempt_id: 'att-1', action: 'pause', requested_at: '2026-07-29T12:05:00.000Z' })]);
    expect(projection?.status).toBe('running');
    expect(projection?.pendingControl).toEqual({ action: 'pause', requestedAt: '2026-07-29T12:05:00.000Z' });
    expect(projection?.canRequestControl).toBe(false);
  });

  test('pausa aplicada projeta status paused, resultado aplicado e nenhum pedido pendente', () => {
    const projection = projectAutonomousExecution(item, [
      started(), checkpoint(1, 'p', ['a'], ['b']),
      ev('work_control_requested', { attempt_id: 'att-1', action: 'pause', requested_at: '2026-07-29T12:05:00.000Z' }),
      ev('work_paused', { attempt_id: 'att-1', reason: 'paused_by_user', control_request_event_seq: 3, checkpoint_event_seq: 2, applied_at: '2026-07-29T12:06:00.000Z' }),
    ]);
    expect(projection?.status).toBe('paused');
    expect(projection?.appliedControl).toEqual({ action: 'pause', reason: 'paused_by_user', appliedAt: '2026-07-29T12:06:00.000Z' });
    expect(projection?.pendingControl).toBeNull();
    expect(projection?.canRequestControl).toBe(false);
  });

  test('cancelamento aplicado projeta status cancelled com controle de origem do usuário', () => {
    const projection = projectAutonomousExecution(item, [
      started(), checkpoint(1, 'p', ['a'], ['b']),
      ev('work_control_requested', { attempt_id: 'att-1', action: 'cancel', requested_at: '2026-07-29T12:05:00.000Z' }),
      ev('work_cancelled', { attempt_id: 'att-1', reason: 'cancelled_by_user', control_request_event_seq: 3, applied_at: '2026-07-29T12:06:00.000Z' }),
    ]);
    expect(projection?.status).toBe('cancelled');
    expect(projection?.appliedControl).toEqual({ action: 'cancel', reason: 'cancelled_by_user', appliedAt: '2026-07-29T12:06:00.000Z' });
  });

  test('cancelamento do executor (sem pedido de controle) não vira controle aplicado', () => {
    const projection = projectAutonomousExecution(item, [started(), ev('work_cancelled', { attempt_id: 'att-1', reason: 'execution_cancelled', handoff_reference: 'h' })]);
    expect(projection?.status).toBe('cancelled');
    expect(projection?.appliedControl).toBeNull();
  });

  test('bloqueio por orçamento projeta status blocked e a razão tipada', () => {
    const projection = projectAutonomousExecution(item, [started(), checkpoint(1, 'p', ['a'], ['b']), ev('work_blocked', { attempt_id: 'att-1', reason: 'interactive_reserve_protected', reached_limit: 'resources' })]);
    expect(projection?.status).toBe('blocked');
    expect(projection?.budgetBlock).toEqual({ reason: 'interactive_reserve_protected', reachedLimit: 'resources', recoverable: true });
    expect(projection?.canRequestControl).toBe(false);
  });

  test('bloqueio NÃO-orçamentário (decisão humana) não é marcado como recuperável', () => {
    const projection = projectAutonomousExecution(item, [started(), checkpoint(1, 'p', ['a'], ['b']), ev('work_blocked', { attempt_id: 'att-1', reason: 'human_input_required' })]);
    expect(projection?.budgetBlock).toEqual({ reason: 'human_input_required', reachedLimit: null, recoverable: false });
  });

  test('resultado submetido projeta status submitted_for_review', () => {
    const projection = projectAutonomousExecution(item, [started(), ev('result_submitted', { attempt_id: 'att-1', summary: 'ok', result_references: [] })]);
    expect(projection?.status).toBe('submitted_for_review');
    expect(projection?.canRequestControl).toBe(false);
  });

  test('retomada usa a tentativa mais recente, não a abandonada', () => {
    const first = ev('execution_started', { attempt_id: 'att-1', executor_id: 'local-runner-v1', claim_id: 'claim-1' }, '2026-07-29T12:00:00.000Z');
    const abandoned = ev('attempt_abandoned', { attempt_id: 'att-1', reason: 'lease_expired' });
    const second = ev('execution_started', { attempt_id: 'att-2', executor_id: 'local-runner-v1', claim_id: 'claim-2', reason: 'resumed_execution' }, '2026-07-29T13:00:00.000Z');
    const projection = projectAutonomousExecution(item, [first, abandoned, second]);
    expect(projection?.attemptId).toBe('att-2');
    expect(projection?.status).toBe('running');
    expect(projection?.startedAt).toBe('2026-07-29T13:00:00.000Z');
  });

  test('presentWorkItem inclui a projeção de execução ao lado das ações', () => {
    expect(presentWorkItem(item, [routed(), started()]).execution).toMatchObject({ attemptId: 'att-1', status: 'running' });
  });
});
