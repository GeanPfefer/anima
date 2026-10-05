import { computeInvestigationVerifierOpinion, computeVerifierOpinion, guardCanonicalResidentWrite, parseInvestigationExecution, readEffectClass, readVerifierRequirement, renderInvestigationSummary, type VerifierOpinionV1, type WorkEvent, type WorkItem, type InvestigationResultV1 } from '@anima/core';
import { hasNewProhibitedInvestigationRefs, readProhibitedInvestigationRefs, resolveInvestigationEvidence, type InvestigationTarget } from './investigation-executor';
import { projectRoot, readExecutionContract } from './executor-selection';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// Produtor vivo do PARECER do Verifier. O cálculo é PURO no core
// (`computeVerifierOpinion`); esta camada só compõe o cálculo com a persistência
// atrás de uma porta injetada, mantendo o transporte (Supabase/RPC) fora do core.
//
// O parecer é ADVISORY e RECOMPUTÁVEL de (item, eventos): persistir é auditoria,
// nunca um efeito a proteger. Por isso a composição é FAIL-OPEN — qualquer falha
// só significa "sem parecer persistido nesta volta"; o parecer continua
// recomputável no próximo seam a partir do log.

/** Porta de persistência do parecer. O caller injeta a RPC real. */
export interface VerifierOpinionSink {
  record(opinion: VerifierOpinionV1): Promise<
    | { readonly ok: true; readonly action: 'recorded' | 'replayed' }
    | { readonly ok: false; readonly message: string }
  >;
}

export type VerifierOpinionOutcome =
  | { readonly ok: true; readonly action: 'recorded' | 'replayed'; readonly opinion: VerifierOpinionV1 }
  // `skipped` = não havia resultado durável a verificar (parecer null); `persist` =
  // a RPC recusou. Ambos são NÃO-FATAIS: o parecer permanece recomputável do log.
  | { readonly ok: false; readonly stage: 'skipped' | 'persist'; readonly reason: string };

/**
 * Calcula o parecer do estado persistido e, quando há o que verificar, persiste-o
 * pela porta injetada. Fail-open por contrato: devolve um desfecho tipado, nunca
 * lança. Não decide, não autoriza, não integra — só registra o parecer.
 */
export async function computeAndPersistVerifierOpinion(
  input: { readonly item: WorkItem; readonly events: readonly WorkEvent[] },
  sink: VerifierOpinionSink,
  investigationDependencies: InvestigationVerifierDependencies = {},
): Promise<VerifierOpinionOutcome> {
  const latestResult = [...input.events].reverse().find(event => event.type === 'result_submitted');
  const data = record(record(latestResult?.payload)?.data);
  const signal = record(data?.executor_signal);
  // Isolated SDC-10 branch. Malformed investigations never fall back to programming.
  const opinion = signal && Object.prototype.hasOwnProperty.call(signal, 'investigation')
    ? await investigationOpinion(input.item, latestResult!, data!, signal, investigationDependencies).catch(() => null)
    : computeVerifierOpinion(input.item, input.events);
  if (!opinion) return { ok: false, stage: 'skipped', reason: 'no durable result to verify' };
  const persisted = await sink.record(opinion).catch((error: unknown) =>
    ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }));
  if (!persisted.ok) return { ok: false, stage: 'persist', reason: persisted.message };
  return { ok: true, action: persisted.action, opinion };
}

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export interface InvestigationVerifierDependencies {
  readonly resolveTarget?: (reference: string) => InvestigationTarget | null;
  readonly resolveEvidence?: (repo: string, result: InvestigationResultV1) => Promise<boolean>;
  readonly readRefs?: (repo: string, attemptId: string) => Promise<readonly string[]>;
}
async function investigationOpinion(item: WorkItem, event: WorkEvent, data: Record<string, unknown>, signal: Record<string, unknown>, deps: InvestigationVerifierDependencies): Promise<VerifierOpinionV1 | null> {
  const effect = readEffectClass(item.intent);
  const contract = readExecutionContract(item.intent);
  if (!effect.ok || effect.value !== 'read_only' || readVerifierRequirement(item.intent) !== 'advisory'
    || contract.executor !== 'investigation-v1' || !contract.baseSha || !contract.targetReference
    || event.workItemId !== item.id || event.proposalVersion !== item.proposalVersion
    || data.work_item_id !== item.id || data.approved_proposal_version !== item.proposalVersion
    || typeof data.attempt_id !== 'string' || data.attempt_id.trim().length === 0
    || signal.kind !== 'result' || signal.origin !== 'executor' || signal.worktreeHandoff !== undefined
    || signal.workItemId !== item.id || signal.attemptId !== data.attempt_id || signal.approvedProposalVersion !== item.proposalVersion) return null;
  const investigation = parseInvestigationExecution(signal.investigation);
  if (investigation && (signal.summary !== renderInvestigationSummary(investigation)
    || typeof signal.handoffReference !== 'string' || !signal.handoffReference.trim()
    || /^[a-z]:[\\/]|^[\\/]/i.test(signal.handoffReference))) return null;
  const target = deps.resolveTarget ? deps.resolveTarget(contract.targetReference)
    : contract.targetKind === 'project' && contract.targetReference === 'anima' ? { repoRoot: projectRoot(), baseSha: contract.baseSha } : null;
  let referencesResolve = false, prohibitedRefsAbsent = false;
  if (investigation && target && investigation.hostVerification.baseSha === contract.baseSha && target.baseSha === contract.baseSha
    && !investigation.hostVerification.prohibitedRefsBefore.some(ref => ref.includes(data.attempt_id as string))) {
    referencesResolve = await (deps.resolveEvidence ?? resolveInvestigationEvidence)(target.repoRoot, investigation).catch(() => false);
    const refs = await (deps.readRefs ?? readProhibitedInvestigationRefs)(target.repoRoot, data.attempt_id).catch(() => null);
    prohibitedRefsAbsent = refs !== null && !hasNewProhibitedInvestigationRefs(investigation.hostVerification.prohibitedRefsBefore, refs);
  }
  return computeInvestigationVerifierOpinion({ workItemId: item.id, attemptId: data.attempt_id, approvedProposalVersion: item.proposalVersion,
    resultEventId: event.id, investigation: signal.investigation, referencesResolve, prohibitedRefsAbsent });
}

/**
 * Sink real: persiste pela RPC `record_verifier_opinion`. Os parâmetros
 * autoritativos vêm do PRÓPRIO parecer (a correlação que `computeVerifierOpinion`
 * derivou dos fatos persistidos), e a RPC recarimba proveniência system/verifier e
 * revalida a base de evidência contra a tentativa real.
 */
export const verifierOpinionSinkFor = (client: SupabaseClient<Database>): VerifierOpinionSink => ({
  record: async (opinion) => {
    // Guarda canônica (read-your-writes): não persiste um parecer que a linha
    // atual não conseguiria reprojetar de volta pelo read-model do Evolution.
    const guard = guardCanonicalResidentWrite('verifier_opinion', opinion);
    if (!guard.ok) return { ok: false, message: `canonical resident contract guard: ${guard.reason}` };
    const { data, error } = await client.rpc('record_verifier_opinion', {
      work_item_id: opinion.workItemId,
      expected_proposal_version: opinion.approvedProposalVersion,
      attempt_id: opinion.attemptId,
      opinion: opinion as unknown as Json,
    });
    if (error) return { ok: false, message: error.message };
    const action = (data as { action?: string } | null)?.action === 'replayed' ? 'replayed' : 'recorded';
    return { ok: true, action };
  },
});
