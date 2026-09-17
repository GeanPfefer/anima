import { resolveCliIdentity } from '@/cli/identity';
import { grantPaidComputeAuthorization, readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';
const WORK_ITEM_ID = '4eb79eb4-f6c4-40a5-b791-2e9d671a33c5';
const VALID_UNTIL = new Date('2026-09-14T23:59:59-03:00').toISOString();
async function main(): Promise<void> {
  const identity = await resolveCliIdentity(); if (!identity.ok) throw new Error(identity.error); const { client } = identity.identity;
  const existing = await client.from('paid_compute_authorizations').select('id').eq('work_item_id', WORK_ITEM_ID); if (existing.error) throw new Error(existing.error.message);
  if ((existing.data?.length ?? 0) !== 0) throw new Error('authority já existe; recusada');
  if (Date.parse(VALID_UNTIL) <= Date.now()) throw new Error('validade expirada');
  const grant = await grantPaidComputeAuthorization(client, { providerId:'openai', nodeId:'openai-api', resourceClass:'provider_api:gpt-5.6-terra', workItemId:WORK_ITEM_ID, maxDurationMs:1_800_000, maxCost:{currency:'USD',amount:1.5}, validFrom:new Date(Date.now()-30_000).toISOString(), validUntil:VALID_UNTIL });
  if (!grant.ok) throw new Error(`${grant.code}: ${grant.message}`);
  console.log(JSON.stringify({ grant, audit: await readPaidComputeBudgetAudit(client, grant.authorizationId) }, null, 2));
}
void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
