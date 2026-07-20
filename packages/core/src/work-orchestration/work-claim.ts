import { evaluateAutonomousEligibility, type AutonomousEligibilityGapCode } from './eligibility';
import type { ProposalVersion, WorkItem, WorkItemId } from './types';

// AUTO-02 — Claim exclusivo e expiração (Marco 003 §Claim exclusivo).
//
// Um claim é a posse temporária e exclusiva de um work item por uma instância
// de supervisor. Ele NÃO é execução: a sequência do domínio é
// `eligible → claimed → attempt_started → execution_started`, e obter o claim
// não afirma que qualquer tentativa começou.
//
// Este módulo é a especificação pura das operações atômicas correspondentes.
// A exclusividade real é garantida pelo banco (lock do item + índice único
// parcial); as funções abaixo definem exatamente qual decisão o servidor deve
// tomar em cada estado, para que o contrato seja verificável sem banco.

export type WorkClaimId = string;
export type SupervisorInstanceId = string;

// Lista fechada: não existe "outro". Liberar sem razão declarada é defeito.
export type WorkClaimReleaseReason =
  | 'attempt_finished'
  | 'released_without_attempt'
  | 'expired';

export interface WorkClaimRelease {
  readonly reason: WorkClaimReleaseReason;
  readonly releasedAt: Date;
}

export interface WorkClaim {
  readonly claimId: WorkClaimId;
  readonly workItemId: WorkItemId;
  // A posse é sempre ancorada na versão aprovada exata, como toda correlação
  // do INT-02. Proposta revisada invalida o claim em vez de herdá-lo.
  readonly approvedProposalVersion: ProposalVersion;
  readonly ownerInstanceId: SupervisorInstanceId;
  readonly acquiredAt: Date;
  readonly expiresAt: Date;
  // Preenchido no máximo uma vez, quando a tentativa nasce sob este claim.
  readonly attemptId: string | null;
  readonly release: WorkClaimRelease | null;
}

// Expiração é derivada do tempo, nunca um estado gravado que apague o anterior:
// o histórico do claim permanece auditável mesmo depois de vencido ou liberado.
export type WorkClaimStatus = 'active' | 'expired' | 'released';

export const deriveWorkClaimStatus = (claim: WorkClaim, now: Date): WorkClaimStatus => {
  if (claim.release !== null) return 'released';
  return now.getTime() >= claim.expiresAt.getTime() ? 'expired' : 'active';
};

export type WorkClaimDenialReason =
  | 'invalid_claim_request'
  | 'claim_identity_conflict'
  | 'claim_already_released'
  | 'claim_expired'
  | 'held_by_active_claim'
  | 'proposal_version_changed'
  | 'not_eligible';

export interface AcquireWorkClaimInput {
  readonly claimId: WorkClaimId;
  readonly item: WorkItem;
  readonly ownerInstanceId: SupervisorInstanceId;
  readonly expectedProposalVersion: ProposalVersion;
  // Claim ainda não liberado deste item, se existir. O banco garante no máximo um.
  readonly openClaim: WorkClaim | null;
  // Claim já gravado com este `claimId`, se existir — base do reconhecimento de replay.
  readonly claimWithSameId: WorkClaim | null;
  readonly now: Date;
  readonly leaseSeconds: number;
}

export type AcquireWorkClaimDecision =
  | { readonly outcome: 'granted'; readonly claim: WorkClaim; readonly supersededClaimId: WorkClaimId | null }
  | { readonly outcome: 'replayed'; readonly claim: WorkClaim }
  | {
      readonly outcome: 'denied';
      readonly reason: WorkClaimDenialReason;
      readonly explanation: string;
      readonly gaps?: readonly AutonomousEligibilityGapCode[];
    };

const deny = (
  reason: WorkClaimDenialReason,
  explanation: string,
  gaps?: readonly AutonomousEligibilityGapCode[],
): AcquireWorkClaimDecision =>
  gaps === undefined ? { outcome: 'denied', reason, explanation } : { outcome: 'denied', reason, explanation, gaps };

const isNonEmpty = (value: string): boolean => value.trim().length > 0;

const sameIdentity = (claim: WorkClaim, input: AcquireWorkClaimInput): boolean =>
  claim.workItemId === input.item.id &&
  claim.ownerInstanceId === input.ownerInstanceId &&
  claim.approvedProposalVersion === input.expectedProposalVersion;

/**
 * Decide a aquisição de um claim exclusivo. A ordem das verificações é
 * deliberada e fail-closed: identidade e replay antes de elegibilidade (uma
 * reentrega legítima acontece depois de o item já ter saído de `approved`),
 * e contenção por último, porque só faz sentido disputar o que é elegível.
 */
export function acquireWorkClaim(input: AcquireWorkClaimInput): AcquireWorkClaimDecision {
  const { claimId, item, ownerInstanceId, expectedProposalVersion, openClaim, claimWithSameId, now, leaseSeconds } = input;

  if (!isNonEmpty(claimId) || !isNonEmpty(ownerInstanceId)) {
    return deny('invalid_claim_request', 'Claim e instância proprietária precisam ser identificadores não vazios.');
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds <= 0) {
    return deny('invalid_claim_request', 'A validade do claim precisa ser um número inteiro positivo de segundos.');
  }
  if (!Number.isInteger(expectedProposalVersion) || expectedProposalVersion < 1) {
    return deny('invalid_claim_request', 'A versão aprovada esperada precisa ser um inteiro positivo.');
  }

  if (claimWithSameId !== null) {
    if (!sameIdentity(claimWithSameId, input)) {
      return deny(
        'claim_identity_conflict',
        'Este claim já existe correlacionado a outro item, dono ou versão aprovada; reutilizá-lo seria ambíguo.',
      );
    }
    const status = deriveWorkClaimStatus(claimWithSameId, now);
    if (status === 'released') {
      return deny('claim_already_released', 'Este claim já foi liberado e não pode ser ressuscitado; adquira um novo.');
    }
    if (status === 'expired') {
      // Renovar silenciosamente esconderia a interrupção; a retomada exige um
      // claim novo, deixando a substituição registrada.
      return deny('claim_expired', 'Este claim expirou; adquira um novo claim para retomar de forma auditável.');
    }
    return { outcome: 'replayed', claim: claimWithSameId };
  }

  if (item.proposalVersion !== expectedProposalVersion) {
    return deny(
      'proposal_version_changed',
      `A proposta está na versão ${item.proposalVersion}, diferente da versão ${expectedProposalVersion} que seria reivindicada.`,
    );
  }

  const eligibility = evaluateAutonomousEligibility(item);
  if (!eligibility.eligible) {
    return deny(
      'not_eligible',
      'O item não é elegível para execução autônoma; as lacunas precisam ser resolvidas antes de qualquer claim.',
      eligibility.gaps.map(entry => entry.code),
    );
  }

  let supersededClaimId: WorkClaimId | null = null;
  if (openClaim !== null) {
    const status = deriveWorkClaimStatus(openClaim, now);
    if (status === 'active') {
      return deny(
        'held_by_active_claim',
        `O item já pertence ao claim ativo ${openClaim.claimId} até ${openClaim.expiresAt.toISOString()}.`,
      );
    }
    // Claim vencido é recuperável: será liberado com razão `expired` na mesma
    // transação, preservando a linha anterior em vez de sobrescrevê-la.
    supersededClaimId = openClaim.claimId;
  }

  return {
    outcome: 'granted',
    supersededClaimId,
    claim: {
      claimId,
      workItemId: item.id,
      approvedProposalVersion: expectedProposalVersion,
      ownerInstanceId,
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + leaseSeconds * 1000),
      attemptId: null,
      release: null,
    },
  };
}

export type BindAttemptDenialReason =
  | 'invalid_attempt_reference'
  | 'claim_expired'
  | 'claim_released'
  | 'attempt_already_bound';

export type BindAttemptToWorkClaimDecision =
  | { readonly outcome: 'bound'; readonly claim: WorkClaim }
  | { readonly outcome: 'replayed'; readonly claim: WorkClaim }
  | { readonly outcome: 'denied'; readonly reason: BindAttemptDenialReason; readonly explanation: string };

/**
 * Liga a tentativa ao claim. No máximo uma tentativa por claim: reentregar o
 * mesmo `attemptId` é idempotente, qualquer outro é recusado. Só aqui a
 * sequência avança de `claimed` para `attempt_started`.
 */
export function bindAttemptToWorkClaim(claim: WorkClaim, attemptId: string, now: Date): BindAttemptToWorkClaimDecision {
  if (!isNonEmpty(attemptId)) {
    return { outcome: 'denied', reason: 'invalid_attempt_reference', explanation: 'A tentativa precisa de um identificador não vazio.' };
  }
  if (claim.attemptId !== null) {
    return claim.attemptId === attemptId
      ? { outcome: 'replayed', claim }
      : {
          outcome: 'denied',
          reason: 'attempt_already_bound',
          explanation: `Este claim já iniciou a tentativa ${claim.attemptId}; um claim inicia no máximo uma tentativa.`,
        };
  }
  const status = deriveWorkClaimStatus(claim, now);
  if (status === 'released') {
    return { outcome: 'denied', reason: 'claim_released', explanation: 'O claim foi liberado e não pode mais iniciar tentativa.' };
  }
  if (status === 'expired') {
    return { outcome: 'denied', reason: 'claim_expired', explanation: 'O claim expirou antes de iniciar a tentativa; adquira um novo claim.' };
  }
  return { outcome: 'bound', claim: { ...claim, attemptId } };
}

export type ReleaseWorkClaimDecision =
  | { readonly outcome: 'released'; readonly claim: WorkClaim }
  | { readonly outcome: 'replayed'; readonly claim: WorkClaim }
  | { readonly outcome: 'denied'; readonly reason: 'release_reason_conflict' | 'release_reason_incoherent'; readonly explanation: string };

/**
 * Libera o claim de forma auditável. A liberação não apaga a linha nem os
 * eventos anteriores: acrescenta a razão e o horário ao registro existente.
 */
export function releaseWorkClaim(claim: WorkClaim, reason: WorkClaimReleaseReason, now: Date): ReleaseWorkClaimDecision {
  if (claim.release !== null) {
    return claim.release.reason === reason
      ? { outcome: 'replayed', claim }
      : {
          outcome: 'denied',
          reason: 'release_reason_conflict',
          explanation: `O claim já foi liberado como "${claim.release.reason}"; registrar "${reason}" reescreveria o histórico.`,
        };
  }
  if (reason === 'attempt_finished' && claim.attemptId === null) {
    return {
      outcome: 'denied',
      reason: 'release_reason_incoherent',
      explanation: 'Nenhuma tentativa foi iniciada sob este claim; "attempt_finished" não descreve o que aconteceu.',
    };
  }
  if (reason === 'released_without_attempt' && claim.attemptId !== null) {
    return {
      outcome: 'denied',
      reason: 'release_reason_incoherent',
      explanation: `Este claim iniciou a tentativa ${claim.attemptId}; "released_without_attempt" contradiz o registro.`,
    };
  }
  return { outcome: 'released', claim: { ...claim, release: { reason, releasedAt: now } } };
}

// Payloads propostos para o log append-only. Nenhum campo carrega caminho
// local, credencial ou detalhe de fornecedor: apenas correlação e posse.
export interface WorkClaimedPayloadV1 {
  readonly schema_version: 1;
  readonly data: {
    readonly claim_id: WorkClaimId;
    readonly work_item_id: WorkItemId;
    readonly approved_proposal_version: ProposalVersion;
    readonly owner_instance_id: SupervisorInstanceId;
    readonly acquired_at: string;
    readonly expires_at: string;
    readonly superseded_claim_id: WorkClaimId | null;
  };
}

export interface WorkClaimReleasedPayloadV1 {
  readonly schema_version: 1;
  readonly data: {
    readonly claim_id: WorkClaimId;
    readonly work_item_id: WorkItemId;
    readonly approved_proposal_version: ProposalVersion;
    readonly owner_instance_id: SupervisorInstanceId;
    readonly attempt_id: string | null;
    readonly reason: WorkClaimReleaseReason;
    readonly released_at: string;
  };
}

export const buildWorkClaimedPayload = (claim: WorkClaim, supersededClaimId: WorkClaimId | null): WorkClaimedPayloadV1 => ({
  schema_version: 1,
  data: {
    claim_id: claim.claimId,
    work_item_id: claim.workItemId,
    approved_proposal_version: claim.approvedProposalVersion,
    owner_instance_id: claim.ownerInstanceId,
    acquired_at: claim.acquiredAt.toISOString(),
    expires_at: claim.expiresAt.toISOString(),
    superseded_claim_id: supersededClaimId,
  },
});

export const buildWorkClaimReleasedPayload = (claim: WorkClaim): WorkClaimReleasedPayloadV1 | null =>
  claim.release === null
    ? null
    : {
        schema_version: 1,
        data: {
          claim_id: claim.claimId,
          work_item_id: claim.workItemId,
          approved_proposal_version: claim.approvedProposalVersion,
          owner_instance_id: claim.ownerInstanceId,
          attempt_id: claim.attemptId,
          reason: claim.release.reason,
          released_at: claim.release.releasedAt.toISOString(),
        },
      };
