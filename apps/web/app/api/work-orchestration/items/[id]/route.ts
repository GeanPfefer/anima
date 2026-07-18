import { createClient } from '@/lib/supabase/server';
import { operationResponse } from '@/lib/work-orchestration/http';
import { serializeReconstructedWorkPresentation, serializeWorkEvent, serializeWorkItem } from '@/lib/work-orchestration/serialize';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const client = await createClient(); const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const { id } = await context.params; const service = createWorkOrchestrationService(client);
  const item = await service.getItem(id); if (!item.ok) return operationResponse(item, serializeWorkItem);
  const events = await service.listEvents(id); if (!events.ok) return operationResponse(events, () => []);
  const contexts = await service.listContexts(id); if (!contexts.ok) return operationResponse(contexts, () => []);
  return Response.json({ ok: true, value: { presentation: serializeReconstructedWorkPresentation(item.value,events.value,contexts.value), item: serializeWorkItem(item.value), events: events.value.map(serializeWorkEvent), contexts: contexts.value.map(value => ({ ...value, createdAt: value.createdAt.toISOString() })) } });
}
