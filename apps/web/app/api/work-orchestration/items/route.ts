import type { WorkItem } from '@anima/core';
import { createClient } from '@/lib/supabase/server';
import { operationResponse } from '@/lib/work-orchestration/http';
import { serializeReconstructedWorkPresentation } from '@/lib/work-orchestration/serialize';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { projectAutonomousReadiness } from '@/lib/work-orchestration/autonomous-readiness';
import { readWorkRetryReadiness } from '@/lib/work-orchestration/retry-readiness';

// UX-04 — lista os trabalhos NÃO terminais do usuário autenticado, cada um como
// a mesma projeção reconstruída dos cartões (fonte persistida e autoritativa),
// para reencontrar e retomar trabalho pela conversa. Isolado por RLS; ordem
// determinística vem do repositório (mais recentes primeiro).
export async function GET() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const service = createWorkOrchestrationService(client);
  const items = await service.findResumableWorkItems();
  if (!items.ok) return operationResponse<readonly WorkItem[]>(items, value => value);
  const readiness=await projectAutonomousReadiness(client,items.value);
  const enriched = await Promise.all(items.value.map(async item => {
    const events = await service.listEvents(item.id);
    const contexts = await service.listContexts(item.id);
    if (!events.ok || !contexts.ok) return null;
    const retryReadiness=await readWorkRetryReadiness(client,item.id);
    return {...serializeReconstructedWorkPresentation(item, events.value, contexts.value),autonomousReadiness:readiness.get(item.id),retryReadiness};
  }));
  if (enriched.some(value => value === null)) return Response.json({ ok: false, error: { code: 'persistence_failure', message: 'Não foi possível reconstruir a proveniência dos trabalhos.' } }, { status: 503 });
  return Response.json({ ok: true, value: enriched });
}
