import type { ReviewWorkResultCommand } from '@anima/core';
import { createClient } from '@/lib/supabase/server';
import { operationResponse } from '@/lib/work-orchestration/http';
import { serializeWorkItem } from '@/lib/work-orchestration/serialize';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { createExternalReviewDeps, externalAcceptanceRefusal } from '@/lib/work-orchestration/external-candidate-review';

export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const command = await request.json() as ReviewWorkResultCommand;
  const service = createWorkOrchestrationService(client);
  // Trabalho EXTERNO com critério human_review: o aceite exige a revisão humana registrada para ESTE candidato (T4).
  if (command.decision?.type === 'accept') {
    const refusal = await externalAcceptanceRefusal(command.workItemId, createExternalReviewDeps(client, user.id, service));
    if (refusal) return Response.json({ ok: false, error: { code: refusal.code, message: refusal.message } }, { status: 409 });
  }
  const result = await service.reviewResult(command);
  return operationResponse(result, serializeWorkItem);
}
