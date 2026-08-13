import { isAnimaWorktreeBranch, reviewRequestKey, type BranchPublicationReceipt, type ProtectedIntegrationProvider, type ProtectedIntegrationRequest, type ReviewRequestProvider, type ReviewRequestReceipt } from '@anima/core';

// ============================================================
// Provider CONCRETO de review request (GitHub) — ADR-002 fase 3.
//
// Implementa TODO o caminho local: preparar → inspecionar/reconciliar → criar →
// pós-verificar, com fail-closed em toda ambiguidade. A ÚNICA fronteira humana é
// EXECUTAR este provider contra o GitHub real (uma chamada mutativa POST /pulls);
// escrever e testar o código não é efeito externo. Todos os testes interceptam o
// transporte (fetch injetado / servidor HTTP local) — nenhuma execução desta
// sessão faz mutação real.
//
// - Provider-agnóstico por construção: recebe o transporte (`fetchImpl`) e o
//   provider de branch por composição; delega inspectBranch/publishBranch ao branch
//   provider (o mesmo id cobre toda a integração protegida).
// - Idempotente ("create-or-get"): inspeciona ANTES de criar; um POST 422
//   "already exists" reconcilia por releitura, nunca duplica.
// - Nunca faz merge, push, force ou deploy: só GET (inspeção) e POST /pulls
//   (criação de review request). A base é o alvo do operador; o head é sempre a
//   branch anima-work/ autorizada — nunca a base.
// ============================================================

const SHA = /^[a-f0-9]{40}$/;

export type ReviewRequestFailureCode =
  | 'invalid_request'
  | 'repository_mismatch'
  | 'credentials_missing'
  | 'not_authorized'        // 401/403
  | 'repository_not_found'  // 404
  | 'conflict'              // 409 ou PR já aberto em commit/base divergente
  | 'validation_failed'     // 422 que não é "já existe"
  | 'rate_limited'          // 429
  | 'provider_unavailable'  // 5xx / rede
  | 'review_unverified';    // resposta sem os campos comprovados esperados

export class ReviewRequestFailure extends Error {
  constructor(readonly code: ReviewRequestFailureCode, message: string) {
    super(message);
    this.name = 'ReviewRequestFailure';
  }
}

export interface GitHubApiConfig {
  /** Base da API (ex.: https://api.github.com; ou host GHE; ou servidor local de teste). */
  readonly apiBaseUrl: string;
  /** Token de acesso. Ausente/vazio ⇒ credentials_missing ANTES de qualquer chamada. */
  readonly token: string;
  /** Injeção do transporte; por padrão o fetch global. */
  readonly fetchImpl?: typeof fetch;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Deriva {owner, repo} de um repositoryId que seja URL do GitHub/GHE ou slug
 * `owner/repo`. Fail-closed: retorna null em qualquer formato inseguro/ambíguo. */
export function parseGitHubRepository(repositoryId: string): { owner: string; repo: string } | null {
  if (typeof repositoryId !== 'string' || repositoryId.trim().length === 0) return null;
  let value = repositoryId.trim().replace(/\.git$/i, '');
  value = value.replace(/^git@[^:]+:/i, '').replace(/^ssh:\/\/git@[^/]+\//i, '');
  value = value.replace(/^https?:\/\/[^/]+\//i, '');
  const segments = value.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const owner = segments[segments.length - 2]!;
  const repo = segments[segments.length - 1]!;
  if (!SAFE_SEGMENT.test(owner) || !SAFE_SEGMENT.test(repo)) return null;
  return { owner, repo };
}

interface GitHubPull {
  readonly number?: unknown;
  readonly html_url?: unknown;
  readonly state?: unknown;
  readonly head?: { readonly ref?: unknown; readonly sha?: unknown };
  readonly base?: { readonly ref?: unknown };
}

export class GitHubReviewRequestProvider implements ReviewRequestProvider {
  readonly id: string;
  private readonly fetchImpl: typeof fetch;
  private readonly apiBaseUrl: string;

  constructor(private readonly branchProvider: ProtectedIntegrationProvider, private readonly config: GitHubApiConfig) {
    this.id = branchProvider.id;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, '');
  }

  // Branch: delegado ao provider de branch (mesma identidade cobre toda a integração).
  inspectBranch(request: ProtectedIntegrationRequest, signal?: AbortSignal): Promise<BranchPublicationReceipt | null> {
    return this.branchProvider.inspectBranch(request, signal);
  }
  publishBranch(request: ProtectedIntegrationRequest, signal?: AbortSignal): Promise<BranchPublicationReceipt> {
    return this.branchProvider.publishBranch(request, signal);
  }

  /** Valida a request e as credenciais ANTES de qualquer chamada de rede. Lança
   * fail-closed; devolve {owner, repo} quando tudo é seguro. */
  private prepare(request: ProtectedIntegrationRequest): { owner: string; repo: string } {
    if (request.target.providerId !== this.id
      || !isAnimaWorktreeBranch(request.remoteBranch) || request.remoteBranch !== request.localBranch
      || request.remoteBranch === request.target.baseBranch
      || !SHA.test(request.baseSha) || !SHA.test(request.commitSha) || request.baseSha === request.commitSha) {
      throw new ReviewRequestFailure('invalid_request', 'Request de review request inválida ou fora do namespace autorizado.');
    }
    if (typeof this.config.token !== 'string' || this.config.token.trim().length === 0) {
      throw new ReviewRequestFailure('credentials_missing', 'Token do provider ausente: nenhuma chamada é feita sem credencial.');
    }
    const parsed = parseGitHubRepository(request.target.repositoryId);
    if (!parsed) throw new ReviewRequestFailure('repository_mismatch', 'repositoryId não resolve para um repositório owner/repo do GitHub.');
    return parsed;
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.config.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'anima-integration',
    };
  }

  /** Uma chamada à API. Erros de rede viram provider_unavailable; a resposta crua
   * (status + json) volta para o chamador mapear por status. NÃO decide efeito. */
  private async call(method: 'GET' | 'POST', path: string, body: unknown, signal?: AbortSignal): Promise<{ status: number; json: unknown }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        method,
        signal,
        headers: { ...this.headers(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      throw new ReviewRequestFailure('provider_unavailable', `Transporte indisponível: ${error instanceof Error ? error.message : String(error)}.`);
    }
    const json = await response.json().catch(() => null);
    return { status: response.status, json };
  }

  /** Mapeia um status não tratado especialmente para o código tipado. */
  private throwForStatus(status: number, context: string): never {
    if (status === 401 || status === 403) throw new ReviewRequestFailure('not_authorized', `${context}: credencial recusada (${status}).`);
    if (status === 404) throw new ReviewRequestFailure('repository_not_found', `${context}: repositório inacessível (404).`);
    if (status === 409) throw new ReviewRequestFailure('conflict', `${context}: conflito (409).`);
    if (status === 422) throw new ReviewRequestFailure('validation_failed', `${context}: validação recusada (422).`);
    if (status === 429) throw new ReviewRequestFailure('rate_limited', `${context}: limite de taxa (429).`);
    if (status >= 500) throw new ReviewRequestFailure('provider_unavailable', `${context}: provider indisponível (${status}).`);
    throw new ReviewRequestFailure('provider_unavailable', `${context}: status inesperado (${status}).`);
  }

  /** Pós-verifica o PR retornado contra a request e monta o receipt. Fail-closed:
   * head ref/sha, base ref e state têm de bater exatamente. */
  private receiptFrom(request: ProtectedIntegrationRequest, pull: GitHubPull, disposition: 'created' | 'already_existed'): ReviewRequestReceipt {
    const number = pull?.number;
    const url = pull?.html_url;
    if (typeof number !== 'number' || !Number.isInteger(number) || typeof url !== 'string' || url.trim().length === 0
      || pull?.head?.ref !== request.remoteBranch || pull?.head?.sha !== request.commitSha
      || pull?.base?.ref !== request.target.baseBranch || pull?.state !== 'open') {
      throw new ReviewRequestFailure('review_unverified', 'A resposta do provider não comprova head/base/commit/estado esperados do review request.');
    }
    return {
      kind: 'review_request',
      receiptId: `review-receipt:${reviewRequestKey(request)}`,
      idempotencyKey: reviewRequestKey(request),
      providerId: this.id,
      repositoryId: request.target.repositoryId,
      remoteName: request.target.remoteName,
      reviewId: String(number),
      reviewReference: url,
      state: 'open',
      sourceBranch: request.remoteBranch,
      sourceCommitSha: request.commitSha,
      baseBranch: request.target.baseBranch,
      verifiedBaseSha: request.baseSha,
      disposition,
    };
  }

  async inspectReviewRequest(request: ProtectedIntegrationRequest, _branch: BranchPublicationReceipt, signal?: AbortSignal): Promise<ReviewRequestReceipt | null> {
    const { owner, repo } = this.prepare(request);
    const query = `head=${encodeURIComponent(`${owner}:${request.remoteBranch}`)}&base=${encodeURIComponent(request.target.baseBranch)}&state=open`;
    const { status, json } = await this.call('GET', `/repos/${owner}/${repo}/pulls?${query}`, undefined, signal);
    if (status !== 200) this.throwForStatus(status, 'inspeção de review request');
    const list: GitHubPull[] = Array.isArray(json) ? json as GitHubPull[] : [];
    const forHead = list.filter(pr => pr?.head?.ref === request.remoteBranch);
    const exact = forHead.find(pr => pr?.head?.sha === request.commitSha && pr?.base?.ref === request.target.baseBranch);
    if (exact) return this.receiptFrom(request, exact, 'already_existed');
    // Existe PR para a mesma head, porém em commit/base divergente: a branch
    // anima-work/ é imutável no seu commit autorizado — isto é conflito, não "ausente".
    if (forHead.length > 0) throw new ReviewRequestFailure('conflict', 'Já existe review request para a branch em commit/base divergente do autorizado.');
    return null;
  }

  async createReviewRequest(request: ProtectedIntegrationRequest, branch: BranchPublicationReceipt, signal?: AbortSignal): Promise<ReviewRequestReceipt> {
    const { owner, repo } = this.prepare(request);
    // Reconcilia antes de criar (create-or-get): PR já aberto vira already_existed.
    const existing = await this.inspectReviewRequest(request, branch, signal);
    if (existing) return existing;
    const body = {
      title: `[anima] ${request.remoteBranch}`,
      head: request.remoteBranch,
      base: request.target.baseBranch,
      body: `Review request criado pelo Anima para revisão humana.\n\nwork_item: ${request.correlation.workItemId}\nattempt: ${request.correlation.attemptId}\ncommit: ${request.commitSha}\nbase: ${request.baseSha}`,
      maintainer_can_modify: false,
      draft: false,
    };
    const { status, json } = await this.call('POST', `/repos/${owner}/${repo}/pulls`, body, signal);
    if (status === 201) return this.receiptFrom(request, json as GitHubPull, 'created');
    // 422 pode ser "a pull request already exists" numa corrida: reconcilia por releitura.
    if (status === 422) {
      const reconciled = await this.inspectReviewRequest(request, branch, signal);
      if (reconciled) return reconciled;
      throw new ReviewRequestFailure('validation_failed', 'Criação recusada (422) e nenhum review request correspondente foi encontrado na releitura.');
    }
    this.throwForStatus(status, 'criação de review request');
  }
}

/** Config do provider GitHub reconstruída EXCLUSIVAMENTE do ambiente do operador,
 * fail-closed. Sem token no servidor NÃO há capacidade de criar review request e
 * a fronteira permanece intransponível por payload de cliente. */
export function githubReviewRequestConfigFromEnvironment(env: Record<string, string | undefined> = process.env): GitHubApiConfig | null {
  const token = env.ANIMA_INTEGRATION_GITHUB_TOKEN?.trim();
  if (!token) return null;
  const apiBaseUrl = (env.ANIMA_INTEGRATION_GITHUB_API_URL?.trim() || 'https://api.github.com').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(apiBaseUrl)) return null;
  return { apiBaseUrl, token };
}
