// FASE 2/3 (decisão humana REQUEST_CHANGES, 2026-09-14): materializa a correção governada
// por RETOMADA do seq.5 (dae3be71) em `changes_requested`, pela ROTA CANÔNICA ÚNICA
// correctReviewedWorkItem (deriveResumeCorrectionSuccessor -> proposeCorrectionSuccessor). Boundary
// máximo `proposed`: não aprova, não classifica, não concede authority, não executa, não chama
// provider. Preserva root/lineage, base coerente e evidência append-only. Idempotente.
import { resolveCliIdentity } from '@/cli/identity';
import { correctReviewedWorkItem } from '@/lib/work-orchestration/review-correction-orchestration';

const WORK_ITEM_ID = 'dae3be71-412d-4730-92ac-bf25b36af758';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;

  const result = await correctReviewedWorkItem(client, WORK_ITEM_ID);
  if (!result.ok) {
    console.log(JSON.stringify({ step: 'correction-refused', reason: result.reason, refusals: result.refusals ?? null, gaps: result.gaps ?? null, message: result.message ?? null }, null, 2));
    process.exitCode = 2;
    return;
  }

  // Releitura autoritativa do successor de correção criado.
  const item = await client.from('work_items').select('id,state,proposal_version,capability,impact_level,intent,proposal').eq('id', result.successorWorkItemId).single();
  const spec = item.data ? ((item.data.intent as { execution_spec?: Record<string, unknown> }).execution_spec ?? {}) : {};

  console.log(JSON.stringify({
    step: 'correction-created',
    successorWorkItemId: result.successorWorkItemId,
    lineageId: result.lineageId,
    recoverySequence: result.recoverySequence,
    replayed: result.replayed,
    state: item.data?.state,
    proposalVersion: item.data?.proposal_version,
    impact: item.data?.impact_level,
    capability: item.data?.capability,
    base_sha: (spec as Record<string, unknown>)['base_sha'],
    resume_from_checkpoint: (spec as Record<string, unknown>)['resume_from_checkpoint'],
    limits: (spec as Record<string, unknown>)['limits'],
    correction_scope: (spec as Record<string, unknown>)['correction_scope'],
    included_scope: (item.data?.proposal as { data?: { included_scope?: unknown } } | null)?.data?.included_scope,
    excluded_scope: (item.data?.proposal as { data?: { excluded_scope?: unknown } } | null)?.data?.excluded_scope,
    validation_criteria: ((spec as Record<string, unknown>)['validation_criteria'] as Array<{ label?: string; command?: string; proof?: string }> | undefined)?.map(c => ({ label: c.label, proof: c.proof, command: c.command })),
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
