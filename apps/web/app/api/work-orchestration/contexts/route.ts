import type { AttachWorkContextCommand } from '@anima/core';
import { createClient } from '@/lib/supabase/server';
import { operationResponse } from '@/lib/work-orchestration/http';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';

export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const command = await request.json() as AttachWorkContextCommand;
  const result = await createWorkOrchestrationService(client).attachContext(command);
  return operationResponse(result, context => ({ ...context, createdAt: context.createdAt.toISOString() }));
}
