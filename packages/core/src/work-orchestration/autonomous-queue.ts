import { evaluateAutonomousEligibility } from './eligibility';
import { evaluateAutonomousIntelligenceEligibility } from './autonomous-intelligence-eligibility';
import {
  evaluateClassificationReadiness,
  type WorkIntelligenceClassificationV1,
} from './work-intelligence-classification';
import type { Json } from '@anima/types';
import type { ProposalVersion, WorkCapability, WorkItem, WorkItemId } from './types';
import { deriveWorkClaimStatus, type WorkClaim } from './work-claim';

// SUP-01 — Fila de trabalho autônomo como projeção.
// SUP-03 — Exclusividade por alvo projetada junto da fila.
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
  /** Classificação vigente da versão atual; ausência é bloqueio fail-closed. */
  readonly currentClassification: WorkIntelligenceClassificationV1 | null;
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
  readonly targetReference: string;
  readonly queuePosition: number;
  // SUP-03: outro trabalho ocupa este alvo agora. O item permanece na fila —
  // ele espera, não é descartado.
  readonly targetOccupied: boolean;
}

const isPlainObject = (value: Json | undefined): value is Readonly<Record<string, Json>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Chave de ocupação do alvo.
 *
 * Deliberadamente o `kind` NÃO participa: tratar `project:X` e `workspace:X`
 * como alvos distintos seria a "definição frouxa de mesmo projeto" que fura o
 * invariante. Mesma referência é o mesmo alvo físico. A comparação é exata
 * após `btrim` — referências são opacas (Marco 004), então não há semântica de
 * caminho a normalizar.
 */
export const readTargetReference = (item: WorkItem): string | null => {
  const spec = item.intent['execution_spec'];
  if (!isPlainObject(spec)) return null;
  const target = spec['target'];
  if (!isPlainObject(target)) return null;
  const reference = target['reference'];
  if (typeof reference !== 'string') return null;
  const trimmed = reference.trim();
  return trimmed.length === 0 ? null : trimmed;
};

/**
 * Alvos ocupados agora. Um alvo está ocupado quando algum item:
 *
 * - está em `in_progress` — uma tentativa começou e não concluiu. Vale
 *   independentemente do claim, o que cobre dois casos reais: o claim que
 *   expira no meio de uma execução longa, e a execução comandada do INT-04,
 *   que não cria claim algum; ou
 * - possui claim ativo — posse válida, ainda que a tentativa não tenha começado.
 *
 * Claim expirado ou liberado sobre item que NÃO está executando não ocupa
 * nada: o alvo volta a ficar livre sem intervenção.
 */
export function deriveOccupiedTargets(candidates: readonly AutonomousQueueCandidate[], now: Date): ReadonlySet<string> {
  const occupied = new Set<string>();
  for (const { item, openClaim } of candidates) {
    const target = readTargetReference(item);
    if (target === null) continue;
    const executing = item.state === 'in_progress';
    const owned = openClaim !== null && deriveWorkClaimStatus(openClaim, now) === 'active';
    if (executing || owned) occupied.add(target);
  }
  return occupied;
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
 *
 * `candidates` deve conter todos os itens não encerrados do usuário, não
 * apenas os elegíveis: itens em execução não entram na fila, mas ocupam alvo.
 * DEVE conter TAMBÉM os itens `completed` referenciados como dependência por
 * algum não-terminal — a satisfação de `depends_on_work_item_ids` exige vê-los
 * (estado `completed`); ausência é tratada, fail-closed, como não-satisfeita.
 */
export function projectAutonomousQueue(
  candidates: readonly AutonomousQueueCandidate[],
  now: Date,
): readonly AutonomousQueueEntry[] {
  const occupiedTargets = deriveOccupiedTargets(candidates, now);
  const itemsById = new Map(candidates.map(candidate => [candidate.item.id, candidate.item]));
  const eligible: Omit<AutonomousQueueEntry, 'queuePosition'>[] = [];

  for (const candidate of candidates) {
    if (!hasCurrentApproval(candidate)) continue;

    // Um claim ativo significa que o item já pertence a alguém: sai da fila.
    // Claim expirado ou liberado é recuperável e permanece.
    if (candidate.openClaim !== null && deriveWorkClaimStatus(candidate.openClaim, now) === 'active') continue;

    const auto01 = evaluateAutonomousEligibility(candidate.item);
    const evaluation = evaluateAutonomousIntelligenceEligibility({
      auto01,
      currentClassification: candidate.currentClassification,
      readiness: candidate.currentClassification === null
        ? null
        : evaluateClassificationReadiness(candidate.currentClassification),
    });
    if (!evaluation.eligible) continue;
    if (evaluation.spec.dependsOnWorkItemIds.some(dependencyId =>
      dependencyId === candidate.item.id || itemsById.get(dependencyId)?.state !== 'completed')) continue;

    const targetReference = evaluation.spec.target.reference.trim();
    eligible.push({
      workItemId: candidate.item.id,
      approvedProposalVersion: candidate.item.proposalVersion,
      approvalSeq: candidate.approval.seq,
      approvedAt: candidate.approval.approvedAt,
      capability: candidate.item.capability,
      targetReference,
      targetOccupied: occupiedTargets.has(targetReference),
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
