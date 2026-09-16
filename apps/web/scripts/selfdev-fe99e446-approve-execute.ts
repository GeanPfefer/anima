// Aprova fe99e446 v3 pelo caminho canônico, confirma a classificação determinística e
// executa UMA volta de host (um attempt pago) pelo Resident Host construído do WIP ATUAL
// (harness aprovado ATIVO: política pré-coder + AST pós-output + read fail-closed +
// policy não-enfraquecível). Router V1 ON, on-demand OFF. Coder = OpenAI gpt-5.6-terra
// (a authority 20f546b1 já concedida governa o gasto; teto US$1,50, fail-closed).
// NÃO cria authority; NÃO liquida reserva; NÃO toca origin/main.
process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED = '1';
process.env.ANIMA_ON_DEMAND_NODE_ENABLED = 'false';
process.env.ANIMA_CODER_VRAM_GB = '16';
process.env.ANIMA_CODER_MODEL_ALLOWLIST = JSON.stringify([{ model: 'qwen3-coder:latest', requiresGb: 20 }]);
import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';
import { runProjectBacklogHostTurn } from '@/lib/work-orchestration/backlog-host-turn-run';

const ID = 'fe99e446-9f14-45d0-97f5-764e9c2af8a9', VERSION = 3;
const log = (v: unknown) => console.log(JSON.stringify(v, null, 2));

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;
  const service = createWorkOrchestrationService(client);

  const approved = await service.resolveApproval({ workItemId: ID, expectedProposalVersion: VERSION, decision: { type: 'approve' } });
  if (!approved.ok) throw new Error(`${approved.error.code}: ${approved.error.message}`);
  log({ step: 'approved', userId, workItemId: ID, version: VERSION });

  const classified = await ensurePlannedProjectClassification(client, ID, VERSION);
  if (!classified.ok) throw new Error(`${classified.code}: ${classified.message}`);
  log({ step: 'classified', replayed: (classified as { replayed?: boolean }).replayed ?? false });

  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => controller.abort());
  const result = await runProjectBacklogHostTurn({ client, ownerInstanceId: `selfdev-fe99e446-${ID}`, maxTurnsPerCycle: 1, maxCycles: 1, signal: controller.signal, requestedWorkItemId: ID });
  log({
    step: 'host-turn:result',
    continuation: result.continuation,
    stopReason: result.stopReason,
    cyclesExecuted: result.cyclesExecuted,
    itemsTouched: result.itemsTouched,
    notExecutableReason: result.notExecutableReason ?? null,
    cycles: result.cycles.map(c => ({ turnsExecuted: c.turnsExecuted, stopReason: c.stopReason, lastOutcome: c.lastOutcome, notExecutableReason: c.notExecutableReason ?? null, turns: c.turns.map(t => ({ workItemId: t.workItemId, outcome: t.outcome, refusal: t.refusal ?? null })) })),
  });
}

void main().catch(e => { console.error(e instanceof Error ? e.stack ?? e.message : String(e)); process.exitCode = 1; });
