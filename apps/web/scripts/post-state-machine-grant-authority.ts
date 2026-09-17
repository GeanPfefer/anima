import { resolveCliIdentity } from '@/cli/identity';
import { grantPaidComputeAuthorization, readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';
const ITEM = 'd054b90f-14e5-4f33-b236-3fe62e97cc20';
async function main(): Promise<void> {
  const identity = await resolveCliIdentity(); if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const existing = await client.from('paid_compute_authorizations').select('id').eq('work_item_id', ITEM);
  if (existing.error) throw new Error(existing.error.message);
  if ((existing.data?.length ?? 0) !== 0) throw new Error('authority já existe');
  const grant = await grantPaidComputeAuthorization(client, {
    providerId: 'openai', nodeId: 'openai-api', resourceClass: 'provider_api:gpt-5.6-terra', workItemId: ITEM,
    maxDurationMs: 1_800_000, maxCost: { currency: 'USD', amount: 1.5 },
    validFrom: new Date(Date.now() - 30_000).toISOString(), validUntil: new Date(Date.now() + 3_600_000).toISOString(),
  });
  if (!grant.ok) throw new Error(`${grant.code}: ${grant.message}`);
  console.log(JSON.stringify({ item: ITEM, grant, audit: await readPaidComputeBudgetAudit(client, grant.authorizationId) }, null, 2));
}
void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
