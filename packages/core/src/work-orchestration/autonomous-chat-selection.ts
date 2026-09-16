import { projectAutonomousQueue, type AutonomousQueueCandidate } from './autonomous-queue';
import { selectNextAutonomousWork, type AutonomousSelectionRationale } from './autonomous-selection';
import type { WorkItem, WorkState } from './types';

export interface WorkLineageEdge {
  readonly predecessorId: string;
  readonly successorId: string;
  readonly recoverySequence: number;
}

export interface AutonomousSelectionObservedItem {
  readonly id: string;
  readonly state: WorkState;
  readonly capability: WorkItem['capability'];
  readonly createdAt: Date;
}

export type AutonomousSelectionEliminationReason =
  | 'superseded_by_successor'
  | 'recovery_required'
  | 'human_decision_pending'
  | 'blocked'
  | 'not_canonically_eligible'
  | 'deterministic_tiebreak';

export interface AutonomousSelectionEvidence {
  readonly consideredIds: readonly string[];
  readonly eliminated: readonly {
    readonly workItemId: string;
    readonly reason: AutonomousSelectionEliminationReason;
    readonly canonicalSuccessorId: string | null;
  }[];
  readonly selectedId: string | null;
  readonly policy: AutonomousSelectionRationale['policy'];
  readonly humanDecisionRequired: boolean;
}

export type AutonomousChatWorkSelection =
  | { readonly outcome: 'selected'; readonly workItemId: string; readonly rationale: AutonomousSelectionRationale; readonly evidence: AutonomousSelectionEvidence }
  | { readonly outcome: 'none_eligible'; readonly reason: 'empty_queue' | 'waiting_for_targets' | 'invalid_queue'; readonly evidence: AutonomousSelectionEvidence }
  | { readonly outcome: 'human_decision_required'; readonly workItemIds: readonly string[]; readonly evidence: AutonomousSelectionEvidence };

const HUMAN_STATES: ReadonlySet<WorkState> = new Set(['proposed', 'review', 'changes_requested']);

const latestSuccessor = (startId: string, edges: readonly WorkLineageEdge[]): string | null => {
  let current = startId;
  let successor: string | null = null;
  const visited = new Set([startId]);
  while (true) {
    const next = edges.filter(edge => edge.predecessorId === current)
      .sort((a, b) => b.recoverySequence - a.recoverySequence || a.successorId.localeCompare(b.successorId))[0];
    if (!next || visited.has(next.successorId)) return successor;
    successor = next.successorId;
    current = next.successorId;
    visited.add(current);
  }
};

/**
 * Resolve o pedido conversacional de "escolha o próximo trabalho" usando a
 * mesma fila do Supervisor. Lineage só reconcilia predecessores históricos;
 * nunca promove um item que a fila canônica considerou inelegível.
 */
export function resolveAutonomousWorkSelection(input: {
  readonly candidates: readonly AutonomousQueueCandidate[];
  readonly observedItems: readonly AutonomousSelectionObservedItem[];
  readonly lineage: readonly WorkLineageEdge[];
  readonly now: Date;
}): AutonomousChatWorkSelection {
  const queue = projectAutonomousQueue(input.candidates, input.now);
  const selection = selectNextAutonomousWork(queue);
  const selectedId = selection.outcome === 'selected' ? selection.entry.workItemId : null;
  const queueIds = new Set(queue.map(entry => entry.workItemId));
  const humanIds = input.observedItems
    .filter(item => HUMAN_STATES.has(item.state) && latestSuccessor(item.id, input.lineage) === null)
    .map(item => item.id).sort();
  const eliminated = input.observedItems
    .filter(item => item.id !== selectedId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map(item => {
      const successor = latestSuccessor(item.id, input.lineage);
      const reason: AutonomousSelectionEliminationReason = successor
        ? 'superseded_by_successor'
        : item.state === 'failed'
          ? 'recovery_required'
          : HUMAN_STATES.has(item.state)
            ? 'human_decision_pending'
            : item.state === 'blocked'
              ? 'blocked'
              : queueIds.has(item.id)
                ? 'deterministic_tiebreak'
                : 'not_canonically_eligible';
      return { workItemId: item.id, reason, canonicalSuccessorId: successor };
    });
  const evidence = (humanDecisionRequired: boolean): AutonomousSelectionEvidence => ({
    consideredIds: input.observedItems.map(item => item.id).sort(),
    eliminated,
    selectedId,
    policy: 'oldest_approval_first',
    humanDecisionRequired,
  });

  if (selection.outcome === 'selected') {
    return { outcome: 'selected', workItemId: selection.entry.workItemId, rationale: selection.rationale, evidence: evidence(false) };
  }
  if (humanIds.length > 0) {
    return { outcome: 'human_decision_required', workItemIds: humanIds, evidence: evidence(true) };
  }
  return {
    outcome: 'none_eligible',
    reason: selection.outcome === 'waiting_for_targets' ? 'waiting_for_targets'
      : selection.outcome === 'refused' ? 'invalid_queue' : 'empty_queue',
    evidence: evidence(false),
  };
}
