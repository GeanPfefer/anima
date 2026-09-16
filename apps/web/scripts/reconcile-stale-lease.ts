// OPERACIONAL (não commitar): converge a lease ESTALE `f9b629ed` (provision_failed, providerRef
// null, NENHUM Pod) para offline, liberando o gate de concorrência (1≥1). Read+teardown-evidence
// via Bearer do dono; o reconciler localiza no provider (não acha) e grava shutdown_confirmed.
import { resolveCliIdentity } from '@/cli/identity';
import { reconcilePaidComputeLeasesFor, readLivePaidNodeCount } from '@/lib/work-orchestration/paid-compute-lease-reconciler-deps';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;

  const before = await readLivePaidNodeCount(client);
  const report = await reconcilePaidComputeLeasesFor(client);
  const after = await readLivePaidNodeCount(client);
  console.log(JSON.stringify({ before, report, after }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
