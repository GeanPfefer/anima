// OPERACIONAL (não commitar). Approval + classification canônicos do successor a84de19c.
import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';

const ITEM = 'a84de19c-3766-44ed-8ce2-80e856ec2a38';
const VERSION = 1;

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const service = createWorkOrchestrationService(client);
  const current = await service.getItem(ITEM);
  if (!current.ok || current.value.state !== 'proposed' || current.value.proposalVersion !== VERSION) throw new Error(`estado/versão divergente: ${JSON.stringify(current.ok ? { state: current.value.state, v: current.value.proposalVersion } : current.error)}`);
  const approved = await service.resolveApproval({ workItemId: ITEM, expectedProposalVersion: VERSION, decision: { type: 'approve' } });
  if (!approved.ok) throw new Error(`${approved.error.code}: ${approved.error.message}`);
  const classified = await ensurePlannedProjectClassification(client, ITEM, VERSION);
  if (!classified.ok) throw new Error(`${classified.code}: ${classified.message}`);
  console.log(JSON.stringify({ approved: true, classified }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
