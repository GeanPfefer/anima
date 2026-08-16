import {
  buildHostObservedGateEvidence,
  type HostObservedGateEvidenceV1,
  type ObservedGateInput,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// Persistência da evidência de GATE observada pelo host. A OBSERVAÇÃO já aconteceu
// durante a execução (o host mediu cada gate via `runGate` e um coletor host-side
// acumulou os fatos brutos); aqui só se constrói a evidência durável e se persiste
// atrás de uma porta injetada. FAIL-OPEN: a evidência de gate é advisory/observada;
// falhar em persistir só significa "sem evidência de gate nesta volta", nunca altera
// o desfecho da tentativa.

export interface GateEvidenceCorrelation {
  readonly workItemId: string;
  readonly attemptId: string;
  readonly approvedProposalVersion: number;
}

/** Porta de persistência. O caller injeta a RPC real. */
export interface GateEvidenceSink {
  record(evidence: HostObservedGateEvidenceV1): Promise<
    | { readonly ok: true; readonly action: 'recorded' | 'replayed' }
    | { readonly ok: false; readonly message: string }
  >;
}

export type GateEvidenceOutcome =
  | { readonly ok: true; readonly action: 'recorded' | 'replayed'; readonly evidence: HostObservedGateEvidenceV1 }
  // `skipped` = nenhum gate observado; `build` = fatos não formaram evidência válida;
  // `persist` = a RPC recusou. Todos NÃO-FATAIS.
  | { readonly ok: false; readonly stage: 'skipped' | 'build' | 'persist'; readonly reason: string };

/**
 * Constrói a evidência de gate a partir dos fatos observados pelo host e a persiste
 * pela porta injetada. Fail-open: devolve um desfecho tipado, nunca lança.
 */
export async function persistHostObservedGateEvidence(
  correlation: GateEvidenceCorrelation,
  observed: readonly ObservedGateInput[],
  sink: GateEvidenceSink,
  now: () => Date = () => new Date(),
): Promise<GateEvidenceOutcome> {
  if (observed.length === 0) return { ok: false, stage: 'skipped', reason: 'no gates observed' };
  const built = buildHostObservedGateEvidence({
    workItemId: correlation.workItemId,
    attemptId: correlation.attemptId,
    approvedProposalVersion: correlation.approvedProposalVersion,
    gates: observed,
    observedAt: now().toISOString(),
  });
  if (!built.ok) return { ok: false, stage: 'build', reason: built.explanation };
  const persisted = await sink.record(built.value).catch((error: unknown) =>
    ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }));
  if (!persisted.ok) return { ok: false, stage: 'persist', reason: persisted.message };
  return { ok: true, action: persisted.action, evidence: built.value };
}

/**
 * Sink real: persiste pela RPC `record_host_observed_gate_evidence`. Os parâmetros
 * autoritativos vêm da PRÓPRIA evidência (correlação derivada dos fatos observados),
 * e a RPC recarimba proveniência system/host e revalida contra a tentativa real.
 */
export const gateEvidenceSinkFor = (client: SupabaseClient<Database>): GateEvidenceSink => ({
  record: async (evidence) => {
    const { data, error } = await client.rpc('record_host_observed_gate_evidence', {
      work_item_id: evidence.workItemId,
      expected_proposal_version: evidence.approvedProposalVersion,
      attempt_id: evidence.attemptId,
      evidence: evidence as unknown as Json,
    });
    if (error) return { ok: false, message: error.message };
    const action = (data as { action?: string } | null)?.action === 'replayed' ? 'replayed' : 'recorded';
    return { ok: true, action };
  },
});
