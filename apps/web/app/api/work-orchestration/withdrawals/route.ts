import type { WithdrawApprovedWorkCommand } from '@anima/core';
import { createClient } from '@/lib/supabase/server';
import { operationResponse } from '@/lib/work-orchestration/http';
import { serializeWorkItem } from '@/lib/work-orchestration/serialize';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';

// POST /api/work-orchestration/withdrawals
// Retira canonicamente um plano APROVADO NÃO INICIADO obsoleto antes da execução
// (approved → cancelled). Mesma capability que a CLI (`anima work withdraw`): a regra
// vive no application service / RPC, o adapter só encaminha. Owner-scoped por RLS.
export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const command = await request.json() as WithdrawApprovedWorkCommand;
  const result = await createWorkOrchestrationService(client).withdrawApprovedWork(command);
  return operationResponse(result, serializeWorkItem);
}
