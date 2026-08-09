import type { DecideIntegrationCommand } from '@anima/core';
import { createClient } from '@/lib/supabase/server';
import { operationResponse } from '@/lib/work-orchestration/http';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';

// ADR-002 — segunda aprovação humana da integração. Persiste apenas a decisão
// (integration_decided) sobre um resultado já aceito; NÃO integra, NÃO publica,
// NÃO faz efeito Git. Auth + ownership + versão + idempotência + correlação são
// garantidos pela RPC decide_integration; aqui só há autenticação e encaminhamento.
export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const command = await request.json() as DecideIntegrationCommand;
  const result = await createWorkOrchestrationService(client).decideIntegration(command);
  return operationResponse(result, outcome => outcome);
}
