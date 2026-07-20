import type { ExecutionAttemptCorrelation } from './execution-attempt';
import type { WorkExecutorSignal } from './work-executor-contract';

export const EXECUTION_EVENT_ORIGINS = ['anima', 'executor', 'user', 'system'] as const;
export type ExecutionEventOrigin = typeof EXECUTION_EVENT_ORIGINS[number];

export interface ExecutionEventCorrelation extends ExecutionAttemptCorrelation {
  readonly origin: ExecutionEventOrigin;
}

export interface CorrelatedExecutionEvent extends ExecutionEventCorrelation {
  readonly eventId: string;
  readonly sequence: number;
  readonly signal: WorkExecutorSignal;
}

export interface ExecutionTimeline {
  readonly attempt: ExecutionAttemptCorrelation;
  readonly events: readonly CorrelatedExecutionEvent[];
}

export type ExecutionTimelineDefect =
  | 'invalid_attempt_context'
  | 'invalid_correlation'
  | 'correlation_mismatch'
  | 'duplicate_event'
  | 'invalid_sequence'
  | 'late_event';

export type ExecutionTimelineResult =
  | { readonly ok: true; readonly timelines: readonly ExecutionTimeline[] }
  | { readonly ok: false; readonly defect: ExecutionTimelineDefect; readonly explanation: string };

const terminalKinds: ReadonlySet<WorkExecutorSignal['kind']> = new Set(['decision_required', 'result', 'error', 'cancelled']);
const signalKinds: ReadonlySet<string> = new Set(['progress', 'decision_required', 'result', 'error', 'cancelled']);
const origins: ReadonlySet<string> = new Set(EXECUTION_EVENT_ORIGINS);
const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;
const object = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
const attemptKey = (value: ExecutionAttemptCorrelation): string => `${value.workItemId}\u0000${value.approvedProposalVersion}\u0000${value.attemptId}`;

function validAttempt(value: unknown): value is ExecutionAttemptCorrelation {
  const candidate = object(value);
  return candidate !== null
    && nonBlank(candidate.attemptId)
    && nonBlank(candidate.workItemId)
    && positiveInteger(candidate.approvedProposalVersion);
}

function validEvent(value: unknown): value is CorrelatedExecutionEvent {
  const candidate = object(value);
  const signal = object(candidate?.signal);
  return candidate !== null
    && nonBlank(candidate.eventId)
    && validAttempt(candidate)
    && typeof candidate.origin === 'string'
    && origins.has(candidate.origin)
    && positiveInteger(candidate.sequence)
    && signal !== null
    && typeof signal.kind === 'string'
    && signalKinds.has(signal.kind)
    && signal.attemptId === candidate.attemptId
    && signal.workItemId === candidate.workItemId
    && signal.approvedProposalVersion === candidate.approvedProposalVersion
    && signal.origin === candidate.origin
    && signal.sequence === candidate.sequence;
}

export function reconstructExecutionTimelines(
  persistedAttempts: readonly unknown[],
  persistedEvents: readonly unknown[],
): ExecutionTimelineResult {
  const attempts = new Map<string, ExecutionAttemptCorrelation>();
  const attemptIds = new Map<string, string>();
  for (const candidate of persistedAttempts) {
    if (!validAttempt(candidate)) {
      return { ok: false, defect: 'invalid_attempt_context', explanation: 'O contexto persistido da tentativa é inválido.' };
    }
    const key = attemptKey(candidate);
    const previousKey = attemptIds.get(candidate.attemptId);
    if ((previousKey && previousKey !== key) || attempts.has(key)) {
      return { ok: false, defect: 'invalid_attempt_context', explanation: 'A tentativa possui contexto persistido ambíguo ou duplicado.' };
    }
    attempts.set(key, candidate);
    attemptIds.set(candidate.attemptId, key);
  }

  const grouped = new Map<string, CorrelatedExecutionEvent[]>();
  const eventIds = new Set<string>();
  for (const candidate of persistedEvents) {
    if (!validEvent(candidate)) {
      return { ok: false, defect: 'invalid_correlation', explanation: 'O evento exige item, tentativa, versão aprovada, origem e sequência válidos e coerentes com o sinal.' };
    }
    if (eventIds.has(candidate.eventId)) {
      return { ok: false, defect: 'duplicate_event', explanation: 'O mesmo evento foi entregue mais de uma vez.' };
    }
    eventIds.add(candidate.eventId);
    const key = attemptKey(candidate);
    if (attemptIds.get(candidate.attemptId) !== key || !attempts.has(key)) {
      return { ok: false, defect: 'correlation_mismatch', explanation: 'A correlação declarada diverge do contexto persistido da tentativa.' };
    }
    const events = grouped.get(key) ?? [];
    events.push(candidate);
    grouped.set(key, events);
  }

  const timelines: ExecutionTimeline[] = [];
  for (const key of [...grouped.keys()].sort()) {
    const attempt = attempts.get(key);
    if (!attempt) {
      return { ok: false, defect: 'correlation_mismatch', explanation: 'A tentativa correlacionada não possui contexto persistido.' };
    }
    const events = [...(grouped.get(key) ?? [])].sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId));
    let terminalSeen = false;
    let expectedSequence = 1;
    for (const event of events) {
      if (event.sequence !== expectedSequence) {
        return { ok: false, defect: 'invalid_sequence', explanation: 'A linha do tempo exige sequência canônica contínua e sem ambiguidades.' };
      }
      if (terminalSeen) {
        return { ok: false, defect: 'late_event', explanation: 'Evento tardio ou terminal duplicado não pode suceder o desfecho da tentativa.' };
      }
      terminalSeen = terminalKinds.has(event.signal.kind);
      expectedSequence++;
    }
    timelines.push({ attempt, events });
  }
  return { ok: true, timelines };
}
