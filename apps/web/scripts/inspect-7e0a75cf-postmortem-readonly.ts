import { resolveCliIdentity } from '@/cli/identity';
import { readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

const ITEM = '7e0a75cf-560b-45a1-8097-5631c631ad05';
const AUTH = 'fc01585e-b334-415e-a730-a0cd8b39536d';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const [item, events, claims, budget] = await Promise.all([
    client.from('work_items').select('state,proposal_version,updated_at').eq('id', ITEM).single(),
    client.from('work_events').select('seq,event_type,created_at,payload').eq('work_item_id', ITEM).order('seq', { ascending: true }),
    client.from('work_claims').select('*').eq('work_item_id', ITEM),
    client.from('paid_compute_budget_events').select('*').eq('authorization_id', AUTH).order('created_at', { ascending: true }),
  ]);
  if (item.error || events.error || claims.error || budget.error) throw new Error(item.error?.message ?? events.error?.message ?? claims.error?.message ?? budget.error?.message);
  console.log(JSON.stringify({ item: item.data, claims: claims.data, ledger: await readPaidComputeBudgetAudit(client, AUTH), budgetEvents: budget.data, events: events.data }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
