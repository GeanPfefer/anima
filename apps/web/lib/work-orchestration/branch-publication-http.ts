import { BranchPublicationFailure } from './git-branch-publication';
import { BranchPublicationPrecondition, executeAuthorizedBranchPublication } from './authorized-branch-publication';

// Tradução fail-closed Git → provider → coordenador → HTTP. Regras:
// - Precondição sobre o estado persistido (autorização/handoff/branch ausentes ou
//   divergentes) → 409: é uma condição do estado, não um erro de servidor.
// - Falha do provider Git: divergência de repo/branch/base/commit → 409;
//   indisponibilidade do remote ou push não comprovado → 502 (retryável);
//   request inválida (não deveria ocorrer, o servidor a constrói) → 400.
// - Erro da RPC de persistência mapeado pelo SQLSTATE, com mensagem CONTROLADA
//   (nunca ecoa a mensagem crua do Postgres, para não vazar schema).
// - Qualquer outra coisa → 500: um inesperado nunca é mascarado como 409.
// Nenhuma mensagem carrega caminho, remote, stderr ou SHA de terceiros.

export interface BranchPublicationHttpError {
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

export function classifyBranchPublicationError(error: unknown): BranchPublicationHttpError {
  if (error instanceof BranchPublicationPrecondition) {
    return { code: error.code, message: error.message, status: 409, retryable: false };
  }
  if (error instanceof BranchPublicationFailure) {
    const status = error.code === 'remote_unavailable' || error.code === 'push_unverified' ? 502
      : error.code === 'invalid_request' ? 400 : 409;
    return { code: error.code, message: error.message, status, retryable: status === 502 };
  }
  switch (postgrestCode(error)) {
    case '42501': return { code: 'orchestration_forbidden', message: 'Orquestração de trabalho não habilitada para este usuário.', status: 403, retryable: false };
    case 'P0002': return { code: 'not_publishable', message: 'Não há autorização de integração publicável para este item.', status: 404, retryable: false };
    case '55000': return { code: 'publication_conflict', message: 'O estado do item mudou desde a autorização; a publicação foi recusada.', status: 409, retryable: false };
    case '22023': return { code: 'invalid_publication_input', message: 'A publicação recebeu uma entrada inválida.', status: 400, retryable: false };
    default: return { code: 'publication_failed', message: 'A publicação protegida falhou de forma inesperada.', status: 500, retryable: true };
  }
}

export interface BranchPublicationHttpResult { readonly status: number; readonly body: unknown; }

/**
 * Executa a publicação protegida e traduz o desfecho para HTTP. O provider é
 * injetado (o servidor decide qual e contra qual repoRoot); o cliente nunca o
 * escolhe. Sucesso devolve só a prova pública (branch/commit/base/disposition);
 * falha devolve um código estável e mensagem controlada.
 */
export async function runAuthorizedBranchPublication(
  input: Parameters<typeof executeAuthorizedBranchPublication>[0],
): Promise<BranchPublicationHttpResult> {
  try {
    const result = await executeAuthorizedBranchPublication(input);
    const r = result.receipt;
    const value = {
      status: result.status,
      publication: {
        repositoryId: r.repositoryId,
        remoteName: r.remoteName,
        remoteBranch: r.remoteBranch,
        commitSha: r.commitSha,
        baseBranch: r.baseBranch,
        disposition: r.disposition,
      },
      ...(result.status === 'published' ? { persistence: result.persistence } : {}),
    };
    return { status: 200, body: { ok: true, value } };
  } catch (error) {
    const classified = classifyBranchPublicationError(error);
    return {
      status: classified.status,
      body: { ok: false, error: { code: classified.code, message: classified.message, retryable: classified.retryable } },
    };
  }
}
