import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';

const WORK_ITEM_ID = '8a2515d8-6967-463e-af2a-fd5d2b5e42a1';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const service = createWorkOrchestrationService(identity.identity.client);
  const current = await service.getItem(WORK_ITEM_ID);
  if (!current.ok) throw new Error(`${current.error.code}: ${current.error.message}`);
  if (current.value.state !== 'proposed') throw new Error(`estado inesperado: ${current.value.state}`);

  const rawSpec = current.value.intent['execution_spec'];
  if (typeof rawSpec !== 'object' || rawSpec === null || Array.isArray(rawSpec)) {
    throw new Error('execution_spec ausente');
  }
  const intent = {
    execution_spec: {
      ...rawSpec,
      coder_backend: 'ollama',
      model: 'qwen3-coder:latest',
    },
  };
  const revised = await service.reviseProposal({
    workItemId: current.value.id,
    expectedProposalVersion: current.value.proposalVersion,
    intent,
    proposal: current.value.proposal,
  });
  if (!revised.ok) throw new Error(`${revised.error.code}: ${revised.error.message}`);
  console.log(JSON.stringify({
    workItemId: revised.value.id,
    state: revised.value.state,
    proposalVersion: revised.value.proposalVersion,
    coderBackend: 'ollama',
    model: 'qwen3-coder:latest',
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
