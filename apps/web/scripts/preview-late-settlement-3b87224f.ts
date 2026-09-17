// READ-ONLY: mostra o efeito hipotético do late settlement das duas reservas históricas da
// authority capability-based 3b87224f. NÃO chama a RPC de settlement e NÃO toca o provider.
// Os custos abaixo são estimativas host-observed registradas nas provas de 2026-09-10; qualquer
// liquidação real continua exigindo autorização humana explícita e deve escolher a fonte correta.
import { resolveCliIdentity } from '@/cli/identity';
import { listPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

const AUTHORIZATION_ID = '3b87224f-071f-486d-88b8-a9dfe0259747';
const ESTIMATED_COST_BY_RESERVATION: Readonly<Record<string, number>> = {
  '94641959-9bc6-46fd-8810-5bc943b6bc0b': 0.08247,
  '0a85dc0f-afbe-488f-bb11-b32884f520d3': 0.0825,
};
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100_000) / 100_000;

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const audit = await listPaidComputeBudgetAudit(identity.identity.client);
  if (!audit.ok) throw new Error(`${audit.code}: ${audit.message}`);
  const budget = audit.budgets.find(entry => entry.authorizationId === AUTHORIZATION_ID);
  if (!budget) throw new Error(`authority ${AUTHORIZATION_ID} não encontrada`);

  let resultingCommitted = budget.committed;
  const reservations = budget.reservations.map(reservation => {
    const estimatedCost = ESTIMATED_COST_BY_RESERVATION[reservation.reservationId] ?? null;
    const settledExcessPossible = !reservation.voided && !reservation.settled && estimatedCost !== null
      ? money(Math.max(0, reservation.amount - estimatedCost)) : 0;
    resultingCommitted = money(resultingCommitted - settledExcessPossible);
    return {
      reservationId: reservation.reservationId,
      reserved: { currency: reservation.currency, amount: reservation.amount },
      estimatedCost: estimatedCost === null ? null : { currency: reservation.currency, amount: estimatedCost },
      settledExcessPossible: { currency: reservation.currency, amount: settledExcessPossible },
      alreadyVoided: reservation.voided,
      alreadySettled: reservation.settled,
    };
  });

  console.log(JSON.stringify({
    mode: 'READ_ONLY_PREVIEW', authorizationId: AUTHORIZATION_ID,
    currentCommitted: { currency: budget.ceiling?.currency ?? 'USD', amount: budget.committed },
    reservations,
    resultingCommitted: { currency: budget.ceiling?.currency ?? 'USD', amount: money(Math.max(0, resultingCommitted)) },
    applied: false,
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
