import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';

const WORK_ITEM_ID = 'd05bcab0-1a2a-4717-ba65-21d4bc2c1b77';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;
  const service = createWorkOrchestrationService(client);
  const read = await client.from('work_items').select('state,proposal_version').eq('id', WORK_ITEM_ID).single();
  if (read.error || !read.data) throw new Error(read.error?.message ?? 'item ausente');
  const version = read.data.proposal_version;
  if (read.data.state !== 'proposed') throw new Error(`estado inesperado: ${read.data.state}`);
  const approved = await service.resolveApproval({ workItemId: WORK_ITEM_ID, expectedProposalVersion: version, decision: { type: 'approve' } });
  if (!approved.ok) throw new Error(`${approved.error.code}: ${approved.error.message}`);
  const classified = await ensurePlannedProjectClassification(client, WORK_ITEM_ID, version);
  if (!classified.ok) throw new Error(`${classified.code}: ${classified.message}`);
  console.log(JSON.stringify({ userId, workItemId: WORK_ITEM_ID, proposalVersion: version, approved: true, classified }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
