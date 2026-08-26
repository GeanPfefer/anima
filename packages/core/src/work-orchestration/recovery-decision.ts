export type RecoveryFailureKind =
  | 'code_failure'
  | 'environment_failure'
  | 'model_capability_limit'
  | 'context_limit'
  | 'resource_pressure'
  | 'gate_failure'
  | 'timeout'
  | 'no_progress'
  | 'external_unavailable'
  | 'contract_violation'
  | 'unknown';

export type RecoveryAction = 'retry' | 'decompose' | 'environment_wait' | 'human_required';

export interface RecoveryFailureEvidence {
  readonly code?: string | null;
  /** Mensagem já sanitizada e limitada pelo host. Nunca log/output bruto do executor. */
  readonly safeMessage?: string | null;
  readonly retryable: boolean;
  readonly attemptsUsed: number;
  readonly maxAttempts: number;
  readonly repeatedSameFailure: boolean;
}

export interface RecoveryDecision {
  readonly failureKind: RecoveryFailureKind;
  readonly normalizedCode: string | null;
  readonly action: RecoveryAction;
  readonly reason:
    | 'transient_retry_within_budget'
    | 'task_should_be_decomposed'
    | 'environment_must_change'
    | 'resource_capacity_unavailable'
    | 'external_dependency_unavailable'
    | 'contract_or_authority_review_required'
    | 'failure_not_classified';
}

const KNOWN_CODES = new Set([
  'code_failure', 'execution_failed', 'gate_failed',
  'worktree_create_failed', 'environment_unavailable',
  'ollama_read_round_limit', 'context_limit', 'context_window_exceeded',
  'resource_pressure', 'insufficient_memory', 'insufficient_vram',
  'ollama_timeout', 'runner_timeout', 'provider_timeout',
  'no_progress', 'loop_detected',
  'provider_unavailable', 'external_unavailable',
  'invalid_request', 'contract_violation', 'attempt_payload_conflict',
] as const);

const normalize = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const candidate = value.trim().toLowerCase();
  return KNOWN_CODES.has(candidate as never) ? candidate : null;
};

/**
 * Compatibilidade estreita com a evidência hoje persistida pelo executor: o host
 * sanitiza a mensagem e alguns backends preservam o código como `[code]`. Só um
 * token allowlisted é aceito; prosa nunca ganha autoridade classificatória.
 */
export function recoveryFailureCode(evidence: Pick<RecoveryFailureEvidence, 'code' | 'safeMessage'>): string | null {
  const direct = normalize(evidence.code);
  if (direct && direct !== 'execution_failed') return direct;
  const bracketed = evidence.safeMessage?.match(/\[([a-z0-9_]{3,64})\]/i)?.[1];
  // `execution_failed` é envelope de transporte, não causa. Sem um código
  // allowlisted adicional, não concede retry nem outra ação automática.
  return normalize(bracketed);
}

const kindFor = (code: string | null): RecoveryFailureKind => {
  switch (code) {
    case 'code_failure': case 'execution_failed': return 'code_failure';
    case 'worktree_create_failed': case 'environment_unavailable': return 'environment_failure';
    case 'ollama_read_round_limit': return 'model_capability_limit';
    case 'context_limit': case 'context_window_exceeded': return 'context_limit';
    case 'resource_pressure': case 'insufficient_memory': case 'insufficient_vram': return 'resource_pressure';
    case 'gate_failed': return 'gate_failure';
    case 'ollama_timeout': case 'runner_timeout': case 'provider_timeout': return 'timeout';
    case 'no_progress': case 'loop_detected': return 'no_progress';
    case 'provider_unavailable': case 'external_unavailable': return 'external_unavailable';
    case 'invalid_request': case 'contract_violation': case 'attempt_payload_conflict': return 'contract_violation';
    default: return 'unknown';
  }
};

/** Política pura e fail-closed. Não cria successor, approval, claim ou attempt. */
export function decideRecovery(evidence: RecoveryFailureEvidence): RecoveryDecision {
  const normalizedCode = recoveryFailureCode(evidence);
  const failureKind = kindFor(normalizedCode);
  const budgetAvailable = Number.isInteger(evidence.attemptsUsed)
    && Number.isInteger(evidence.maxAttempts)
    && evidence.attemptsUsed >= 0
    && evidence.maxAttempts > evidence.attemptsUsed;

  if (failureKind === 'contract_violation') {
    return { failureKind, normalizedCode, action: 'human_required', reason: 'contract_or_authority_review_required' };
  }
  if (failureKind === 'model_capability_limit' || failureKind === 'context_limit' || failureKind === 'no_progress') {
    return { failureKind, normalizedCode, action: 'decompose', reason: 'task_should_be_decomposed' };
  }
  if (failureKind === 'resource_pressure') {
    return { failureKind, normalizedCode, action: 'environment_wait', reason: 'resource_capacity_unavailable' };
  }
  if (failureKind === 'environment_failure' || failureKind === 'timeout') {
    if (evidence.retryable && budgetAvailable && !evidence.repeatedSameFailure) {
      return { failureKind, normalizedCode, action: 'retry', reason: 'transient_retry_within_budget' };
    }
    return { failureKind, normalizedCode, action: 'environment_wait', reason: 'environment_must_change' };
  }
  if (failureKind === 'external_unavailable') {
    if (evidence.retryable && budgetAvailable && !evidence.repeatedSameFailure) {
      return { failureKind, normalizedCode, action: 'retry', reason: 'transient_retry_within_budget' };
    }
    return { failureKind, normalizedCode, action: 'environment_wait', reason: 'external_dependency_unavailable' };
  }
  if ((failureKind === 'code_failure' || failureKind === 'gate_failure')
      && evidence.retryable && budgetAvailable && !evidence.repeatedSameFailure) {
    return { failureKind, normalizedCode, action: 'retry', reason: 'transient_retry_within_budget' };
  }
  if ((failureKind === 'code_failure' || failureKind === 'gate_failure') && evidence.repeatedSameFailure) {
    return { failureKind, normalizedCode, action: 'decompose', reason: 'task_should_be_decomposed' };
  }
  return { failureKind, normalizedCode, action: 'human_required', reason: 'failure_not_classified' };
}
