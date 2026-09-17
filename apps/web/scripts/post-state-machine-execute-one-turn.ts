process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED = '1';
process.env.ANIMA_ON_DEMAND_NODE_ENABLED = 'false';
process.env.ANIMA_CODER_VRAM_GB = '16';
process.env.ANIMA_CODER_MODEL_ALLOWLIST = JSON.stringify([{ model: 'qwen3-coder:latest', requiresGb: 20 }]);
process.env.ANIMA_CODER_MODEL = 'gpt-5.6-terra';
import { resolveCliIdentity } from '@/cli/identity';
import { runProjectBacklogHostTurn } from '@/lib/work-orchestration/backlog-host-turn-run';
const ITEM = 'd054b90f-14e5-4f33-b236-3fe62e97cc20';
async function main(): Promise<void> {
  if (process.cwd().replace(/\\/g, '/').toLowerCase() !== 'g:/anima/apps/web') throw new Error(`cwd incorreto ${process.cwd()}`);
  const identity = await resolveCliIdentity(); if (!identity.ok) throw new Error(identity.error);
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => controller.abort());
  const result = await runProjectBacklogHostTurn({ client: identity.identity.client, ownerInstanceId: `post-state-machine-${ITEM}`, maxTurnsPerCycle: 1, maxCycles: 1, signal: controller.signal, requestedWorkItemId: ITEM });
  console.log(JSON.stringify({ item: ITEM, cwd: process.cwd(), result }, null, 2));
}
void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
