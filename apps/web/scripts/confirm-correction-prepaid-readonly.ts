// READ-ONLY: confirma o estado pós-request_changes/correção antes da parada pré-paga.
// Correction successor d05bcab0; item revisado dae3be71 (changes_requested); reserva/authority
// antigas INTOCADAS (aa692acb/1447ebcd). Não muta nada.
import { resolveCliIdentity } from '@/cli/identity';
import { readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

const CORRECTION = 'd05bcab0-1a2a-4717-ba65-21d4bc2c1b77';
const REVIEWED = 'dae3be71-412d-4730-92ac-bf25b36af758';
const OLD_AUTHORITY = '1447ebcd-7635-4567-b785-007e3512ca72';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;

  const corr = await client.from('work_items').select('state,proposal_version,intent').eq('id', CORRECTION).single();
  const spec = corr.data ? ((corr.data.intent as { execution_spec?: Record<string, unknown> }).execution_spec ?? {}) : {};
  const criteria = ((spec as Record<string, unknown>)['validation_criteria'] as Array<{ label?: string; proof?: string; command?: string; covers?: string[] }> | undefined) ?? [];

  const corrEvents = await client.from('work_events').select('event_type,created_at').eq('work_item_id', CORRECTION).order('created_at', { ascending: true });
  const reviewed = await client.from('work_items').select('state').eq('id', REVIEWED).single();
  const reviewedEvents = await client.from('work_events').select('event_type,created_at').eq('work_item_id', REVIEWED).order('created_at', { ascending: true });

  const audit = await readPaidComputeBudgetAudit(client, OLD_AUTHORITY);

  console.log(JSON.stringify({
    mode: 'READ_ONLY',
    correctionSuccessor: {
      id: CORRECTION,
      state: corr.data?.state,
      proposalVersion: corr.data?.proposal_version,
      events: (corrEvents.data ?? []).map(e => e.event_type),
      validation_criteria: criteria.map(c => ({ label: c.label, proof: c.proof, command: c.command ?? null, coversCount: c.covers?.length ?? 0 })),
    },
    reviewedItem: { id: REVIEWED, state: reviewed.data?.state, events: (reviewedEvents.data ?? []).map(e => e.event_type) },
    oldAuthorityLedger: audit.ok ? {
      authorizationId: audit.budget.authorizationId,
      ceiling: audit.budget.ceiling, reserved: audit.budget.reserved, committed: audit.budget.committed,
      voided: audit.budget.voided, settledExcess: audit.budget.settledExcess, remaining: audit.budget.remaining,
      reservation: (audit.budget.reservations ?? []).map(r => ({ id: r.reservationId, settled: r.settled, settledCost: r.settledCost, costSource: r.costSource, voided: r.voided, amount: r.amount })),
    } : audit,
  }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
