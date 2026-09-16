// FASE 3 (Opção B): aprova canonicamente o seq.5 (dae3be71) e classifica pela POLÍTICA VIGENTE,
// SEM alterá-la. Ato de estado, ZERO gasto, nenhuma chamada de provider. Fail-closed. A passagem
// da classificação é a PROVA autoritativa de que sourceForClassification() deriva um source do
// novo execution_spec (via resume_from_checkpoint + lineage), condição obrigatória pré-paga.
import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';

const WORK_ITEM_ID = 'dae3be71-412d-4730-92ac-bf25b36af758';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;
  const service = createWorkOrchestrationService(client);

  const read = await client.from('work_items').select('state,proposal_version').eq('id', WORK_ITEM_ID).single();
  if (read.error || !read.data) throw new Error(`leitura falhou: ${read.error?.message ?? 'sem linha'}`);
  const version = read.data.proposal_version as number;
  console.log(JSON.stringify({ step: 'read', state: read.data.state, proposalVersion: version }, null, 2));

  if (read.data.state === 'proposed') {
    const approved = await service.resolveApproval({
      workItemId: WORK_ITEM_ID,
      expectedProposalVersion: version,
      decision: { type: 'approve' },
    });
    if (!approved.ok) throw new Error(`${approved.error.code}: ${approved.error.message}`);
    console.log(JSON.stringify({ step: 'approved', userId, workItemId: WORK_ITEM_ID, proposalVersion: version }, null, 2));
  } else if (read.data.state === 'approved') {
    console.log(JSON.stringify({ step: 'already-approved', proposalVersion: version }, null, 2));
  } else {
    throw new Error(`estado inesperado: ${read.data.state}`);
  }

  const classified = await ensurePlannedProjectClassification(client, WORK_ITEM_ID, version);
  if (!classified.ok) throw new Error(`${classified.code}: ${classified.message}`);
  console.log(JSON.stringify({
    step: 'classified',
    ok: classified.ok,
    replayed: (classified as { replayed?: boolean }).replayed ?? false,
    PROVA: 'classification canônica passou => sourceForClassification derivou source do novo spec',
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
