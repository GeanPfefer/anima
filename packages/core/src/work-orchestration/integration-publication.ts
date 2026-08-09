import type { ExecutionAttemptCorrelation } from './execution-attempt';
import type { ExecutionEventCorrelation } from './execution-event-correlation';
import type { IntegrationBoundary, RecordIntegrationInput } from './integration-boundary';
import { isAnimaWorktreeBranch, type WorktreeHandoffV1 } from './worktree-handoff';

// ============================================================
// Camada de aplicação/integração/publicação real — SUBSTRATO PURO (ADR-002).
//
// NÃO ratificado e INERTE por construção. Deriva o que publicar SOMENTE de uma
// `IntegrationBoundary` já AUTORIZADA (o contrato ratificado do INT-03) somada à
// evidência durável do INT-05, e define a porta provider-agnóstica que um
// adaptador real (git/GitHub, fora do core) implementaria atrás da segunda
// aprovação humana (Marco 003).
//
// Este módulo NÃO importa `fs`, `child_process`, rede nem GitHub; NÃO faz push,
// PR, merge ou apply; NÃO persiste. É impossível, por construção, derivar uma
// publicação sem uma autorização humana registrada: sem `integration_authorized`
// não há request — logo não há o que um publisher execute.
// ============================================================

const SHA = /^[a-f0-9]{40}$/;
const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** O que publicar, derivado fail-closed de (fronteira autorizada, evidência). */
export interface IntegrationPublicationRequest {
  readonly idempotencyKey: string;
  readonly correlation: ExecutionAttemptCorrelation;
  readonly authorizationDecisionId: string;
  readonly acceptedResultEventId: string;
  readonly baseSha: string;
  readonly branch: string;
  readonly commitSha: string;
  readonly executorId: string;
  readonly backendId: string;
}

export type IntegrationPublicationDefect =
  | 'not_authorized'
  | 'correlation_mismatch'
  | 'branch_not_owned'
  | 'result_not_succeeded'
  | 'already_published'
  | 'invalid_input';

export type IntegrationPublicationRequestResult =
  | { readonly ok: true; readonly value: IntegrationPublicationRequest }
  | { readonly ok: false; readonly defect: IntegrationPublicationDefect; readonly explanation: string };

const failReq = (defect: IntegrationPublicationDefect, explanation: string): IntegrationPublicationRequestResult =>
  ({ ok: false, defect, explanation });

/** Chave de idempotência canônica e determinística: a mesma autorização sobre o
 * mesmo commit produz sempre a mesma chave, sem relógio nem dado variável. É o
 * eixo anti-duplicação de todo o fluxo (D5). */
export const publicationIdempotencyKey = (authorizationDecisionId: string, commitSha: string): string =>
  `integration-publication:${authorizationDecisionId}:${commitSha}`;

/**
 * Deriva a request de publicação de uma fronteira de integração. Fail-closed em
 * toda ambiguidade (D4): exige `integration_authorized` com decisão `authorize`,
 * o aceite carregando o resultado exato, a evidência do INT-05 correlacionada à
 * mesma tentativa, branch sob o namespace do Anima, desfecho de sucesso, estado
 * `local_only` e SHAs completos e distintos. Sem esses fatos NÃO há request —
 * é assim que publicar sem aprovação humana se torna impossível, não improvável.
 */
export function buildIntegrationPublicationRequest(
  boundary: IntegrationBoundary,
  handoff: WorktreeHandoffV1,
): IntegrationPublicationRequestResult {
  const decision = boundary.integrationDecision;
  const acceptance = boundary.acceptance;
  if (boundary.status !== 'integration_authorized' || decision === undefined
    || decision.decision !== 'authorize' || !nonBlank(decision.decisionId)) {
    return failReq('not_authorized', 'A publicação exige uma fronteira em integration_authorized com decisão authorize.');
  }
  if (acceptance === undefined || !nonBlank(acceptance.acceptedResultEventId)) {
    return failReq('invalid_input', 'A fronteira autorizada precisa carregar o aceite com o resultado exato.');
  }
  const correlation = boundary.correlation;
  if (handoff.workItemId !== correlation.workItemId || handoff.attemptId !== correlation.attemptId
    || handoff.approvedProposalVersion !== correlation.approvedProposalVersion) {
    return failReq('correlation_mismatch', 'A evidência de worktree não corresponde à tentativa autorizada.');
  }
  if (!isAnimaWorktreeBranch(handoff.branch)) {
    return failReq('branch_not_owned', 'A branch a publicar precisa pertencer ao namespace de trabalho do Anima.');
  }
  if (handoff.status !== 'succeeded') {
    return failReq('result_not_succeeded', 'Só um desfecho de sucesso pode ser publicado.');
  }
  if (handoff.publicationState !== 'local_only') {
    return failReq('already_published', 'A evidência já não está em estado local_only.');
  }
  if (!SHA.test(handoff.baseSha) || !SHA.test(handoff.commitSha) || handoff.baseSha === handoff.commitSha) {
    return failReq('invalid_input', 'base_sha e commit precisam ser SHAs completos e distintos.');
  }
  const value: IntegrationPublicationRequest = {
    idempotencyKey: publicationIdempotencyKey(decision.decisionId, handoff.commitSha),
    correlation: {
      attemptId: correlation.attemptId,
      workItemId: correlation.workItemId,
      approvedProposalVersion: correlation.approvedProposalVersion,
    },
    authorizationDecisionId: decision.decisionId,
    acceptedResultEventId: acceptance.acceptedResultEventId,
    baseSha: handoff.baseSha,
    branch: handoff.branch,
    commitSha: handoff.commitSha,
    executorId: handoff.executorId,
    backendId: handoff.backendId,
  };
  return { ok: true, value };
}

export type IntegrationPublicationErrorCode =
  | 'provider_unavailable'
  | 'credentials_missing'
  | 'base_sha_mismatch'
  | 'commit_not_found'
  | 'branch_conflict'
  | 'publish_failed';

export type IntegrationPublicationOutcome =
  | { readonly ok: true; readonly reviewableReference: string; readonly idempotencyKey: string }
  | { readonly ok: false; readonly code: IntegrationPublicationErrorCode; readonly message: string; readonly retryable: boolean };

/**
 * Porta provider-agnóstica (D3). O adaptador concreto (git/GitHub) vive fora do
 * core e atrás da segunda aprovação humana; o core só conhece esta interface. Um
 * publisher correto é **idempotente por `idempotencyKey`** ("create-or-get"): a
 * mesma request após um crash não pode produzir um segundo efeito externo.
 */
export interface IntegrationPublisher {
  readonly id: string;
  publish(request: IntegrationPublicationRequest, signal?: AbortSignal): Promise<IntegrationPublicationOutcome>;
}

const errorCodes: ReadonlySet<string> = new Set([
  'provider_unavailable', 'credentials_missing', 'base_sha_mismatch', 'commit_not_found', 'branch_conflict', 'publish_failed',
]);

/**
 * Régua fail-closed do outcome, cruzada com a request que o originou: um sucesso
 * tem de carregar a MESMA `idempotencyKey` e uma referência revisável não vazia;
 * uma falha, um código conhecido e mensagem. Devolve a razão da recusa, ou `null`.
 */
export function validatePublicationOutcome(
  request: IntegrationPublicationRequest,
  outcome: IntegrationPublicationOutcome,
): string | null {
  if (outcome.ok) {
    if (outcome.idempotencyKey !== request.idempotencyKey) return 'O outcome de sucesso perdeu a chave de idempotência da request.';
    if (!nonBlank(outcome.reviewableReference)) return 'Um sucesso precisa de uma referência revisável não vazia.';
    return null;
  }
  if (!errorCodes.has(outcome.code) || !nonBlank(outcome.message)) return 'Uma falha precisa de código conhecido e mensagem.';
  return null;
}

/**
 * Ponte pura para o `recordIntegrated` ratificado: converte um outcome de sucesso
 * VALIDADO no input do registro, com `recordId` determinístico derivado da
 * `idempotencyKey` — replay/retry produz o mesmo registro e mantém `recordIntegrated`
 * idempotente. Devolve `null` para qualquer outcome que não seja um sucesso válido:
 * registrar integração sem publicação confirmada seria o estado interno mentindo
 * (D6), então uma falha externa jamais vira `integrated`.
 */
export function buildIntegrationRecordInput(
  request: IntegrationPublicationRequest,
  outcome: IntegrationPublicationOutcome,
): RecordIntegrationInput | null {
  if (!outcome.ok || validatePublicationOutcome(request, outcome) !== null) return null;
  const correlation: ExecutionEventCorrelation = { ...request.correlation, origin: 'system' };
  return {
    workItemState: 'completed',
    recordId: `integration-record:${request.idempotencyKey}`,
    authorizationDecisionId: request.authorizationDecisionId,
    correlation,
  };
}
