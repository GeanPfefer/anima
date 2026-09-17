// Diagnóstico ESTRITAMENTE read-only do successor 5895b59c (recovery_successor, seq. 4),
// sua lineage (root 3b0b3c57, lineage 9497140e), o predecessor falho 4a36b0a5 (seq. 3) e
// quaisquer autoridades pagas associadas. Não concede, não aprova, não classifica,
// não executa attempt, não cria reservation, não liquida. Apenas lê e imprime.
import { resolveCliIdentity } from '@/cli/identity';
import {
  listPaidComputeAuthorizations,
} from '@/lib/work-orchestration/paid-compute-authorization-store';

const SUCCESSOR_ID = '5895b59c-0568-483a-9731-2abd45fb4b90';
const LINEAGE_ID = '9497140e-37af-44fb-baf5-175cf6fe8c0f';
const ROOT_ID = '3b0b3c57-a1d0-4bbe-a719-829b680ca6d1';
const PREDECESSOR_ID = '4a36b0a5-3be8-4431-a3fa-258be13917a3';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;

  const items = await client
    .from('work_items')
    .select('id,state,proposal_version,capability,impact_level,created_at,updated_at')
    .in('id', [SUCCESSOR_ID, PREDECESSOR_ID, ROOT_ID]);
  if (items.error) throw new Error(`${items.error.code}: ${items.error.message}`);

  const events = await client
    .from('work_events')
    .select('id,event_type,proposal_version,created_at')
    .eq('work_item_id', SUCCESSOR_ID)
    .order('created_at', { ascending: true });
  if (events.error) throw new Error(`${events.error.code}: ${events.error.message}`);

  const claims = await client
    .from('work_claims')
    .select('*')
    .eq('work_item_id', SUCCESSOR_ID);
  if (claims.error) throw new Error(`${claims.error.code}: ${claims.error.message}`);

  const lineage = await client
    .from('work_recovery_lineage')
    .select('*')
    .or(`successor_work_item_id.eq.${SUCCESSOR_ID},original_work_item_id.eq.${ROOT_ID},id.eq.${LINEAGE_ID}`)
    .order('recovery_sequence', { ascending: true });
  if (lineage.error) throw new Error(`${lineage.error.code}: ${lineage.error.message}`);

  const auths = await listPaidComputeAuthorizations(client);
  if (!auths.ok) throw new Error(`${auths.code}: ${auths.message}`);
  const forSuccessor = auths.authorizations.filter(a => a.workItemId === SUCCESSOR_ID);

  console.log(JSON.stringify({
    mode: 'READ_ONLY',
    userId,
    successor: {
      id: SUCCESSOR_ID,
      row: items.data?.find(i => i.id === SUCCESSOR_ID) ?? null,
      eventCount: (events.data ?? []).length,
      eventTypes: (events.data ?? []).map(e => ({ type: e.event_type, v: e.proposal_version, at: e.created_at })),
      activeClaims: claims.data ?? [],
      paidAuthorities: forSuccessor,
    },
    predecessorRow: items.data?.find(i => i.id === PREDECESSOR_ID) ?? null,
    rootRow: items.data?.find(i => i.id === ROOT_ID) ?? null,
    lineage: lineage.data ?? [],
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
