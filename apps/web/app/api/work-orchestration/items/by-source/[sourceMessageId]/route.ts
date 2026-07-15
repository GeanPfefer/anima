import { createClient } from '@/lib/supabase/server';
import type { WorkItem } from '@anima/core';
import { operationResponse } from '@/lib/work-orchestration/http';
import { serializeWorkItem } from '@/lib/work-orchestration/serialize';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
export async function GET(_: Request, context: { params: Promise<{ sourceMessageId: string }> }) {
  const client = await createClient(); const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const { sourceMessageId } = await context.params;
  const service = createWorkOrchestrationService(client);
  const items = await service.findItemsBySourceMessageId(sourceMessageId);
  if (!items.ok) return operationResponse<readonly WorkItem[]>(items, value => value.map(serializeWorkItem));
  const enriched = await Promise.all(items.value.map(async item => {
    const events = await service.listEvents(item.id);
    return { ...serializeWorkItem(item), ...(events.ok && events.value.length > 0 ? { lastEventType: events.value[events.value.length - 1]!.type } : {}) };
  }));
  return Response.json({ ok: true, value: enriched });
}
