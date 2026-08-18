import { createClient } from '@/lib/supabase/server';
import { operationResponse } from '@/lib/work-orchestration/http';
import { serializeWorkItem } from '@/lib/work-orchestration/serialize';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { composeItemGateAdvisory, declaredCoderBackendId, declaredGateCommands } from '@/lib/work-orchestration/resource-governor';

// Leitura read-only do Resource Governor ANTES de rodar: para os GATES declarados E o CODER
// que o contrato deste item vai rodar, o parecer relativo ao histórico machine-wide + a pressão
// atual da máquina. Serve à decisão de "vale rodar agora?" — informa, nunca decide/bloqueia/atua.
//
// `nodejs` porque a composição lê a telemetria viva da máquina (`node:os`) pelo seam central. A
// leitura de eventos é machine-wide (`listEventsByType`), isolada pela RLS já ratificada de
// work_events (o mesmo padrão do read de item aqui do lado). Busca gate E coder; gate e coder
// mantêm referências de custo SEPARADAS na composição.
export const runtime = 'nodejs';

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const { id } = await context.params;
  const service = createWorkOrchestrationService(client);
  const item = await service.getItem(id);
  if (!item.ok) return operationResponse(item, serializeWorkItem);
  const [gateEvents, coderEvents] = await Promise.all([
    service.listEventsByType('host_observed_gate_evidence_recorded'),
    service.listEventsByType('host_observed_coder_evidence_recorded'),
  ]);
  if (!gateEvents.ok) return operationResponse(gateEvents, () => []);
  if (!coderEvents.ok) return operationResponse(coderEvents, () => []);
  const report = composeItemGateAdvisory({
    commands: declaredGateCommands(item.value),
    coderBackendId: declaredCoderBackendId(item.value),
    events: [...gateEvents.value, ...coderEvents.value],
  });
  return Response.json({ ok: true, value: { resourceGovernor: report } });
}
