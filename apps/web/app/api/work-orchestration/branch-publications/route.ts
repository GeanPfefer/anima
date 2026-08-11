import { authenticateRequest } from '@/lib/supabase/request-auth';
import { supabaseBranchReceiptPersistence } from '@/lib/work-orchestration/branch-publication-operation';
import { runAuthorizedBranchPublication } from '@/lib/work-orchestration/branch-publication-http';
import { GitBranchPublicationProvider } from '@/lib/work-orchestration/git-branch-publication';
import { branchPublicationTargetFromEnvironment } from '@/lib/work-orchestration/integration-target';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

// ADR-002 — PRIMEIRO efeito Git externo real do produto, fiado ao caminho vivo.
// Dispara a publicação PROTEGIDA de branch (push da branch anima-work/ autorizada,
// nunca PR/merge/integrated) a partir de uma autorização de integração já
// persistida. O corpo carrega SOMENTE `workItemId`: remote, repositório, base,
// provider, branch, SHA e idempotencyKey são reconstruídos do servidor (env do
// operador + log persistido). Nada do cliente vira argumento Git. Ausência de
// configuração de alvo é fail-closed (503): sem ato explícito do operador não há
// capacidade de push. Autenticação obrigatória; a autoridade é `auth.uid()` via
// RLS, o mesmo que a RPC de persistência exige — jamais um user_id do corpo.
export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const { client } = auth;

  const body = await request.json().catch(() => null) as { workItemId?: unknown } | null;
  const workItemId = typeof body?.workItemId === 'string' ? body.workItemId.trim() : '';
  if (!workItemId) {
    return Response.json({ ok: false, error: { code: 'invalid_input', message: 'workItemId é obrigatório.' } }, { status: 400 });
  }

  const configured = branchPublicationTargetFromEnvironment();
  if (!configured) {
    return Response.json({
      ok: false,
      error: { code: 'integration_target_not_configured', message: 'Publicação protegida não está configurada neste servidor.' },
    }, { status: 503 });
  }

  const provider = new GitBranchPublicationProvider(configured.repoRoot);
  const service = createWorkOrchestrationService(client);
  const readEvents = async (id: string) => {
    const result = await service.listEvents(id);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  const outcome = await runAuthorizedBranchPublication({
    workItemId,
    target: configured.target,
    provider,
    readEvents,
    persist: supabaseBranchReceiptPersistence(client),
    signal: request.signal,
  });
  return Response.json(outcome.body, { status: outcome.status });
}
