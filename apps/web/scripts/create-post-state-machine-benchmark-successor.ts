// OPERACIONAL (não commitar). Cria exatamente um successor pós-state-machine.
import { createHash } from 'node:crypto';
import { resolveCliIdentity } from '@/cli/identity';

const PREDECESSOR = 'a84de19c-3766-44ed-8ce2-80e856ec2a38';
const EXPECTED_SCOPE = [
  'apps/web/lib/work-orchestration/post-turn-observation.ts',
  'apps/web/lib/work-orchestration/post-turn-observation.test.ts',
  'apps/web/lib/work-orchestration/autonomous-backlog-deps.ts',
  'apps/web/lib/work-orchestration/autonomous-backlog-deps-router.test.ts',
] as const;

function stableUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const source = await client.from('work_items').select('state,proposal_version,impact_level,capability,intent,proposal').eq('id', PREDECESSOR).single();
  if (source.error || !source.data) throw new Error(source.error?.message ?? 'predecessor ausente');
  if (source.data.state !== 'failed' || source.data.proposal_version !== 1 || source.data.capability !== 'programming') throw new Error('predecessor divergente');
  const intent = source.data.intent as { execution_spec?: Record<string, unknown> };
  const proposal = source.data.proposal as { schema_version?: number; data?: Record<string, unknown> };
  const spec = intent.execution_spec;
  if (!spec || spec.base_sha !== 'ccb7dccd6ffa25d65ce443657eddb7c97dd4b6fe' || spec.model !== 'gpt-5.6-terra') throw new Error('base/model divergente');
  if (JSON.stringify(proposal.data?.included_scope) !== JSON.stringify(EXPECTED_SCOPE)) throw new Error('escopo divergente');
  const children = await client.from('work_recovery_lineage').select('recovery_sequence').eq('original_work_item_id', PREDECESSOR);
  if (children.error) throw new Error(children.error.message);
  if ((children.data ?? []).length !== 0) throw new Error('successor pós-state-machine já existe');
  const key = stableUuid(`benchmark-post-state-machine:${PREDECESSOR}:v1`);
  const nextProposal = { ...proposal, data: { ...proposal.data, summary: 'Primeira prova paga pós-state-machine estrutural — settlement B1/B2/B3.' } };
  const created = await client.rpc('propose_recovery_successor', {
    p_original_work_item_id: PREDECESSOR,
    p_recovery_sequence: 1,
    p_impact_level: source.data.impact_level,
    p_capability: source.data.capability,
    p_intent: source.data.intent,
    p_proposal: nextProposal,
    p_recovery_reason: 'Primeira prova paga posterior à state machine estrutural: preservar contrato B1/B2/B3 e executar uma única attempt OpenAI com TEST e DIFF obrigatórios antes de SUBMIT.',
    p_idempotency_key: key,
  });
  if (created.error) throw new Error(`${created.error.code ?? ''}: ${created.error.message}`);
  console.log(JSON.stringify({ created: created.data, predecessor: PREDECESSOR, sequence: 1, idempotencyKey: key }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
