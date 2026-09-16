import { resolveCliIdentity } from '@/cli/identity';
import { readPaidComputeBudgetAudit, revokePaidComputeAuthorization } from '@/lib/work-orchestration/paid-compute-authorization-store';

const AUTHORIZATION_ID = 'c922b5be-9d26-4035-9405-af5f99a9f12a';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const before = await readPaidComputeBudgetAudit(client, AUTHORIZATION_ID);
  if (!before.ok || before.budget.reserved !== 0 || before.budget.committed !== 0) throw new Error('authority não está órfã sem consumo; abortando');
  const revoked = await revokePaidComputeAuthorization(client, AUTHORIZATION_ID);
  if (!revoked.ok) throw new Error(`${revoked.code}: ${revoked.message}`);
  const after = await client.from('paid_compute_authorizations').select('id,revoked_at,valid_until').eq('id', AUTHORIZATION_ID).single();
  console.log(JSON.stringify({ revoked, before: before.budget, after: after.data }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
