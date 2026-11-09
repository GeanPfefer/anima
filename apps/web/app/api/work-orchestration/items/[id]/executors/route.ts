import { createClient } from '@/lib/supabase/server';
import { operationResponse } from '@/lib/work-orchestration/http';
import { serializeWorkItem } from '@/lib/work-orchestration/serialize';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { createNodeExecutorReadinessDeps, probeAllExecutors } from '@/lib/work-orchestration/executor-readiness';
import { diagnoseCodexExecutor } from '@/lib/work-orchestration/codex-executor-diagnostics';
import { discoverWorkItemExecutors, governedExecuteOneCommand } from '@/lib/work-orchestration/work-executor-discovery';
import { readWorkHumanReference } from '@/lib/work-orchestration/work-reference';

export const runtime = 'nodejs';

// GET /api/work-orchestration/items/[id]/executors — MESMA descoberta de `anima work executors`
// (`discoverWorkItemExecutors`). READ-ONLY: sonda `--version`/`auth status` dos CLIs e o Ollama local, sem
// segredo, sem evento, sem escolher executor, sem iniciar attempt. Executar continua sendo a volta isolada
// governada (`work execute-one`), cujo comando exato é devolvido para o humano, nunca disparado aqui.
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const { id } = await context.params;
  const item = await createWorkOrchestrationService(client).getItem(id);
  if (!item.ok) return operationResponse(item, serializeWorkItem);
  const readiness = createNodeExecutorReadinessDeps();
  const discovery = await discoverWorkItemExecutors({
    item: item.value,
    probe: () => probeAllExecutors(readiness),
    diagnoseCodex: observation => diagnoseCodexExecutor(readiness, observation),
  });
  const human = readWorkHumanReference(item.value.intent);
  return Response.json({
    ok: true,
    value: {
      workItemId: item.value.id, state: item.value.state, proposalVersion: item.value.proposalVersion,
      reference: human?.reference ?? null, title: human?.title ?? null,
      ...discovery,
      governedCommand: governedExecuteOneCommand(human?.reference ?? null, item.value.id, item.value.proposalVersion),
    },
  });
}
