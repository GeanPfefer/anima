// OPERACIONAL (NÃO commitar) — CLOUD RESOURCE MATCHING V1: PRÉVIA READ-ONLY da seleção de recurso.
//
// Projeta a parte de SELEÇÃO do "Cloud GPU Test #2 — autoprov de GPU cloud self-hosted COMPATÍVEL"
// (evolução semântica do antigo "autoprov A40"): lê o INVENTÁRIO vivo do RunPod (read-only,
// GraphQL gpuTypes), aplica requisitos → capacidade → autoridade → budget → ranking e IMPRIME o
// relatório — candidatos considerados, rejeitados COM razão, escolhido (GPU concreta, VRAM, preço,
// custo estimado, rationale). A40 deixa de ser requisito: se indisponível, a busca continua.
//
// SEM EFEITOS EXTERNOS: NÃO cria Pod, NÃO faz provider write, NÃO gasta, NÃO materializa autoridade.
// A "autoridade por capacidade" aqui é HIPOTÉTICA e vive só em memória — é a ENTRADA da projeção que
// mostra o que o humano selecionaria SE concedesse tal autoridade (fronteira humana, ver
// docs/registros/2026-09-10-cloud-resource-matching-v1.md). A leitura de inventário é a única
// chamada externa e é estritamente read-only.
//
// Execução (após o humano configurar ANIMA_RUNPOD_* em apps/web/.env.local):
//   node --experimental-transform-types --import ./scripts/ts-resolve.mjs \
//        --env-file-if-exists=.env.local scripts/preview-cloud-resource-match.ts
//
// Pool tático de SKUs: ANIMA_CLOUD_MATCH_GPU_TYPE_IDS (csv) amplia o pool para demonstrar
// alternativas à A40; ausente ⇒ usa ANIMA_RUNPOD_GPU_TYPE_IDS.
import {
  deriveQwen3CoderCloudRequirements,
  type PaidComputeAuthorizationV1,
} from '@anima/core';
import {
  describeCloudResourcePlan,
  planCloudResourceProvisioning,
} from '@/lib/work-orchestration/cloud-resource-plan';
import { readRunPodProvisionerConfig } from '@/lib/work-orchestration/runpod-node-provisioner';
import { readRunPodResourceInventory } from '@/lib/work-orchestration/runpod-price-quote';

const HALF_HOUR_MS = 30 * 60_000;
const READ_TIMEOUT_MS = Number(process.env.ANIMA_RUNPOD_HTTP_TIMEOUT_MS) || 30_000;

async function main(): Promise<void> {
  const runpod = readRunPodProvisionerConfig();
  if (runpod === null) {
    console.log(JSON.stringify({
      status: 'BLOCKED_API_KEY_ABSENT',
      detail: 'ANIMA_RUNPOD_* (incl. ANIMA_RUNPOD_API_KEY) ausente/incompleto em apps/web/.env.local. Nenhuma leitura, nenhum efeito.',
    }, null, 2));
    return;
  }

  // Requisitos derivados da EVIDÊNCIA (Bobcat/qwen3-coder), NÃO da SKU A40: piso de VRAM = 24 GiB.
  const maxHourly = Number(process.env.ANIMA_ON_DEMAND_PRICE_PER_HOUR);
  const requirements = deriveQwen3CoderCloudRequirements({
    maxEstimatedCost: { currency: 'USD', amount: 1.5 },
    maxHourlyPrice: Number.isFinite(maxHourly) && maxHourly > 0 ? { currency: 'USD', amount: maxHourly } : null,
  });

  // Autoridade HIPOTÉTICA por capacidade (NÃO persistida): entrada da projeção. Deriva os limites
  // dos próprios requisitos — é o que o humano concederia sob a estratégia cloud_self_hosted.
  const now = new Date();
  const hypotheticalAuthority: PaidComputeAuthorizationV1 = {
    schemaVersion: 1,
    authorizationId: 'preview-hypothetical',
    authorizedBy: 'preview',
    authorizedByAuthor: 'user',
    providerId: 'runpod',
    nodeId: null,
    resourceClass: null,
    capabilityScope: {
      minimumVramGiB: requirements.minimumVramGiB,
      requiredGpuFeatures: requirements.requiredGpuFeatures,
      maxHourlyPrice: requirements.maxHourlyPrice,
      maxNodes: requirements.maxNodes,
    },
    workItemId: null,
    maxDurationMs: HALF_HOUR_MS,
    maxCostEstimate: { currency: 'USD', amount: 1.5 },
    validFrom: new Date(now.getTime() - 60_000).toISOString(),
    validUntil: new Date(now.getTime() + HALF_HOUR_MS).toISOString(),
  };

  const poolOverride = (process.env.ANIMA_CLOUD_MATCH_GPU_TYPE_IDS ?? '').split(',').map(v => v.trim()).filter(Boolean);
  const gpuTypeIds = poolOverride.length > 0 ? poolOverride : runpod.gpuTypeIds;
  const graphqlBase = process.env.ANIMA_RUNPOD_GRAPHQL_BASE?.trim() || 'https://api.runpod.io/graphql';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  try {
    const plan = await planCloudResourceProvisioning({
      requirements,
      authorization: hypotheticalAuthority,
      leaseDurationMs: HALF_HOUR_MS,
      // READ-ONLY: gpuTypes (inventário). Nenhuma criação, nenhum gasto.
      readInventory: () => readRunPodResourceInventory({
        graphqlBase, apiKey: runpod.apiKey, gpuTypeIds, gpuCount: runpod.gpuCount, cloudType: runpod.cloudType,
      }, controller.signal),
    });
    const report = describeCloudResourcePlan(plan, requirements);
    console.log(JSON.stringify({ status: 'PREVIEW_ONLY', poolConsidered: gpuTypeIds, cloudType: runpod.cloudType, report }, null, 2));
  } finally {
    clearTimeout(timer);
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
