import type { ResolvePendingVerificationCommand } from '@anima/core';
import { createClient } from '@/lib/supabase/server';
import { operationResponse } from '@/lib/work-orchestration/http';
import { serializeWorkItem } from '@/lib/work-orchestration/serialize';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';

// POST /api/work-orchestration/pending-verification-resolutions
// Pending Verification Human Recovery V0: decisão HUMANA sobre o resultado candidato
// retido do lane com Verifier obrigatório — request_changes (→ changes_requested) ou
// cancel (→ cancelled). Mesma capability que a CLI (`anima work resolve-pending`): a
// regra vive no application service / RPC, o adapter só encaminha. Owner-scoped por
// RLS. Nunca verifica, nunca libera review, nunca aceita.
export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const command = await request.json() as ResolvePendingVerificationCommand;
  const result = await createWorkOrchestrationService(client).resolvePendingVerification(command);
  return operationResponse(result, serializeWorkItem);
}
