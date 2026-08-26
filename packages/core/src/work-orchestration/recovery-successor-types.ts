import type { RecoveryDecision } from './recovery-decision';

/** Forma mínima compartilhada entre a projeção da aplicação e a validação do successor. */
export interface WorkRecoveryAssessment {
  readonly workItemId: string;
  readonly proposalVersion: number;
  readonly failureEventId: string;
  readonly sourceAttemptId: string;
  readonly attemptsUsed: number;
  readonly maxAttempts: number;
  readonly decision: RecoveryDecision;
}

