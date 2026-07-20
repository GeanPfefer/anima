import type { ProposalVersion, WorkItemId } from './types';

// AUTO-03 mínimo — uma execução comandada corresponde a uma tentativa
// consultável. Telemetria detalhada de ambiente/consumo fica para o AUTO-03
// completo; transporte e persistência definitiva ficam para INT-01/INT-02.
export type ExecutionAttemptStatus = 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'paused' | 'blocked';
export type ExecutionAttemptStopReason =
  | 'result_produced'
  | 'executor_failure'
  | 'time_limit_reached'
  | 'cancelled_by_user'
  | 'human_input_required'
  | 'dependency_unavailable';

export interface ExecutionAttemptCorrelation {
  readonly attemptId: string;
  readonly workItemId: WorkItemId;
  readonly approvedProposalVersion: ProposalVersion;
}

export interface RunningExecutionAttempt extends ExecutionAttemptCorrelation {
  readonly status: 'running';
  readonly executorId: string;
  readonly startedAt: Date;
}

export interface TerminalExecutionAttempt extends ExecutionAttemptCorrelation {
  readonly status: Exclude<ExecutionAttemptStatus, 'running'>;
  readonly executorId: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly resultSummary: string;
  readonly stopReason: ExecutionAttemptStopReason;
  readonly handoffReference: string;
}

export type ExecutionAttempt = RunningExecutionAttempt | TerminalExecutionAttempt;

export interface StartExecutionAttemptInput extends ExecutionAttemptCorrelation {
  readonly executorId: string;
  readonly startedAt: Date;
}

export interface FinishExecutionAttemptInput {
  readonly status: Exclude<ExecutionAttemptStatus, 'running'>;
  readonly finishedAt: Date;
  readonly resultSummary: string;
  readonly stopReason: ExecutionAttemptStopReason;
  readonly handoffReference: string;
}

export interface ExecutionAttemptStartedPayloadV1 {
  readonly schema_version: 1;
  readonly data: {
    readonly attempt_id: string;
    readonly work_item_id: WorkItemId;
    readonly approved_proposal_version: ProposalVersion;
    readonly executor_id: string;
    readonly started_at: string;
  };
}

export interface ExecutionAttemptFinishedPayloadV1 {
  readonly schema_version: 1;
  readonly data: {
    readonly attempt_id: string;
    readonly work_item_id: WorkItemId;
    readonly approved_proposal_version: ProposalVersion;
    readonly executor_id: string;
    readonly started_at: string;
    readonly finished_at: string;
    readonly status: Exclude<ExecutionAttemptStatus, 'running'>;
    readonly result_summary: string;
    readonly stop_reason: ExecutionAttemptStopReason;
    readonly handoff_reference: string;
  };
}

export type ExecutionAttemptPolicyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly defect: 'invalid_attempt' | 'sensitive_data' | 'attempt_already_finished' | 'invalid_transition'; readonly explanation: string };

const terminalStatuses: ReadonlySet<string> = new Set(['succeeded', 'failed', 'timed_out', 'cancelled', 'paused', 'blocked']);
const stopReasons: ReadonlySet<string> = new Set([
  'result_produced', 'executor_failure', 'time_limit_reached', 'cancelled_by_user', 'human_input_required', 'dependency_unavailable',
]);
const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
const positiveVersion = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

// Payloads de domínio não podem persistir credenciais nem caminhos absolutos.
// Referências devem ser opacas (hash/id/URI segura), não localização da máquina.
const containsSensitiveData = (value: string): boolean =>
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value)
  || /\b(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]/i.test(value)
  || /:\/\/[^\s/@:]+:[^\s/@]+@/.test(value)
  || /^[a-z]:[\\/]/i.test(value)
  || /^\/(?:home|users|root|etc|var|tmp)\//i.test(value);

export function startExecutionAttempt(input: StartExecutionAttemptInput): ExecutionAttemptPolicyResult<RunningExecutionAttempt> {
  if (!nonBlank(input.attemptId) || !nonBlank(input.workItemId) || !positiveVersion(input.approvedProposalVersion)
    || !nonBlank(input.executorId) || !validDate(input.startedAt)) {
    return { ok: false, defect: 'invalid_attempt', explanation: 'A tentativa exige identificadores, versão aprovada, executor e início válidos.' };
  }
  if (containsSensitiveData(input.executorId)) {
    return { ok: false, defect: 'sensitive_data', explanation: 'O identificador do executor contém dado sensível ou caminho local.' };
  }
  return { ok: true, value: { ...input, status: 'running' } };
}

export function finishExecutionAttempt(attempt: ExecutionAttempt, input: FinishExecutionAttemptInput): ExecutionAttemptPolicyResult<TerminalExecutionAttempt> {
  if (attempt.status !== 'running') {
    return { ok: false, defect: 'attempt_already_finished', explanation: 'Tentativa tardia ou duplicada não pode substituir um desfecho já registrado.' };
  }
  if (!terminalStatuses.has(input.status) || !validDate(input.finishedAt) || input.finishedAt.getTime() < attempt.startedAt.getTime()
    || !nonBlank(input.resultSummary) || !stopReasons.has(input.stopReason) || !nonBlank(input.handoffReference)) {
    return { ok: false, defect: 'invalid_attempt', explanation: 'O término exige estado terminal, horário, resultado, razão e handoff válidos.' };
  }
  if (containsSensitiveData(input.resultSummary) || containsSensitiveData(input.handoffReference)) {
    return { ok: false, defect: 'sensitive_data', explanation: 'Resultado e handoff não podem persistir credenciais ou caminhos absolutos locais.' };
  }
  if ((input.status === 'succeeded') !== (input.stopReason === 'result_produced')) {
    return { ok: false, defect: 'invalid_transition', explanation: 'Somente sucesso usa result_produced, e todo sucesso deve usá-lo.' };
  }
  return { ok: true, value: { ...attempt, ...input } };
}

export const buildAttemptStartedPayload = (attempt: RunningExecutionAttempt): ExecutionAttemptStartedPayloadV1 => ({
  schema_version: 1,
  data: {
    attempt_id: attempt.attemptId,
    work_item_id: attempt.workItemId,
    approved_proposal_version: attempt.approvedProposalVersion,
    executor_id: attempt.executorId,
    started_at: attempt.startedAt.toISOString(),
  },
});

export const buildAttemptFinishedPayload = (attempt: TerminalExecutionAttempt): ExecutionAttemptFinishedPayloadV1 => ({
  schema_version: 1,
  data: {
    attempt_id: attempt.attemptId,
    work_item_id: attempt.workItemId,
    approved_proposal_version: attempt.approvedProposalVersion,
    executor_id: attempt.executorId,
    started_at: attempt.startedAt.toISOString(),
    finished_at: attempt.finishedAt.toISOString(),
    status: attempt.status,
    result_summary: attempt.resultSummary,
    stop_reason: attempt.stopReason,
    handoff_reference: attempt.handoffReference,
  },
});
