// Pending Verification Human Recovery V0 (2026-09-28) — saída HUMANA do resultado
// candidato retido no lane com Verifier obrigatório.
//
// No lane `required_fail_closed` o resultado fica CANDIDATO (`in_progress`) até um
// parecer conclusivo e correlacionado. Um Verifier determinístico `inconclusive`,
// `missing`, com timeout/erro ou evidência incompleta o reteria para sempre. O humano
// pode encerrar o candidato — `request_changes` (→ `changes_requested`, retrabalho pelo
// fluxo de correção existente) ou `cancel` (→ `cancelled`) — mas NUNCA verificá-lo,
// liberá-lo para `review`, aceitá-lo ou integrá-lo. Controle humano ≠ bypass do Verifier.
//
// Este módulo só DERIVA a identidade exata do candidato a partir do log (resultado mais
// recente, da versão e attempt vigentes, sem resolução humana) e valida a decisão. A
// autoridade é a RPC `resolve_pending_verification`, que revalida tudo sob lock e inclui
// o veredito persistido (candidato com parecer conclusivo não é pendente). Puro.

import { readVerifierRequirement } from './verifier-requirement';
import type { Json } from '@anima/types';
import type { WorkEvent, WorkItem } from './types';

export const PENDING_VERIFICATION_RECOVERY_ORIGIN = 'pending_verification_recovery' as const;

export type PendingVerificationDecision =
  | { readonly type: 'request_changes'; readonly requestedChanges: string }
  | { readonly type: 'cancel'; readonly reason?: string };

export interface PendingVerificationCandidate {
  readonly workItemId: string;
  readonly resultEventId: string;
  readonly attemptId: string;
  readonly proposalVersion: number;
}

export type PendingVerificationCandidateGap =
  | 'advisory_lane'
  | 'not_in_progress'
  | 'result_missing'
  | 'result_stale'
  | 'attempt_mismatch'
  | 'already_resolved';

export type PendingVerificationCandidateProjection =
  | { readonly pending: true; readonly candidate: PendingVerificationCandidate }
  | { readonly pending: false; readonly gap: PendingVerificationCandidateGap };

const object = (value: Json | undefined | unknown): Record<string, Json | undefined> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Json | undefined> : null;
const dataOf = (event: WorkEvent): Record<string, Json | undefined> | null => object(object(event.payload)?.data);
const text = (value: Json | undefined): string | null => typeof value === 'string' && value.length > 0 ? value : null;

/**
 * Identidade do candidato retido. `events` na ordem persistida (seq ascendente).
 * Não conhece o veredito do Verifier: um candidato com parecer conclusivo já saiu de
 * `in_progress` na mesma transação do parecer, e a RPC recusa o raro caso residual.
 */
export function projectPendingVerificationCandidate(item: WorkItem, events: readonly WorkEvent[]): PendingVerificationCandidateProjection {
  const gap = (reason: PendingVerificationCandidateGap): PendingVerificationCandidateProjection => ({ pending: false, gap: reason });
  if (readVerifierRequirement(item.intent) === 'advisory') return gap('advisory_lane');
  if (item.state !== 'in_progress') return gap('not_in_progress');

  const result = [...events].reverse().find(event => event.type === 'result_submitted');
  if (!result) return gap('result_missing');
  if (result.proposalVersion !== item.proposalVersion) return gap('result_stale');
  const attemptId = text(dataOf(result)?.attempt_id);
  const currentAttempt = [...events].reverse()
    .map(event => event.type === 'execution_started' ? text(dataOf(event)?.attempt_id) : null)
    .find((attempt): attempt is string => attempt !== null);
  if (!attemptId || attemptId !== currentAttempt) return gap('attempt_mismatch');

  const resolved = events.some(event =>
    (event.type === 'changes_requested' || event.type === 'work_cancelled') && event.author === 'user'
    && dataOf(event)?.origin === PENDING_VERIFICATION_RECOVERY_ORIGIN
    && dataOf(event)?.resolved_result_event_id === result.id);
  if (resolved) return gap('already_resolved');

  return { pending: true, candidate: { workItemId: item.id, resultEventId: result.id, attemptId, proposalVersion: item.proposalVersion } };
}

export function isValidPendingVerificationDecision(decision: unknown): decision is PendingVerificationDecision {
  const value = object(decision);
  if (!value) return false;
  if (value.type === 'request_changes') return typeof value.requestedChanges === 'string' && value.requestedChanges.trim().length > 0;
  if (value.type === 'cancel') return value.reason === undefined || (typeof value.reason === 'string' && value.reason.trim().length > 0);
  return false;
}

/** Contexto da RPC — mesmo vocabulário do review (`requested_changes`). */
export function pendingVerificationDecisionContext(decision: PendingVerificationDecision): { readonly requested_changes: string } | { readonly reason?: string } {
  return decision.type === 'request_changes'
    ? { requested_changes: decision.requestedChanges.trim() }
    : decision.reason === undefined ? {} : { reason: decision.reason.trim() };
}
