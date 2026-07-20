import type { AutonomousExecutionLimits, AutonomousExecutionTarget, AutonomousValidationCriterion } from './eligibility';
import type { ExecutionAttemptCorrelation } from './execution-attempt';
import type { HumanInterruptionReason } from './human-interruption';
import type { WorkCapability, WorkContextReference, WorkResultValidation } from './types';

export interface WorkExecutorRequest extends ExecutionAttemptCorrelation {
  readonly capability: WorkCapability;
  readonly objective: string;
  readonly includedScope: readonly string[];
  readonly excludedScope: readonly string[];
  readonly target: AutonomousExecutionTarget;
  readonly permissions: readonly string[];
  readonly validationCriteria: readonly AutonomousValidationCriterion[];
  readonly limits: AutonomousExecutionLimits;
  readonly contextReferences: readonly WorkContextReference[];
}

interface CorrelatedSignal extends ExecutionAttemptCorrelation { readonly sequence: number; }
export type WorkExecutorSignal =
  | (CorrelatedSignal & { readonly kind: 'progress'; readonly message: string })
  | (CorrelatedSignal & { readonly kind: 'decision_required'; readonly reason: HumanInterruptionReason; readonly explanation: string })
  | (CorrelatedSignal & { readonly kind: 'result'; readonly summary: string; readonly resultReferences: readonly string[]; readonly validations: readonly WorkResultValidation[]; readonly limitations: readonly string[]; readonly handoffReference: string })
  | (CorrelatedSignal & { readonly kind: 'error'; readonly code: WorkExecutorErrorCode; readonly message: string; readonly retryable: boolean; readonly handoffReference: string })
  | (CorrelatedSignal & { readonly kind: 'cancelled'; readonly acknowledged: true; readonly handoffReference: string });

export type WorkExecutorErrorCode = 'invalid_request' | 'execution_failed' | 'attempt_payload_conflict' | 'contract_violation';
export type WorkExecutorSignalInput =
  | { readonly kind: 'progress'; readonly message: string }
  | { readonly kind: 'decision_required'; readonly reason: HumanInterruptionReason; readonly explanation: string }
  | { readonly kind: 'result'; readonly summary: string; readonly resultReferences: readonly string[]; readonly validations: readonly WorkResultValidation[]; readonly limitations: readonly string[]; readonly handoffReference: string }
  | { readonly kind: 'error'; readonly code: WorkExecutorErrorCode; readonly message: string; readonly retryable: boolean; readonly handoffReference: string }
  | { readonly kind: 'cancelled'; readonly acknowledged: true; readonly handoffReference: string };

export interface WorkExecutorAdapter {
  readonly id: string;
  execute(request: WorkExecutorRequest, signal: AbortSignal): AsyncIterable<WorkExecutorSignal>;
}

const terminalKinds: ReadonlySet<WorkExecutorSignal['kind']> = new Set(['decision_required', 'result', 'error', 'cancelled']);
const nonBlank = (value: string): boolean => value.trim().length > 0;
const positive = (value: number | undefined): boolean => value === undefined || (Number.isInteger(value) && value > 0);

export function validateWorkExecutorRequest(request: WorkExecutorRequest): string | null {
  if (!nonBlank(request.attemptId) || !nonBlank(request.workItemId) || !Number.isInteger(request.approvedProposalVersion) || request.approvedProposalVersion < 1) return 'Correlação da tentativa inválida.';
  if (!nonBlank(request.objective) || request.includedScope.length === 0 || request.excludedScope.length === 0 || request.includedScope.some(value => !nonBlank(value)) || request.excludedScope.some(value => !nonBlank(value))) return 'Objetivo e escopo delimitado são obrigatórios.';
  if (!nonBlank(request.target.reference) || request.validationCriteria.length === 0 || request.validationCriteria.some(value => !nonBlank(value.label))) return 'Alvo e critérios de validação são obrigatórios.';
  const { maxAttempts, maxDurationMinutes, maxResourceUnits } = request.limits;
  if (!positive(maxAttempts) || !positive(maxDurationMinutes) || !positive(maxResourceUnits) || (maxAttempts === undefined && maxDurationMinutes === undefined && maxResourceUnits === undefined)) return 'Ao menos um limite positivo é obrigatório.';
  return null;
}

export function validateWorkExecutorTranscript(signals: readonly WorkExecutorSignal[]): string | null {
  const correlation = signals[0];
  if (!correlation) return 'O executor não emitiu sinais.';
  let terminalCount = 0;
  let index = 0;
  for (const signal of signals) {
    if (signal.sequence !== index + 1) return 'A sequência de sinais não é contínua.';
    if (signal.attemptId !== correlation.attemptId || signal.workItemId !== correlation.workItemId || signal.approvedProposalVersion !== correlation.approvedProposalVersion) return 'Um sinal perdeu a correlação da tentativa.';
    if (terminalKinds.has(signal.kind)) terminalCount++;
    if (terminalCount > 0 && index < signals.length - 1) return 'Nenhum sinal pode suceder a condição terminal.';
    index++;
  }
  return terminalCount === 1 ? null : 'A execução exige exatamente uma condição terminal.';
}

const requestFingerprint = (request: WorkExecutorRequest): string => JSON.stringify(request);

export class FakeWorkExecutor implements WorkExecutorAdapter {
  readonly id = 'fake';
  private readonly completed = new Map<string, { fingerprint: string; signals: readonly WorkExecutorSignal[] }>();
  private readonly inFlight = new Map<string, { fingerprint: string; completion: Promise<readonly WorkExecutorSignal[]> }>();
  private executions = 0;

  constructor(private readonly script: readonly WorkExecutorSignalInput[]) {}
  get executionCount(): number { return this.executions; }

  async *execute(request: WorkExecutorRequest, signal: AbortSignal): AsyncIterable<WorkExecutorSignal> {
    const fingerprint = requestFingerprint(request);
    const previous = this.completed.get(request.attemptId);
    if (previous) {
      if (previous.fingerprint === fingerprint) { yield* previous.signals; return; }
      yield this.attach(request, 1, { kind: 'error', code: 'attempt_payload_conflict', message: 'A tentativa foi reentregue com entrada diferente.', retryable: false, handoffReference: 'checkpoint:attempt-conflict' });
      return;
    }
    const pending = this.inFlight.get(request.attemptId);
    if (pending) {
      if (pending.fingerprint === fingerprint) { yield* await pending.completion; return; }
      yield this.attach(request, 1, { kind: 'error', code: 'attempt_payload_conflict', message: 'A tentativa em andamento recebeu entrada diferente.', retryable: false, handoffReference: 'checkpoint:attempt-conflict' });
      return;
    }
    let finishInFlight!: (signals: readonly WorkExecutorSignal[]) => void;
    const completion = new Promise<readonly WorkExecutorSignal[]>(resolve => { finishInFlight = resolve; });
    this.inFlight.set(request.attemptId, { fingerprint, completion });
    this.executions++;
    const invalid = validateWorkExecutorRequest(request);
    if (invalid) {
      const failure = this.attach(request, 1, { kind: 'error', code: 'invalid_request', message: invalid, retryable: false, handoffReference: 'checkpoint:invalid-request' });
      this.completed.set(request.attemptId, { fingerprint, signals: [failure] });
      this.inFlight.delete(request.attemptId);
      finishInFlight([failure]);
      yield failure;
      return;
    }
    const produced: WorkExecutorSignal[] = [];
    for (const entry of this.script) {
      const next = signal.aborted
        ? this.attach(request, produced.length + 1, { kind: 'cancelled', acknowledged: true, handoffReference: 'checkpoint:cancelled' })
        : this.attach(request, produced.length + 1, entry);
      produced.push(next);
      yield next;
      if (terminalKinds.has(next.kind)) break;
    }
    if (!produced.some(item => terminalKinds.has(item.kind))) {
      const terminal = this.attach(request, produced.length + 1, { kind: 'error', code: 'contract_violation', message: 'Executor terminou sem condição terminal.', retryable: false, handoffReference: 'checkpoint:contract-violation' });
      produced.push(terminal);
      yield terminal;
    }
    this.completed.set(request.attemptId, { fingerprint, signals: produced });
    this.inFlight.delete(request.attemptId);
    finishInFlight(produced);
  }

  private attach(request: WorkExecutorRequest, sequence: number, input: WorkExecutorSignalInput): WorkExecutorSignal {
    return { attemptId: request.attemptId, workItemId: request.workItemId, approvedProposalVersion: request.approvedProposalVersion, sequence, ...input } as WorkExecutorSignal;
  }
}
