// Mandated Verifier Enforcement V0 (2026-09-28) — Verifier OBRIGATÓRIO por lane.
//
// Antes: o parecer do Verifier era só advisory/fail-open em todo lugar. Ele roda
// na observação pós-turno (`persistPostTurnHostObservations`), DEPOIS de o
// `result_submitted` já ter levado o item a `review`; exceção, persistência falha,
// parecer ausente/inconclusivo ou rejeitado eram todos silenciosos, e o resultado
// seguia aceitável pelo humano como qualquer outro.
//
// Agora: um item cujo `execution_spec.verifier_requirement` é
// `required_fail_closed` (o lane mandatado de worktree — o materializer canônico
// grava e o Envelope V1 exige) só pode ter o RESULTADO ACEITO quando existe um
// parecer do Verifier VÁLIDO, CORRELACIONADO ao resultado revisado e com veredito
// `verified`. Qualquer outra coisa nega o aceite (fail-closed); `request_changes`
// continua disponível (retrabalho pelo fluxo de correção existente).
//
// O Verifier é salvaguarda TÉCNICA, não autoridade de produto: `verified` NÃO
// aceita nem integra nada — só deixa de bloquear o aceite HUMANO.
// Itens sem o marcador seguem `advisory` (comportamento anterior, inalterado).
// Puro.

import { projectLatestWorkResult } from './presentation';
import { projectVerifierOpinionHistory, type VerifierOpinionV1 } from './verifier-opinion';
import { projectWorktreeHandoff } from './worktree-handoff';
import type { WorkEvent, WorkItem } from './types';

export const VERIFIER_REQUIREMENT_KEY = 'verifier_requirement' as const;

export type VerifierRequirement = 'advisory' | 'required_fail_closed';

/** Vereditos que CONCLUEM o parecer. `inconclusive` não conclui. */
export const CONCLUSIVE_VERIFIER_VERDICTS = ['verified', 'rejected'] as const;

export type VerifierRequirementRefusal =
  /** Não há resultado submetido (ou o revisado não é o último): não há o que aceitar. */
  | 'verifier_result_missing'
  | 'verifier_result_stale'
  /** Nenhum parecer persistido (Verifier não rodou, lançou ou a persistência falhou). */
  | 'verifier_missing'
  /** Há pareceres, mas nenhum correlacionado a ESTE resultado/attempt/versão. */
  | 'verifier_uncorrelated'
  | 'verifier_inconclusive'
  | 'verifier_rejected'
  /** V0.1: o parecer decisivo não se apoia em evidência git E gate observadas pelo host
   * (espelho de `private.mandated_result_verdict`, que também confere coder e commit). */
  | 'verifier_evidence_incomplete';

export type VerifierRequirementEvaluation =
  | { readonly requirement: 'advisory'; readonly satisfied: true }
  | { readonly requirement: 'required_fail_closed'; readonly satisfied: true; readonly opinion: VerifierOpinionV1 }
  | { readonly requirement: 'required_fail_closed'; readonly satisfied: false; readonly reason: VerifierRequirementRefusal };

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * Exigência declarada no `execution_spec`. Ausente ou `advisory` ⇒ `advisory`.
 * Qualquer OUTRO valor presente ⇒ `required_fail_closed` (na dúvida, exige).
 */
export function readVerifierRequirement(intent: unknown): VerifierRequirement {
  const spec = asObject(asObject(intent)?.execution_spec);
  const value = spec?.[VERIFIER_REQUIREMENT_KEY];
  if (value === undefined || value === 'advisory') return 'advisory';
  return 'required_fail_closed';
}

/**
 * Avalia se o aceite do resultado pode prosseguir sob a exigência do lane.
 * `reviewedResultEventId`: o resultado que o humano está aceitando (ausente ⇒ o último).
 * O parecer decisivo é o MAIS RECENTE correlacionado ao resultado revisado (um
 * `rejected` posterior derruba um `verified` anterior; parecer de outra attempt,
 * versão ou resultado nunca conta).
 */
export function evaluateVerifierRequirement(
  item: WorkItem,
  events: readonly WorkEvent[],
  reviewedResultEventId?: string,
): VerifierRequirementEvaluation {
  if (readVerifierRequirement(item.intent) === 'advisory') return { requirement: 'advisory', satisfied: true };
  const deny = (reason: VerifierRequirementRefusal): VerifierRequirementEvaluation =>
    ({ requirement: 'required_fail_closed', satisfied: false, reason });

  const latest = projectLatestWorkResult(events);
  const handoff = projectWorktreeHandoff(events);
  if (latest === null || handoff === null) return deny('verifier_result_missing');
  if (latest.proposalVersion !== item.proposalVersion) return deny('verifier_result_stale');
  if (reviewedResultEventId !== undefined && reviewedResultEventId !== latest.eventId) return deny('verifier_result_stale');

  const history = projectVerifierOpinionHistory(events);
  if (history.length === 0) return deny('verifier_missing');

  const correlated = history.filter((opinion) =>
    opinion.workItemId === item.id
    && opinion.approvedProposalVersion === item.proposalVersion
    && opinion.attemptId === handoff.attemptId
    && opinion.evidenceBasis.resultEventId === latest.eventId);
  const decisive = correlated[correlated.length - 1];
  if (!decisive) return deny('verifier_uncorrelated');
  if (decisive.evidenceBasis.observedEventId === null || decisive.evidenceBasis.observedGateEventId === null) {
    return deny('verifier_evidence_incomplete');
  }
  if (decisive.verdict === 'rejected') return deny('verifier_rejected');
  if (decisive.verdict !== 'verified') return deny('verifier_inconclusive');
  return { requirement: 'required_fail_closed', satisfied: true, opinion: decisive };
}
