import type { ReviewWorkResultCommand } from './commands';
import { availableWorkActions, projectLatestWorkResult, type WorkAction } from './presentation';
import type { ResultReviewDecision, WorkEvent, WorkItem } from './types';

// ============================================================
// Montagem PURA e compartilhada do comando de revisão de RESULTADO
// (`accept` / `request_changes`) a partir do item + log de eventos persistidos.
//
// A REGRA de quando uma decisão de revisão cabe já vive em `availableWorkActions`
// (estado `review` + o último resultado casa a versão aprovada). Este helper apenas
// (1) reusa essa regra como pré-gate e (2) deriva os campos de correlação que o
// comando exige — `reviewedResultEventId` (o evento do último resultado submetido)
// e `expectedProposalVersion` (a versão do item). Não reimplementa a máquina de
// estados: a AUTORIDADE final permanece no `WorkOrchestrationService.reviewResult`
// e na RPC persistente (que revalidam versão, evento e a transição sob RLS).
//
// Existe para que web, CLI e qualquer outro adapter construam o MESMO comando pela
// MESMA regra, em vez de remontá-lo inline. Puro e determinístico: sem I/O, sem
// relógio — dado item+eventos+decisão, o plano é sempre o mesmo (testável à exaustão).
// ============================================================

/** Por que uma decisão de revisão de resultado não cabe agora — fail-closed e tipado. */
export type ResultReviewRefusal =
  /** O item não está aguardando revisão de resultado (estado ≠ `review`). */
  | 'not_in_review'
  /** Não há resultado submetido reconstituível para revisar. */
  | 'no_reviewable_result'
  /** Há resultado, mas ele pertence a uma versão de proposta diferente da vigente. */
  | 'result_version_mismatch';

export type ResultReviewPlan =
  | { readonly ok: true; readonly command: ReviewWorkResultCommand }
  | { readonly ok: false; readonly reason: ResultReviewRefusal };

/**
 * Deriva o comando de revisão de resultado para a decisão dada, ou recusa fechado
 * com um motivo tipado. A ação necessária (`accept_result`/`request_result_changes`)
 * precisa estar entre as ações disponíveis projetadas do item — só então o comando
 * é montado com a correlação exigida.
 */
export function planResultReview(
  item: WorkItem,
  events: readonly WorkEvent[],
  decision: ResultReviewDecision,
): ResultReviewPlan {
  const latestResult = projectLatestWorkResult(events);
  const actions = availableWorkActions(item, latestResult);
  const needed: WorkAction = decision.type === 'accept' ? 'accept_result' : 'request_result_changes';
  if (!actions.includes(needed)) {
    if (item.state !== 'review') return { ok: false, reason: 'not_in_review' };
    if (latestResult === null) return { ok: false, reason: 'no_reviewable_result' };
    return { ok: false, reason: 'result_version_mismatch' };
  }
  // `latestResult` é não-nulo aqui: a ação só está disponível quando ele existe e
  // casa a versão vigente (invariante de `availableWorkActions`).
  return {
    ok: true,
    command: {
      workItemId: item.id,
      expectedProposalVersion: item.proposalVersion,
      reviewedResultEventId: latestResult!.eventId,
      decision,
    },
  };
}
