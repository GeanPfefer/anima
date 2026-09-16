// OPERACIONAL (item-specific; não commitar): materializa a AUTORIDADE HUMANA paga para a
// prova "Cloud GPU Test #2 — RunPod autoprov end-to-end" via o mecanismo CANÔNICO
// (Bearer/GoTrue como identidade residente = dono do item; RPC SECURITY DEFINER
// grant_paid_compute_authorization; NUNCA service_role). Idempotente: se já existir uma
// autorização ATIVA que casa a config de runtime, NÃO cria outra.
//
// Autoridade humana desta prova (fornecida explicitamente pelo usuário):
//   provider=runpod  node=null  class=null  item=8a2515d8…
//   capability={minimumVramGiB:24,cuda,maxHourlyPrice:USD 1.00,maxNodes:1}
//   teto ABSOLUTO=USD 1.50  max_duration=30min (1 lease)  1 node.  reserved ≠ settled.
import { resolveCliIdentity } from '@/cli/identity';
import {
  grantPaidComputeAuthorization,
  readActivePaidComputeAuthorization,
  revokePaidComputeAuthorization,
} from '@/lib/work-orchestration/paid-compute-authorization-store';

const WORK_ITEM_ID = '8a2515d8-6967-463e-af2a-fd5d2b5e42a1';
const PROVIDER_ID = 'runpod';
const NODE_ID = null;
const RESOURCE_CLASS = null;
const MAX_DURATION_MS = 1_800_000; // 30 min — casa maxActiveDurationMs do on-demand.
const MAX_COST = { currency: 'USD', amount: 1.5 } as const; // teto ABSOLUTO.
const VALID_DAYS = 7;
const OLD_SKU_AUTHORIZATION_ID = 'c1c3c608-cf2b-4b79-8828-c291e72b5431';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;
  console.log(JSON.stringify({ step: 'identity', userId }, null, 2));

  const now = new Date();
  // A authority SKU-fixed antiga não autoriza alternativas e deve ficar revogada.
  const revoked = await revokePaidComputeAuthorization(client, OLD_SKU_AUTHORIZATION_ID);
  if (!revoked.ok && revoked.code !== 'not_found') {
    throw new Error(`${revoked.code}: ${revoked.message}`);
  }
  console.log(JSON.stringify({ step: 'old_sku_authority_reconciled', authorizationId: OLD_SKU_AUTHORIZATION_ID }, null, 2));

  // Idempotência: a autorização é lida EXATAMENTE como o runtime a lê (mesmos filtros).
  const existing = await readActivePaidComputeAuthorization(client, {
    providerId: PROVIDER_ID, nodeId: NODE_ID, resourceClass: RESOURCE_CLASS,
    workItemId: WORK_ITEM_ID, now,
  });
  if (existing) {
    console.log(JSON.stringify({
      step: 'already_present', authorizationId: existing.authorizationId,
      maxCost: existing.maxCostEstimate, validUntil: existing.validUntil,
      capabilityScope: existing.capabilityScope,
      note: 'autorização capability-based ativa já casa a config de runtime; nada a fazer.',
    }, null, 2));
    return;
  }

  const validFrom = now.toISOString();
  const validUntil = new Date(now.getTime() + VALID_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const granted = await grantPaidComputeAuthorization(client, {
    providerId: PROVIDER_ID, nodeId: NODE_ID, resourceClass: RESOURCE_CLASS,
    capabilityScope: {
      minimumVramGiB: 24,
      requiredGpuFeatures: ['cuda'],
      maxHourlyPrice: { currency: 'USD', amount: 1 },
      maxNodes: 1,
    },
    workItemId: WORK_ITEM_ID, maxDurationMs: MAX_DURATION_MS, maxCost: MAX_COST,
    validFrom, validUntil,
  });
  if (!granted.ok) throw new Error(`${granted.code}: ${granted.message}`);
  console.log(JSON.stringify({ step: 'granted', authorizationId: granted.authorizationId }, null, 2));

  // Releitura de confirmação PELO MESMO filtro do runtime (prova que casa).
  const confirm = await readActivePaidComputeAuthorization(client, {
    providerId: PROVIDER_ID, nodeId: NODE_ID, resourceClass: RESOURCE_CLASS,
    workItemId: WORK_ITEM_ID, now: new Date(),
  });
  console.log(JSON.stringify({
    step: 'confirm_runtime_match',
    matches: confirm?.authorizationId === granted.authorizationId,
    authorizationId: confirm?.authorizationId ?? null,
    providerId: confirm?.providerId, nodeId: confirm?.nodeId, resourceClass: confirm?.resourceClass,
    workItemId: confirm?.workItemId, maxDurationMs: confirm?.maxDurationMs,
    capabilityScope: confirm?.capabilityScope,
    maxCost: confirm?.maxCostEstimate, validFrom: confirm?.validFrom, validUntil: confirm?.validUntil,
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
