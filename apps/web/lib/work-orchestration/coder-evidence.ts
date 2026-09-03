import {
  buildHostObservedCoderEvidence,
  type HostObservedCoderEvidenceV1,
  type ObservedCoderInput,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// Persistência da evidência do CODER observada pelo host. A OBSERVAÇÃO já aconteceu
// durante a execução (o host cronometrou `backend.edit()` e um coletor host-side guardou
// o fato bruto: backendId, duração wall-clock e desfecho); aqui só se constrói a evidência
// durável e se persiste atrás de uma porta injetada. FAIL-OPEN: a evidência do coder é
// advisory/observada; falhar em persistir só significa "sem evidência de coder nesta volta",
// nunca altera o desfecho da tentativa (a gravação da observação não pode transformar uma
// edição bem-sucedida em falha).

export interface CoderEvidenceCorrelation {
  readonly workItemId: string;
  readonly attemptId: string;
  readonly approvedProposalVersion: number;
}

/** Porta de persistência. O caller injeta a RPC real. */
export interface CoderEvidenceSink {
  record(evidence: HostObservedCoderEvidenceV1): Promise<
    | { readonly ok: true; readonly action: 'recorded' | 'replayed' }
    | { readonly ok: false; readonly message: string }
  >;
}

export type CoderEvidenceOutcome =
  | { readonly ok: true; readonly action: 'recorded' | 'replayed'; readonly evidence: HostObservedCoderEvidenceV1 }
  // `skipped` = nenhuma edição de coder observada; `build` = os fatos não formaram evidência
  // válida; `persist` = a RPC recusou. Todos NÃO-FATAIS.
  | { readonly ok: false; readonly stage: 'skipped' | 'build' | 'persist'; readonly reason: string };

/**
 * Constrói a evidência do coder a partir do fato observado pelo host e a persiste pela
 * porta injetada. Fail-open: devolve um desfecho tipado, nunca lança.
 */
export async function persistHostObservedCoderEvidence(
  correlation: CoderEvidenceCorrelation,
  observed: ObservedCoderInput | readonly ObservedCoderInput[] | null,
  sink: CoderEvidenceSink,
  now: () => Date = () => new Date(),
): Promise<CoderEvidenceOutcome> {
  const observations = observed === null
    ? []
    : Array.isArray(observed)
      ? observed
      : [observed];

  if (observations.length === 0) {
    return { ok: false, stage: 'skipped', reason: 'no coder observed' };
  }

  const observedAt = now().toISOString();

  // Valida cada fato bruto individualmente pela mesma régua canônica do V1.
  // Assim uma duração/outcome/backend inválido em um turno intermediário não
  // pode desaparecer por causa da agregação.
  const validated: HostObservedCoderEvidenceV1[] = [];

  for (const observation of observations) {
    const turn = buildHostObservedCoderEvidence({
      workItemId: correlation.workItemId,
      attemptId: correlation.attemptId,
      approvedProposalVersion: correlation.approvedProposalVersion,
      backendId: observation.backendId,
      durationMs: observation.durationMs,
      outcome: observation.outcome,
      ...(observation.placement !== undefined ? {
        placement: observation.placement,
        nodeId: observation.nodeId,
        model: observation.model,
      } : {}),
      ...(observation.modelSelection !== undefined ? { modelSelection: observation.modelSelection } : {}),
      ...(observation.transcripts ? { transcripts: observation.transcripts } : {}),
      observedAt,
    });

    if (!turn.ok) {
      return { ok: false, stage: 'build', reason: turn.explanation };
    }

    validated.push(turn.value);
  }

  const backendId = validated[0]!.backendId;

  if (validated.some(turn => turn.backendId !== backendId)) {
    return {
      ok: false,
      stage: 'build',
      reason: 'coder observations from one attempt must use the same backend',
    };
  }
  const placement = validated[0]!.placement;
  const nodeId = validated[0]!.nodeId;
  const model = validated[0]!.model;
  if (validated.some(turn => turn.placement !== placement || turn.nodeId !== nodeId || turn.model !== model)) {
    return { ok: false, stage: 'build', reason: 'coder observations from one attempt must use the same placement identity' };
  }

  const durationMs = validated.reduce(
    (total, turn) => total + turn.durationMs,
    0,
  );

  const finalTurn = validated.at(-1)!;

  const transcripts = validated.flatMap(turn => turn.transcripts ?? []);
  const built = buildHostObservedCoderEvidence({
    workItemId: correlation.workItemId,
    attemptId: correlation.attemptId,
    approvedProposalVersion: correlation.approvedProposalVersion,
    backendId,
    durationMs,
    outcome: finalTurn.outcome,
    ...(transcripts.length ? { transcripts } : {}),
    ...(placement !== undefined ? { placement, nodeId, model } : {}),
    ...(finalTurn.modelSelection !== undefined ? { modelSelection: finalTurn.modelSelection } : {}),
    observedAt,
  });

  if (!built.ok) {
    return { ok: false, stage: 'build', reason: built.explanation };
  }
  const persisted = await sink.record(built.value).catch((error: unknown) =>
    ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }));
  if (!persisted.ok) return { ok: false, stage: 'persist', reason: persisted.message };
  return { ok: true, action: persisted.action, evidence: built.value };
}

/**
 * Sink real: persiste pela RPC `record_host_observed_coder_evidence`. Os parâmetros
 * autoritativos vêm da PRÓPRIA evidência (correlação derivada do fato observado), e a RPC
 * recarimba proveniência system/host e revalida contra a tentativa real.
 */
export const coderEvidenceSinkFor = (client: SupabaseClient<Database>): CoderEvidenceSink => ({
  record: async (evidence) => {
    const { data, error } = await client.rpc('record_host_observed_coder_evidence', {
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
