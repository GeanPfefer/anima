import { createClient } from '@/lib/supabase/server';
import type { WorkItem } from '@anima/core';
import { operationResponse } from '@/lib/work-orchestration/http';
import { serializeReconstructedWorkPresentation } from '@/lib/work-orchestration/serialize';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
export async function GET(_: Request, context: { params: Promise<{ sourceMessageId: string }> }) {
  const client = await createClient(); const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const { sourceMessageId } = await context.params;
  const service = createWorkOrchestrationService(client);
  const items = await service.findItemsBySourceMessageId(sourceMessageId);
  if (!items.ok) return operationResponse<readonly WorkItem[]>(items, value => value);
  const enriched = await Promise.all(items.value.map(async item => {
    const events = await service.listEvents(item.id);
    const contexts = await service.listContexts(item.id);
    if(!events.ok||!contexts.ok)return null;
    return serializeReconstructedWorkPresentation(item,events.value,contexts.value);
  }));
  if(enriched.some(value=>value===null))return Response.json({ok:false,error:{code:'persistence_failure',message:'Não foi possível reconstruir a proveniência do trabalho.'}},{status:503});
  return Response.json({ ok: true, value: enriched });
}
