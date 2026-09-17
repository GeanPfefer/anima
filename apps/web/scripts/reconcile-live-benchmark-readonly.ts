// OPERACIONAL (não commitar) — READ-ONLY. Reconciliação do STORE VIVO antes de criar
// successor/authority para o benchmark settlement B1/B2/B3. NÃO muta nada. US$0.
// Identidade residente (GoTrue -> Bearer -> RLS; NUNCA service_role).
import { resolveCliIdentity } from '@/cli/identity';
import { listPaidComputeAuthorizations, readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

const PRED = '7e0a75cf-560b-45a1-8097-5631c631ad05'; // predecessor terminal do benchmark
const EXPECTED_SCOPE = [
  'apps/web/lib/work-orchestration/post-turn-observation.ts',
  'apps/web/lib/work-orchestration/post-turn-observation.test.ts',
  'apps/web/lib/work-orchestration/autonomous-backlog-deps.ts',
  'apps/web/lib/work-orchestration/autonomous-backlog-deps-router.test.ts',
];

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;

  const item = await client.from('work_items').select('id,state,proposal_version,impact_level,capability,intent,proposal,updated_at').eq('id', PRED).single();
  if (item.error || !item.data) throw new Error(`predecessor ausente: ${item.error?.message}`);
  const intent = item.data.intent as { execution_spec?: Record<string, unknown> };
  const spec = intent?.execution_spec ?? {};
  const proposal = item.data.proposal as { data?: Record<string, unknown> };
  const scope = proposal?.data?.included_scope;

  // lineage: successores existentes de 7e0a75cf (para calcular a próxima sequence e
  // garantir que NÃO há successor não-terminal já criado)
  const asOriginal = await client.from('work_recovery_lineage').select('*').eq('original_work_item_id', PRED);
  if (asOriginal.error) throw new Error(asOriginal.error.message);
  // lineage do próprio 7e0a75cf (onde ele é successor)
  const asSuccessor = await client.from('work_recovery_lineage').select('*').eq('successor_work_item_id', PRED);

  const now = new Date();
  const auths = await listPaidComputeAuthorizations(client, now);
  if (!auths.ok) throw new Error(`auths: ${auths.code} ${auths.message}`);
  const openAiAuths = auths.authorizations.filter(a => a.providerId === 'openai').map(a => ({ id: a.id, active: a.active, workItemId: a.workItemId, resourceClass: a.resourceClass, maxCost: a.maxCost, validUntil: a.validUntil, revokedAt: a.revokedAt }));

  // ledger das autoridades OpenAI conhecidas (reservas abertas a preservar)
  const knownAuthIds = ['fc01585e-b334-415e-a730-a0cd8b39536d', 'c922b5be-9d26-4035-9405-af5f99a9f12a', '1447ebcd-7635-4567-b785-007e3512ca72'];
  const ledgers: Record<string, unknown> = {};
  for (const a of openAiAuths) {
    const audit = await readPaidComputeBudgetAudit(client, a.id);
    if (audit.ok && audit.budget) {
      ledgers[a.id] = { ceiling: audit.budget.ceiling, reserved: audit.budget.reserved, committed: audit.budget.committed, voided: audit.budget.voided, remaining: audit.budget.remaining, reservations: audit.budget.reservations.map(r => ({ reservationId: r.reservationId, amount: r.amount, voided: r.voided })) };
    }
  }

  console.log(JSON.stringify({
    mode: 'READ_ONLY_RECONCILE',
    userId,
    predecessor: {
      id: item.data.id, state: item.data.state, proposal_version: item.data.proposal_version,
      impact_level: item.data.impact_level, capability: item.data.capability, updated_at: item.data.updated_at,
      base_sha: spec.base_sha, resume: spec.resume_from_checkpoint ?? spec.resume ?? null, model: spec.model,
      scope, scopeMatchesExpected: JSON.stringify(scope) === JSON.stringify(EXPECTED_SCOPE),
    },
    lineage: {
      successorsOf_7e0a75cf: asOriginal.data,
      nextSequenceIfSourcedFrom_7e0a75cf: (asOriginal.data ?? []).reduce((m: number, r: { recovery_sequence?: number }) => Math.max(m, r.recovery_sequence ?? 0), 0) + 1,
      _7e0a75cf_asSuccessor: asSuccessor.error ? asSuccessor.error.message : asSuccessor.data,
    },
    openAiAuthorities: openAiAuths,
    knownAuthIds,
    ledgers,
  }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
