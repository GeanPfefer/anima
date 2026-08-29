import {
  deriveResumeCorrectionSuccessor,
  projectHostObservedEvidence,
  type RecoverySuccessorCandidate,
  type RecoverySuccessorGap,
  type ResumeCorrectionRefusal,
  type WorkEvent,
  type WorkItem,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { uuidFromSeed } from './decomposition-orchestration';
import { proposeCorrectionSuccessor } from './recovery-successor';
import { createWorkOrchestrationService } from './server';
import { worktreeBranchFor } from './worktree-executor';

// ============================================================
// Ligação de produção da CORREÇÃO GOVERNADA POR RETOMADA. Fecha a lacuna entre o
// primitive puro (deriveResumeCorrectionSuccessor → validateCorrectionSuccessor →
// proposeCorrectionSuccessor) e o estado real: dado um work item em
// `changes_requested` cuja revisão pede um complemento que cabe no escopo AINDA
// NÃO tocado, monta os fatos DETERMINÍSTICOS já persistidos — o pedido da revisão
// e o checkpoint git observado da tentativa REVISADA (base, commit, arquivos
// preservados) — e materializa, idempotente, a menor unidade sucessora `proposed`
// que RETOMA do checkpoint reduzindo o escopo ao restante, ligada por lineage.
//
// NÃO aprova, classifica, executa nem amplia autoridade. Desfecho máximo:
// `proposed` (a validação de envelope roda em proposeCorrectionSuccessor).
// Fail-closed em toda lacuna. A DECISÃO é PURA (`planCorrectionFromReview`,
// testável sem banco); a cola de I/O (`correctReviewedWorkItem`) só busca e persiste.
// ============================================================

export type ReviewCorrectionBlock =
  | 'item_unavailable'
  | 'events_unavailable'
  | 'review_request_missing'
  | 'reviewed_result_missing'
  | 'checkpoint_evidence_missing'
  | 'lineage_read_failed'
  | 'derivation_refused'
  | 'candidate_invalid'
  | 'persistence_failed';

export interface ReviewCorrectionFacts {
  readonly original: WorkItem;
  readonly events: readonly WorkEvent[];
  /** Sequências de lineage já existentes para o original (append-only). */
  readonly existingRecoverySequences: readonly number[];
  /** Sequência não terminal já materializada. Quando existe, a operação deve
   * replayar essa unidade em vez de criar uma concorrente. */
  readonly activeRecoverySequence?: number;
}

export type ReviewCorrectionPlanResult =
  | { readonly ok: true; readonly candidate: RecoverySuccessorCandidate; readonly recoverySequence: number; readonly idempotencyKey: string }
  | { readonly ok: false; readonly reason: ReviewCorrectionBlock; readonly refusals?: readonly ResumeCorrectionRefusal[] };

const asObject = (value: Json | undefined): Record<string, Json | undefined> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, Json | undefined> : null;
const dataOf = (event: WorkEvent): Record<string, Json | undefined> | null => {
  const root = asObject(event.payload);
  return root ? asObject(root['data']) : null;
};
const readString = (record: Record<string, Json | undefined> | null, key: string): string =>
  typeof record?.[key] === 'string' ? record[key] as string : '';

/**
 * PURA e fail-closed. Deriva o candidato de correção por retomada a partir dos
 * fatos observados: o pedido da última revisão + o checkpoint git da tentativa
 * REVISADA (correlacionado pelo `reviewed_result_event_id` → `attempt_id`). Não
 * toca o banco.
 */
export function planCorrectionFromReview(facts: ReviewCorrectionFacts): ReviewCorrectionPlanResult {
  const { original, events } = facts;
  if (original.state !== 'changes_requested') return { ok: false, reason: 'item_unavailable' };

  // Última revisão solicitada: o pedido do humano + qual resultado foi revisado.
  const review = [...events].reverse().find(event => event.type === 'changes_requested');
  const reviewData = review ? dataOf(review) : null;
  const requestedChanges = readString(reviewData, 'requested_changes');
  const reviewedResultEventId = readString(reviewData, 'reviewed_result_event_id');
  if (!requestedChanges.trim() || !reviewedResultEventId) return { ok: false, reason: 'review_request_missing' };

  // A tentativa cujo resultado foi revisado — âncora do checkpoint a retomar.
  const reviewedResult = events.find(event => event.id === reviewedResultEventId);
  const reviewedAttemptId = reviewedResult ? readString(dataOf(reviewedResult), 'attempt_id') : '';
  if (!reviewedAttemptId) return { ok: false, reason: 'reviewed_result_missing' };

  // Checkpoint durável observado pelo host DA tentativa revisada (nunca de outra).
  const gitEvidence = projectHostObservedEvidence(events);
  if (!gitEvidence || gitEvidence.attemptId !== reviewedAttemptId) return { ok: false, reason: 'checkpoint_evidence_missing' };

  const recoverySequence = facts.activeRecoverySequence
    ?? facts.existingRecoverySequences.reduce((max, value) => Math.max(max, value), 0) + 1;
  // A primeira sequência mantém compatibilidade com a chave já publicada. Após
  // um successor terminal, cada nova unidade governada recebe chave própria;
  // enquanto estiver ativa, o mesmo número replaya estritamente a mesma linha.
  const keySeed = `review-correction:${original.id.toLowerCase()}:${gitEvidence.observedCommitSha.toLowerCase()}`
    + (recoverySequence === 1 ? '' : `:${recoverySequence}`);
  const idempotencyKey = uuidFromSeed(keySeed);

  const derivation = deriveResumeCorrectionSuccessor({
    original,
    requestedChanges,
    checkpoint: { baseSha: gitEvidence.baseSha, branch: worktreeBranchFor(reviewedAttemptId), commitSha: gitEvidence.observedCommitSha },
    preservedFiles: gitEvidence.observedChangedFiles,
    recoverySequence,
    idempotencyKey,
  });
  if (!derivation.ok) return { ok: false, reason: 'derivation_refused', refusals: derivation.refusals };
  return { ok: true, candidate: derivation.candidate, recoverySequence, idempotencyKey };
}

export type ReviewCorrectionResult =
  | { readonly ok: true; readonly successorWorkItemId: string; readonly lineageId: string; readonly recoverySequence: number; readonly replayed: boolean }
  | { readonly ok: false; readonly reason: ReviewCorrectionBlock; readonly refusals?: readonly ResumeCorrectionRefusal[]; readonly gaps?: readonly RecoverySuccessorGap[]; readonly message?: string };

/**
 * Materializa (ou replaya) a correção governada por retomada de um item em
 * `changes_requested`. Chamável por um usuário autenticado (RLS): lê apenas as
 * próprias linhas; a RPC recarimba proveniência. Puro efeito local.
 */
export async function correctReviewedWorkItem(
  client: SupabaseClient<Database>,
  workItemId: string,
): Promise<ReviewCorrectionResult> {
  const service = createWorkOrchestrationService(client);
  const [itemResult, eventsResult] = await Promise.all([
    service.getItem(workItemId),
    service.listEvents(workItemId),
  ]);
  if (!itemResult.ok || itemResult.value.state !== 'changes_requested') return { ok: false, reason: 'item_unavailable' };
  if (!eventsResult.ok) return { ok: false, reason: 'events_unavailable' };

  const lineage = await client
    .from('work_recovery_lineage')
    .select('recovery_sequence,successor_work_item_id')
    .eq('original_work_item_id', workItemId);
  if (lineage.error) return { ok: false, reason: 'lineage_read_failed', message: lineage.error.message };
  const existingRecoverySequences = (lineage.data ?? []).map(row => row.recovery_sequence ?? 0);
  const successorIds = (lineage.data ?? []).map(row => row.successor_work_item_id);
  let activeRecoverySequence: number | undefined;
  if (successorIds.length > 0) {
    const successors = await client.from('work_items').select('id,state').in('id', successorIds);
    if (successors.error) return { ok: false, reason: 'lineage_read_failed', message: successors.error.message };
    const activeStates = new Set(['proposed', 'approved', 'in_progress', 'blocked', 'review', 'changes_requested']);
    activeRecoverySequence = (lineage.data ?? [])
      .filter(row => successors.data?.some(item => item.id === row.successor_work_item_id && activeStates.has(item.state)))
      .reduce<number | undefined>((max, row) => max === undefined || row.recovery_sequence > max ? row.recovery_sequence : max, undefined);
  }

  const planned = planCorrectionFromReview({
    original: itemResult.value,
    events: eventsResult.value,
    existingRecoverySequences,
    activeRecoverySequence,
  });
  if (!planned.ok) return { ok: false, reason: planned.reason, refusals: planned.refusals };

  const persisted = await proposeCorrectionSuccessor(client, itemResult.value, planned.candidate);
  if (!persisted.ok) {
    if (persisted.code === 'candidate_invalid') return { ok: false, reason: 'candidate_invalid', gaps: persisted.gaps };
    return { ok: false, reason: 'persistence_failed', message: persisted.message };
  }
  return {
    ok: true,
    successorWorkItemId: persisted.successorWorkItemId,
    lineageId: persisted.lineageId,
    recoverySequence: persisted.recoverySequence,
    replayed: persisted.replayed,
  };
}
