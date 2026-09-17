// OPERACIONAL (não commitar). Executa EXATAMENTE UMA attempt governada de a84de19c pelo
// Coding Harness V3, forçando o coder OpenAI gpt-5.6-terra (VRAM 16 + allowlist exige 20GB
// ⇒ nenhum modelo local cabe ⇒ SEM fallback Ollama silencioso). cwd DEVE ser apps/web
// (fix do footgun d05bcab0). maxCycles/maxTurnsPerCycle = 1 ⇒ nenhum retry.
process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED = '1';
process.env.ANIMA_ON_DEMAND_NODE_ENABLED = 'false';
process.env.ANIMA_CODER_VRAM_GB = '16';
process.env.ANIMA_CODER_MODEL_ALLOWLIST = JSON.stringify([{ model: 'qwen3-coder:latest', requiresGb: 20 }]);
process.env.ANIMA_CODER_MODEL = 'gpt-5.6-terra';

import { resolveCliIdentity } from '@/cli/identity';
import { runProjectBacklogHostTurn } from '@/lib/work-orchestration/backlog-host-turn-run';

const ITEM = 'a84de19c-3766-44ed-8ce2-80e856ec2a38';

async function main(): Promise<void> {
  if (process.cwd().replace(/\\/g, '/').toLowerCase() !== 'g:/anima/apps/web') throw new Error(`cwd incorreto ${process.cwd()}`);
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => controller.abort());
  const startedAt = new Date().toISOString();
  const result = await runProjectBacklogHostTurn({ client: identity.identity.client, ownerInstanceId: `selfdev-v3-${ITEM}`, maxTurnsPerCycle: 1, maxCycles: 1, signal: controller.signal, requestedWorkItemId: ITEM });
  console.log(JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), cwd: process.cwd(), result }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
