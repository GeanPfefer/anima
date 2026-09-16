// OPERACIONAL (não commitar) — READ-ONLY. Postmortem da attempt de a84de19c. US$0.
import { resolveCliIdentity } from '@/cli/identity';
import { readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

const ITEM = 'a84de19c-3766-44ed-8ce2-80e856ec2a38';
const AUTH = 'b17414e1-2b74-493f-a9f7-4694e9c63955';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const [item, events, claims, budget, attempts] = await Promise.all([
    client.from('work_items').select('state,proposal_version,updated_at').eq('id', ITEM).single(),
    client.from('work_events').select('seq,event_type,created_at,payload').eq('work_item_id', ITEM).order('seq', { ascending: true }),
    client.from('work_claims').select('*').eq('work_item_id', ITEM),
    client.from('paid_compute_budget_events').select('*').eq('authorization_id', AUTH).order('created_at', { ascending: true }),
    client.from('work_attempts').select('*').eq('work_item_id', ITEM).order('created_at', { ascending: true }),
  ]);
  const err = item.error || events.error || claims.error || budget.error || attempts.error;
  console.log(JSON.stringify({
    item: item.data ?? item.error?.message,
    attempts: attempts.error ? attempts.error.message : attempts.data,
    claims: claims.data ?? claims.error?.message,
    ledger: await readPaidComputeBudgetAudit(client, AUTH),
    budgetEvents: budget.data ?? budget.error?.message,
    events: (events.data ?? []).map(e => ({ seq: e.seq, type: e.event_type, at: e.created_at, payload: e.payload })),
    _err: err?.message ?? null,
  }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
