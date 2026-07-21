import type { WorkItem, WorkItemId } from './types';
import { deriveWorkClaimStatus, type WorkClaim, type WorkClaimId, type WorkClaimReleaseReason } from './work-claim';

// SUP-04 — Reconciliação e retomada segura (Fase E, Supervisor V0).
//
// Espelho puro de `public.reconcile_supervised_work()`. A garantia real é do
// banco — lock consultivo por usuário, `FOR UPDATE` por item, eventos
// append-only. Aqui fica exatamente qual decisão o servidor deve tomar diante
// de cada combinação de fatos persistidos, para que o contrato seja verificável
// sem banco e para que as duas implementações possam ser provadas concordantes.
//
// O princípio que ordena tudo: ausência de processo, executor ou heartbeat NÃO
// prova sucesso nem fracasso. A pergunta respondível não é "a execução
// terminou?" e sim "esta tentativa excedeu um limite declarado e persistido?".

/** Limite persistido que delimita até quando uma tentativa ainda vale. */
export type DeclaredAttemptBound =
  // AUTO-02: o lease do claim, contrato de posse que o banco já guarda.
  | 'claim_lease'
  // AUTO-01/INT-04: `execution_spec.limits.max_duration_minutes`, declarado na
  // proposta aprovada e medido a partir do `execution_started` persistido.
  | 'declared_duration';

export type WorkReconciliationFinding =
  | 'nothing_to_reconcile'
  | 'terminal_not_materialized'
  | 'claim_active'
  | 'claim_expired'
  | 'claim_open_after_terminal'
  | 'attempt_within_declared_bounds'
  | 'attempt_without_declared_bound'
  | 'attempt_missing'
  | 'attempt_abandoned';

export type WorkReconciliationAction =
  | 'none'
  | 'state_materialized'
  | 'claim_released'
  | 'attempt_abandoned'
  | 'requires_human';

export type AttemptAbandonmentReason =
  | 'lease_expired'
  | 'duration_limit_exceeded'
  | 'declared_bounds_exceeded';

/** Desfecho já persistido de uma tentativa, se houver. */
export type PersistedAttemptTerminal =
  | 'result_submitted'
  | 'execution_failed'
  | 'work_cancelled'
  | 'attempt_abandoned';

export interface ReconciliationAttempt {
  readonly attemptId: string;
  readonly startedAt: Date;
  /** Evento final já gravado para ESTA tentativa, ou `null` se nenhum. */
  readonly terminal: PersistedAttemptTerminal | null;
  /** Claim que iniciou esta tentativa; `null` na execução comandada (INT-04). */
  readonly claim: WorkClaim | null;
}

export interface WorkReconciliationInput {
  readonly item: WorkItem;
  /** Tentativa vigente do item, ou `null` se nenhuma foi registrada. */
  readonly attempt: ReconciliationAttempt | null;
  /** Claim ainda não liberado do item, se existir. O banco garante no máximo um. */
  readonly openClaim: WorkClaim | null;
  /**
   * Desfecho já gravado da tentativa do `openClaim`, quando ela difere da
   * tentativa vigente. `null` significa "nenhum desfecho registrado".
   */
  readonly openClaimAttemptTerminal: PersistedAttemptTerminal | null;
  /** Limite de duração declarado na proposta aprovada, em minutos. */
  readonly declaredDurationMinutes: number | null;
  readonly now: Date;
}

export interface WorkReconciliationOutcome {
  readonly workItemId: WorkItemId;
  readonly attemptId: string | null;
  readonly claimId: WorkClaimId | null;
  readonly finding: WorkReconciliationFinding;
  readonly action: WorkReconciliationAction;
  readonly explanation: string;
}

export interface WorkReconciliationDecision {
  readonly outcomes: readonly WorkReconciliationOutcome[];
  /** Estado do item depois da reconciliação. Igual ao anterior quando nada muda. */
  readonly resultingState: WorkItem['state'];
  /** Liberação a registrar para o claim aberto, se alguma. */
  readonly claimRelease: WorkClaimReleaseReason | null;
  /** Preenchido apenas quando a tentativa foi abandonada. */
  readonly abandonment: {
    readonly attemptId: string;
    readonly reason: AttemptAbandonmentReason;
    readonly exceededBounds: readonly DeclaredAttemptBound[];
  } | null;
}

// Mesma matriz normativa de `private.work_state_transitions`, restrita aos
// eventos que a reconciliação pode materializar.
const TERMINAL_STATE: Readonly<Record<PersistedAttemptTerminal, WorkItem['state']>> = {
  result_submitted: 'review',
  execution_failed: 'failed',
  work_cancelled: 'cancelled',
  attempt_abandoned: 'approved',
};

const isPositiveInteger = (value: number | null): value is number =>
  value !== null && Number.isInteger(value) && value > 0;

/**
 * Decide a reconciliação de um único work item a partir exclusivamente de
 * fatos persistidos.
 *
 * Nunca:
 *
 * - conclui sucesso ou fracasso a partir do desaparecimento do executor;
 * - toma, renova ou libera claim ainda ativo;
 * - abandona tentativa sem que TODOS os limites declarados aplicáveis tenham
 *   sido excedidos;
 * - aceita, autoriza ou integra resultado algum;
 * - inicia nova execução — devolver o item a `approved` restaura elegibilidade,
 *   e escolher e iniciar continuam sendo SUP-02 e AUTO-02.
 */
export function reconcileSupervisedWork(input: WorkReconciliationInput): WorkReconciliationDecision {
  const { item, attempt, openClaim, openClaimAttemptTerminal, declaredDurationMinutes, now } = input;

  const outcomes: WorkReconciliationOutcome[] = [];
  let state = item.state;
  let claimRelease: WorkClaimReleaseReason | null = null;
  let abandonment: WorkReconciliationDecision['abandonment'] = null;

  const record = (
    finding: WorkReconciliationFinding,
    action: WorkReconciliationAction,
    explanation: string,
    attemptId: string | null = attempt?.attemptId ?? null,
    claimId: WorkClaimId | null = null,
  ): void => {
    outcomes.push({ workItemId: item.id, attemptId, claimId, finding, action, explanation });
  };

  // ---------- (1) desfecho já persistido, estado derivado atrasado ----------
  //
  // Nenhum evento novo: ele já existe, e duplicá-lo inventaria um segundo fato.
  if (state === 'in_progress' && attempt !== null && attempt.terminal !== null) {
    state = TERMINAL_STATE[attempt.terminal];
    record(
      'terminal_not_materialized',
      'state_materialized',
      `A tentativa já tem "${attempt.terminal}" persistido; o estado derivado foi materializado sem duplicar o evento.`,
    );
  }

  // ---------- (2) posse aberta ----------
  if (openClaim !== null) {
    const claimTerminal =
      openClaim.attemptId !== null && openClaim.attemptId === attempt?.attemptId
        ? attempt.terminal
        : openClaimAttemptTerminal;

    if (openClaim.attemptId !== null && claimTerminal !== null) {
      claimRelease = 'attempt_finished';
      record(
        'claim_open_after_terminal',
        'claim_released',
        'A tentativa desta posse já tem desfecho persistido; faltava apenas materializar a liberação.',
        openClaim.attemptId,
        openClaim.claimId,
      );
    } else if (deriveWorkClaimStatus(openClaim, now) === 'expired') {
      // Mesma razão declarada que `acquire_work_claim` já usa. A linha
      // permanece: recolher não é apagar.
      claimRelease = 'expired';
      record(
        'claim_expired',
        'claim_released',
        `O lease venceu em ${openClaim.expiresAt.toISOString()} e foi recolhido com razão declarada, preservando o registro.`,
        openClaim.attemptId,
        openClaim.claimId,
      );
    } else {
      // Tomar posse válida seria o roubo silencioso que o SUP-05 proíbe;
      // liberá-la duplicaria execução.
      record(
        'claim_active',
        'none',
        `A posse ${openClaim.claimId} continua válida até ${openClaim.expiresAt.toISOString()}; nada é tomado nem liberado.`,
        openClaim.attemptId,
        openClaim.claimId,
      );
    }
  }

  // ---------- (3) tentativa interrompida ----------
  if (state === 'in_progress' && (attempt === null || attempt.terminal === null)) {
    if (attempt === null) {
      record(
        'attempt_missing',
        'requires_human',
        'O item consta em execução sem nenhum evento de tentativa correlacionado; nenhum fato persistido resolve isso.',
        null,
      );
    } else {
      // Lido antes das ramificações: o estreitamento de `attempt.claim` pelos
      // booleanos de limite deixa a propriedade inacessível dentro delas.
      const attemptClaimId = attempt.claim?.claimId ?? null;
      const leaseBound = attempt.claim !== null;
      const leaseExceeded = attempt.claim !== null && deriveWorkClaimStatus(attempt.claim, now) !== 'active';
      const durationBound = isPositiveInteger(declaredDurationMinutes);
      const durationExceeded =
        durationBound &&
        attempt.startedAt.getTime() + declaredDurationMinutes * 60_000 <= now.getTime();

      if (!leaseBound && !durationBound) {
        // Sem limite persistido não há fato que sustente transição alguma.
        record(
          'attempt_without_declared_bound',
          'requires_human',
          'A tentativa não tem lease nem `max_duration_minutes` declarado: nada delimita quando ela deixou de valer, e supor um desfecho seria inventá-lo.',
          attempt.attemptId,
          attemptClaimId,
        );
      } else if ((!leaseBound || leaseExceeded) && (!durationBound || durationExceeded)) {
        const exceededBounds: DeclaredAttemptBound[] = [];
        if (leaseBound) exceededBounds.push('claim_lease');
        if (durationBound) exceededBounds.push('declared_duration');
        const reason: AttemptAbandonmentReason =
          leaseBound && durationBound
            ? 'declared_bounds_exceeded'
            : leaseBound
              ? 'lease_expired'
              : 'duration_limit_exceeded';

        state = TERMINAL_STATE.attempt_abandoned;
        abandonment = { attemptId: attempt.attemptId, reason, exceededBounds };
        record(
          'attempt_abandoned',
          'attempt_abandoned',
          'A tentativa excedeu todos os limites declarados aplicáveis e deixou de ser a ocupante do item. Isso não afirma sucesso nem fracasso, e nenhum resultado foi aceito.',
          attempt.attemptId,
          attemptClaimId,
        );
      } else {
        // Ao menos um limite declarado ainda não venceu: a execução pode estar
        // legitimamente viva.
        record(
          'attempt_within_declared_bounds',
          'none',
          'Ao menos um limite declarado ainda não foi excedido; a execução pode seguir viva e não se mexe nela.',
          attempt.attemptId,
          attemptClaimId,
        );
      }
    }
  }

  if (outcomes.length === 0) {
    record('nothing_to_reconcile', 'none', 'Nada a reconciliar: o estado persistido já é consistente.', null);
  }

  return { outcomes, resultingState: state, claimRelease, abandonment };
}

/**
 * Reconciliar restaura consistência e elegibilidade — nunca dispara execução.
 * Nenhuma decisão leva um item para `in_progress`: quando o resultado é
 * `in_progress`, ele já era. Predicado explícito para que a separação entre
 * reconciliar e executar seja verificável em teste, não confiada a leitura
 * atenta.
 */
export const reconciliationStartsNoExecution = (
  previousState: WorkItem['state'],
  decision: WorkReconciliationDecision,
): boolean => decision.resultingState !== 'in_progress' || previousState === 'in_progress';

/**
 * Nenhuma decisão da reconciliação aceita, autoriza ou integra resultado.
 * `completed` só é alcançável por `result_accepted`, que exige decisão humana,
 * e a autorização de integração (INT-03) exige uma segunda — nenhuma das duas
 * está no vocabulário desta função.
 */
export const reconciliationAcceptsNoResult = (decision: WorkReconciliationDecision): boolean =>
  decision.resultingState !== 'completed';
