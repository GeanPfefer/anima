import { randomUUID } from 'node:crypto';
import { projectAutonomousQueue } from '@anima/core';
import { resolveCliIdentity } from '@/cli/identity';
import { buildProjectBacklogCycleDeps } from '@/lib/work-orchestration/autonomous-backlog-deps';
import { readAutonomousBacklogCandidates } from '@/lib/work-orchestration/autonomous-backlog-read';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';

const WORK_ITEM_ID = '8a2515d8-6967-463e-af2a-fd5d2b5e42a1';
const VERSION = 2;

async function main(): Promise<void> {
  // Restrição operacional absoluta desta prova: somente Ollama local.
  process.env.ANIMA_COMPUTE_ROUTER_V1 = '0';
  process.env.OLLAMA_URL = 'http://127.0.0.1:11434';
  process.env.ANIMA_WORKTREE_CODER_MODEL = 'qwen3-coder:latest';

  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const classified = await ensurePlannedProjectClassification(client, WORK_ITEM_ID, VERSION);
  if (!classified.ok) throw new Error(`${classified.code}: ${classified.message}`);

  const candidates = await readAutonomousBacklogCandidates(client);
  const entry = projectAutonomousQueue(candidates, new Date()).find(candidate => candidate.workItemId === WORK_ITEM_ID);
  if (!entry) throw new Error('successor não entrou na fila autônoma');
  const deps = buildProjectBacklogCycleDeps(client, `local-correction-${randomUUID()}`);
  if (!deps.hostPermitsAutonomousWork()) throw new Error('Resource Governor recusou execução local');
  const turn = await deps.runTurn(entry, new AbortController().signal);
  console.log(JSON.stringify({ workItemId: WORK_ITEM_ID, provider: 'ollama', model: 'qwen3-coder:latest', turn }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
