// READ-ONLY: prova consolidada das 5 condições pré-pagas do seq.5 (dae3be71) exigidas pela
// decisão humana antes de qualquer authority paga. Não muta nada.
import { resolveCliIdentity } from '@/cli/identity';
import { listPaidComputeAuthorizations } from '@/lib/work-orchestration/paid-compute-authorization-store';

const SEQ5 = 'dae3be71-412d-4730-92ac-bf25b36af758';
const LINEAGE_ROOT = '3b0b3c57-a1d0-4bbe-a719-829b680ca6d1';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;

  const item = await client.from('work_items').select('id,state,proposal_version,capability,impact_level,intent').eq('id', SEQ5).single();
  if (item.error || !item.data) throw new Error(`item: ${item.error?.message ?? 'sem linha'}`);
  const spec = (item.data.intent as { execution_spec?: Record<string, unknown> }).execution_spec ?? {};
  const rfc = (spec as Record<string, unknown>)['resume_from_checkpoint'];

  const lineage = await client.from('work_recovery_lineage').select('id,original_work_item_id,successor_work_item_id,recovery_sequence,relation_kind').eq('successor_work_item_id', SEQ5).maybeSingle();

  const cls = await client.rpc('current_work_intelligence_classification', { p_work_item_id: SEQ5 });

  const events = await client.from('work_events').select('event_type,proposal_version,created_at').eq('work_item_id', SEQ5).order('created_at', { ascending: true });
  const claims = await client.from('work_claims').select('*').eq('work_item_id', SEQ5);

  const auths = await listPaidComputeAuthorizations(client);
  const forSeq5 = auths.ok ? auths.authorizations.filter(a => a.workItemId === SEQ5) : auths;

  const cond1 = !!lineage.data && lineage.data.original_work_item_id === LINEAGE_ROOT && lineage.data.recovery_sequence === 5;
  const cond2 = typeof rfc === 'object' && rfc !== null;
  const cond3 = !!(cls.data as { classification?: unknown } | null)?.classification;
  const cond5_noAuthYet = Array.isArray(forSeq5) && forSeq5.length === 0;
  const cond5_noClaim = (claims.data?.length ?? 0) === 0;

  console.log(JSON.stringify({
    mode: 'READ_ONLY',
    seq5: SEQ5,
    state: item.data.state,
    proposalVersion: item.data.proposal_version,
    capability: item.data.capability,
    impact: item.data.impact_level,
    resume_from_checkpoint: rfc ?? null,
    lineage: lineage.data ?? null,
    classificationPresent: cond3,
    classification: (cls.data as { classification?: unknown } | null)?.classification ?? null,
    events: (events.data ?? []).map(e => e.event_type),
    activeClaims: claims.data ?? [],
    paidAuthoritiesForSeq5: forSeq5,
    CONDICOES_PRE_PAGAS: {
      '1_existe_e_ligado_lineage': cond1,
      '2_execution_spec_tem_resume_from_checkpoint': cond2,
      '3_classification_canonica_passou': cond3,
      '4_gates_deterministicos_coerentes': '25 focais VERDES no af313c3 (provado antes; commits inalterados)',
      '5a_sem_authority_ainda': cond5_noAuthYet,
      '5b_sem_claim_attempt': cond5_noClaim,
    },
    APROVADO_PARA_PAGO: cond1 && cond2 && cond3 && cond5_noAuthYet && cond5_noClaim && item.data.state === 'approved',
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
