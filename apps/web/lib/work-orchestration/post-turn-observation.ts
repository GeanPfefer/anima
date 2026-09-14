import type { ComputeCohortKeyV1, ObservedCoderInput, ObservedGateInput, ProviderPricingV1 } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { gateEvidenceSinkFor, persistHostObservedGateEvidence } from './gate-evidence';
import { coderEvidenceSinkFor, persistHostObservedCoderEvidence } from './coder-evidence';
import { hostEvidenceSinkFor, observeAndPersistHostGitEvidence } from './host-evidence';
import { computeAndPersistVerifierOpinion, verifierOpinionSinkFor } from './verifier-opinion';
import {
  settleOpenAIActualCostReservation,
  type OpenAIComputeReservationV1,
  type OpenAIProviderUsageV1,
} from './openai-actual-cost-settlement';
import { settlePaidComputeBudgetReservation } from './paid-compute-authorization-store';
import { projectRoot, type ExecutionContract } from './executor-selection';
import { createWorkOrchestrationService } from './server';
import type { SupervisorTurnResult } from './supervisor';
import { worktreeBranchFor } from './worktree-executor';

// ============================================================
// Observação host-side pós-volta — a mesma para o turno único (rota
// `supervisor-turn`) e para o driver do backlog. É o que torna uma volta
// autônoma AUDITÁVEL e o `review` confiável: o host persiste sua evidência de
// primeira parte (gate/coder cronometrados, git observado na worktree) e o
// Verifier registra seu parecer sobre o estado FRESCO.
//
// TUDO fail-open: persistir evidência ou parecer NUNCA altera o desfecho da
// tentativa nem a resposta. Um defeito de telemetria vira evidência AUSENTE,
// jamais um erro que contamine o turno. Não aceita, autoriza, integra nem aplica.
// ============================================================

/** Fatos canônicos e correlacionados para a liquidação OpenAI pós-turno. */
export interface OpenAIActualCostSettlementFacts {
  readonly reservation: OpenAIComputeReservationV1 | null;
  readonly attemptId: string;
  readonly model: string;
  readonly cohort: ComputeCohortKeyV1;
  readonly usage: OpenAIProviderUsageV1 | null;
  readonly pricing: ProviderPricingV1 | null;
}

/** Lê a reserva pelo lease do provider e projeta usage terminal observado pelo host. */
export async function resolveOpenAIActualCostSettlementFacts(
  client: SupabaseClient<Database>,
  input: {
    readonly attemptId: string;
    readonly model: string;
    readonly cohort: ComputeCohortKeyV1;
    readonly coderObservations: readonly ObservedCoderInput[];
    readonly pricing: ProviderPricingV1 | null;
  },
): Promise<OpenAIActualCostSettlementFacts> {
  const reservationRow = await client
    .from('paid_compute_budget_events')
    .select('reservation_id,currency,amount')
    .eq('lease_id', `provider-api:${input.attemptId}`)
    .eq('event_type', 'reserved')
    .maybeSingle();
  const reservation: OpenAIComputeReservationV1 | null = reservationRow.error || !reservationRow.data
    ? null
    : {
        reservationId: reservationRow.data.reservation_id,
        attemptId: input.attemptId,
        currency: reservationRow.data.currency,
        reservedAmount: Number(reservationRow.data.amount),
      };
  const observed = input.coderObservations.find(observation => observation.providerUsage !== undefined && observation.providerCallCount !== undefined);
  const usage: OpenAIProviderUsageV1 | null = observed?.providerUsage && observed.providerCallCount !== undefined
    ? {
        inputTokens: observed.providerUsage.inputTokens,
        cachedInputTokens: observed.providerUsage.cachedInputTokens ?? 0,
        outputTokens: observed.providerUsage.outputTokens,
        providerCallCount: observed.providerCallCount,
        terminalEvidence: true,
      }
    : null;
  return { reservation, attemptId: input.attemptId, model: input.model, cohort: input.cohort, usage, pricing: input.pricing };
}

export interface PostTurnObservationInput {
  readonly client: SupabaseClient<Database>;
  readonly result: SupervisorTurnResult;
  /** Contrato do executor desta volta (null quando não há caminho worktree). */
  readonly contract: ExecutionContract | null;
  /** Durações de gate cronometradas pelo host ao redor de cada gate rodado. */
  readonly gateObservations: readonly ObservedGateInput[];
  /** Durações wall-clock do coder cronometradas pelo host ao redor de `backend.edit()`. */
  readonly coderObservations: readonly ObservedCoderInput[];
  /** Fatos de settlement montados pelo caller vivo para uma volta OpenAI paga. */
  readonly openAIActualCostSettlement?: OpenAIActualCostSettlementFacts | null;
}

/**
 * Persiste a evidência observada pelo host e o parecer do Verifier de uma volta
 * que iniciou uma tentativa. Idempotente e fail-open. Só age quando a volta
 * produziu uma tentativa correlacionada (attempt + selection).
 */
export async function persistPostTurnHostObservations(input: PostTurnObservationInput): Promise<void> {
  const { client, result, contract, gateObservations, coderObservations } = input;
  if (!result.attemptId || !result.selection) return;

  const correlation = {
    workItemId: result.selection.workItemId,
    attemptId: result.attemptId,
    approvedProposalVersion: result.selection.approvedProposalVersion,
  };

  // (0) GATE observado pelo host — persiste INCLUSIVE em terminal de erro (um gate
  // falho é a evidência mais valiosa: contradiz um executor que minta que passou).
  if (gateObservations.length > 0) {
    await persistHostObservedGateEvidence(correlation, gateObservations, gateEvidenceSinkFor(client)).catch(() => undefined);
  }

  // (0b) CODER observado pelo host — UMA evidência por tentativa, agregando a
  // duração wall-clock de todas as chamadas `backend.edit()` observadas.
  if (coderObservations.length > 0) {
    await persistHostObservedCoderEvidence(correlation, coderObservations, coderEvidenceSinkFor(client)).catch(() => undefined);
  }

  // (0c) Liquida exclusivamente fatos montados pelo caller vivo. Sem pricing
  // versionado, reserva ou usage terminal, a primitive permanece fail-closed.
  if (contract?.coderBackend === 'openai' && input.openAIActualCostSettlement) {
    const facts = input.openAIActualCostSettlement;
    await settleOpenAIActualCostReservation({
      reservation: facts.reservation,
      attemptId: facts.attemptId,
      model: facts.model,
      cohort: facts.cohort,
      usage: facts.usage,
      pricing: facts.pricing,
      settlePaidComputeBudgetReservation: audit => settlePaidComputeBudgetReservation(client, {
        reservationId: audit.reservationId,
        settled: audit.actualCost,
        costSource: 'provider_reported',
      }),
    }).catch(() => undefined);
  }

  // (1) GIT observado pelo host. Só o caminho worktree deixa uma branch real; o
  // host inspeciona `anima-work/<attempt>` contra o SHA-base do contrato e persiste
  // o que o git de fato registrou — nunca o que o executor atestou. Persiste
  // INCLUSIVE em terminal de ERRO (gate falho): quando a tentativa deixou um
  // checkpoint durável na branch, essa evidência é o que torna o checkpoint de uma
  // tentativa FALHA disponível para diagnóstico e retomada (decomposição governada).
  // observeHostGitEvidence é fail-closed em base==commit — sem checkpoint durável,
  // nada é gravado —, então um erro sem edit efetivo não fabrica evidência.
  if ((result.terminalKind === 'result' || result.terminalKind === 'error')
      && contract?.executor === 'worktree' && contract.baseSha) {
    await observeAndPersistHostGitEvidence(
      {
        repoRoot: projectRoot(),
        baseSha: contract.baseSha,
        startSha: contract.resumeCheckpointCommitSha ?? contract.baseSha,
        branch: worktreeBranchFor(result.attemptId),
        ...correlation,
      },
      hostEvidenceSinkFor(client),
    ).catch(() => undefined);
  }

  // (2) PARECER do Verifier sobre o estado FRESCO — só no terminal `result` (sem
  // handoff durável de sucesso não há parecer). Inclui as evidências observadas
  // recém-persistidas. Advisory e recomputável.
  if (result.terminalKind !== 'result') return;
  try {
    const service = createWorkOrchestrationService(client);
    const [freshItem, freshEvents] = await Promise.all([
      service.getItem(correlation.workItemId),
      service.listEvents(correlation.workItemId),
    ]);
    if (freshItem.ok && freshEvents.ok) {
      await computeAndPersistVerifierOpinion(
        { item: freshItem.value, events: freshEvents.value },
        verifierOpinionSinkFor(client),
      ).catch(() => undefined);
    }
  } catch {
    // O adaptador é estritamente fail-open: uma leitura fresca indisponível não
    // pode alterar o resultado já materializado da tentativa.
  }
}
