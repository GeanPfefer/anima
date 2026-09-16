import { resolveCliIdentity } from '@/cli/identity';
import { grantPaidComputeAuthorization, readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

const ITEM = '7e0a75cf-560b-45a1-8097-5631c631ad05';
const UNTIL = new Date('2026-09-14T23:59:59-03:00').toISOString();

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const existing = await client.from('paid_compute_authorizations').select('id').eq('work_item_id', ITEM);
  if (existing.error) throw new Error(existing.error.message);
  if ((existing.data?.length ?? 0) !== 0) throw new Error('authority já existe');
  if (Date.parse(UNTIL) <= Date.now()) throw new Error('validade expirada');
  const grant = await grantPaidComputeAuthorization(client, { providerId: 'openai', nodeId: 'openai-api', resourceClass: 'provider_api:gpt-5.6-terra', workItemId: ITEM, maxDurationMs: 1_800_000, maxCost: { currency: 'USD', amount: 1.5 }, validFrom: new Date(Date.now() - 30_000).toISOString(), validUntil: UNTIL });
  if (!grant.ok) throw new Error(`${grant.code}: ${grant.message}`);
  console.log(JSON.stringify({ grant, audit: await readPaidComputeBudgetAudit(client, grant.authorizationId) }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
