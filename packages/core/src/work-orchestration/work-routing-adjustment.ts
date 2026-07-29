import type { WorkEffortLevel } from './work-routing';

export const routingAttemptOutcomes = [
  'result_submitted',
  'execution_failed',
  'work_cancelled',
  'attempt_abandoned',
] as const;

export type RoutingAttemptOutcome = typeof routingAttemptOutcomes[number];
export type WorkRoutingAdjustmentKind = 'none' | 'escalated' | 'reduced';

export interface RoutingAttemptHistoryEntryV1 {
  readonly attemptId: string;
  readonly outcome: RoutingAttemptOutcome;
  readonly selectedEffort: WorkEffortLevel;
  readonly adjustment: WorkRoutingAdjustmentKind;
}

export interface WorkRoutingAdjustmentContextV1 {
  readonly schemaVersion: 1;
  readonly attempts: readonly RoutingAttemptHistoryEntryV1[];
  readonly latestCheckpoint: {
    readonly attemptId: string;
    readonly nextStep: string;
    readonly remainingSteps: readonly string[];
    readonly failures: readonly string[];
  } | null;
}

export interface WorkRoutingAdjustmentV1 {
  readonly schemaVersion: 1;
  readonly policyVersion: 'work-routing-adjustment-v1';
  readonly kind: WorkRoutingAdjustmentKind;
  readonly baselineEffort: WorkEffortLevel;
  readonly effectiveEffort: WorkEffortLevel;
  readonly consecutiveFailures: number;
  readonly evidenceAttemptIds: readonly string[];
  readonly reason:
    | 'baseline_sufficient'
    | 'two_consecutive_failures'
    | 'consolidated_checkpoint_after_escalation'
    | 'already_at_strong';
}

const rank: Readonly<Record<WorkEffortLevel, number>> = { light: 0, standard: 1, strong: 2 };
const effortAt = (value: number): WorkEffortLevel =>
  value <= 0 ? 'light' : value === 1 ? 'standard' : 'strong';

const isFailure = (outcome: RoutingAttemptOutcome): boolean =>
  outcome === 'execution_failed' || outcome === 'attempt_abandoned';

export function planWorkRoutingAdjustment(input: {
  readonly baselineEffort: WorkEffortLevel;
  readonly context: WorkRoutingAdjustmentContextV1;
}): WorkRoutingAdjustmentV1 {
  const reversed = [...input.context.attempts].reverse();
  const failures: RoutingAttemptHistoryEntryV1[] = [];
  for (const attempt of reversed) {
    if (!isFailure(attempt.outcome)) break;
    failures.push(attempt);
  }

  const previous = reversed[0];
  const checkpoint = input.context.latestCheckpoint;
  const consolidated = previous?.adjustment === 'escalated'
    && checkpoint?.attemptId === previous.attemptId
    && checkpoint.nextStep.trim().length > 0
    && checkpoint.remainingSteps.length > 0
    && checkpoint.failures.length === 0;

  if (consolidated) {
    return {
      schemaVersion: 1,
      policyVersion: 'work-routing-adjustment-v1',
      kind: 'reduced',
      baselineEffort: input.baselineEffort,
      effectiveEffort: input.baselineEffort,
      consecutiveFailures: failures.length,
      evidenceAttemptIds: [previous.attemptId],
      reason: 'consolidated_checkpoint_after_escalation',
    };
  }

  if (failures.length >= 2) {
    const effectiveEffort = effortAt(rank[input.baselineEffort] + 1);
    return {
      schemaVersion: 1,
      policyVersion: 'work-routing-adjustment-v1',
      kind: effectiveEffort === input.baselineEffort ? 'none' : 'escalated',
      baselineEffort: input.baselineEffort,
      effectiveEffort,
      consecutiveFailures: failures.length,
      evidenceAttemptIds: failures.map(attempt => attempt.attemptId),
      reason: effectiveEffort === input.baselineEffort ? 'already_at_strong' : 'two_consecutive_failures',
    };
  }

  return {
    schemaVersion: 1,
    policyVersion: 'work-routing-adjustment-v1',
    kind: 'none',
    baselineEffort: input.baselineEffort,
    effectiveEffort: input.baselineEffort,
    consecutiveFailures: failures.length,
    evidenceAttemptIds: failures.map(attempt => attempt.attemptId),
    reason: 'baseline_sufficient',
  };
}
