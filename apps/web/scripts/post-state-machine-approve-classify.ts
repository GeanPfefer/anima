import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';
const ITEM = 'd054b90f-14e5-4f33-b236-3fe62e97cc20';
async function main(): Promise<void> {
  const identity = await resolveCliIdentity(); if (!identity.ok) throw new Error(identity.error);
  const service = createWorkOrchestrationService(identity.identity.client);
  const current = await service.getItem(ITEM);
  if (!current.ok || current.value.state !== 'proposed' || current.value.proposalVersion !== 1) throw new Error('estado/versão divergente');
  const approved = await service.resolveApproval({ workItemId: ITEM, expectedProposalVersion: 1, decision: { type: 'approve' } });
  if (!approved.ok) throw new Error(`${approved.error.code}: ${approved.error.message}`);
  const classified = await ensurePlannedProjectClassification(identity.identity.client, ITEM, 1);
  if (!classified.ok) throw new Error(`${classified.code}: ${classified.message}`);
  console.log(JSON.stringify({ item: ITEM, approved: true, classified }, null, 2));
}
void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
