// Post-mortem ESTRITAMENTE read-only da attempt paga do seq.5 (dae3be71): item, eventos
// (roteamento, attempt, evidência observada, gates, Verifier, terminal), ledger da authority
// 1447ebcd, budget events e claims. Não muta nada.
import { resolveCliIdentity } from '@/cli/identity';
import { readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

const WORK_ITEM_ID = 'dae3be71-412d-4730-92ac-bf25b36af758';
const AUTHORITY_ID = '1447ebcd-7635-4567-b785-007e3512ca72';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;

  const item = await client.from('work_items').select('state,proposal_version,updated_at').eq('id', WORK_ITEM_ID).maybeSingle();
  if (item.error) throw new Error(`${item.error.code}: ${item.error.message}`);

  const events = await client
    .from('work_events')
    .select('seq,event_type,proposal_version,created_at,payload')
    .eq('work_item_id', WORK_ITEM_ID)
    .order('seq', { ascending: true });
  if (events.error) throw new Error(`${events.error.code}: ${events.error.message}`);

  const claims = await client.from('work_claims').select('*').eq('work_item_id', WORK_ITEM_ID);
  if (claims.error) throw new Error(`${claims.error.code}: ${claims.error.message}`);

  const audit = await readPaidComputeBudgetAudit(client, AUTHORITY_ID);
  const budgetEvents = await client.from('paid_compute_budget_events').select('*').eq('authorization_id', AUTHORITY_ID).order('created_at', { ascending: true });

  console.log(JSON.stringify({
    mode: 'READ_ONLY',
    item: item.data,
    activeClaims: claims.data ?? [],
    ledger: audit.ok ? audit.budget : audit,
    budgetEvents: budgetEvents.data ?? [],
    budgetEventsError: budgetEvents.error?.message ?? null,
    events: (events.data ?? []).map(e => ({ seq: e.seq, type: e.event_type, v: e.proposal_version, at: e.created_at, payload: e.payload })),
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
