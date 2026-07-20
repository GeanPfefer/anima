import {
  acceptResultForIntegration,
  decideIntegration,
  produceResultForIntegration,
  recordIntegrated,
  type ExecutionEventCorrelation,
  type IntegrationBoundary,
  type TerminalExecutionAttempt,
} from '.';

const attempt: TerminalExecutionAttempt = {
  attemptId: 'attempt-1',
  workItemId: 'work-1',
  approvedProposalVersion: 3,
  status: 'succeeded',
  executorId: 'executor-generic',
  startedAt: new Date('2026-07-20T10:00:00Z'),
  finishedAt: new Date('2026-07-20T10:10:00Z'),
  resultSummary: 'Alteração produzida para revisão.',
  stopReason: 'result_produced',
  handoffReference: 'commit:abc',
};

const correlation = (origin: ExecutionEventCorrelation['origin']): ExecutionEventCorrelation => ({
  attemptId: attempt.attemptId,
  workItemId: attempt.workItemId,
  approvedProposalVersion: attempt.approvedProposalVersion,
  origin,
});

const produced = (): IntegrationBoundary => {
  const result = produceResultForIntegration({
    attempt,
    workItemState: 'review',
    resultCorrelation: correlation('executor'),
    handoff: { kind: 'execution_result', reference: attempt.handoffReference, resultEventId: 'result-event-1' },
  });
  if (!result.ok) throw new Error(result.explanation);
  return result.value;
};

const accepted = (): IntegrationBoundary => {
  const result = acceptResultForIntegration(produced(), {
    workItemState: 'completed',
    decisionId: 'acceptance-1',
    acceptedResultEventId: 'result-event-1',
    correlation: correlation('user'),
  });
  if (!result.ok) throw new Error(result.explanation);
  return result.value;
};

describe('INT-03 — execução separada de integração', () => {
  test('tentativa concluída produz resultado ainda não aceito nem integrado', () => {
    const boundary = produced();
    expect(boundary).toMatchObject({ status: 'result_produced' });
    expect(boundary).not.toHaveProperty('acceptance');
    expect(boundary).not.toHaveProperty('integrationDecision');
    expect(boundary).not.toHaveProperty('integrationRecord');
  });

  test('resultado aceito continua explicitamente não integrado', () => {
    const boundary = accepted();
    expect(boundary).toMatchObject({ status: 'result_accepted', acceptance: { acceptedResultEventId: 'result-event-1' } });
    expect(boundary).not.toHaveProperty('integrationRecord');
  });

  test('integração pode ser recusada sem alterar o resultado aceito', () => {
    const result = decideIntegration(accepted(), {
      workItemState: 'completed', decisionId: 'integration-decision-1', decision: 'refuse', correlation: correlation('user'),
    });
    expect(result).toMatchObject({ ok: true, value: { status: 'integration_refused', acceptance: { decisionId: 'acceptance-1' } } });
  });

  test('integração pode ser autorizada, mas autorização não registra aplicação', () => {
    const result = decideIntegration(accepted(), {
      workItemState: 'completed', decisionId: 'integration-decision-1', decision: 'authorize', correlation: correlation('user'),
    });
    expect(result).toMatchObject({ ok: true, value: { status: 'integration_authorized' } });
    if (result.ok) expect(result.value).not.toHaveProperty('integrationRecord');
  });

  test('recusa integração sem resultado e sem aceite', () => {
    expect(decideIntegration({ status: 'result_produced' } as IntegrationBoundary, {
      workItemState: 'completed', decisionId: 'integration-decision-1', decision: 'authorize', correlation: correlation('user'),
    })).toMatchObject({ ok: false, defect: 'invalid_input' });
    expect(decideIntegration(produced(), {
      workItemState: 'completed', decisionId: 'integration-decision-1', decision: 'authorize', correlation: correlation('user'),
    })).toMatchObject({ ok: false, defect: 'result_not_accepted' });
  });

  test('repetição idêntica é idempotente e entrada divergente falha fechada', () => {
    const input = { workItemState: 'completed' as const, decisionId: 'integration-decision-1', decision: 'authorize' as const, correlation: correlation('user') };
    const first = decideIntegration(accepted(), input);
    if (!first.ok) throw new Error(first.explanation);
    expect(decideIntegration(first.value, input)).toEqual(first);
    expect(decideIntegration(first.value, { ...input, decision: 'refuse' })).toMatchObject({ ok: false, defect: 'input_conflict' });
  });

  test('estado e versão incorretos são recusados', () => {
    expect(produceResultForIntegration({
      attempt, workItemState: 'completed', resultCorrelation: correlation('executor'),
      handoff: { kind: 'execution_result', reference: 'commit:abc', resultEventId: 'result-event-1' },
    })).toMatchObject({ ok: false, defect: 'result_not_produced' });
    expect(acceptResultForIntegration(produced(), {
      workItemState: 'completed', decisionId: 'acceptance-1', acceptedResultEventId: 'result-event-1',
      correlation: { ...correlation('user'), approvedProposalVersion: 4 },
    })).toMatchObject({ ok: false, defect: 'correlation_mismatch' });
    expect(decideIntegration({ ...accepted(), status: 'integration_authorized', integrationDecision: undefined }, {
      workItemState: 'completed', decisionId: 'integration-decision-1', decision: 'authorize', correlation: correlation('user'),
    })).toMatchObject({ ok: false, defect: 'invalid_input' });
  });

  test('correlação divergente por tentativa ou item é recusada', () => {
    expect(acceptResultForIntegration(produced(), {
      workItemState: 'completed', decisionId: 'acceptance-1', acceptedResultEventId: 'result-event-1',
      correlation: { ...correlation('user'), attemptId: 'attempt-other' },
    })).toMatchObject({ ok: false, defect: 'correlation_mismatch' });
    expect(decideIntegration(accepted(), {
      workItemState: 'completed', decisionId: 'integration-decision-1', decision: 'authorize',
      correlation: { ...correlation('user'), workItemId: 'work-other' },
    })).toMatchObject({ ok: false, defect: 'correlation_mismatch' });
  });

  test('registro de integração exige autorização exata e preserva idempotência', () => {
    const authorization = decideIntegration(accepted(), {
      workItemState: 'completed', decisionId: 'integration-decision-1', decision: 'authorize', correlation: correlation('user'),
    });
    if (!authorization.ok) throw new Error(authorization.explanation);
    expect(recordIntegrated(accepted(), {
      workItemState: 'completed', recordId: 'integration-1', authorizationDecisionId: 'integration-decision-1', correlation: correlation('system'),
    })).toMatchObject({ ok: false, defect: 'integration_not_authorized' });
    const input = { workItemState: 'completed' as const, recordId: 'integration-1', authorizationDecisionId: 'integration-decision-1', correlation: correlation('system') };
    const integrated = recordIntegrated(authorization.value, input);
    expect(integrated).toMatchObject({ ok: true, value: { status: 'integrated', integrationRecord: { recordId: 'integration-1' } } });
    if (!integrated.ok) throw new Error(integrated.explanation);
    expect(recordIntegrated(integrated.value, input)).toEqual(integrated);
    expect(recordIntegrated(integrated.value, { ...input, authorizationDecisionId: 'different' })).toMatchObject({ ok: false, defect: 'input_conflict' });
  });

  test('conclusão da tentativa e conclusão do work item são gates distintos', () => {
    const boundary = produced();
    expect(attempt.status).toBe('succeeded');
    expect(boundary.status).toBe('result_produced');
    expect(acceptResultForIntegration(boundary, {
      workItemState: 'review', decisionId: 'acceptance-1', acceptedResultEventId: 'result-event-1', correlation: correlation('user'),
    })).toMatchObject({ ok: false, defect: 'result_not_accepted' });
  });
});
