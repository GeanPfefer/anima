import {
  reconstructExecutionTimelines,
  type CorrelatedExecutionEvent,
  type ExecutionAttemptCorrelation,
  type WorkExecutorSignal,
} from '.';

const attempt = (attemptId: string, approvedProposalVersion = 3, workItemId = 'work-1'): ExecutionAttemptCorrelation => ({
  attemptId,
  workItemId,
  approvedProposalVersion,
});

const event = (
  attemptContext: ExecutionAttemptCorrelation,
  sequence: number,
  kind: WorkExecutorSignal['kind'],
  origin: CorrelatedExecutionEvent['origin'] = 'executor',
): CorrelatedExecutionEvent => {
  const correlation = { ...attemptContext, origin, sequence };
  const signal = kind === 'progress'
    ? { ...correlation, kind, message: `progresso-${sequence}` }
    : kind === 'decision_required'
      ? { ...correlation, kind, reason: 'architectural_decision' as const, explanation: 'Escolha necessária.' }
      : kind === 'result'
        ? { ...correlation, kind, summary: 'Concluído.', resultReferences: ['commit:abc'], validations: [], limitations: [], handoffReference: 'commit:abc' }
        : kind === 'error'
          ? { ...correlation, kind, code: 'execution_failed' as const, message: 'Falhou.', retryable: false, handoffReference: 'report:error' }
          : kind === 'checkpoint'
            ? { ...correlation, kind, checkpoint: { schemaVersion: 1 as const, handoffReference: 'runner-bundle:cp', completedSteps: ['feito'], remainingSteps: ['resta'], nextStep: 'seguir', decisions: [], risks: [], touchedResources: [], validations: [], failures: [], evidenceReferences: [] } }
            : { ...correlation, kind, acknowledged: true as const, handoffReference: 'checkpoint:cancelled' };
  return { ...correlation, eventId: `${attemptContext.attemptId}-${sequence}`, signal };
};

describe('INT-02 — correlação e reconstrução de eventos', () => {
  test.each(['decision_required', 'result', 'error', 'cancelled'] as const)(
    'reconstrói progresso seguido do terminal %s',
    terminal => {
      const context = attempt(`attempt-${terminal}`);
      const result = reconstructExecutionTimelines([context], [event(context, 1, 'progress'), event(context, 2, terminal)]);
      expect(result).toMatchObject({ ok: true, timelines: [{ attempt: context }] });
      if (result.ok) expect(result.timelines[0]!.events.map(value => value.signal.kind)).toEqual(['progress', terminal]);
    },
  );

  test('distingue tentativas concorrentes do mesmo item e versão por correlação explícita', () => {
    const first = attempt('attempt-a');
    const second = attempt('attempt-b');
    const result = reconstructExecutionTimelines(
      [second, first],
      [event(second, 2, 'result'), event(first, 2, 'error'), event(second, 1, 'progress'), event(first, 1, 'progress')],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.timelines.map(value => value.attempt.attemptId)).toEqual(['attempt-a', 'attempt-b']);
      expect(result.timelines.map(value => value.events.map(item => item.sequence))).toEqual([[1, 2], [1, 2]]);
    }
  });

  test('mantém versões aprovadas distintas e origens fechadas distintas', () => {
    const versionTwo = attempt('attempt-v2', 2);
    const versionThree = attempt('attempt-v3', 3);
    const result = reconstructExecutionTimelines(
      [versionThree, versionTwo],
      [event(versionThree, 1, 'result', 'system'), event(versionTwo, 1, 'progress', 'anima'), event(versionTwo, 2, 'cancelled', 'user')],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.timelines.map(value => value.attempt.approvedProposalVersion)).toEqual([2, 3]);
      expect(result.timelines[0]!.events.map(value => value.origin)).toEqual(['anima', 'user']);
    }
  });

  test.each([
    ['item', { workItemId: undefined }],
    ['tentativa', { attemptId: undefined }],
    ['versão', { approvedProposalVersion: undefined }],
    ['origem', { origin: undefined }],
    ['origem inválida', { origin: 'other' }],
    ['id vazio', { attemptId: ' ' }],
    ['versão inválida', { approvedProposalVersion: 0 }],
  ])('rejeita evento sem correlação válida: %s', (_label, replacement) => {
    const context = attempt('attempt-invalid');
    const candidate = { ...event(context, 1, 'result'), ...replacement };
    expect(reconstructExecutionTimelines([context], [candidate])).toMatchObject({ ok: false, defect: 'invalid_correlation' });
  });

  test('rejeita divergência entre evento, sinal e contexto persistido', () => {
    const context = attempt('attempt-divergent');
    const correlated = event(context, 1, 'result');
    expect(reconstructExecutionTimelines([context], [{ ...correlated, workItemId: 'work-other' }])).toMatchObject({ ok: false, defect: 'invalid_correlation' });
    expect(reconstructExecutionTimelines([attempt(context.attemptId, 4)], [correlated])).toMatchObject({ ok: false, defect: 'correlation_mismatch' });
  });

  test('rejeita tentativa reutilizada em outro item ou versão', () => {
    expect(reconstructExecutionTimelines([
      attempt('attempt-reused', 2, 'work-a'),
      attempt('attempt-reused', 3, 'work-b'),
    ], [])).toMatchObject({ ok: false, defect: 'invalid_attempt_context' });
  });

  test('rejeita evento duplicado, sequência ambígua e evento tardio', () => {
    const context = attempt('attempt-terminal');
    const terminal = event(context, 1, 'result');
    expect(reconstructExecutionTimelines([context], [terminal, terminal])).toMatchObject({ ok: false, defect: 'duplicate_event' });
    expect(reconstructExecutionTimelines([context], [event(context, 2, 'result')])).toMatchObject({ ok: false, defect: 'invalid_sequence' });
    expect(reconstructExecutionTimelines([context], [terminal, event(context, 2, 'progress')])).toMatchObject({ ok: false, defect: 'late_event' });
  });

  test('a ordem canônica depende apenas da correlação e da sequência explícitas', () => {
    const context = attempt('attempt-order');
    const unordered = [event(context, 3, 'result'), event(context, 1, 'progress', 'anima'), event(context, 2, 'progress', 'executor')];
    const forward = reconstructExecutionTimelines([context], unordered);
    const reversed = reconstructExecutionTimelines([context], [...unordered].reverse());
    expect(forward).toEqual(reversed);
    if (forward.ok) expect(forward.timelines[0]!.events.map(value => value.eventId)).toEqual(['attempt-order-1', 'attempt-order-2', 'attempt-order-3']);
  });
});
