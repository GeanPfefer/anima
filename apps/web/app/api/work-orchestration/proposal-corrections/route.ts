import { createChatProjectPlanner, planExecutableProjectWorkRevision } from '@/lib/ai/project-work-planner';
import { parseExplicitChatProvider } from '@/lib/ai/chat-provider';
import { createClient } from '@/lib/supabase/server';
import { operationResponse } from '@/lib/work-orchestration/http';
import { serializeWorkItem } from '@/lib/work-orchestration/serialize';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';

export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();

  if (!user) {
    return Response.json(
      { ok: false, error: { code: 'authentication_required' } },
      { status: 401 },
    );
  }

  const input = await request.json() as {
    workItemId?: unknown;
    expectedProposalVersion?: unknown;
    requestedChanges?: unknown;
    provider?: unknown;
  };

  // A correção herda a MESMA autoridade interativa do turno de criação: o provider
  // selecionado pelo usuário no Chat Dev. Sem uma seleção explícita e suportada,
  // falha fechado como input incompleto — nunca cai no default de deploy (OpenAI
  // paga) nem faz qualquer fallback silencioso de/para o modelo local.
  const provider = parseExplicitChatProvider(input.provider);

  if (
    typeof input.workItemId !== 'string'
    || typeof input.expectedProposalVersion !== 'number'
    || typeof input.requestedChanges !== 'string'
    || provider === null
  ) {
    return Response.json(
      { ok: false, error: { code: 'invalid_input', message: 'Correção inválida.' } },
      { status: 400 },
    );
  }

  const service = createWorkOrchestrationService(client);
  const current = await service.getItem(input.workItemId);
  if (!current.ok) return operationResponse(current, serializeWorkItem);

  // Mesmo factory interativo canônico do turno de criação (chat/route.ts): o
  // provider do request escolhe o planner e, no caminho OpenAI, amarra o user.id
  // real ao envelope de admissão paga. Recusa de admissão falha no próprio
  // provider selecionado, sem trocar GPT↔Local.
  const planned = await planExecutableProjectWorkRevision(
    current.value,
    input.requestedChanges,
    createChatProjectPlanner(provider, user.id),
  );

  if (!planned.ok) {
    return Response.json(
      {
        ok: false,
        error: {
          code: 'project_planning_failed',
          message: planned.message,
        },
      },
      { status: 422 },
    );
  }

  const result = await service.requestProposalRevision({
    workItemId: input.workItemId,
    expectedProposalVersion: input.expectedProposalVersion,
    ...planned.revision,
  });

  return operationResponse(result, serializeWorkItem);
}