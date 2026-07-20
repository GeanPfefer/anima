import type { ExecutionAttemptCorrelation, TerminalExecutionAttempt } from './execution-attempt';
import { EXECUTION_EVENT_ORIGINS, type ExecutionEventCorrelation } from './execution-event-correlation';
import type { WorkState } from './types';

export type IntegrationBoundaryStatus =
  | 'result_produced'
  | 'result_accepted'
  | 'integration_refused'
  | 'integration_authorized'
  | 'integrated';

export interface IntegrationHandoff {
  readonly kind: 'execution_result';
  readonly reference: string;
  readonly resultEventId: string;
}

export interface ResultAcceptanceRecord {
  readonly decisionId: string;
  readonly acceptedResultEventId: string;
  readonly correlation: ExecutionEventCorrelation;
}

export interface IntegrationDecisionRecord {
  readonly decisionId: string;
  readonly decision: 'authorize' | 'refuse';
  readonly correlation: ExecutionEventCorrelation;
}

export interface IntegrationRecord {
  readonly recordId: string;
  readonly authorizationDecisionId: string;
  readonly correlation: ExecutionEventCorrelation;
}

export interface IntegrationBoundary {
  readonly status: IntegrationBoundaryStatus;
  readonly correlation: ExecutionAttemptCorrelation;
  readonly resultCorrelation: ExecutionEventCorrelation;
  readonly handoff: IntegrationHandoff;
  readonly acceptance?: ResultAcceptanceRecord;
  readonly integrationDecision?: IntegrationDecisionRecord;
  readonly integrationRecord?: IntegrationRecord;
}

export interface ProduceIntegrationResultInput {
  readonly attempt: TerminalExecutionAttempt;
  readonly workItemState: WorkState;
  readonly resultCorrelation: ExecutionEventCorrelation;
  readonly handoff: IntegrationHandoff;
}

export interface AcceptIntegrationResultInput extends ResultAcceptanceRecord {
  readonly workItemState: WorkState;
}

export interface DecideIntegrationInput extends IntegrationDecisionRecord {
  readonly workItemState: WorkState;
}

export interface RecordIntegrationInput extends IntegrationRecord {
  readonly workItemState: WorkState;
}

export type IntegrationBoundaryDefect =
  | 'invalid_input'
  | 'invalid_transition'
  | 'correlation_mismatch'
  | 'result_not_produced'
  | 'result_not_accepted'
  | 'integration_not_authorized'
  | 'input_conflict';

export type IntegrationBoundaryResult =
  | { readonly ok: true; readonly value: IntegrationBoundary }
  | { readonly ok: false; readonly defect: IntegrationBoundaryDefect; readonly explanation: string };

const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validVersion = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;
const fail = (defect: IntegrationBoundaryDefect, explanation: string): IntegrationBoundaryResult => ({ ok: false, defect, explanation });
const sameAttempt = (left: ExecutionAttemptCorrelation, right: ExecutionAttemptCorrelation): boolean =>
  left.attemptId === right.attemptId
  && left.workItemId === right.workItemId
  && left.approvedProposalVersion === right.approvedProposalVersion;
const sameCorrelation = (left: ExecutionEventCorrelation, right: ExecutionEventCorrelation): boolean =>
  sameAttempt(left, right) && left.origin === right.origin;
const validCorrelation = (value: ExecutionEventCorrelation): boolean =>
  nonBlank(value.attemptId) && nonBlank(value.workItemId) && validVersion(value.approvedProposalVersion)
  && EXECUTION_EVENT_ORIGINS.includes(value.origin);
const validBoundary = (value: IntegrationBoundary): boolean => {
  const base = nonBlank(value.correlation?.attemptId)
  && nonBlank(value.correlation?.workItemId)
  && validVersion(value.correlation?.approvedProposalVersion)
  && validCorrelation(value.resultCorrelation)
  && sameAttempt(value.correlation, value.resultCorrelation)
  && value.resultCorrelation.origin === 'executor'
  && value.handoff?.kind === 'execution_result'
  && nonBlank(value.handoff.reference)
  && nonBlank(value.handoff.resultEventId);
  if (!base) return false;
  const acceptanceValid = value.acceptance !== undefined
    && nonBlank(value.acceptance.decisionId)
    && value.acceptance.acceptedResultEventId === value.handoff.resultEventId
    && validCorrelation(value.acceptance.correlation)
    && value.acceptance.correlation.origin === 'user'
    && sameAttempt(value.correlation, value.acceptance.correlation);
  const decisionValid = value.integrationDecision !== undefined
    && nonBlank(value.integrationDecision.decisionId)
    && ['authorize', 'refuse'].includes(value.integrationDecision.decision)
    && validCorrelation(value.integrationDecision.correlation)
    && value.integrationDecision.correlation.origin === 'user'
    && sameAttempt(value.correlation, value.integrationDecision.correlation);
  const recordValid = value.integrationRecord !== undefined
    && nonBlank(value.integrationRecord.recordId)
    && value.integrationRecord.authorizationDecisionId === value.integrationDecision?.decisionId
    && validCorrelation(value.integrationRecord.correlation)
    && value.integrationRecord.correlation.origin === 'system'
    && sameAttempt(value.correlation, value.integrationRecord.correlation);
  switch (value.status) {
    case 'result_produced': return value.acceptance === undefined && value.integrationDecision === undefined && value.integrationRecord === undefined;
    case 'result_accepted': return acceptanceValid && value.integrationDecision === undefined && value.integrationRecord === undefined;
    case 'integration_refused': return acceptanceValid && decisionValid && value.integrationDecision?.decision === 'refuse' && value.integrationRecord === undefined;
    case 'integration_authorized': return acceptanceValid && decisionValid && value.integrationDecision?.decision === 'authorize' && value.integrationRecord === undefined;
    case 'integrated': return acceptanceValid && decisionValid && value.integrationDecision?.decision === 'authorize' && recordValid;
  }
};

export function produceResultForIntegration(input: ProduceIntegrationResultInput): IntegrationBoundaryResult {
  const { attempt, resultCorrelation, handoff } = input;
  if (attempt.status !== 'succeeded' || attempt.stopReason !== 'result_produced' || input.workItemState !== 'review') {
    return fail('result_not_produced', 'Somente uma tentativa concluída com resultado em revisão pode abrir a fronteira de integração.');
  }
  if (!validCorrelation(resultCorrelation) || resultCorrelation.origin !== 'executor' || !sameAttempt(attempt, resultCorrelation)) {
    return fail('correlation_mismatch', 'O resultado deve preservar item, tentativa e versão aprovada da execução.');
  }
  if (handoff.kind !== 'execution_result' || !nonBlank(handoff.reference) || !nonBlank(handoff.resultEventId)
    || handoff.reference !== attempt.handoffReference) {
    return fail('invalid_input', 'O resultado exige handoff tipado e referências não vazias.');
  }
  return {
    ok: true,
    value: {
      status: 'result_produced',
      correlation: {
        attemptId: attempt.attemptId,
        workItemId: attempt.workItemId,
        approvedProposalVersion: attempt.approvedProposalVersion,
      },
      resultCorrelation,
      handoff,
    },
  };
}

export function acceptResultForIntegration(
  boundary: IntegrationBoundary,
  input: AcceptIntegrationResultInput,
): IntegrationBoundaryResult {
  if (!validBoundary(boundary)) return fail('invalid_input', 'A fronteira de integração está ausente ou malformada.');
  const replay = boundary.acceptance;
  if (replay) {
    const same = replay.decisionId === input.decisionId
      && replay.acceptedResultEventId === input.acceptedResultEventId
      && sameCorrelation(replay.correlation, input.correlation);
    if (same) return { ok: true, value: boundary };
    if (replay.decisionId === input.decisionId) return fail('input_conflict', 'A mesma decisão de aceite foi repetida com entrada divergente.');
    return fail('invalid_transition', 'O resultado já possui uma decisão de aceite.');
  }
  if (boundary.status !== 'result_produced') return fail('result_not_produced', 'Não há resultado produzido aguardando aceite.');
  if (input.workItemState !== 'completed') return fail('result_not_accepted', 'Aceitar o resultado exige o work item concluído pela revisão explícita.');
  if (!validCorrelation(input.correlation) || input.correlation.origin !== 'user' || !sameAttempt(boundary.correlation, input.correlation)) {
    return fail('correlation_mismatch', 'O aceite deve preservar a correlação e ter origem humana.');
  }
  if (!nonBlank(input.decisionId) || input.acceptedResultEventId !== boundary.handoff.resultEventId) {
    return fail('invalid_input', 'O aceite deve apontar para o resultado exato apresentado.');
  }
  const acceptance: ResultAcceptanceRecord = {
    decisionId: input.decisionId,
    acceptedResultEventId: input.acceptedResultEventId,
    correlation: input.correlation,
  };
  return { ok: true, value: { ...boundary, status: 'result_accepted', acceptance } };
}

export function decideIntegration(boundary: IntegrationBoundary, input: DecideIntegrationInput): IntegrationBoundaryResult {
  if (!validBoundary(boundary)) return fail('invalid_input', 'A fronteira de integração está ausente ou malformada.');
  const replay = boundary.integrationDecision;
  if (replay) {
    const same = replay.decisionId === input.decisionId
      && replay.decision === input.decision
      && sameCorrelation(replay.correlation, input.correlation);
    if (same) return { ok: true, value: boundary };
    if (replay.decisionId === input.decisionId) return fail('input_conflict', 'A mesma decisão de integração foi repetida com entrada divergente.');
    return fail('invalid_transition', 'A integração já possui uma decisão explícita.');
  }
  if (boundary.status !== 'result_accepted' || !boundary.acceptance) {
    return fail('result_not_accepted', 'Integração exige resultado produzido e aceito antes da decisão.');
  }
  if (input.workItemState !== 'completed') return fail('invalid_transition', 'A decisão de integração exige o work item concluído por aceite.');
  if (!validCorrelation(input.correlation) || input.correlation.origin !== 'user' || !sameAttempt(boundary.correlation, input.correlation)) {
    return fail('correlation_mismatch', 'A decisão de integração deve preservar a correlação e ter origem humana.');
  }
  if (!nonBlank(input.decisionId) || !['authorize', 'refuse'].includes(input.decision)) {
    return fail('invalid_input', 'A decisão de integração deve ser explícita e fechada.');
  }
  const integrationDecision: IntegrationDecisionRecord = {
    decisionId: input.decisionId,
    decision: input.decision,
    correlation: input.correlation,
  };
  return {
    ok: true,
    value: {
      ...boundary,
      status: input.decision === 'authorize' ? 'integration_authorized' : 'integration_refused',
      integrationDecision,
    },
  };
}

export function recordIntegrated(boundary: IntegrationBoundary, input: RecordIntegrationInput): IntegrationBoundaryResult {
  if (!validBoundary(boundary)) return fail('invalid_input', 'A fronteira de integração está ausente ou malformada.');
  const replay = boundary.integrationRecord;
  if (replay) {
    const same = replay.recordId === input.recordId
      && replay.authorizationDecisionId === input.authorizationDecisionId
      && sameCorrelation(replay.correlation, input.correlation);
    if (same) return { ok: true, value: boundary };
    if (replay.recordId === input.recordId) return fail('input_conflict', 'O mesmo registro de integração foi repetido com entrada divergente.');
    return fail('invalid_transition', 'A integração já foi registrada.');
  }
  if (boundary.status !== 'integration_authorized' || boundary.integrationDecision?.decision !== 'authorize') {
    return fail('integration_not_authorized', 'Nenhum resultado pode ser integrado sem autorização explícita anterior.');
  }
  if (input.workItemState !== 'completed') return fail('invalid_transition', 'A integração exige o work item concluído por aceite.');
  if (!validCorrelation(input.correlation) || input.correlation.origin !== 'system' || !sameAttempt(boundary.correlation, input.correlation)) {
    return fail('correlation_mismatch', 'O registro de integração deve preservar a correlação e ter origem de sistema.');
  }
  if (!nonBlank(input.recordId) || input.authorizationDecisionId !== boundary.integrationDecision.decisionId) {
    return fail('invalid_input', 'A integração deve apontar para a autorização exata.');
  }
  const integrationRecord: IntegrationRecord = {
    recordId: input.recordId,
    authorizationDecisionId: input.authorizationDecisionId,
    correlation: input.correlation,
  };
  return { ok: true, value: { ...boundary, status: 'integrated', integrationRecord } };
}
