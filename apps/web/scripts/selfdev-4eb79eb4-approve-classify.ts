import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';
const WORK_ITEM_ID = '4eb79eb4-f6c4-40a5-b791-2e9d671a33c5';
async function main(): Promise<void> {
  const identity = await resolveCliIdentity(); if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity; const service = createWorkOrchestrationService(client);
  const item = await client.from('work_items').select('state,proposal_version').eq('id', WORK_ITEM_ID).single();
  if (item.error || item.data?.state !== 'proposed') throw new Error(`estado inesperado: ${item.error?.message ?? item.data?.state}`);
  const approved = await service.resolveApproval({ workItemId: WORK_ITEM_ID, expectedProposalVersion: item.data.proposal_version, decision: { type: 'approve' } });
  if (!approved.ok) throw new Error(`${approved.error.code}: ${approved.error.message}`);
  const classified = await ensurePlannedProjectClassification(client, WORK_ITEM_ID, item.data.proposal_version);
  if (!classified.ok) throw new Error(`${classified.code}: ${classified.message}`);
  console.log(JSON.stringify({ workItemId: WORK_ITEM_ID, proposalVersion: item.data.proposal_version, approved: true, classified }, null, 2));
}
void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
