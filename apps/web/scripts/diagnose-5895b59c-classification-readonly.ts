// READ-ONLY: diagnostica por que ensurePlannedProjectClassification recusou o successor 5895b59c.
// Avalia cada sub-condição de `planned` e replica sourceForClassification, comparando o
// execution_spec do 5895b59c (falhou) com o do 4a36b0a5 (classificou com sucesso). Não muta nada.
import { readCanonicalProvenanceFromIntent } from '@anima/core';
import { resolveCliIdentity } from '@/cli/identity';

const SUCCESSOR_ID = '5895b59c-0568-483a-9731-2abd45fb4b90';
const PREDECESSOR_ID = '4a36b0a5-3be8-4431-a3fa-258be13917a3';

type AnyIntent = { planner?: unknown; execution_spec?: Record<string, unknown> };
const supportedPlanner = (v: unknown): boolean => v === 'openai_project_tools_v1' || v === 'local_ollama_project_tools_v1';

async function describe(client: any, id: string) {
  const read = await client.from('work_items').select('state,proposal_version,impact_level,capability,intent').eq('id', id).maybeSingle();
  if (read.error || !read.data) return { id, error: read.error?.message ?? 'not found' };
  const item = read.data;
  const intent = item.intent as AnyIntent;
  const spec = (intent.execution_spec ?? {}) as Record<string, any>;

  // Replica sourceForClassification (branches)
  const plannerSupported = supportedPlanner(intent.planner);
  const canonicalProvenance = readCanonicalProvenanceFromIntent(intent as any);
  const hasResumeFromCheckpoint = typeof spec.resume_from_checkpoint === 'object' && spec.resume_from_checkpoint !== null;

  // Walk lineage se resume_from_checkpoint presente
  let lineageWalk: any = 'nao-tentado (sem resume_from_checkpoint)';
  if (hasResumeFromCheckpoint) {
    const visited = new Set<string>([id]);
    let currentId = id;
    lineageWalk = 'sem-fonte';
    for (let hop = 0; hop < 16; hop++) {
      const lineage = await client.from('work_recovery_lineage').select('original_work_item_id').eq('successor_work_item_id', currentId).maybeSingle();
      if (lineage.error || !lineage.data) { lineageWalk = `parou hop ${hop}: sem pai`; break; }
      const originalId = lineage.data.original_work_item_id;
      if (visited.has(originalId)) { lineageWalk = `ciclo em ${originalId}`; break; }
      visited.add(originalId);
      const original = await client.from('work_items').select('intent').eq('id', originalId).maybeSingle();
      if (original.error || !original.data) { lineageWalk = `pai ${originalId} nao encontrado`; break; }
      const oi = original.data.intent as AnyIntent;
      if (supportedPlanner(oi.planner)) { lineageWalk = `planner ${String(oi.planner)} @ ${originalId}`; break; }
      if (readCanonicalProvenanceFromIntent(original.data.intent as any) !== null) { lineageWalk = `canonical_backlog_v1 @ ${originalId}`; break; }
      currentId = originalId;
    }
  }

  const classificationSource = plannerSupported ? intent.planner
    : canonicalProvenance !== null ? 'canonical_backlog_v1'
    : null; // (lineage walk só ocorre se hasResumeFromCheckpoint)

  const supportedImpact = item.impact_level === 'low' || item.impact_level === 'structural';
  const conds = {
    'state===approved': item.state === 'approved',
    'proposal_version===expected': item.proposal_version,
    supportedImpact,
    'capability===programming': item.capability === 'programming',
    'classificationSource!==null (SEM lineage walk)': classificationSource !== null,
    'target.kind===project': spec?.target?.kind === 'project',
    'target.reference===anima': spec?.target?.reference === 'anima',
    'permissions ok': Array.isArray(spec.permissions) && spec.permissions.length === 2 && spec.permissions[0] === 'workspace_read' && spec.permissions[1] === 'workspace_write_isolated',
    'validation_criteria>0': Array.isArray(spec.validation_criteria) && spec.validation_criteria.length > 0,
    'max_attempts in [1,3]': typeof spec.limits?.max_attempts === 'number' && spec.limits.max_attempts >= 1 && spec.limits.max_attempts <= 3,
    'max_duration===30': spec.limits?.max_duration_minutes === 30,
  };

  return {
    id,
    state: item.state,
    specKeys: Object.keys(spec).sort(),
    plannerTopLevel: intent.planner ?? null,
    plannerSupported,
    canonicalProvenance,
    hasResumeFromCheckpoint,
    resume_from_checkpoint: spec.resume_from_checkpoint ?? null,
    base_sha: spec.base_sha ?? null,
    lineageWalkIfTriggered: lineageWalk,
    classificationSourceWithoutWalk: classificationSource,
    conds,
  };
}

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const successor = await describe(client, SUCCESSOR_ID);
  const predecessor = await describe(client, PREDECESSOR_ID);
  console.log(JSON.stringify({ mode: 'READ_ONLY', successor, predecessor }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
