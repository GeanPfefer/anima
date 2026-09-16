// Concede exatamente uma paid authority, previamente autorizada pelo humano, para o successor
// 3b0b3c57. A guarda inicial falha se já existir qualquer authority para este work item.
// Não aprova, não executa, não chama provider e não liquida reservation.
import { resolveCliIdentity } from '@/cli/identity';
import {
  grantPaidComputeAuthorization,
  readPaidComputeBudgetAudit,
} from '@/lib/work-orchestration/paid-compute-authorization-store';

const WORK_ITEM_ID = '3b0b3c57-a1d0-4bbe-a719-829b680ca6d1';
const MODEL = 'gpt-5.6-terra';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;
const CLOCK_TOLERANCE_MS = 30_000;

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;

  const existing = await client
    .from('paid_compute_authorizations')
    .select('id, created_at')
    .eq('work_item_id', WORK_ITEM_ID);
  if (existing.error) throw new Error(`${existing.error.code}: ${existing.error.message}`);
  if ((existing.data?.length ?? 0) !== 0) {
    throw new Error(`authority já existente para ${WORK_ITEM_ID}; concessão duplicada recusada`);
  }

  const now = Date.now();
  const validFrom = new Date(now - CLOCK_TOLERANCE_MS).toISOString();
  const validUntil = new Date(now + SEVEN_DAYS_MS).toISOString();
  const grant = await grantPaidComputeAuthorization(client, {
    providerId: 'openai',
    nodeId: 'openai-api',
    resourceClass: `provider_api:${MODEL}`,
    workItemId: WORK_ITEM_ID,
    maxDurationMs: 5_400_000,
    maxCost: { currency: 'USD', amount: 1.5 },
    validFrom,
    validUntil,
  });
  if (!grant.ok) throw new Error(`${grant.code}: ${grant.message}`);

  const audit = await readPaidComputeBudgetAudit(client, grant.authorizationId);
  console.log(JSON.stringify({
    step: 'authority-granted',
    authorizationId: grant.authorizationId,
    workItemId: WORK_ITEM_ID,
    providerId: 'openai',
    nodeId: 'openai-api',
    resourceClass: `provider_api:${MODEL}`,
    maxDurationMs: 5_400_000,
    maxCost: { currency: 'USD', amount: 1.5 },
    validFrom,
    validUntil,
    audit: audit.ok ? audit.budget : audit,
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
