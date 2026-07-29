import type { WorkState } from './types';
import type { WorkHandoffV1 } from './work-handoff';

// AUTO-06 — Política fechada de interrupção humana (Marco 003).
// O domínio não oferece razão genérica: qualquer valor fora desta lista é defeito.
export const HUMAN_INTERRUPTION_REASONS = [
  'scope_change',
  'architectural_decision',
  'destructive_action',
  'sensitive_credential_required',
  'requirements_conflict',
  'permission_missing',
  'final_integration_approval',
  'persistent_inability_after_limits',
] as const;

export type HumanInterruptionReason = (typeof HUMAN_INTERRUPTION_REASONS)[number];
export type AutonomousLimitKind = 'attempts' | 'duration' | 'resources';

export interface HumanInterruptionSourceState {
  readonly workState: WorkState;
  readonly proposalVersion: number;
  readonly attemptNumber?: number;
  readonly checkpointReference?: string;
}

export interface HumanInterruptionRequest {
  readonly reason: HumanInterruptionReason;
  readonly state: HumanInterruptionSourceState;
  readonly explanation: string;
  readonly reachedLimit?: AutonomousLimitKind;
}

export interface InputRequestedPayloadV1 {
  readonly schema_version: 1;
  readonly reason: HumanInterruptionReason;
  readonly source_state: {
    readonly work_state: WorkState;
    readonly proposal_version: number;
    readonly attempt_number?: number;
    readonly checkpoint_reference?: string;
  };
  readonly explanation: string;
  readonly reached_limit?: AutonomousLimitKind;
}
export interface HumanDecisionOption {
  readonly id:string;
  readonly label:string;
  readonly effect:'resume'|'cancel';
}
// Refinamento do MESMO InputRequestedPayloadV1 para o UX-02. O pedido não
// ganha outro vocabulário: mantém razão/source_state/explicação e acrescenta
// apenas correlação, alternativas apresentadas e o handoff AUTO-05 persistido.
export interface DecisionInputRequestedPayloadV1 extends InputRequestedPayloadV1 {
  readonly attempt_id:string;
  readonly options:readonly HumanDecisionOption[];
  readonly handoff:WorkHandoffV1;
}

export type HumanInterruptionPolicyResult =
  | { readonly kind: 'interrupt'; readonly payload: InputRequestedPayloadV1 }
  | { readonly kind: 'defect'; readonly code: 'reason_not_allowed' | 'source_state_invalid' | 'explanation_missing' | 'limit_not_reached'; readonly explanation: string };

const reasons: ReadonlySet<string> = new Set(HUMAN_INTERRUPTION_REASONS);
const workStates: ReadonlySet<string> = new Set<WorkState>([
  'proposed', 'approved', 'in_progress', 'blocked', 'review', 'changes_requested',
  'completed', 'failed', 'rejected', 'cancelled',
]);
const limitKinds: ReadonlySet<string> = new Set<AutonomousLimitKind>(['attempts', 'duration', 'resources']);

const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

// Aceita unknown de propósito: fronteiras de persistência/adaptadores precisam
// detectar valores inválidos em runtime, não apenas depender do compilador.
export function evaluateHumanInterruption(request: unknown): HumanInterruptionPolicyResult {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    return { kind: 'defect', code: 'source_state_invalid', explanation: 'A interrupção precisa informar a razão e o estado que a originou.' };
  }
  const candidate = request as Partial<HumanInterruptionRequest>;
  if (typeof candidate.reason !== 'string' || !reasons.has(candidate.reason)) {
    return { kind: 'defect', code: 'reason_not_allowed', explanation: 'A razão não pertence à política fechada de interrupções humanas.' };
  }
  const state = candidate.state;
  if (!state || !workStates.has(state.workState) || !positiveInteger(state.proposalVersion)
    || (state.attemptNumber !== undefined && !positiveInteger(state.attemptNumber))
    || (state.checkpointReference !== undefined && !nonBlank(state.checkpointReference))) {
    return { kind: 'defect', code: 'source_state_invalid', explanation: 'A interrupção precisa referenciar um estado de trabalho válido e sua versão exata.' };
  }
  if (!nonBlank(candidate.explanation)) {
    return { kind: 'defect', code: 'explanation_missing', explanation: 'A interrupção precisa explicar concretamente por que a decisão humana é necessária.' };
  }
  if (candidate.reason === 'persistent_inability_after_limits'
    && (typeof candidate.reachedLimit !== 'string' || !limitKinds.has(candidate.reachedLimit))) {
    return { kind: 'defect', code: 'limit_not_reached', explanation: 'Incapacidade persistente só interrompe depois que um limite declarado é atingido.' };
  }

  const sourceState: InputRequestedPayloadV1['source_state'] = {
    work_state: state.workState,
    proposal_version: state.proposalVersion,
    ...(state.attemptNumber === undefined ? {} : { attempt_number: state.attemptNumber }),
    ...(state.checkpointReference === undefined ? {} : { checkpoint_reference: state.checkpointReference }),
  };
  return {
    kind: 'interrupt',
    payload: {
      schema_version: 1,
      reason: candidate.reason as HumanInterruptionReason,
      source_state: sourceState,
      explanation: candidate.explanation,
      ...(candidate.reason === 'persistent_inability_after_limits' ? { reached_limit: candidate.reachedLimit as AutonomousLimitKind } : {}),
    },
  };
}
