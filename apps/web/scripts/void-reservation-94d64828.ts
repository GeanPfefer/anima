// OPERACIONAL (não commitar): estorna a reserva órfã criada antes do provision que falhou com
// 403 (provider rejeitou o create; NENHUM Pod criado; zero gasto). Mantém o ledger honesto.
import { resolveCliIdentity } from '@/cli/identity';
import { voidPaidComputeBudgetReservation, listPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

const RESERVATION_ID = '94d64828-4d9c-4569-850e-43468796dfa2';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const res = await voidPaidComputeBudgetReservation(client, RESERVATION_ID, 'provider_rejected_before_create');
  console.log(JSON.stringify({ void: res }, null, 2));
  const audit = await listPaidComputeBudgetAudit(client);
  if (audit.ok) {
    const a = audit.budgets.find(b => b.authorizationId === 'fd534be7-5b04-4e04-9079-b62a6762480f');
    console.log(JSON.stringify({ authorizationId: a?.authorizationId, ceiling: a?.ceiling, reserved: a?.reserved, voided: a?.voided, committed: a?.committed, remaining: a?.remaining }, null, 2));
  }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
