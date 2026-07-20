import {
  buildAttemptFinishedPayload,
  buildAttemptStartedPayload,
  finishExecutionAttempt,
  startExecutionAttempt,
  type ExecutionAttempt,
  type FinishExecutionAttemptInput,
  type RunningExecutionAttempt,
} from '.';

const startedAt = new Date('2026-07-20T12:00:00.000Z');
const finishedAt = new Date('2026-07-20T12:10:00.000Z');
const start = () => startExecutionAttempt({ attemptId: 'attempt-1', workItemId: 'work-1', approvedProposalVersion: 3, executorId: 'generic-executor', startedAt });
const running = (): RunningExecutionAttempt => {
  const result = start();
  if (!result.ok) throw new Error(result.explanation);
  return result.value;
};
const finishInput = (overrides: Partial<FinishExecutionAttemptInput> = {}): FinishExecutionAttemptInput => ({
  status: 'succeeded', finishedAt, resultSummary: 'Alteração pronta para revisão.', stopReason: 'result_produced', handoffReference: 'commit:abc123', ...overrides,
});

describe('AUTO-03 mínimo — tentativa persistente', () => {
  test('início cria tentativa única correlacionada a item e versão aprovada', () => {
    expect(start()).toEqual({ ok: true, value: { attemptId: 'attempt-1', workItemId: 'work-1', approvedProposalVersion: 3, executorId: 'generic-executor', startedAt, status: 'running' } });
  });

  test('início gera payload consultável e independente de fornecedor', () => {
    expect(buildAttemptStartedPayload(running())).toEqual({ schema_version: 1, data: { attempt_id: 'attempt-1', work_item_id: 'work-1', approved_proposal_version: 3, executor_id: 'generic-executor', started_at: '2026-07-20T12:00:00.000Z' } });
  });

  test.each([
    ['succeeded', 'result_produced'], ['failed', 'executor_failure'], ['timed_out', 'time_limit_reached'],
    ['cancelled', 'cancelled_by_user'], ['paused', 'human_input_required'], ['blocked', 'dependency_unavailable'],
  ] as const)('%s é estado terminal consultável com razão tipada', (status, stopReason) => {
    const result = finishExecutionAttempt(running(), finishInput({ status, stopReason }));
    expect(result).toMatchObject({ ok: true, value: { status, stopReason, resultSummary: 'Alteração pronta para revisão.', handoffReference: 'commit:abc123' } });
  });

  test('término gera payload com correlação, resultado, razão e handoff', () => {
    const result = finishExecutionAttempt(running(), finishInput());
    if (!result.ok) throw new Error(result.explanation);
    expect(buildAttemptFinishedPayload(result.value)).toEqual({ schema_version: 1, data: {
      attempt_id: 'attempt-1', work_item_id: 'work-1', approved_proposal_version: 3, executor_id: 'generic-executor',
      started_at: '2026-07-20T12:00:00.000Z', finished_at: '2026-07-20T12:10:00.000Z', status: 'succeeded',
      result_summary: 'Alteração pronta para revisão.', stop_reason: 'result_produced', handoff_reference: 'commit:abc123',
    } });
  });

  test('término tardio ou duplicado é rejeitado sem substituir o primeiro desfecho', () => {
    const first = finishExecutionAttempt(running(), finishInput());
    if (!first.ok) throw new Error(first.explanation);
    expect(finishExecutionAttempt(first.value, finishInput({ status: 'failed', stopReason: 'executor_failure' }))).toMatchObject({ ok: false, defect: 'attempt_already_finished' });
  });

  test('fim anterior ao início e campos mínimos ausentes falham fechados', () => {
    expect(finishExecutionAttempt(running(), finishInput({ finishedAt: new Date('2026-07-20T11:59:00Z') }))).toMatchObject({ ok: false, defect: 'invalid_attempt' });
    expect(finishExecutionAttempt(running(), finishInput({ handoffReference: ' ' }))).toMatchObject({ ok: false, defect: 'invalid_attempt' });
  });

  test('sucesso e razão de parada não podem divergir', () => {
    expect(finishExecutionAttempt(running(), finishInput({ status: 'failed' }))).toMatchObject({ ok: false, defect: 'invalid_transition' });
    expect(finishExecutionAttempt(running(), finishInput({ status: 'succeeded', stopReason: 'executor_failure' }))).toMatchObject({ ok: false, defect: 'invalid_transition' });
  });

  test.each([
    { resultSummary: 'api_key=segredo', handoffReference: 'commit:abc' },
    { resultSummary: 'feito', handoffReference: 'G:\\anima\\arquivo.patch' },
    { resultSummary: 'feito', handoffReference: 'https://usuario:senha@interno.local/x' },
  ])('segredo ou caminho sensível não entra no payload: %o', unsafe => {
    expect(finishExecutionAttempt(running(), finishInput(unsafe))).toMatchObject({ ok: false, defect: 'sensitive_data' });
  });

  test('tentativa já terminal continua identificável como uma única entidade', () => {
    const attempt: ExecutionAttempt = { ...running(), ...finishInput() };
    expect(attempt.attemptId).toBe('attempt-1');
  });
});
