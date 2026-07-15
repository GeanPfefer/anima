import type { ReviseWorkProposalCommand } from '@anima/core';
import { createClient } from '@/lib/supabase/server';
import { operationResponse } from '@/lib/work-orchestration/http';
import { serializeWorkItem } from '@/lib/work-orchestration/serialize';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const command = await request.json() as ReviseWorkProposalCommand;
  const result = await createWorkOrchestrationService(client).reviseProposal(command);
  console.info('[work-orchestration]', { operation: 'reviseProposal', workItemId: command.workItemId, proposalVersion: command.expectedProposalVersion, result: result.ok ? 'success' : result.error.code });
  return operationResponse(result, serializeWorkItem);
}
