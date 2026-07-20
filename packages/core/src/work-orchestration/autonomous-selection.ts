import type { AutonomousQueueEntry } from './autonomous-queue';

// SUP-02 — Seleção determinística do próximo trabalho.
//
// A política V0 é a mais explicável possível: **aprovação mais antiga
// primeiro**, exatamente a ordem já projetada pela fila (SUP-01). Não há
// juízo de valor escondido em heurística — nem urgência, nem impacto, nem
// dificuldade. Escolher executor, modelo ou esforço é da Fase F e não
// pertence a este mecanismo.
//
// A escolha não emite evento próprio. Ela é um **read**: o efeito auditável é
// o claim, que já registra `work_claimed` no log append-only. Como a política
// é determinística sobre um log imutável, a decisão é sempre recomputável —
// registrar um evento por consulta inundaria um log que não pode ser limpo.

export type AutonomousSelectionPolicy = 'oldest_approval_first';

export const AUTONOMOUS_SELECTION_POLICY: AutonomousSelectionPolicy = 'oldest_approval_first';

export interface AutonomousSelectionRationale {
  readonly policy: AutonomousSelectionPolicy;
  readonly queueSize: number;
  readonly selectedPosition: number;
  readonly approvalSeq: number;
  // Sequência do segundo colocado: explica por que este item e não o próximo.
  readonly runnerUpApprovalSeq: number | null;
  // SUP-03: quantos itens mais antigos foram pulados porque seu alvo está
  // ocupado. Explica por que a escolha não foi a cabeça da fila.
  readonly skippedOccupiedTargets: number;
}

export type AutonomousSelectionRefusal =
  | 'positions_not_contiguous'
  | 'order_not_monotonic'
  | 'duplicate_work_item';

export type AutonomousWorkSelection =
  | { readonly outcome: 'selected'; readonly entry: AutonomousQueueEntry; readonly rationale: AutonomousSelectionRationale }
  | { readonly outcome: 'empty_queue' }
  // Há trabalho esperando, mas todo alvo está ocupado. Não é fila vazia:
  // o supervisor deve aguardar, não concluir que não há trabalho.
  | { readonly outcome: 'waiting_for_targets'; readonly occupiedTargets: readonly string[] }
  | { readonly outcome: 'refused'; readonly reason: AutonomousSelectionRefusal; readonly explanation: string };

const refuse = (reason: AutonomousSelectionRefusal, explanation: string): AutonomousWorkSelection => ({
  outcome: 'refused',
  reason,
  explanation,
});

/**
 * Escolhe o próximo trabalho a partir da fila projetada.
 *
 * Fail-closed por desconfiança da entrada: a política não reordena nem
 * "conserta" uma fila inconsistente. Se as posições não forem contíguas a
 * partir de 1, se a ordem não for monotônica na sequência de aprovação, ou se
 * houver item repetido, nada é escolhido — uma fila ambígua não autoriza
 * execução.
 */
export function selectNextAutonomousWork(queue: readonly AutonomousQueueEntry[]): AutonomousWorkSelection {
  if (queue.length === 0) return { outcome: 'empty_queue' };

  const seen = new Set<string>();
  for (let index = 0; index < queue.length; index += 1) {
    const entry = queue[index]!;
    if (entry.queuePosition !== index + 1) {
      return refuse(
        'positions_not_contiguous',
        `A fila recebida não está posicionada de 1 a ${queue.length}; posição ${entry.queuePosition} apareceu no índice ${index + 1}.`,
      );
    }
    if (seen.has(entry.workItemId)) {
      return refuse('duplicate_work_item', `O item ${entry.workItemId} aparece mais de uma vez na fila recebida.`);
    }
    seen.add(entry.workItemId);
    if (index > 0 && entry.approvalSeq <= queue[index - 1]!.approvalSeq) {
      return refuse(
        'order_not_monotonic',
        `A sequência de aprovação não é crescente entre as posições ${index} e ${index + 1}.`,
      );
    }
  }

  // SUP-03: o alvo ocupado não reordena a fila nem descarta o item — apenas o
  // torna inelegível agora. O mais antigo com alvo livre é escolhido, de modo
  // que trabalhos em alvos diferentes progridem e ninguém passa na frente.
  const selectedIndex = queue.findIndex(candidate => !candidate.targetOccupied);
  if (selectedIndex === -1) {
    return {
      outcome: 'waiting_for_targets',
      occupiedTargets: [...new Set(queue.map(candidate => candidate.targetReference))].sort(),
    };
  }

  const entry = queue[selectedIndex]!;
  const runnerUp = queue.slice(selectedIndex + 1).find(candidate => !candidate.targetOccupied);
  return {
    outcome: 'selected',
    entry,
    rationale: {
      policy: AUTONOMOUS_SELECTION_POLICY,
      queueSize: queue.length,
      selectedPosition: entry.queuePosition,
      approvalSeq: entry.approvalSeq,
      runnerUpApprovalSeq: runnerUp === undefined ? null : runnerUp.approvalSeq,
      skippedOccupiedTargets: selectedIndex,
    },
  };
}
