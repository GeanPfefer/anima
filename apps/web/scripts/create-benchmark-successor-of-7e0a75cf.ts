// OPERACIONAL (não commitar). Cria UM successor canônico do benchmark settlement
// B1/B2/B3 a partir do predecessor terminal 7e0a75cf, preservando base/resume/escopo/
// critérios/limites VERBATIM (NÃO injeta a correção conhecida costSource/pricing).
// Identidade residente (GoTrue -> Bearer -> RLS; NUNCA service_role).
import { createHash } from 'node:crypto';
import { resolveCliIdentity } from '@/cli/identity';

const FAILED = '7e0a75cf-560b-45a1-8097-5631c631ad05';
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
  const source = await client.from('work_items').select('state,proposal_version,impact_level,capability,intent,proposal').eq('id', FAILED).single();
  if (source.error || !source.data) throw new Error(source.error?.message ?? 'item fonte ausente');
  if (source.data.state !== 'failed' || source.data.proposal_version !== 1 || source.data.impact_level !== 'low' || source.data.capability !== 'programming') throw new Error(`envelope fonte divergente: ${JSON.stringify({ state: source.data.state, v: source.data.proposal_version, impact: source.data.impact_level, cap: source.data.capability })}`);
  const intent = source.data.intent as { execution_spec?: Record<string, unknown> };
  const proposal = source.data.proposal as { schema_version?: number; data?: Record<string, unknown> };
  const spec = intent.execution_spec;
  if (!spec || spec.base_sha !== 'ccb7dccd6ffa25d65ce443657eddb7c97dd4b6fe' || spec.model !== 'gpt-5.6-terra') throw new Error('base/model fonte divergente');
  const resume = spec.resume_from_checkpoint as { commit_sha?: string } | undefined;
  if (!resume || resume.commit_sha !== '5fad66796af8ceeb8ad3f175dfeba911c324caec') throw new Error(`resume fonte divergente: ${JSON.stringify(resume)}`);
  if (JSON.stringify(proposal.data?.included_scope) !== JSON.stringify(EXPECTED_SCOPE)) throw new Error('escopo fonte divergente');

  const children = await client.from('work_recovery_lineage').select('recovery_sequence').eq('original_work_item_id', FAILED);
  if (children.error) throw new Error(children.error.message);
  if ((children.data ?? []).length !== 0) throw new Error('já existe successor de 7e0a75cf — abortando para não criar segundo');
  const sequence = 1;

  // VERBATIM: intent e proposal do predecessor terminal, sem qualquer alteração do
  // contrato (mesmo objetivo/critérios/escopo que falharam). Só ajusta o summary.
  const nextProposal = { ...proposal, data: { ...proposal.data, summary: 'Benchmark Coding Harness V3 (pós-14k validate-before-submit) — settlement OpenAI B1/B2/B3.' } };
  const key = stableUuid(`benchmark-v3:${FAILED}:settlement-b1-b2-b3:validate-before-submit:v1`);
  const created = await client.rpc('propose_recovery_successor', {
    p_original_work_item_id: FAILED,
    p_recovery_sequence: sequence,
    p_impact_level: source.data.impact_level,
    p_capability: source.data.capability,
    p_intent: source.data.intent,
    p_proposal: nextProposal,
    p_recovery_reason: 'Benchmark canônico do mesmo settlement B1/B2/B3 após 7e0a75cf falhar no gate 1: preservar base/resume/escopo/limites VERBATIM e executar exatamente uma attempt OpenAI pelo Coding Harness V3 com validate-before-submit; medir se o agente descobre e corrige o defeito sem receber a correção pronta.',
    p_idempotency_key: key,
  });
  if (created.error) throw new Error(`${created.error.code ?? ''}: ${created.error.message}`);
  console.log(JSON.stringify({ created: created.data, sequence, idempotencyKey: key, objectivePreview: String(proposal.data?.objective ?? '').slice(0, 400) }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
