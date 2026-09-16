// Aprova canonicamente o replacement 4a36b0a5 (proposal v1) e prepara a classificação real
// (ato de estado, ZERO gasto, nenhuma chamada de provider). Fail-closed: se a aprovação ou a
// classificação não se aplicarem ao envelope persistido, aborta antes de qualquer execução paga.
import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';

const WORK_ITEM_ID = '4a36b0a5-3be8-4431-a3fa-258be13917a3';
const PROPOSAL_VERSION = 1;

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;
  const service = createWorkOrchestrationService(client);

  const approved = await service.resolveApproval({
    workItemId: WORK_ITEM_ID,
    expectedProposalVersion: PROPOSAL_VERSION,
    decision: { type: 'approve' },
  });
  if (!approved.ok) throw new Error(`${approved.error.code}: ${approved.error.message}`);
  console.log(JSON.stringify({ step: 'approved', userId, workItemId: WORK_ITEM_ID, proposalVersion: PROPOSAL_VERSION }, null, 2));

  const classified = await ensurePlannedProjectClassification(client, WORK_ITEM_ID, PROPOSAL_VERSION);
  if (!classified.ok) throw new Error(`${classified.code}: ${classified.message}`);
  console.log(JSON.stringify({
    step: 'classified',
    ok: classified.ok,
    replayed: (classified as { replayed?: boolean }).replayed ?? false,
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
