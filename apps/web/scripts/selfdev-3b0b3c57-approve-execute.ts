// Aprova canonicamente o successor v3, confirma sua classificação e executa uma única volta do
// Resident Host construído do WIP atual. A execução paga é governada pela authority humana exata.
// Não cria authority adicional, não abre segunda volta e não toca origin/main.
process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED = '1';
process.env.ANIMA_ON_DEMAND_NODE_ENABLED = 'false';
process.env.ANIMA_CODER_VRAM_GB = '16';
process.env.ANIMA_CODER_MODEL_ALLOWLIST = JSON.stringify([
  { model: 'qwen3-coder:latest', requiresGb: 20 },
]);

import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';
import { runProjectBacklogHostTurn } from '@/lib/work-orchestration/backlog-host-turn-run';

const WORK_ITEM_ID = '3b0b3c57-a1d0-4bbe-a719-829b680ca6d1';
const PROPOSAL_VERSION = 3;

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;
  const service = createWorkOrchestrationService(client);

  const approved = await service.resolveApproval({
    workItemId: WORK_ITEM_ID,
    expectedProposalVersion: PROPOSAL_VERSION,
    decision: { type: 'approve' },
  });
  if (!approved.ok) throw new Error(`${approved.error.code}: ${approved.error.message}`);
  console.log(JSON.stringify({
    step: 'approved', userId, workItemId: WORK_ITEM_ID, proposalVersion: PROPOSAL_VERSION,
  }, null, 2));

  const classified = await ensurePlannedProjectClassification(
    client,
    WORK_ITEM_ID,
    PROPOSAL_VERSION,
  );
  if (!classified.ok) throw new Error(`${classified.code}: ${classified.message}`);
  console.log(JSON.stringify({
    step: 'classified',
    replayed: (classified as { replayed?: boolean }).replayed ?? false,
  }, null, 2));

  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => controller.abort());
  }
  const result = await runProjectBacklogHostTurn({
    client,
    ownerInstanceId: `selfdev-3b0b3c57-${WORK_ITEM_ID}`,
    maxTurnsPerCycle: 1,
    maxCycles: 1,
    signal: controller.signal,
    requestedWorkItemId: WORK_ITEM_ID,
  });
  console.log(JSON.stringify({
    step: 'host-turn:result',
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
