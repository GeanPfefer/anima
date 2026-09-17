// OPERACIONAL (não commitar) — READ-ONLY. Preflight do lado DB para a Fase 6 do run live:
// confirma authority ativa + escopo por capacidade + ledger (committed/remaining) SEM mutar nada.
// Usa a identidade residente (GoTrue -> Bearer -> RLS select-own; NUNCA service_role). US$0.
import { resolveCliIdentity } from '@/cli/identity';
import { listPaidComputeAuthorizations, readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

const AUTHORITY = '3b87224f-071f-486d-88b8-a9dfe0259747';
const WORK_ITEM = '8a2515d8-6967-463e-af2a-fd5d2b5e42a1';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const now = new Date();

  const auths = await listPaidComputeAuthorizations(client, now);
  if (!auths.ok) throw new Error(`authorizations: ${auths.code} ${auths.message}`);
  const audit = await readPaidComputeBudgetAudit(client, AUTHORITY);
  if (!audit.ok) throw new Error(`ledger: ${audit.code} ${audit.message}`);

  const target = auths.authorizations.find(a => a.id === AUTHORITY) ?? null;
  const ledger = audit.budget;
  const activeForItem = auths.authorizations.filter(a =>
    a.active && a.providerId === 'runpod' && (a.workItemId === null || a.workItemId === WORK_ITEM));

  console.log(JSON.stringify({
    mode: 'READ_ONLY',
    targetAuthority: target === null ? 'NOT_FOUND' : {
      id: target.id, active: target.active, providerId: target.providerId,
      nodeId: target.nodeId, resourceClass: target.resourceClass,
      capabilityScope: target.capabilityScope, workItemId: target.workItemId,
      maxCost: target.maxCost, validUntil: target.validUntil, revokedAt: target.revokedAt,
    },
    targetLedger: ledger === null ? { committed: 0, remaining: target?.maxCost?.amount ?? null, reservations: [] } : {
      ceiling: ledger.ceiling, reserved: ledger.reserved, voided: ledger.voided,
      committed: ledger.committed, remaining: ledger.remaining,
      reservations: ledger.reservations.map(r => ({ reservationId: r.reservationId, amount: r.amount, currency: r.currency, voided: r.voided, nodeId: r.nodeId })),
    },
    otherActiveRunpodAuthoritiesForItem: activeForItem.filter(a => a.id !== AUTHORITY).map(a => a.id),
  }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
