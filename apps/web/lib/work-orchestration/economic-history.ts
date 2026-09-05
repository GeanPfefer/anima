import {
  aggregateEconomicObservations,
  calculateCohortMetrics,
  parseHostObservedCoderEvidence,
  parseVerifierOpinion,
  type ComputeEconomicsSignalV1,
  type EconomicCohortAggregationV1,
  type EconomicObservationV1,
  type WorkCapability,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Limite por tipo de evidência. A decisão nunca varre o histórico inteiro. */
export const ECONOMIC_HISTORY_LIMIT = 100;

type EventRow = {
  readonly id: string;
  readonly work_item_id: string;
  readonly event_type: string;
  readonly proposal_version: number | null;
  readonly payload: Json;
  readonly created_at: string;
};
type ItemRow = { readonly id: string; readonly capability: WorkCapability; readonly intent?: Json };

export interface EconomicHistoryQueryV1 {
  readonly capability: WorkCapability;
  readonly taskClass: string | null;
  readonly localModel: string;
  readonly openAIModel: string;
}

export interface EconomicHistoryProjectionV1 {
  readonly observations: readonly EconomicObservationV1[];
  readonly signal: ComputeEconomicsSignalV1;
  readonly local: EconomicCohortAggregationV1 | null;
  readonly openai: EconomicCohortAggregationV1 | null;
}

const object = (value: unknown): Record<string, Json | undefined> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, Json | undefined> : null;

const evidenceFrom = (event: EventRow) => {
  const data = object(object(event.payload)?.data);
  return parseHostObservedCoderEvidence(data?.evidence);
};

const opinionFrom = (event: EventRow) => {
  const data = object(object(event.payload)?.data);
  return parseVerifierOpinion(data?.opinion);
};

const providerIdentity = (backendId: string): 'ollama' | 'openai' | null => {
  const normalized = backendId.toLowerCase();
  if (normalized.includes('openai') || normalized.includes('gpt')) return 'openai';
  if (normalized.includes('ollama')) return 'ollama';
  return null;
};

export function economicTaskClass(intent: Json | undefined): string {
  const root = object(intent);
  const value = root?.taskClass ?? root?.task_class;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'unknown';
}

const unavailableMetrics = () => calculateCohortMetrics([], 2);

/**
 * Projeção pura do event/evidence store. A reserva financeira não aparece aqui:
 * sem settlement ou pricing versionado, `cost` permanece null. Um parecer só conta
 * como sucesso quando o Verifier persistiu literalmente `verified`.
 */
export function projectEconomicHistory(
  query: EconomicHistoryQueryV1,
  coderEvents: readonly EventRow[],
  verifierEvents: readonly EventRow[],
  items: readonly ItemRow[],
): EconomicHistoryProjectionV1 {
  const taskClass = query.taskClass?.trim() || 'unknown';
  const itemById = new Map(items.map(item => [item.id, item]));
  const latestOpinionByAttempt = new Map<string, { opinion: NonNullable<ReturnType<typeof opinionFrom>>; createdAt: string }>();
  for (const event of [...verifierEvents].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const opinion = opinionFrom(event);
    if (opinion) latestOpinionByAttempt.set(opinion.attemptId, { opinion, createdAt: event.created_at });
  }

  const observations: EconomicObservationV1[] = [];
  for (const event of coderEvents) {
    const evidence = evidenceFrom(event);
    const item = itemById.get(event.work_item_id);
    if (!evidence || item?.capability !== query.capability || economicTaskClass(item.intent) !== taskClass) continue;
    const provider = providerIdentity(evidence.backendId);
    if (!provider) continue;
    const model = evidence.model ?? (provider === 'openai' ? query.openAIModel : query.localModel);
    if (model !== (provider === 'openai' ? query.openAIModel : query.localModel)) continue;
    const opinionEvent = latestOpinionByAttempt.get(evidence.attemptId) ?? null;
    const opinion = opinionEvent?.opinion ?? null;
    const finished = new Date(evidence.observedAt);
    const started = new Date(finished.getTime() - evidence.durationMs);
    const verified = opinion?.verdict === 'verified';
    const reachedReview = opinion !== null;
    const failureCategory = opinion?.verdict === 'inconclusive' ? 'review_inconclusive'
      : evidence.outcome === 'failed' ? 'unknown'
        : evidence.outcome === 'cancelled' ? 'infrastructure' : null;
    observations.push({
      schemaVersion: 1,
      workItemId: evidence.workItemId,
      attemptId: evidence.attemptId,
      cohort: { capability: query.capability, taskClass, provider, model, placement: provider === 'openai' ? 'api' : 'local' },
      admittedAt: null,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      reviewAt: opinionEvent?.createdAt ?? null,
      runtimeMs: evidence.durationMs,
      timeToReviewMs: opinionEvent ? Math.max(0, Date.parse(opinionEvent.createdAt) - started.getTime()) : null,
      reachedReview,
      verified,
      terminalClass: reachedReview ? 'completed' : evidence.outcome === 'cancelled' ? 'cancelled' : evidence.outcome === 'failed' ? 'failed' : 'unknown',
      failureCategory,
      outcomeClass: verified ? 'verified' : failureCategory ?? 'outcome_unknown',
      usage: provider === 'openai' ? {
        hostObservedCallCount: evidence.providerCallCount ?? null,
        providerReported: evidence.providerUsage ? {
          inputTokens: evidence.providerUsage.inputTokens,
          outputTokens: evidence.providerUsage.outputTokens,
          cachedInputTokens: evidence.providerUsage.cachedInputTokens ?? 0,
          ...(evidence.providerUsage.providerRequestIds ? { requestIds: evidence.providerUsage.providerRequestIds } : {}),
        } : null,
      } : null,
      cost: null,
      reservedExposure: null,
      local: provider === 'ollama' ? { runtimeMs: evidence.durationMs, monetaryCost: null } : null,
      cloud: null,
      provenance: {
        identity: 'persisted', timestamps: 'host_observed', runtime: 'host_observed', outcome: opinion ? 'persisted' : 'unknown',
        hostObservedCallCount: evidence.providerCallCount === undefined ? 'unknown' : 'host_observed',
        providerReportedUsage: evidence.providerUsage === undefined ? 'unknown' : 'provider_reported',
      },
    });
  }

  const aggregated = aggregateEconomicObservations(observations);
  const cohorts = aggregated.ok ? aggregated.value : [];
  const local = cohorts.find(value => value.cohort.provider === 'ollama') ?? null;
  const openai = cohorts.find(value => value.cohort.provider === 'openai') ?? null;
  return {
    observations,
    local,
    openai,
    signal: {
      local: local?.computeEconomics ?? unavailableMetrics(),
      openai: openai?.computeEconomics ?? unavailableMetrics(),
    },
  };
}

export async function readEconomicHistory(
  client: SupabaseClient<Database>,
  query: EconomicHistoryQueryV1,
): Promise<EconomicHistoryProjectionV1 | null> {
  const coder = await client.from('work_events').select('id,work_item_id,event_type,proposal_version,payload,created_at')
    .eq('event_type', 'host_observed_coder_evidence_recorded').order('created_at', { ascending: false }).limit(ECONOMIC_HISTORY_LIMIT);
  if (coder.error) return null;
  const workItemIds = [...new Set((coder.data ?? []).map(event => event.work_item_id))];
  if (workItemIds.length === 0) return projectEconomicHistory(query, [], [], []);
  const verifier = await client.from('work_events').select('id,work_item_id,event_type,proposal_version,payload,created_at')
    .eq('event_type', 'verifier_opinion_recorded').in('work_item_id', workItemIds)
    .order('created_at', { ascending: false }).limit(ECONOMIC_HISTORY_LIMIT);
  if (verifier.error) return null;
  const items = await client.from('work_items').select('id,capability,intent').in('id', workItemIds).limit(ECONOMIC_HISTORY_LIMIT);
  if (items.error) return null;
  return projectEconomicHistory(query, coder.data ?? [], verifier.data ?? [], items.data ?? []);
}
