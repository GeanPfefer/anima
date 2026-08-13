import type { IntegrationTarget, ReviewRequestProvider } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ReviewRequestFailure } from './github-review-request';
import { ReviewRequestPrecondition, executeAuthorizedReviewRequest, executeAuthorizedReviewRequestWithSupabase } from './authorized-review-request';

// Tradução fail-closed provider → coordenador → HTTP para review request. Regras:
// - Precondição sobre o estado persistido (autorização/handoff/branch ausentes ou
//   divergentes) → 409/404: condição do estado, não erro de servidor.
// - Falha do provider: indisponibilidade/limite de taxa → 502 (retryável);
//   credencial/config/derivação (o servidor constrói a request e detém o token) →
//   500; divergência de estado/validação/pós-verificação → 409.
// - Erro da RPC de persistência mapeado pelo SQLSTATE, com mensagem CONTROLADA.
// - Qualquer outra coisa → 500. Nenhuma mensagem carrega caminho, remote, token,
//   stderr ou SHA de terceiros.

export interface ReviewRequestHttpError {
  readonly code: string;
  readonly message: string;
  readonly status: number;
  readonly retryable: boolean;
}

const postgrestCode = (error: unknown): string | null => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
};

export function classifyReviewRequestError(error: unknown): ReviewRequestHttpError {
  if (error instanceof ReviewRequestPrecondition) {
    // branch_not_published/authorization/handoff ausentes são "não criável ainda"
    // (404); as demais são conflito de estado (409).
    const status = error.code === 'authorization_not_found' || error.code === 'handoff_not_found' || error.code === 'branch_not_published' ? 404 : 409;
    return { code: error.code, message: error.message, status, retryable: false };
  }
  if (error instanceof ReviewRequestFailure) {
    // provider_unavailable/rate_limited: retryável (502). credencial/config/
    // derivação são do SERVIDOR (500), nunca erro de cliente. Divergência de
    // estado/validação/pós-verificação: conflito (409).
    const status = error.code === 'provider_unavailable' || error.code === 'rate_limited' ? 502
      : error.code === 'credentials_missing' || error.code === 'not_authorized' || error.code === 'repository_mismatch' || error.code === 'repository_not_found' || error.code === 'invalid_request' ? 500
        : 409;
    return { code: error.code, message: error.message, status, retryable: status === 502 };
  }
  switch (postgrestCode(error)) {
    case '42501': return { code: 'orchestration_forbidden', message: 'Orquestração de trabalho não habilitada para este usuário.', status: 403, retryable: false };
    case 'P0002': return { code: 'not_reviewable', message: 'Não há branch publicada e autorização de integração para criar review request neste item.', status: 404, retryable: false };
    case '55000': return { code: 'review_request_conflict', message: 'O estado do item mudou desde a autorização; a criação de review request foi recusada.', status: 409, retryable: false };
    case '22023': return { code: 'invalid_review_request_input', message: 'A criação de review request recebeu uma entrada inválida.', status: 400, retryable: false };
    default: return { code: 'review_request_failed', message: 'A criação protegida de review request falhou de forma inesperada.', status: 500, retryable: true };
  }
}

export interface ReviewRequestHttpResult { readonly status: number; readonly body: unknown; }

type ReviewRequestOutcome = Awaited<ReturnType<typeof executeAuthorizedReviewRequest>>;

/**
 * Executa a criação de review request e traduz o desfecho para HTTP. Sucesso
 * devolve só a prova pública (review/branch/base/disposition), nunca token ou
 * repoRoot; falha devolve um código estável e mensagem controlada.
 */
async function settle(exec: () => Promise<ReviewRequestOutcome>): Promise<ReviewRequestHttpResult> {
  try {
    const result = await exec();
    const r = result.receipt;
    const value = {
      status: result.status,
      reviewRequest: {
        repositoryId: r.repositoryId,
        remoteName: r.remoteName,
        reviewId: r.reviewId,
        reviewReference: r.reviewReference,
        sourceBranch: r.sourceBranch,
        sourceCommitSha: r.sourceCommitSha,
        baseBranch: r.baseBranch,
        state: r.state,
        disposition: r.disposition,
      },
      ...(result.status === 'created' ? { persistence: result.persistence } : {}),
    };
    return { status: 200, body: { ok: true, value } };
  } catch (error) {
    const classified = classifyReviewRequestError(error);
    return {
      status: classified.status,
      body: { ok: false, error: { code: classified.code, message: classified.message, retryable: classified.retryable } },
    };
  }
}

/** Ponto de entrada de baixo nível (readEvents/persist/provider injetados) — usado
 * pelos testes com fakes e pela prova de integração. */
export const runAuthorizedReviewRequest = (
  input: Parameters<typeof executeAuthorizedReviewRequest>[0],
): Promise<ReviewRequestHttpResult> => settle(() => executeAuthorizedReviewRequest(input));

/** Ponto de entrada da rota: compõe readEvents/persist a partir do cliente
 * Supabase autenticado (RLS) e traduz o desfecho para HTTP. */
export const runAuthorizedReviewRequestWithSupabase = (
  client: SupabaseClient<Database>,
  input: { readonly workItemId: string; readonly target: IntegrationTarget; readonly provider: ReviewRequestProvider; readonly signal?: AbortSignal },
): Promise<ReviewRequestHttpResult> => settle(() => executeAuthorizedReviewRequestWithSupabase(client, input));
