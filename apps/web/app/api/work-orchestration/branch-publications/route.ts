import { authenticateRequest } from '@/lib/supabase/request-auth';
import { runAuthorizedBranchPublicationWithSupabase } from '@/lib/work-orchestration/branch-publication-http';
import { GitBranchPublicationProvider } from '@/lib/work-orchestration/git-branch-publication';
import { branchPublicationTargetFromEnvironment } from '@/lib/work-orchestration/integration-target';

export const runtime = 'nodejs';
export const maxDuration = 120;

// work_item_id é um UUID gerado pelo banco. Validar o formato aqui traduz um
// payload malformado em 400, em vez de deixá-lo falhar como 22P02 (cast de UUID)
// lá no fundo e virar um 500 opaco.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!UUID.test(workItemId)) {
    return Response.json({ ok: false, error: { code: 'invalid_input', message: 'workItemId precisa ser um UUID.' } }, { status: 400 });
  }

  const configured = branchPublicationTargetFromEnvironment();
  if (!configured) {
    return Response.json({
      ok: false,
      error: { code: 'integration_target_not_configured', message: 'Publicação protegida não está configurada neste servidor.' },
    }, { status: 503 });
  }

  const provider = new GitBranchPublicationProvider(configured.repoRoot);
  // A autorização de integração já está persistida ANTES desta rota; publicar a
  // branch é efeito mutativo externo (git push). Depois disso, o ciclo NÃO herda o
  // lifetime do transporte HTTP: abandonar a página ou perder a conexão não
  // equivale a um pedido humano de cancelamento e não pode abortar o push no meio
  // (efeito possível + nada persistido = ambiguidade). Mesmo racional de
  // /supervisor-turn (3c9ac70) e /execute-commanded; a reconciliação
  // (inspect-antes-de-publicar + idempotência) e a autorização persistida são as
  // fronteiras reais.
  const executionSignal = new AbortController().signal;
  const outcome = await runAuthorizedBranchPublicationWithSupabase(client, {
    workItemId,
    target: configured.target,
    provider,
    signal: executionSignal,
  });
  return Response.json(outcome.body, { status: outcome.status });
}
