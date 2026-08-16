import { computeVerifierOpinion, type VerifierOpinionV1, type WorkEvent, type WorkItem } from '@anima/core';
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
): Promise<VerifierOpinionOutcome> {
  const opinion = computeVerifierOpinion(input.item, input.events);
  if (!opinion) return { ok: false, stage: 'skipped', reason: 'no durable result to verify' };
  const persisted = await sink.record(opinion).catch((error: unknown) =>
    ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }));
  if (!persisted.ok) return { ok: false, stage: 'persist', reason: persisted.message };
  return { ok: true, action: persisted.action, opinion };
}

/**
 * Sink real: persiste pela RPC `record_verifier_opinion`. Os parâmetros
 * autoritativos vêm do PRÓPRIO parecer (a correlação que `computeVerifierOpinion`
 * derivou dos fatos persistidos), e a RPC recarimba proveniência system/verifier e
 * revalida a base de evidência contra a tentativa real.
 */
export const verifierOpinionSinkFor = (client: SupabaseClient<Database>): VerifierOpinionSink => ({
  record: async (opinion) => {
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
