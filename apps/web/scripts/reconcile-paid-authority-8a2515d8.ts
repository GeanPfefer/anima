// OPERACIONAL (não commitar): reconcilia a autoridade paga fd534be7 contra o CAMINHO DE RUNTIME
// e explica a "divergência" do preflight (que é infra-pura e NÃO lê o DB). No-spend, sem provider.
import { evaluatePaidComputeAuthorization, estimateLeaseCost } from '@anima/core';
import { resolveCliIdentity } from '@/cli/identity';
import { readActivePaidComputeAuthorization } from '@/lib/work-orchestration/paid-compute-authorization-store';
import { readResidentOnDemandNodeConfig } from '@/lib/work-orchestration/resident-on-demand-node';
import { assessPaidComputePreflight } from '@/lib/work-orchestration/paid-compute-preflight';

const WORK_ITEM_ID = '8a2515d8-6967-463e-af2a-fd5d2b5e42a1';

async function main(): Promise<void> {
  const cfg = readResidentOnDemandNodeConfig('qwen3-coder:latest');
  if (!cfg) throw new Error('on-demand config nula (API key/config ausente?)');

  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;

  const now = new Date();
  // Leitura EXATA do runtime (mesmos filtros de prepareResidentOnDemandCoderNode).
  const auth = await readActivePaidComputeAuthorization(client, {
    providerId: cfg.providerId, nodeId: cfg.nodeId, resourceClass: cfg.resourceClass,
    workItemId: WORK_ITEM_ID, now,
  });

  const estimatedCost = estimateLeaseCost(cfg.priceHint, cfg.maxActiveDurationMs);
  const financial = auth ? evaluatePaidComputeAuthorization({
    billingMode: cfg.billingMode, providerId: cfg.providerId, nodeId: cfg.nodeId,
    resourceClass: cfg.resourceClass, workItemId: WORK_ITEM_ID,
    requestedDurationMs: cfg.maxActiveDurationMs, estimatedCost,
  }, auth, now) : null;

  // Preflight COM o flag humano derivado da leitura REAL (o que o wiring de produção faria).
  const pf = assessPaidComputePreflight({ env: process.env, humanAuthorizationValid: financial?.authorized === true });
  // Preflight SEM o flag (o que meu verify-script roda) — para explicar a diferença.
  const pfNoFlag = assessPaidComputePreflight({ env: process.env });

  console.log(JSON.stringify({
    identity: { userId, isOwner_e570e43b: userId === 'e570e43b-0263-43a1-b8e9-63b4eb2b5ba4' },
    runtimeRead: {
      found: auth !== null,
      authorizationId: auth?.authorizationId ?? null,
      matchesGranted: auth?.authorizationId === 'fd534be7-5b04-4e04-9079-b62a6762480f',
      providerId: auth?.providerId, nodeId: auth?.nodeId, resourceClass: auth?.resourceClass,
      workItemId: auth?.workItemId, maxDurationMs: auth?.maxDurationMs, maxCost: auth?.maxCostEstimate,
      validFrom: auth?.validFrom, validUntil: auth?.validUntil,
    },
    financialEvaluation: financial,
    estimatedReservedExposure: estimatedCost,
    preflight_withRealFlag: { paidExecutionAuthorized: pf.paidExecutionAuthorized, missing: pf.missing },
    preflight_withoutFlag_infraOnly: { readyForHumanPaidAuthorization: pfNoFlag.readyForHumanPaidAuthorization, missing: pfNoFlag.missing },
    conclusion: (auth !== null && financial?.authorized === true && pf.paidExecutionAuthorized)
      ? 'SAME_AUTHORIZATION_PASSES_RUNTIME — preflight infra-only nao le DB; sem divergencia real'
      : 'PROBLEMA_REAL — investigar',
  }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
