import { authenticateRequest } from '@/lib/supabase/request-auth';
import { runAuthorizedReviewRequestWithSupabase } from '@/lib/work-orchestration/review-request-http';
import { GitBranchPublicationProvider } from '@/lib/work-orchestration/git-branch-publication';
import { GitHubReviewRequestProvider, githubReviewRequestConfigFromEnvironment } from '@/lib/work-orchestration/github-review-request';
import { branchPublicationTargetFromEnvironment } from '@/lib/work-orchestration/integration-target';

export const runtime = 'nodejs';
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ADR-002 fase 3 — cria review request (PR) a partir de uma branch já publicada e
// de uma autorização de integração já persistidas. O corpo carrega SOMENTE
// `workItemId`: repositório, remote, base, provider, branch, SHA e idempotencyKey
// vêm do servidor (env do operador + log persistido); o token do provider NUNCA
// vem do cliente. Ausência de configuração — alvo OU token do GitHub — é
// fail-closed (503): sem ato explícito do operador não há capacidade de criar PR,
// e a fronteira permanece intransponível por payload de cliente. Autenticação
// obrigatória; a autoridade é `auth.uid()` via RLS, como a RPC de persistência
// exige. O provider é idempotente (create-or-get): só GET e POST /pulls, nunca
// merge/push/force/deploy. A criação real é o PRIMEIRO efeito externo desta linha
// e permanece uma decisão humana (habilitar o token + chamar).
export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const { client } = auth;

  const body = await request.json().catch(() => null) as { workItemId?: unknown } | null;
  const workItemId = typeof body?.workItemId === 'string' ? body.workItemId.trim() : '';
  if (!UUID.test(workItemId)) {
    return Response.json({ ok: false, error: { code: 'invalid_input', message: 'workItemId precisa ser um UUID.' } }, { status: 400 });
  }

  const configured = branchPublicationTargetFromEnvironment();
  const githubConfig = githubReviewRequestConfigFromEnvironment();
  if (!configured || !githubConfig) {
    return Response.json({
      ok: false,
      error: { code: 'review_request_not_configured', message: 'Criação de review request não está configurada neste servidor.' },
    }, { status: 503 });
  }

  const provider = new GitHubReviewRequestProvider(new GitBranchPublicationProvider(configured.repoRoot), githubConfig);
  const outcome = await runAuthorizedReviewRequestWithSupabase(client, {
    workItemId,
    target: configured.target,
    provider,
    signal: request.signal,
  });
  return Response.json(outcome.body, { status: outcome.status });
}
