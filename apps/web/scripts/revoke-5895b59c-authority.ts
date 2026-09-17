// FASE 0 (Opção B, decisão humana 2026-09-14): revoga canonicamente a paid authority órfã
// 74671277 (vinculada ao seq.4 malformado 5895b59c, que será abandonado). reserved=0,
// committed=0, sem attempt, sem provider call ⇒ revogação = zero gasto, evita autoridade órfã.
// Não reutiliza nem transfere a authority. Idempotente.
import { resolveCliIdentity } from '@/cli/identity';
import {
  revokePaidComputeAuthorization,
  readPaidComputeBudgetAudit,
} from '@/lib/work-orchestration/paid-compute-authorization-store';

const AUTHORIZATION_ID = '74671277-1ae9-403f-924e-768d459e44c2';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;

  const before = await readPaidComputeBudgetAudit(client, AUTHORIZATION_ID);
  const revoked = await revokePaidComputeAuthorization(client, AUTHORIZATION_ID);
  if (!revoked.ok) throw new Error(`${revoked.code}: ${revoked.message}`);
  const after = await client
    .from('paid_compute_authorizations')
    .select('id, revoked_at, valid_until')
    .eq('id', AUTHORIZATION_ID)
    .single();

  console.log(JSON.stringify({
    step: 'authority-revoked',
    authorizationId: revoked.authorizationId,
    auditBefore: before.ok ? before.budget : before,
    revokedAt: after.data?.revoked_at ?? null,
    error: after.error?.message ?? null,
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
