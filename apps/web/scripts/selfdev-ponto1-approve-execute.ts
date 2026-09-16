// OPERACIONAL (não commitar): APROVA (decisão humana expressa no mandato) + CLASSIFICA +
// EXECUTA o Work Item de self-dev Ponto 1 (8fe633eb) pela cadeia canônica, com o MELHOR
// compute (coder OpenAI FORTE gpt-5.6-terra via Compute Router; SEM RunPod). Identidade
// residente (Bearer/RLS), NUNCA service_role. Desfecho máximo = review; PARA em review.

// Rota de compute (mesma provada nesta sessão): Router ON + política de capacidade honesta
// (local qwen3-coder não cabe na Goma 16GB) ⇒ Router seleciona OpenAI (preferred=openai do
// contrato) ⇒ placement=null ⇒ NENHUM burst RunPod. On-demand node desligado (defesa em profundidade).
process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED = '1';
process.env.ANIMA_ON_DEMAND_NODE_ENABLED = 'false';
process.env.ANIMA_CODER_VRAM_GB = '16';
process.env.ANIMA_CODER_MODEL_ALLOWLIST = JSON.stringify([{ model: 'qwen3-coder:latest', requiresGb: 20 }]);

import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';
import { runProjectBacklogHostTurn } from '@/lib/work-orchestration/backlog-host-turn-run';

const WORK_ITEM_ID = '8fe633eb-d3f7-4c5c-82b7-6931dc8441d9';
const EXPECTED_VERSION = 2;

function log(o: unknown): void { console.log(JSON.stringify(o, null, 2)); }

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;
  const service = createWorkOrchestrationService(client);
  log({ step: 'route', userId, router: process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED, onDemand: process.env.ANIMA_ON_DEMAND_NODE_ENABLED, model: process.env.OPENAI_MODEL });

  // 4) Aprovação (decisão humana expressa no mandato).
  const approved = await service.resolveApproval({ workItemId: WORK_ITEM_ID, expectedProposalVersion: EXPECTED_VERSION, decision: { type: 'approve' } });
  if (!approved.ok) throw new Error(`Aprovação recusada: ${approved.error.code} ${approved.error.message}`);
  log({ step: 'approved', workItemId: WORK_ITEM_ID, version: EXPECTED_VERSION });

  const classified = await ensurePlannedProjectClassification(client, WORK_ITEM_ID, EXPECTED_VERSION);
  if (!classified.ok) throw new Error(`Classificação recusada: ${classified.code} ${classified.message}`);
  log({ step: 'classified', replayed: (classified as { replayed?: boolean }).replayed ?? false });

  // 5) Execução canônica (claim → attempt → melhor compute → coder → gates → Verifier → review).
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => controller.abort());
  const result = await runProjectBacklogHostTurn({
    client, ownerInstanceId: `selfdev-ponto1-${WORK_ITEM_ID}`,
    maxTurnsPerCycle: 1, maxCycles: 1, signal: controller.signal, requestedWorkItemId: WORK_ITEM_ID,
  });
  log({ step: 'host-turn:result', continuation: result.continuation, stopReason: result.stopReason,
    cyclesExecuted: result.cyclesExecuted, itemsTouched: result.itemsTouched,
    notExecutableReason: result.notExecutableReason ?? null,
    cycles: result.cycles.map(c => ({ turnsExecuted: c.turnsExecuted, stopReason: c.stopReason, lastOutcome: c.lastOutcome,
      notExecutableReason: c.notExecutableReason ?? null,
      turns: c.turns.map(t => ({ workItemId: t.workItemId, outcome: t.outcome, refusal: t.refusal ?? null })) })) });
}

void main().catch(error => { console.error(error instanceof Error ? (error.stack ?? error.message) : String(error)); process.exitCode = 1; });
