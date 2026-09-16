// OPERACIONAL (item-specific; NÃO commitar): driver da prova viva "Cloud GPU Test #2 —
// RunPod autoprov end-to-end" para o successor 8a2515d8. Dirige EXATAMENTE este item pelo
// caminho on-demand RunPod (ANIMA_ON_DEMAND_FORCE_BURST=true + config presente no .env.local),
// mediado pela Goma (worktree/Git/gates/Verifier locais), coder remoto ollama:qwen3-coder.
//
// SESSÃO RESILIENTE (Resilient Cloud Session V1): este driver LIGA o gate
// ANIMA_RESILIENT_CLOUD_SESSION=true, então a aquisição do coder node passa pela SESSÃO RESILIENTE
// (troca autônoma de máquina + settlement dentro do envelope da autoridade capability-based), NÃO
// pela tentativa única. A próxima prova, portanto, NÃO bypassa a sessão resiliente.
//
// GUARD FAIL-CLOSED: sem ANIMA_RUNPOD_API_KEY o adapter RunPod é null; abortamos ANTES de
// qualquer runTurn para NUNCA cair em fallback de Ollama local (30B → swap → timeout). Este
// script só GASTA quando: chave presente + autoridade paga capability-based válida
// (3b87224f-071f-486d-88b8-a9dfe0259747, teto US$1,50, validUntil 2026-09-17) + recurso GPU
// compatível (≥24 GiB/cuda/≤US$1,00/h) em estoque. A autoridade cobre a SESSÃO (não uma máquina):
// endpoint_unpublished numa máquina → teardown + settlement + próxima máquina, dentro do teto.
//
// Execução (após o humano configurar a API key em apps/web/.env.local):
//   node --experimental-transform-types --import ./scripts/ts-resolve.mjs \
//        --env-file-if-exists=.env.local scripts/prove-runpod-autoprov-8a2515d8.ts
import { randomUUID } from 'node:crypto';
import { projectAutonomousQueue } from '@anima/core';
import { resolveCliIdentity } from '@/cli/identity';
import { buildProjectBacklogCycleDeps } from '@/lib/work-orchestration/autonomous-backlog-deps';
import { readAutonomousBacklogCandidates } from '@/lib/work-orchestration/autonomous-backlog-read';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';
import { readRunPodProvisionerConfig } from '@/lib/work-orchestration/runpod-node-provisioner';
import { readResidentOnDemandNodeConfig, onDemandBurstForced, resilientCloudSessionEnabled } from '@/lib/work-orchestration/resident-on-demand-node';
import { readActivePaidComputeAuthorization } from '@/lib/work-orchestration/paid-compute-authorization-store';

const WORK_ITEM_ID = '8a2515d8-6967-463e-af2a-fd5d2b5e42a1';
const AUTHORIZATION_ID = '3b87224f-071f-486d-88b8-a9dfe0259747';
const VERSION = 2;

async function main(): Promise<void> {
  // Restrição absoluta desta prova: ZERO API proprietária de modelo. Router OFF => Ollama remoto.
  process.env.ANIMA_COMPUTE_ROUTER_V1 = '0';
  process.env.ANIMA_WORKTREE_CODER_MODEL = 'qwen3-coder:latest';
  // Liga a SESSÃO RESILIENTE no caminho canônico do host-turn (troca de máquina + settlement).
  process.env.ANIMA_RESILIENT_CLOUD_SESSION = 'true';
  // A REST v1 só conhece SKU antes do create. Duas tentativas por SKU permitem que uma máquina
  // física ruim não elimine prematuramente a SKU; 16 permanece apenas a rede defensiva finita.
  process.env.ANIMA_RESILIENT_CLOUD_MAX_ATTEMPTS_PER_PLACEMENT = '2';
  process.env.ANIMA_RESILIENT_CLOUD_MAX_PROVISION_ATTEMPTS = '16';

  // GUARD 1 — API key (a barreira humana). Sem ela: fail-closed, sem fallback local.
  if (readRunPodProvisionerConfig() === null) {
    console.log(JSON.stringify({
      status: 'BLOCKED_API_KEY_ABSENT',
      detail: 'ANIMA_RUNPOD_API_KEY ausente em apps/web/.env.local. Configure-a e re-execute. Nenhum gasto, nenhum fallback local.',
    }, null, 2));
    return;
  }
  // GUARD 2 — o burst remoto tem de estar forçado e a config on-demand resolvível.
  const nodeConfig = readResidentOnDemandNodeConfig('qwen3-coder:latest');
  if (!onDemandBurstForced() || !nodeConfig) {
    throw new Error('config on-demand RunPod incompleta ou ANIMA_ON_DEMAND_FORCE_BURST!=true');
  }
  // GUARD 3 — a sessão resiliente tem de estar LIGADA (o gate acima a força; falha-fecha se algo a desligou).
  if (!resilientCloudSessionEnabled()) {
    throw new Error('ANIMA_RESILIENT_CLOUD_SESSION!=true: a prova não pode bypassar a sessão resiliente');
  }

  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;

  // PREFLIGHT capability-based local, antes do host-turn e portanto antes de qualquer provider
  // write. Não cria authority: exige exatamente a authority humana já existente.
  const authority = await readActivePaidComputeAuthorization(client, {
    providerId: 'runpod', nodeId: nodeConfig.nodeId, resourceClass: nodeConfig.resourceClass,
    workItemId: WORK_ITEM_ID, now: new Date(),
  });
  const scope = authority?.capabilityScope;
  if (authority?.authorizationId !== AUTHORIZATION_ID || scope === null || scope === undefined
    || scope.minimumVramGiB < 24 || !scope.requiredGpuFeatures.includes('cuda')
    || scope.maxNodes !== 1 || scope.maxHourlyPrice?.currency !== 'USD'
    || scope.maxHourlyPrice.amount > 1 || authority.maxCostEstimate?.currency !== 'USD'
    || authority.maxCostEstimate.amount < 1.5) {
    throw new Error(`authority capability-based ${AUTHORIZATION_ID} ausente, expirada ou incompatível`);
  }

  const classified = await ensurePlannedProjectClassification(client, WORK_ITEM_ID, VERSION);
  if (!classified.ok) throw new Error(`${classified.code}: ${classified.message}`);

  const candidates = await readAutonomousBacklogCandidates(client);
  const entry = projectAutonomousQueue(candidates, new Date()).find(c => c.workItemId === WORK_ITEM_ID);
  if (!entry) throw new Error('successor 8a2515d8 não entrou na fila autônoma');

  const deps = buildProjectBacklogCycleDeps(client, `runpod-autoprov-${randomUUID()}`);
  if (!deps.hostPermitsAutonomousWork()) throw new Error('Resource Governor recusou execução');
  const turn = await deps.runTurn(entry, new AbortController().signal);
  console.log(JSON.stringify({
    status: 'RAN', workItemId: WORK_ITEM_ID, provider: 'ollama:remote:qwen3-coder:latest', turn,
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
