// OPERACIONAL (não commitar): reconcilia UMA reserva RunPod órfã (pod já offline,
// activeDurationMs 0 ⇒ custo real ~0) via o RPC CANÔNICO append-only
// `void_paid_compute_budget_reservation`, sob identidade residente (Bearer/RLS,
// dona da autoridade), NUNCA service_role. Libera a exposição fantasma sem inferir
// settled (reserved ≠ settled). Idempotente pelo próprio RPC.
import { resolveCliIdentity } from '@/cli/identity';

const RESERVATION_ID = process.argv[2] ?? '2b931274-0883-40a0-8f5e-8ccbb95374cd';
const REASON = 'orphan_reservation_dead_pod_reconcile';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;
  const { data, error } = await client.rpc('void_paid_compute_budget_reservation', {
    reservation_id: RESERVATION_ID, reason: REASON,
  });
  if (error) throw new Error(`${error.code ?? ''} ${error.message}`);
  console.log(JSON.stringify({ step: 'voided', userId, reservationId: RESERVATION_ID, result: data ?? null }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
