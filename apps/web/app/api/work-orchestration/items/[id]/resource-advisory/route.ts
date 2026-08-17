import { createClient } from '@/lib/supabase/server';
import { operationResponse } from '@/lib/work-orchestration/http';
import { serializeWorkItem } from '@/lib/work-orchestration/serialize';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { composeItemGateAdvisory, declaredGateCommands } from '@/lib/work-orchestration/resource-governor';

// Leitura read-only do Resource Governor ANTES de rodar: para os gates DECLARADOS no
// contrato deste item, o parecer relativo ao histórico machine-wide + a pressão atual da
// máquina. Serve à decisão de "vale rodar agora?" — informa, nunca decide/bloqueia/atua.
//
// `nodejs` porque a composição lê a telemetria viva da máquina (`node:os`) pelo seam
// central. A leitura de eventos é machine-wide (`listEventsByType`), isolada pela RLS já
// ratificada de work_events (o mesmo padrão do read de item aqui do lado).
export const runtime = 'nodejs';

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const { id } = await context.params;
  const service = createWorkOrchestrationService(client);
  const item = await service.getItem(id);
  if (!item.ok) return operationResponse(item, serializeWorkItem);
  const events = await service.listEventsByType('host_observed_gate_evidence_recorded');
  if (!events.ok) return operationResponse(events, () => []);
  const report = composeItemGateAdvisory({ commands: declaredGateCommands(item.value), events: events.value });
  return Response.json({ ok: true, value: { resourceGovernor: report } });
}
