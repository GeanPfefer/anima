import { createHash } from 'node:crypto';
import { resolveCliIdentity } from '@/cli/identity';

const FAILED = 'd05bcab0-1a2a-4717-ba65-21d4bc2c1b77';
const EXPECTED_SCOPE = [
  'apps/web/lib/work-orchestration/post-turn-observation.ts',
  'apps/web/lib/work-orchestration/post-turn-observation.test.ts',
  'apps/web/lib/work-orchestration/autonomous-backlog-deps.ts',
  'apps/web/lib/work-orchestration/autonomous-backlog-deps-router.test.ts',
] as const;

function stableUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-${((parseInt(hex.slice(16,18),16)&0x3f)|0x80).toString(16).padStart(2,'0')}${hex.slice(18,20)}-${hex.slice(20,32)}`;
}

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const source = await client.from('work_items').select('state,proposal_version,impact_level,capability,intent,proposal').eq('id', FAILED).single();
  if (source.error || !source.data) throw new Error(source.error?.message ?? 'item ausente');
  if (source.data.state !== 'failed' || source.data.proposal_version !== 1 || source.data.impact_level !== 'low' || source.data.capability !== 'programming') throw new Error('envelope fonte divergente');
  const proposal = source.data.proposal as { data?: { included_scope?: unknown } };
  if (JSON.stringify(proposal.data?.included_scope) !== JSON.stringify(EXPECTED_SCOPE)) throw new Error('escopo fonte divergente');
  const children = await client.from('work_recovery_lineage').select('recovery_sequence').eq('original_work_item_id', FAILED);
  if (children.error) throw new Error(children.error.message);
  const sequence = (children.data ?? []).reduce((max, row) => Math.max(max, row.recovery_sequence ?? 0), 0) + 1;
  const key = stableUuid(`operational-recovery:${FAILED}:worktree-create-failed:v1`);
  const created = await client.rpc('propose_recovery_successor', {
    p_original_work_item_id: FAILED,
    p_recovery_sequence: sequence,
    p_impact_level: source.data.impact_level,
    p_capability: source.data.capability,
    p_intent: source.data.intent,
    p_proposal: source.data.proposal,
    p_recovery_reason: 'Recovery operacional de worktree-create-failed antes de reservation/provider/edit: preservar integralmente correction B1/B2/B3 e executar o invocador in-process com cwd G:\\anima\\apps\\web.',
    p_idempotency_key: key,
  });
  if (created.error) throw new Error(`${created.error.code ?? ''}: ${created.error.message}`);
  console.log(JSON.stringify({ created: created.data, sequence, idempotencyKey: key, preservedIntent: source.data.intent, preservedProposal: source.data.proposal }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
