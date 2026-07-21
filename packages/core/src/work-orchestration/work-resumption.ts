import { evaluateAutonomousEligibility } from './eligibility';
import type { AutonomousLimitKind, HumanInterruptionReason } from './human-interruption';
import type { ProposalVersion, WorkItem, WorkItemId } from './types';
import { deriveWorkClaimStatus, type WorkClaim, type WorkClaimId } from './work-claim';
import type { WorkHandoffV1 } from './work-handoff';

// AUTO-05 — Pausa e retomada (Marco 003 §Pausa e retomada).
//
// Retomar é eleger o último checkpoint válido somado às evidências persistidas
// e continuar dali com **novo claim e nova tentativa**. Nunca é confiar no
// contexto conversacional anterior de um executor: tudo o que atravessa a
// interrupção precisa ter sido escrito antes dela.
//
// A retomada automática sem supervisor pertence ao SUP-04. Aqui ficam as
// regras puras: quando é seguro retomar, a partir de quê, e o que é levado.

// Lista fechada dos cenários nomeados no Marco 003. Não existe "outro":
// interrupção fora desta lista é defeito, como na política do AUTO-06.
export const INTERRUPTION_SCENARIOS = [
  'provider_limit_reached',
  'application_shutdown',
  'machine_restart',
  'container_runtime_unavailable',
  'network_failure',
  'model_failure',
  'executor_change',
] as const;

export type InterruptionScenario = (typeof INTERRUPTION_SCENARIOS)[number];

export type WorkResumptionRefusal =
  | 'scenario_not_allowed'
  | 'checkpoint_missing'
  | 'checkpoint_correlation_mismatch'
  | 'attempt_still_open'
  | 'claim_still_active'
  | 'work_not_resumable'
  | 'identifier_reused'
  | 'invalid_resumption_request';

export interface WorkResumptionInput {
  readonly item: WorkItem;
  readonly scenario: InterruptionScenario;
  // Último handoff produzido — o checkpoint a partir do qual se retoma.
  readonly lastHandoff: WorkHandoffV1 | null;
  // Claim ainda não liberado do item, se houver.
  readonly openClaim: WorkClaim | null;
  // Tentativas já registradas para este item, na ordem em que ocorreram.
  readonly previousAttemptIds: readonly string[];
  readonly nextAttemptId: string;
  readonly nextClaimId: WorkClaimId;
  readonly now: Date;
}

export interface WorkResumptionPlan {
  readonly workItemId: WorkItemId;
  readonly approvedProposalVersion: ProposalVersion;
  readonly scenario: InterruptionScenario;
  // De onde se retoma: sempre uma referência persistida, nunca memória.
  readonly resumeFromAttemptId: string;
  readonly resumeFromHandoffReference: string;
  // Para onde se vai: identidades novas, jamais reaproveitadas.
  readonly nextAttemptId: string;
  readonly nextClaimId: WorkClaimId;
  readonly attemptNumber: number;
  // Contexto carregado, extraído exclusivamente do handoff persistido.
  readonly carriedContext: {
    readonly remainingSteps: readonly string[];
    readonly nextStep: string;
    readonly risks: readonly string[];
    readonly touchedResources: readonly string[];
    readonly previousFailures: readonly string[];
  };
}

export type WorkResumptionDecision =
  | { readonly outcome: 'resume'; readonly plan: WorkResumptionPlan }
  | { readonly outcome: 'refused'; readonly reason: WorkResumptionRefusal; readonly explanation: string }
  // Limites esgotados não viram loop: viram interrupção humana tipada (AUTO-06).
  | {
      readonly outcome: 'requires_human';
      readonly reason: HumanInterruptionReason;
      readonly reachedLimit: AutonomousLimitKind;
      readonly explanation: string;
    };

const refuse = (reason: WorkResumptionRefusal, explanation: string): WorkResumptionDecision =>
  ({ outcome: 'refused', reason, explanation });

const scenarios: ReadonlySet<string> = new Set(INTERRUPTION_SCENARIOS);
const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

// Estados a partir dos quais uma retomada faz sentido.
//
// `in_progress` fica de fora de propósito: uma tentativa que ainda consta
// aberta precisa ser reconciliada primeiro (SUP-04), não retomada por
// suposição otimista. `blocked` também fica de fora: pela régua ratificada do
// AUTO-01 ele aguarda informação, autoridade ou dependência externa — é
// checkpoint humano, e resolvê-lo devolve o item a `approved`.
const resumableStates: ReadonlySet<string> = new Set(['approved']);

/**
 * Decide se e como retomar um trabalho interrompido.
 *
 * Fail-closed em toda ambiguidade. Em particular, nunca:
 *
 * - retoma sem checkpoint persistido;
 * - reaproveita `attemptId` ou `claimId` anteriores;
 * - retoma sobre versão de proposta diferente da que produziu o checkpoint;
 * - retoma enquanto uma posse ainda está ativa ou uma tentativa segue aberta;
 * - insiste depois do limite de tentativas — aí a saída é interrupção humana.
 */
export function planWorkResumption(input: WorkResumptionInput): WorkResumptionDecision {
  const { item, scenario, lastHandoff, openClaim, previousAttemptIds, nextAttemptId, nextClaimId, now } = input;

  if (!scenarios.has(scenario)) {
    return refuse('scenario_not_allowed', `"${String(scenario)}" não é um cenário de interrupção reconhecido pelo Marco 003.`);
  }
  if (!nonBlank(nextAttemptId) || !nonBlank(nextClaimId) || !Array.isArray(previousAttemptIds)) {
    return refuse('invalid_resumption_request', 'A retomada exige identificadores novos e histórico de tentativas.');
  }
  if (previousAttemptIds.includes(nextAttemptId)) {
    return refuse('identifier_reused', 'A retomada exige uma tentativa nova; reaproveitar o identificador duplicaria efeitos.');
  }

  if (lastHandoff === null) {
    return refuse(
      'checkpoint_missing',
      'Não há checkpoint persistido: retomar seria reconstruir por suposição. O caso exige reparação ou decisão humana.',
    );
  }
  if (lastHandoff.workItemId !== item.id) {
    return refuse('checkpoint_correlation_mismatch', 'O checkpoint pertence a outro work item.');
  }
  if (lastHandoff.approvedProposalVersion !== item.proposalVersion) {
    return refuse(
      'checkpoint_correlation_mismatch',
      `O checkpoint foi produzido sobre a versão ${lastHandoff.approvedProposalVersion} e a proposta vigente é a ${item.proposalVersion}; retomar ali mudaria o escopo aprovado.`,
    );
  }
  if (lastHandoff.claimId !== null && nextClaimId === lastHandoff.claimId) {
    return refuse('identifier_reused', 'A retomada exige claim novo; o claim anterior não é renovado nem reaproveitado.');
  }
  if (!previousAttemptIds.includes(lastHandoff.attemptId)) {
    return refuse('checkpoint_correlation_mismatch', 'O checkpoint aponta uma tentativa ausente do histórico do item.');
  }

  if (openClaim !== null && deriveWorkClaimStatus(openClaim, now) === 'active') {
    return refuse(
      'claim_still_active',
      `O item ainda pertence ao claim ativo ${openClaim.claimId}; retomar em paralelo duplicaria execução.`,
    );
  }
  if (!resumableStates.has(item.state)) {
    return refuse(
      'work_not_resumable',
      item.state === 'in_progress'
        ? 'Há uma tentativa ainda aberta para este item; ela precisa ser reconciliada antes de qualquer retomada.'
        : `O item está em "${item.state}" e não admite retomada automática.`,
    );
  }

  const eligibility = evaluateAutonomousEligibility(item);
  if (!eligibility.eligible) {
    return refuse('work_not_resumable', 'O item deixou de ser elegível; a retomada exige que as lacunas sejam resolvidas antes.');
  }

  const attemptNumber = previousAttemptIds.length + 1;
  const maxAttempts = eligibility.spec.limits.maxAttempts;
  if (maxAttempts !== undefined && attemptNumber > maxAttempts) {
    return {
      outcome: 'requires_human',
      reason: 'persistent_inability_after_limits',
      reachedLimit: 'attempts',
      explanation: `O limite de ${maxAttempts} tentativa(s) foi atingido; insistir viraria loop, então o caso vai para decisão humana.`,
    };
  }

  return {
    outcome: 'resume',
    plan: {
      workItemId: item.id,
      approvedProposalVersion: item.proposalVersion,
      scenario,
      resumeFromAttemptId: lastHandoff.attemptId,
      resumeFromHandoffReference: lastHandoff.handoffReference,
      nextAttemptId,
      nextClaimId,
      attemptNumber,
      // Estritamente o que foi persistido no handoff. Nada de contexto de sessão.
      carriedContext: {
        remainingSteps: lastHandoff.remainingSteps,
        nextStep: lastHandoff.nextStep,
        risks: lastHandoff.risks,
        touchedResources: lastHandoff.touchedResources,
        previousFailures: lastHandoff.failures,
      },
    },
  };
}

/**
 * Todo cenário do Marco 003 tem caminho de retomada pela mesma regra: eleger o
 * checkpoint e recomeçar com identidades novas. A distinção entre eles é de
 * diagnóstico e auditoria, não de mecanismo — não existe cenário privilegiado
 * que dispense checkpoint ou reaproveite posse.
 */
export const describesRecoverableInterruption = (scenario: InterruptionScenario): boolean => scenarios.has(scenario);
