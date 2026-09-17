// Diagnóstico estritamente read-only do successor e de sua única authority.
import { resolveCliIdentity } from '@/cli/identity';
import { readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

const WORK_ITEM_ID = '3b0b3c57-a1d0-4bbe-a719-829b680ca6d1';
const AUTHORIZATION_ID = '73c9e25b-4386-42bf-a9f7-458fed377067';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const events = await client
    .from('work_events')
    .select('id,event_type,payload,created_at,proposal_version')
    .eq('work_item_id', WORK_ITEM_ID)
    .order('created_at', { ascending: true });
  if (events.error) throw new Error(`${events.error.code}: ${events.error.message}`);
  const audit = await readPaidComputeBudgetAudit(client, AUTHORIZATION_ID);
  console.log(JSON.stringify({
    mode: 'READ_ONLY',
    workItemId: WORK_ITEM_ID,
    events: (events.data ?? []).map(event => ({
      id: event.id,
      type: event.event_type,
      proposalVersion: event.proposal_version,
      createdAt: event.created_at,
      payload: event.payload,
    })),
    audit,
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
