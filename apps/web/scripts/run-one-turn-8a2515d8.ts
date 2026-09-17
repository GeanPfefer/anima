// OPERACIONAL (não commitar): dispara EXATAMENTE UM host-turn canônico para o item
// 8a2515d8, com a MELHOR rota de compute para esta etapa (coder OpenAI FORTE gpt-5.6-terra),
// via a MESMA composição de produção (`runProjectBacklogHostTurn`) — sem daemon, sem loop.
//
// Rota escolhida (autorização humana para MAXIMIZAR capacidade de self-dev):
//   • Compute Router V1 LIGADO (decide Ollama-local × OpenAI-API).
//   • Política de capacidade HONESTA da Goma (16 GB) declarada: qwen3-coder:latest (30B)
//     exige ~20 GB ⇒ NÃO cabe localmente (barreira de RAM documentada). Logo o candidato
//     LOCAL é inadmissível e o Router seleciona OpenAI (autoridade paga provider_api ativa
//     do item). Selecionado OpenAI ⇒ placement=null ⇒ NENHUM burst RunPod (nem gasto GPU).
//   • On-demand node DESLIGADO (defesa em profundidade contra qualquer gasto GPU).
//
// Identidade RESIDENTE (GoTrue → Bearer → RLS), NUNCA service_role. Reconciliação de leases
// pagas órfãs ANTES da volta. Desfecho máximo do item = `review` (não aceita/integra/mergeia).
// Segredos NUNCA impressos.

// Env da rota — setado no processo ANTES de qualquer leitura em runtime (as funções que leem
// env — computeRouterEnabled/resolveCoderCapacityPolicy/onDemandBurstForced — leem no CALL,
// não no import). NUNCA grava em .env.local (arquivo preservado).
process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED = '1';
process.env.ANIMA_ON_DEMAND_NODE_ENABLED = 'false';
process.env.ANIMA_CODER_VRAM_GB = '16';
process.env.ANIMA_CODER_MODEL_ALLOWLIST = JSON.stringify([{ model: 'qwen3-coder:latest', requiresGb: 20 }]);

import { createGoTrueIdentityProvider } from '@/lib/resident-host/ports';
import { createBearerClient } from '@/lib/supabase/bearer';
import { reconcilePaidComputeLeasesFor } from '@/lib/work-orchestration/paid-compute-lease-reconciler-deps';
import { runProjectBacklogHostTurn } from '@/lib/work-orchestration/backlog-host-turn-run';

const WORK_ITEM_ID = '8a2515d8-6967-463e-af2a-fd5d2b5e42a1';
const OWNER_INSTANCE_ID = process.env.ANIMA_SUPERVISOR_INSTANCE_ID ?? 'oneshot-best-capability-8a2515d8';

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

async function main(): Promise<void> {
  log('route', {
    router: process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED,
    onDemandNode: process.env.ANIMA_ON_DEMAND_NODE_ENABLED,
    coderVramGb: process.env.ANIMA_CODER_VRAM_GB,
    openAIModel: process.env.OPENAI_MODEL ?? null,
    aiProvider: process.env.ANIMA_AI_PROVIDER ?? null,
  });

  const acquireIdentity = createGoTrueIdentityProvider({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    email: process.env.ANIMA_RESIDENT_EMAIL,
    password: process.env.ANIMA_RESIDENT_PASSWORD,
  });
  const identity = await acquireIdentity();
  if (!identity) throw new Error('Identidade residente indisponível (GoTrue).');
  log('identity', { userId: identity.userId });

  const client = createBearerClient(identity.accessToken);

  // Rede de segurança: teardown/reconciliação de leases pagas órfãs ANTES de agir.
  try {
    const report = await reconcilePaidComputeLeasesFor(client);
    log('paid-lease-reconcile', { tornDown: report.tornDown, retriable: report.retriable, leftAwaiting: report.leftAwaiting, results: report.results.length });
  } catch (error) {
    log('paid-lease-reconcile-error', { message: error instanceof Error ? error.message : 'reconcile_failed' });
  }

  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => { log('signal', { signal: sig }); controller.abort(); });
  }

  log('host-turn:start', { workItemId: WORK_ITEM_ID, ownerInstanceId: OWNER_INSTANCE_ID });
  const result = await runProjectBacklogHostTurn({
    client,
    ownerInstanceId: OWNER_INSTANCE_ID,
    maxTurnsPerCycle: 1,
    maxCycles: 1,
    signal: controller.signal,
    requestedWorkItemId: WORK_ITEM_ID,
  });

  log('host-turn:result', {
    continuation: result.continuation,
    stopReason: result.stopReason,
    moreWorkAvailable: result.moreWorkAvailable,
    cyclesExecuted: result.cyclesExecuted,
    itemsTouched: result.itemsTouched,
    notExecutableReason: result.notExecutableReason ?? null,
    cycles: result.cycles.map(c => ({
      turnsExecuted: c.turnsExecuted,
      stopReason: c.stopReason,
      lastOutcome: c.lastOutcome,
      notExecutableReason: c.notExecutableReason ?? null,
      turns: c.turns.map(t => ({ workItemId: t.workItemId, outcome: t.outcome, refusal: t.refusal ?? null })),
    })),
  });
}

void main().catch(error => {
  log('fatal', { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
