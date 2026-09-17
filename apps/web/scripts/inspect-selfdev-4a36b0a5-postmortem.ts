// Post-mortem ESTRITAMENTE read-only da attempt do replacement 4a36b0a5: item, eventos
// (roteamento, attempt, evidência observada, gates, terminal), ledger da authority 71554a8f e
// claims. Não muta nada.
import { resolveCliIdentity } from '@/cli/identity';
import { readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

const WORK_ITEM_ID = '4a36b0a5-3be8-4431-a3fa-258be13917a3';
const AUTHORITY_ID = '71554a8f-802f-4ef4-ad52-e5f791fc8413';

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

  console.log(JSON.stringify({
    mode: 'READ_ONLY',
    item: item.data,
    activeClaims: claims.data ?? [],
    ledger: audit.ok ? audit.budget : audit,
    events: (events.data ?? []).map(e => ({ seq: e.seq, type: e.event_type, v: e.proposal_version, at: e.created_at, payload: e.payload })),
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
