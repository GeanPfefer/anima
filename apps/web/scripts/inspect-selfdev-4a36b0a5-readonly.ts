// Diagnóstico ESTRITAMENTE read-only do replacement 4a36b0a5 (recovery_successor, seq 3),
// da sua lineage, do item retirado anterior (bea933f2 -> cancelled) e da authority antiga
// revogada (0e4fc437). Não concede, não aprova, não classifica, não executa, não liquida.
import { resolveCliIdentity } from '@/cli/identity';
import {
  listPaidComputeAuthorizations,
  readPaidComputeBudgetAudit,
} from '@/lib/work-orchestration/paid-compute-authorization-store';

const REPLACEMENT_ID = '4a36b0a5-3be8-4431-a3fa-258be13917a3';
const LINEAGE_ID = '4277187e-2730-4869-8114-92a77756c706';
const PREDECESSOR_ID = '3b0b3c57-a1d0-4bbe-a719-829b680ca6d1';
const WITHDRAWN_ITEM_ID = 'bea933f2-61bf-4d7d-bcdb-22f623a8f36c';
const OLD_AUTHORITY_ID = '0e4fc437-da5c-4254-ba45-b22b081d16db';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;

  const items = await client
    .from('work_items')
    .select('id,state,proposal_version,capability,impact_level,created_at,updated_at')
    .in('id', [REPLACEMENT_ID, PREDECESSOR_ID, WITHDRAWN_ITEM_ID]);
  if (items.error) throw new Error(`${items.error.code}: ${items.error.message}`);

  const events = await client
    .from('work_events')
    .select('id,event_type,proposal_version,created_at')
    .eq('work_item_id', REPLACEMENT_ID)
    .order('created_at', { ascending: true });
  if (events.error) throw new Error(`${events.error.code}: ${events.error.message}`);

  const claims = await client
    .from('work_claims')
    .select('*')
    .eq('work_item_id', REPLACEMENT_ID);
  if (claims.error) throw new Error(`${claims.error.code}: ${claims.error.message}`);

  const lineage = await client
    .from('work_recovery_lineage')
    .select('*')
    .or(`successor_work_item_id.eq.${REPLACEMENT_ID},original_work_item_id.eq.${LINEAGE_ID},successor_work_item_id.eq.${PREDECESSOR_ID}`)
    .order('recovery_sequence', { ascending: true });
  if (lineage.error) throw new Error(`${lineage.error.code}: ${lineage.error.message}`);

  const auths = await listPaidComputeAuthorizations(client);
  if (!auths.ok) throw new Error(`${auths.code}: ${auths.message}`);
  const forReplacement = auths.authorizations.filter(a => a.workItemId === REPLACEMENT_ID);
  const oldAuthority = auths.authorizations.find(a => a.id === OLD_AUTHORITY_ID) ?? null;
  const oldAudit = await readPaidComputeBudgetAudit(client, OLD_AUTHORITY_ID);

  console.log(JSON.stringify({
    mode: 'READ_ONLY',
    userId,
    replacement: {
      id: REPLACEMENT_ID,
      row: items.data?.find(i => i.id === REPLACEMENT_ID) ?? null,
      eventTypes: (events.data ?? []).map(e => ({ type: e.event_type, v: e.proposal_version, at: e.created_at })),
      activeClaims: claims.data ?? [],
      paidAuthorities: forReplacement,
    },
    predecessorRow: items.data?.find(i => i.id === PREDECESSOR_ID) ?? null,
    withdrawnRow: items.data?.find(i => i.id === WITHDRAWN_ITEM_ID) ?? null,
    lineage: lineage.data ?? [],
    oldAuthority: {
      id: OLD_AUTHORITY_ID,
      view: oldAuthority,
      audit: oldAudit.ok ? oldAudit.budget : oldAudit,
    },
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
