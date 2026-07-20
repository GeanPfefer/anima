import { evaluateAutonomousEligibility } from './eligibility';
import type { ProposalVersion, WorkCapability, WorkItem, WorkItemId } from './types';
import { deriveWorkClaimStatus, type WorkClaim } from './work-claim';

// SUP-01 — Fila de trabalho autônomo como projeção.
//
// A fila NÃO é uma tabela paralela: é derivada da fonte de verdade (itens,
// eventos de aprovação e claims). Por isso ela sobrevive a reinícios sem
// persistência própria e um item que deixa de ser elegível sai dela sozinho,
// sem intervenção nem risco de divergir do estado real.

export interface AutonomousQueueApproval {
  // `seq` do evento `work_approved` — identidade monotônica e globalmente
  // única do log append-only, imune a relógio e a fuso.
  readonly seq: number;
  readonly approvedAt: Date;
  readonly proposalVersion: ProposalVersion;
}

export interface AutonomousQueueCandidate {
  readonly item: WorkItem;
  // Aprovação vigente: o `work_approved` mais recente do item. Ausente quando
  // o item nunca foi aprovado.
  readonly approval: AutonomousQueueApproval | null;
  // Claim ainda não liberado do item, se houver. O banco garante no máximo um.
  readonly openClaim: WorkClaim | null;
}

export interface AutonomousQueueEntry {
  readonly workItemId: WorkItemId;
  readonly approvedProposalVersion: ProposalVersion;
  readonly approvalSeq: number;
  readonly approvedAt: Date;
  readonly capability: WorkCapability;
  // Alvo declarado na especificação de execução; a invariante de um trabalho
  // ativo por alvo (SUP-03) depende dele.
  readonly targetReference: string;
  readonly queuePosition: number;
}

const hasCurrentApproval = (candidate: AutonomousQueueCandidate): candidate is AutonomousQueueCandidate & { approval: AutonomousQueueApproval } => {
  const { approval, item } = candidate;
  if (approval === null) return false;
  // Aprovação de uma versão que não é mais a vigente não sustenta execução:
  // proposta revisada invalida a posição anterior na fila.
  if (approval.proposalVersion !== item.proposalVersion) return false;
  return Number.isInteger(approval.seq) && approval.seq > 0;
};

/**
 * Projeta a fila de itens aguardando execução autônoma, na ordem em que devem
 * ser considerados. Fail-closed: qualquer ambiguidade exclui o item da fila.
 *
 * A ordenação é FIFO pela aprovação vigente (`approvalSeq` crescente). Como
 * `seq` é identidade única do log, empate é impossível por construção; o
 * `workItemId` entra como desempate secundário apenas para que a ordem seja
 * total mesmo diante de entrada inesperada.
 */
export function projectAutonomousQueue(
  candidates: readonly AutonomousQueueCandidate[],
  now: Date,
): readonly AutonomousQueueEntry[] {
  const eligible: Omit<AutonomousQueueEntry, 'queuePosition'>[] = [];

  for (const candidate of candidates) {
    if (!hasCurrentApproval(candidate)) continue;

    // Um claim ativo significa que o item já pertence a alguém: sai da fila.
    // Claim expirado ou liberado é recuperável e permanece.
    if (candidate.openClaim !== null && deriveWorkClaimStatus(candidate.openClaim, now) === 'active') continue;

    const evaluation = evaluateAutonomousEligibility(candidate.item);
    if (!evaluation.eligible) continue;

    eligible.push({
      workItemId: candidate.item.id,
      approvedProposalVersion: candidate.item.proposalVersion,
      approvalSeq: candidate.approval.seq,
      approvedAt: candidate.approval.approvedAt,
      capability: candidate.item.capability,
      targetReference: evaluation.spec.target.reference,
    });
  }

  return eligible
    .sort((left, right) =>
      left.approvalSeq === right.approvalSeq
        ? left.workItemId.localeCompare(right.workItemId)
        : left.approvalSeq - right.approvalSeq,
    )
    .map((entry, index) => ({ ...entry, queuePosition: index + 1 }));
}
