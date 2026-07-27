import type { AutonomousExecutionLimits, AutonomousExecutionTarget, AutonomousValidationCriterion } from './eligibility';
import { containsSensitiveData, type ExecutionAttemptCorrelation } from './execution-attempt';
import type { ExecutionEventCorrelation } from './execution-event-correlation';
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
  /** Contexto informativo de uma tentativa anterior; nunca amplia permissões. */
  readonly carriedContext?: {
    readonly isNewAttempt: true;
    readonly continueFromCheckpoint: true;
    readonly remainingSteps: readonly string[];
    readonly nextStep: string;
    readonly risks: readonly string[];
    readonly touchedResources: readonly string[];
    readonly previousFailures: readonly string[];
  };
}

// WorkCheckpointV1 — AUTO-04/AUTO-05: snapshot estruturado de uma tentativa
// AINDA EM ANDAMENTO, suficiente para persistir a continuação (o futuro evento
// `checkpoint_recorded`, Opção B) sem afirmar desfecho algum.
//
// Diferente do handoff estruturado do término (AUTO-04), o checkpoint é
// mid-flight e por isso NÃO carrega `status` nem `stopReason`: ambos são fatos
// terminais, e inventá-los aqui seria afirmar um desfecho que não ocorreu.
// `planWorkResumption` (AUTO-05) lê apenas o subconjunto de continuação
// (`remainingSteps`, `nextStep`, `risks`, `touchedResources`, falhas) mais a
// correlação; o servidor projeta o último checkpoint para a forma
// `WorkHandoffV1` que o AUTO-05 espera, derivando `status`/`stopReason` do
// contexto real da interrupção — sem tocar o contrato puro do AUTO-05.
//
// A correlação (item, tentativa, versão aprovada, origem, sequência) é herdada
// do sinal que o carrega; `claimId` NÃO entra no payload — ele vive no servidor
// (a posse), e a futura RPC persistente o anexa, como `begin_work_attempt` já
// faz. O executor não conhece o claim.
//
// Semântica de checkpoints sucessivos — aprovada, pertencente à FUTURA RPC
// persistente `record_work_checkpoint`, e deliberadamente NÃO implementada aqui
// (nem no executor nem no validador de transcrição), porque exige o estado
// persistido que só o banco tem:
//
//   * `sequence` menor que a última persistida  → recusa por regressão;
//   * mesma `sequence`, conteúdo idêntico        → replay idempotente;
//   * mesma `sequence`, conteúdo diferente       → conflito, falha fechada;
//   * `sequence` maior                           → novo checkpoint.
//
// A `sequence` é a mesma da transcrição inteira do INT-01 (não só dos
// checkpoints), e sua monotonicidade é a chave anti-regressão — sem relógio.
export interface WorkCheckpointV1 {
  readonly schemaVersion: 1;
  readonly handoffReference: string;
  readonly completedSteps: readonly string[];
  readonly remainingSteps: readonly string[];
  readonly nextStep: string;
  readonly decisions: readonly string[];
  readonly risks: readonly string[];
  readonly touchedResources: readonly string[];
  readonly validations: readonly WorkResultValidation[];
  readonly failures: readonly string[];
  readonly evidenceReferences: readonly string[];
}

interface CorrelatedSignal extends ExecutionEventCorrelation { readonly sequence: number; }
// `progress` e `checkpoint` são os dois sinais NÃO-terminais. `checkpoint` é o
// único que carrega continuação estruturada retomável antes do terminal único.
export type WorkExecutorSignal =
  | (CorrelatedSignal & { readonly kind: 'progress'; readonly message: string })
  | (CorrelatedSignal & { readonly kind: 'checkpoint'; readonly checkpoint: WorkCheckpointV1 })
  | (CorrelatedSignal & { readonly kind: 'decision_required'; readonly reason: HumanInterruptionReason; readonly explanation: string })
  | (CorrelatedSignal & { readonly kind: 'result'; readonly summary: string; readonly resultReferences: readonly string[]; readonly validations: readonly WorkResultValidation[]; readonly limitations: readonly string[]; readonly handoffReference: string })
  | (CorrelatedSignal & { readonly kind: 'error'; readonly code: WorkExecutorErrorCode; readonly message: string; readonly retryable: boolean; readonly handoffReference: string })
  | (CorrelatedSignal & { readonly kind: 'cancelled'; readonly acknowledged: true; readonly handoffReference: string });

export type WorkExecutorErrorCode = 'invalid_request' | 'execution_failed' | 'attempt_payload_conflict' | 'contract_violation';
export type WorkExecutorSignalInput =
  | { readonly kind: 'progress'; readonly message: string }
  | { readonly kind: 'checkpoint'; readonly checkpoint: WorkCheckpointV1 }
  | { readonly kind: 'decision_required'; readonly reason: HumanInterruptionReason; readonly explanation: string }
  | { readonly kind: 'result'; readonly summary: string; readonly resultReferences: readonly string[]; readonly validations: readonly WorkResultValidation[]; readonly limitations: readonly string[]; readonly handoffReference: string }
  | { readonly kind: 'error'; readonly code: WorkExecutorErrorCode; readonly message: string; readonly retryable: boolean; readonly handoffReference: string }
  | { readonly kind: 'cancelled'; readonly acknowledged: true; readonly handoffReference: string };

export interface WorkExecutorAdapter {
  readonly id: string;
  execute(request: WorkExecutorRequest, signal: AbortSignal): AsyncIterable<WorkExecutorSignal>;
}

// `checkpoint` e `progress` são deliberadamente NÃO-terminais: não entram aqui,
// então `validateWorkExecutorTranscript` os aceita como qualquer sinal
// intermediário, sem special-case e sem alteração.
const terminalKinds: ReadonlySet<WorkExecutorSignal['kind']> = new Set(['decision_required', 'result', 'error', 'cancelled']);
const nonBlank = (value: string): boolean => value.trim().length > 0;
const positive = (value: number | undefined): boolean => value === undefined || (Number.isInteger(value) && value > 0);

const isStructuredList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(entry => typeof entry === 'string' && entry.trim().length > 0);
const checkpointValidationOutcomes: ReadonlySet<string> = new Set(['passed', 'failed', 'declared']);
const areCheckpointValidations = (value: unknown): value is readonly WorkResultValidation[] =>
  Array.isArray(value) && value.every(entry =>
    typeof entry === 'object' && entry !== null
    && typeof (entry as WorkResultValidation).label === 'string' && (entry as WorkResultValidation).label.trim().length > 0
    && checkpointValidationOutcomes.has((entry as WorkResultValidation).outcome));

export function validateWorkExecutorRequest(request: WorkExecutorRequest): string | null {
  if (!nonBlank(request.attemptId) || !nonBlank(request.workItemId) || !Number.isInteger(request.approvedProposalVersion) || request.approvedProposalVersion < 1) return 'Correlação da tentativa inválida.';
  if (!nonBlank(request.objective) || request.includedScope.length === 0 || request.excludedScope.length === 0 || request.includedScope.some(value => !nonBlank(value)) || request.excludedScope.some(value => !nonBlank(value))) return 'Objetivo e escopo delimitado são obrigatórios.';
  if (!nonBlank(request.target.reference) || request.validationCriteria.length === 0 || request.validationCriteria.some(value => !nonBlank(value.label))) return 'Alvo e critérios de validação são obrigatórios.';
  const { maxAttempts, maxDurationMinutes, maxResourceUnits } = request.limits;
  if (!positive(maxAttempts) || !positive(maxDurationMinutes) || !positive(maxResourceUnits) || (maxAttempts === undefined && maxDurationMinutes === undefined && maxResourceUnits === undefined)) return 'Ao menos um limite positivo é obrigatório.';
  return null;
}

/**
 * Régua estrutural, fail-closed, do payload de um `checkpoint` mid-flight.
 *
 * Espelha a validação de `buildWorkHandoff` (AUTO-04) — listas estruturadas sem
 * entradas em branco, `nextStep` e `handoffReference` concretos, ao menos um
 * passo entre feito/restante — e REUTILIZA a régua única de sanitização
 * (`containsSensitiveData`), sem inventar uma segunda política. Devolve a razão
 * da recusa, ou `null` quando o checkpoint é aceitável.
 *
 * Não valida sequência, correlação nem posição na transcrição: isso é do
 * `validateWorkExecutorTranscript`. Não persiste nada: a idempotência por
 * sequência pertence à futura RPC, como documentado em `WorkCheckpointV1`.
 */
export function validateWorkCheckpoint(checkpoint: WorkCheckpointV1): string | null {
  if (checkpoint.schemaVersion !== 1) return 'Versão de checkpoint não suportada.';
  if (!nonBlank(checkpoint.handoffReference)) return 'O checkpoint precisa referenciar um handoff/bundle não vazio.';
  if (!nonBlank(checkpoint.nextStep)) return 'O checkpoint precisa recomendar um próximo passo concreto para quem retomar.';
  if (!isStructuredList(checkpoint.completedSteps) || !isStructuredList(checkpoint.remainingSteps)
    || !isStructuredList(checkpoint.decisions) || !isStructuredList(checkpoint.risks)
    || !isStructuredList(checkpoint.touchedResources) || !isStructuredList(checkpoint.failures)
    || !isStructuredList(checkpoint.evidenceReferences) || !areCheckpointValidations(checkpoint.validations)) {
    return 'Cada seção do checkpoint precisa ser uma lista estruturada sem entradas vazias.';
  }
  if (checkpoint.completedSteps.length === 0 && checkpoint.remainingSteps.length === 0) {
    return 'Um checkpoint que não diz o que foi feito nem o que resta não permite retomada.';
  }
  const sensitiveCandidates = [
    checkpoint.handoffReference, checkpoint.nextStep,
    ...checkpoint.completedSteps, ...checkpoint.remainingSteps, ...checkpoint.decisions, ...checkpoint.risks,
    ...checkpoint.touchedResources, ...checkpoint.failures, ...checkpoint.evidenceReferences,
    ...checkpoint.validations.map(entry => entry.label),
  ];
  if (sensitiveCandidates.some(containsSensitiveData)) {
    return 'O checkpoint não pode carregar credenciais nem caminhos absolutos locais.';
  }
  return null;
}

export function validateWorkExecutorTranscript(signals: readonly WorkExecutorSignal[]): string | null {
  const correlation = signals[0];
  if (!correlation) return 'O executor não emitiu sinais.';
  let terminalCount = 0;
  let index = 0;
  for (const signal of signals) {
    if (signal.sequence !== index + 1) return 'A sequência de sinais não é contínua.';
    if (signal.attemptId !== correlation.attemptId || signal.workItemId !== correlation.workItemId || signal.approvedProposalVersion !== correlation.approvedProposalVersion || signal.origin !== 'executor') return 'Um sinal perdeu a correlação da tentativa.';
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
    return { attemptId: request.attemptId, workItemId: request.workItemId, approvedProposalVersion: request.approvedProposalVersion, origin: 'executor', sequence, ...input } as WorkExecutorSignal;
  }
}
