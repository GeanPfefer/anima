// Executa UMA ÚNICA volta do Resident Host para o replacement 4a36b0a5, já aprovado e
// classificado. A execução paga é governada pela authority humana EXATA (openai/openai-api/
// provider_api:gpt-5.6-terra, 30 min, US$1,50, 72h, attempts=1). Não cria authority adicional,
// não abre segunda volta, não liquida reserva artificialmente e não toca origin/main.
//
// Roteamento forçado para OpenAI sem RunPod: Router V1 LIGADO + on-demand DESLIGADO + política
// de capacidade local (qwen3-coder exige 20 GiB, capacidade 16 GiB ⇒ local inviável) ⇒ o Router
// escolhe o provider pago. `ANIMA_CODER_MODEL` fixa gpt-5.6-terra para casar a resource_class da
// authority (o lookup usa provider_api:<openAIModel>).
process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED = '1';
process.env.ANIMA_ON_DEMAND_NODE_ENABLED = 'false';
process.env.ANIMA_CODER_VRAM_GB = '16';
process.env.ANIMA_CODER_MODEL_ALLOWLIST = JSON.stringify([
  { model: 'qwen3-coder:latest', requiresGb: 20 },
]);
process.env.ANIMA_CODER_MODEL = 'gpt-5.6-terra';

import { resolveCliIdentity } from '@/cli/identity';
import { runProjectBacklogHostTurn } from '@/lib/work-orchestration/backlog-host-turn-run';

const WORK_ITEM_ID = '4a36b0a5-3be8-4431-a3fa-258be13917a3';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;

  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => controller.abort());
  }

  const result = await runProjectBacklogHostTurn({
    client,
    ownerInstanceId: `selfdev-4a36b0a5-${WORK_ITEM_ID}`,
    maxTurnsPerCycle: 1,
    maxCycles: 1,
    signal: controller.signal,
    requestedWorkItemId: WORK_ITEM_ID,
  });

  console.log(JSON.stringify({
    step: 'host-turn:result',
    userId,
    continuation: result.continuation,
    stopReason: result.stopReason,
    cyclesExecuted: result.cyclesExecuted,
    itemsTouched: result.itemsTouched,
    notExecutableReason: result.notExecutableReason ?? null,
    cycles: result.cycles.map(cycle => ({
      turnsExecuted: cycle.turnsExecuted,
      stopReason: cycle.stopReason,
      lastOutcome: cycle.lastOutcome,
      notExecutableReason: cycle.notExecutableReason ?? null,
      turns: cycle.turns.map(turn => ({
        workItemId: turn.workItemId,
        outcome: turn.outcome,
        refusal: turn.refusal ?? null,
      })),
    })),
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
