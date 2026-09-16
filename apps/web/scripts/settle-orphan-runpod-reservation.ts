// OPERACIONAL (não commitar): reconcilia a reserva RunPod órfã 2b931274 pelo custo REAL
// (~US$0,0243) via o RPC CANÔNICO append-only `settle_paid_compute_budget_reservation`,
// sob identidade residente (Bearer/RLS, dona da autoridade), NUNCA service_role.
// reserved ≠ settled: settle grava o custo efetivo S e libera o excesso R−S. NÃO void
// (Pod dxrkpol155xvne foi criado e rodou ~178s ⇒ custo real existe). Idempotente pelo RPC.
import { resolveCliIdentity } from '@/cli/identity';
import {
  settlePaidComputeBudgetReservation,
  readPaidComputeBudgetAudit,
} from '@/lib/work-orchestration/paid-compute-authorization-store';

const RESERVATION_ID = '2b931274-0883-40a0-8f5e-8ccbb95374cd';
const AUTHORITY_ID = '3b87224f-071f-486d-88b8-a9dfe0259747';
const SETTLED = { currency: 'USD', amount: 0.0243 } as const;

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;

  const result = await settlePaidComputeBudgetReservation(client, {
    reservationId: RESERVATION_ID, settled: SETTLED, costSource: 'estimated',
  });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  console.log(JSON.stringify({
    step: 'settled', userId, reservationId: RESERVATION_ID,
    action: result.action, settledAmount: result.settledAmount,
    releasedExcess: result.releasedExcess, currency: result.currency, costSource: result.costSource,
  }, null, 2));

  const audit = await readPaidComputeBudgetAudit(client, AUTHORITY_ID);
  console.log(JSON.stringify({ step: 'audit', authority: AUTHORITY_ID, audit }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
