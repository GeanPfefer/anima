// INTEL-04 — orçamento V0 de execução autônoma (referência de valores V0).
//
// O V0 mede somente tentativas e tempo. Tokens e dinheiro permanecem fora do
// contrato até existir telemetria confiável para essas unidades.
//
// AUTORIDADE VIVA: a decisão de admissão em produção é a RPC SQL
// `private.autonomous_work_budget_decision` (migration
// `20260821000002_local_vs_external_work_budget.sql`, policyVersion
// `autonomous-work-budget-v2-local-external`), que é **consciente de custo**: as
// quotas globais (`user_attempt`/`user_runtime`) contam e se aplicam SÓ a execução
// EXTERNA (coder_backend externo). `evaluateWorkBudgetAdmission` abaixo é a
// referência V0 (não consciente de custo) usada por seus próprios testes; NÃO é o
// caminho vivo. Ao evoluir a régua, o SQL é a fonte da verdade.
export const DEFAULT_AUTONOMOUS_WORK_BUDGET_V1 = {
  schemaVersion: 1,
  policyVersion: 'autonomous-work-budget-v1',
  itemAttempts24Hours: 3,
  userAttempts24Hours: 6,
  userRuntimeSeconds24Hours: 120 * 60,
  autonomousRuntimeSeconds60Minutes: 45 * 60,
  interactiveReserveSeconds60Minutes: 15 * 60,
} as const;

export type WorkBudgetReason =
  | 'item_attempt_budget_exhausted'
  | 'user_attempt_budget_exhausted'
  | 'user_runtime_budget_exhausted'
  | 'interactive_reserve_protected';

export interface WorkBudgetUsageV1 {
  readonly schemaVersion: 1;
  readonly itemAttempts24Hours: number;
  readonly userAttempts24Hours: number;
  readonly userRuntimeSeconds24Hours: number;
  readonly autonomousRuntimeSeconds60Minutes: number;
}
export interface WorkBudgetAdmissionInput {
  readonly usage: WorkBudgetUsageV1;
  readonly declaredMaxAttempts?: number;
}

export type WorkBudgetAdmission =
  | {
      readonly outcome: 'admitted';
      readonly effectiveItemAttemptLimit: number;
      readonly remainingUserAttempts: number;
      readonly remainingRuntimeSeconds24Hours: number;
      readonly remainingAutonomousRuntimeSeconds60Minutes: number;
      readonly maxRuntimeSeconds: number;
    }
  | {
      readonly outcome: 'interrupted';
      readonly reason: WorkBudgetReason;
      readonly reachedLimit: 'attempts' | 'duration' | 'resources';
      readonly explanation: string;
    };

const nonNegativeInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 0;

const interrupted = (
  reason: WorkBudgetReason,
  reachedLimit: 'attempts' | 'duration' | 'resources',
  explanation: string,
): WorkBudgetAdmission => ({ outcome: 'interrupted', reason, reachedLimit, explanation });

export function evaluateWorkBudgetAdmission(input: WorkBudgetAdmissionInput): WorkBudgetAdmission {
  const { usage, declaredMaxAttempts } = input;
  if (usage.schemaVersion !== 1
    || !nonNegativeInteger(usage.itemAttempts24Hours)
    || !nonNegativeInteger(usage.userAttempts24Hours)
    || !nonNegativeInteger(usage.userRuntimeSeconds24Hours)
    || !nonNegativeInteger(usage.autonomousRuntimeSeconds60Minutes)
    || (declaredMaxAttempts !== undefined
      && (!Number.isInteger(declaredMaxAttempts) || declaredMaxAttempts < 1))) {
    throw new Error('invalid work budget usage');
  }

  const policy = DEFAULT_AUTONOMOUS_WORK_BUDGET_V1;
  const effectiveItemAttemptLimit = Math.min(
    policy.itemAttempts24Hours,
    declaredMaxAttempts ?? policy.itemAttempts24Hours,
  );
  if (usage.itemAttempts24Hours >= effectiveItemAttemptLimit) {
    return interrupted(
      'item_attempt_budget_exhausted',
      'attempts',
      `O item atingiu o limite de ${effectiveItemAttemptLimit} tentativa(s) autônoma(s) em 24 horas.`,
    );
  }
  if (usage.userAttempts24Hours >= policy.userAttempts24Hours) {
    return interrupted(
      'user_attempt_budget_exhausted',
      'attempts',
      `O usuário atingiu o limite global de ${policy.userAttempts24Hours} tentativas autônomas em 24 horas.`,
    );
  }

  const remainingRuntimeSeconds24Hours =
    Math.max(0, policy.userRuntimeSeconds24Hours - usage.userRuntimeSeconds24Hours);
  if (remainingRuntimeSeconds24Hours === 0) {
    return interrupted(
      'user_runtime_budget_exhausted',
      'duration',
      'O modo autônomo consumiu as 120 minutos permitidos nas últimas 24 horas.',
    );
  }

  const remainingAutonomousRuntimeSeconds60Minutes = Math.max(
    0,
    policy.autonomousRuntimeSeconds60Minutes - usage.autonomousRuntimeSeconds60Minutes,
  );
  if (remainingAutonomousRuntimeSeconds60Minutes === 0) {
    return interrupted(
      'interactive_reserve_protected',
      'resources',
      'A execução autônoma parou para preservar 15 minutos da janela atual para uso interativo.',
    );
  }

  return {
    outcome: 'admitted',
    effectiveItemAttemptLimit,
    remainingUserAttempts: policy.userAttempts24Hours - usage.userAttempts24Hours,
    remainingRuntimeSeconds24Hours,
    remainingAutonomousRuntimeSeconds60Minutes,
    maxRuntimeSeconds: Math.min(
      remainingRuntimeSeconds24Hours,
      remainingAutonomousRuntimeSeconds60Minutes,
    ),
  };
}
