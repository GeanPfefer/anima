import { resolveCliIdentity } from '@/cli/identity';
import { readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

const WORK_ITEM_ID = 'd05bcab0-1a2a-4717-ba65-21d4bc2c1b77';
const AUTHORITY_ID = 'c922b5be-9d26-4035-9405-af5f99a9f12a';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const item = await client.from('work_items').select('state,proposal_version,updated_at').eq('id', WORK_ITEM_ID).maybeSingle();
  if (item.error) throw new Error(item.error.message);
  const events = await client.from('work_events').select('seq,event_type,proposal_version,created_at,payload').eq('work_item_id', WORK_ITEM_ID).order('seq', { ascending: true });
  if (events.error) throw new Error(events.error.message);
  const claims = await client.from('work_claims').select('*').eq('work_item_id', WORK_ITEM_ID);
  if (claims.error) throw new Error(claims.error.message);
  const audit = await readPaidComputeBudgetAudit(client, AUTHORITY_ID);
  const budgetEvents = await client.from('paid_compute_budget_events').select('*').eq('authorization_id', AUTHORITY_ID).order('created_at', { ascending: true });
  console.log(JSON.stringify({ mode: 'READ_ONLY', item: item.data, claims: claims.data ?? [], ledger: audit.ok ? audit.budget : audit, budgetEvents: budgetEvents.data ?? [], events: events.data ?? [] }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
