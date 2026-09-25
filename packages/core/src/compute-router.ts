import type { CohortMetricsV1, EconomicValueV1, MoneyV1 } from './compute-economics';
import type { WorkCapability } from './work-orchestration/types';

export type ComputeProviderV1 = 'ollama' | 'openai';
export type ComputePlacementV1 = 'local' | 'provider_api';
export type ComputeRouteStatusV1 = 'selected' | 'waiting_for_human_authorization' | 'blocked';
export type LocalFailureSignalV1 = 'none' | 'model_capability' | 'no_progress' | 'temporary_infrastructure';
export type ComputeRouteReasonCodeV1 =
  | 'local_sufficient'
  | 'economics_favors_local'
  | 'economics_favors_openai'
  | 'preferred_candidate'
  | 'local_governor_denied'
  | 'local_model_incapable'
  | 'local_no_progress'
  | 'local_temporary_infrastructure'
  | 'openai_unavailable'
  | 'paid_authorization_required'
  | 'preferred_model_unavailable'
  | 'no_admissible_provider';

export interface ComputeRouteCandidateV1 {
  readonly provider: ComputeProviderV1;
  readonly model: string;
  readonly available: boolean;
  readonly supportsCapability: boolean;
  readonly modelFits: boolean;
  readonly resourceClass: string | null;
}

export interface PaidRouteAuthorityV1 {
  readonly status: 'authorized' | 'missing' | 'expired' | 'incompatible' | 'budget_unavailable';
  readonly authorizationId: string | null;
  readonly remainingExposure: EconomicValueV1<MoneyV1>;
}

export interface ComputeEconomicsSignalV1 {
  readonly local: CohortMetricsV1;
  readonly openai: CohortMetricsV1;
}

export interface DecideComputeRouteInputV1 {
  readonly schemaVersion: 1;
  readonly workItemId: string;
  readonly approvedProposalVersion: number;
  readonly capability: WorkCapability;
  readonly taskClass: string | null;
  /** Preferência de compute da UNIDADE (decisão humana, nunca env de deploy). `source`
   * distingue a preferência explícita registrada do contrato legado. */
  readonly preferred: { readonly provider: ComputeProviderV1; readonly model: string; readonly source?: string } | null;
  readonly local: ComputeRouteCandidateV1;
  readonly resourceGovernor: 'permit' | 'deny' | 'unavailable';
  readonly localFailure: LocalFailureSignalV1;
  readonly openai: ComputeRouteCandidateV1;
  readonly paidAuthority: PaidRouteAuthorityV1;
  readonly economics: ComputeEconomicsSignalV1 | null;
}

export interface ComputeRouteAlternativeV1 {
  readonly provider: ComputeProviderV1;
  readonly model: string;
  readonly admissible: boolean;
  readonly reasons: readonly string[];
}

export interface ComputeRouteDecisionV1 {
  readonly schemaVersion: 1;
  readonly policyVersion: 'compute-router-v1';
  readonly workItemId: string;
  readonly approvedProposalVersion: number;
  readonly capability: WorkCapability;
  readonly taskClass: string | null;
  readonly status: ComputeRouteStatusV1;
  readonly selectedProvider: ComputeProviderV1 | null;
  readonly selectedModel: string | null;
  readonly placement: ComputePlacementV1 | null;
  readonly reasonCode: ComputeRouteReasonCodeV1;
  readonly reason: string;
  readonly alternativesConsidered: readonly ComputeRouteAlternativeV1[];
  readonly fallbackChain: readonly ComputeProviderV1[];
  readonly paidAuthorityRequired: boolean;
  readonly authorizationId: string | null;
  readonly economicsBasis: {
    readonly used: boolean;
    readonly reason: 'comparable_cost_per_verified' | 'not_provided' | 'insufficient_or_unavailable';
    readonly localCostPerVerified: EconomicValueV1<MoneyV1> | null;
    readonly openaiCostPerVerified: EconomicValueV1<MoneyV1> | null;
    readonly localSampleSize: number | null;
    readonly openaiSampleSize: number | null;
    readonly localDataQuality: CohortMetricsV1['dataQuality'] | null;
    readonly openaiDataQuality: CohortMetricsV1['dataQuality'] | null;
  };
  /** Presente só quando a unidade declara preferência: a escolha que o Router honrou. */
  readonly preference?: { readonly provider: ComputeProviderV1; readonly model: string; readonly source: string | null };
}

const candidateReasons = (candidate: ComputeRouteCandidateV1): string[] => {
  const reasons: string[] = [];
  if (!candidate.available) reasons.push('provider_unavailable');
  if (!candidate.supportsCapability) reasons.push('capability_unsupported');
  if (!candidate.modelFits) reasons.push('model_or_resource_incompatible');
  return reasons;
};

const economicsBasis = (signal: ComputeEconomicsSignalV1 | null): ComputeRouteDecisionV1['economicsBasis'] => {
  if (!signal) return { used: false, reason: 'not_provided', localCostPerVerified: null, openaiCostPerVerified: null,
    localSampleSize: null, openaiSampleSize: null, localDataQuality: null, openaiDataQuality: null };
  const local = signal.local.costPerVerified;
  const openai = signal.openai.costPerVerified;
  const comparable = signal.local.dataQuality === 'complete' && signal.openai.dataQuality === 'complete'
    && local.status === 'known' && openai.status === 'known'
    && local.value.currency === openai.value.currency;
  return { used: comparable, reason: comparable ? 'comparable_cost_per_verified' : 'insufficient_or_unavailable', localCostPerVerified: local, openaiCostPerVerified: openai,
    localSampleSize: signal.local.totalAttempts, openaiSampleSize: signal.openai.totalAttempts,
    localDataQuality: signal.local.dataQuality, openaiDataQuality: signal.openai.dataQuality };
};

export function decideComputeRoute(input: DecideComputeRouteInputV1): ComputeRouteDecisionV1 {
  const localReasons = candidateReasons(input.local);
  if (input.resourceGovernor !== 'permit') localReasons.push(`resource_governor_${input.resourceGovernor}`);
  if (input.localFailure !== 'none') localReasons.push(`history_${input.localFailure}`);
  const openaiReasons = candidateReasons(input.openai);
  if (input.paidAuthority.status !== 'authorized') openaiReasons.push(`paid_authority_${input.paidAuthority.status}`);
  const localAdmissible = localReasons.length === 0;
  const openaiTechnicallyAdmissible = candidateReasons(input.openai).length === 0;
  const openaiAdmissible = openaiReasons.length === 0;
  const basis = economicsBasis(input.economics);
  const alternativesConsidered: readonly ComputeRouteAlternativeV1[] = [
    { provider: 'ollama', model: input.local.model, admissible: localAdmissible, reasons: localReasons },
    { provider: 'openai', model: input.openai.model, admissible: openaiAdmissible, reasons: openaiReasons },
  ];
  const base = { schemaVersion: 1 as const, policyVersion: 'compute-router-v1' as const,
    workItemId: input.workItemId, approvedProposalVersion: input.approvedProposalVersion,
    capability: input.capability, taskClass: input.taskClass, alternativesConsidered,
    paidAuthorityRequired: true, economicsBasis: basis,
    // Só quando existe: decisões sem preferência mantêm a forma (e o decision_id) anteriores.
    ...(input.preferred ? { preference: { provider: input.preferred.provider, model: input.preferred.model, source: input.preferred.source ?? null } } : {}) };
  const selected = (provider: ComputeProviderV1, reasonCode: ComputeRouteReasonCodeV1, reason: string): ComputeRouteDecisionV1 => ({
    ...base, status: 'selected', selectedProvider: provider,
    selectedModel: provider === 'ollama' ? input.local.model : input.openai.model,
    placement: provider === 'ollama' ? 'local' : 'provider_api', reasonCode, reason,
    fallbackChain: provider === 'ollama' ? ['ollama', 'openai'] : ['openai', 'ollama'],
    authorizationId: provider === 'openai' ? input.paidAuthority.authorizationId : null,
  });

  // Preferência APROVADA por OpenAI é autoritativa: o humano aprovou esse executor. Sem
  // autoridade paga a unidade ESPERA (nunca vira Ollama em silêncio); sem candidato OpenAI
  // técnico, bloqueia. Mudar de executor exige revisar a proposta, não um fallback do Router.
  if (input.preferred?.provider === 'openai') {
    if (input.preferred.model === input.openai.model && openaiAdmissible) {
      return selected('openai', 'preferred_candidate', 'A preferência aprovada aponta para um candidato OpenAI admissível.');
    }
    if (input.preferred.model === input.openai.model && openaiTechnicallyAdmissible) {
      return { ...base, status: 'waiting_for_human_authorization', selectedProvider: null, selectedModel: null, placement: null,
        reasonCode: 'paid_authorization_required', reason: 'A preferência aprovada é OpenAI e não existe autoridade paga válida e compatível; o compute local não a substitui.',
        fallbackChain: [], authorizationId: null };
    }
    if (input.openai.available && input.preferred.model !== input.openai.model) {
      return { ...base, status: 'blocked', selectedProvider: null, selectedModel: null, placement: null,
        reasonCode: 'preferred_model_unavailable',
        reason: `A preferência da unidade é OpenAI/${input.preferred.model}, mas o runtime oferece OpenAI/${input.openai.model}; nenhum downgrade é feito.`,
        fallbackChain: [], authorizationId: null };
    }
    return { ...base, status: 'blocked', selectedProvider: null, selectedModel: null, placement: null,
      reasonCode: !input.openai.available ? 'openai_unavailable' : 'no_admissible_provider',
      reason: 'A preferência aprovada é OpenAI, mas o candidato OpenAI configurado não é admissível.', fallbackChain: [], authorizationId: null };
  }

  // Falha temporária não é um sinal de incapacidade: nunca promove gasto automaticamente.
  if (input.localFailure === 'temporary_infrastructure') {
    return { ...base, status: 'blocked', selectedProvider: null, selectedModel: null, placement: null,
      reasonCode: 'local_temporary_infrastructure', reason: 'A infraestrutura local falhou temporariamente; compute pago não é promovido automaticamente.',
      fallbackChain: ['ollama'], authorizationId: null };
  }
  if (localAdmissible && openaiAdmissible && basis.used) {
    const localCost = basis.localCostPerVerified!;
    const openaiCost = basis.openaiCostPerVerified!;
    if (localCost.status === 'known' && openaiCost.status === 'known' && openaiCost.value.amount < localCost.value.amount) {
      return selected('openai', 'economics_favors_openai', 'Coortes comparáveis indicam menor custo por resultado VERIFIED na OpenAI.');
    }
    return selected('ollama', 'economics_favors_local', 'Coortes comparáveis favorecem ou empatam com o compute local.');
  }
  if (localAdmissible) return selected('ollama', 'local_sufficient', 'O compute local é capaz, disponível e permitido pelo Resource Governor.');
  if (openaiAdmissible) {
    const reasonCode = input.localFailure === 'model_capability' ? 'local_model_incapable'
      : input.localFailure === 'no_progress' ? 'local_no_progress' : 'local_governor_denied';
    return selected('openai', reasonCode, 'O candidato local não é admissível e a OpenAI possui autoridade paga válida.');
  }
  if (openaiTechnicallyAdmissible && input.paidAuthority.status !== 'authorized') {
    return { ...base, status: 'waiting_for_human_authorization', selectedProvider: null, selectedModel: null, placement: null,
      reasonCode: 'paid_authorization_required', reason: 'A OpenAI seria o próximo candidato, mas não existe autoridade paga válida e compatível.',
      fallbackChain: localAdmissible ? ['ollama'] : [], authorizationId: null };
  }
  const reasonCode: ComputeRouteReasonCodeV1 = !input.openai.available ? 'openai_unavailable' : 'no_admissible_provider';
  return { ...base, status: 'blocked', selectedProvider: null, selectedModel: null, placement: null,
    reasonCode, reason: 'Nenhum candidato satisfaz capacidade, disponibilidade e governança.', fallbackChain: [], authorizationId: null };
}

/** Evento mínimo do histórico que alimenta o sinal de falha local (forma de `work_events`). */
export interface LocalFailureHistoryEventV1 {
  readonly event_type: string;
  readonly payload: unknown;
}

const recordOf = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const eventData = (event: LocalFailureHistoryEventV1) => recordOf(recordOf(event.payload)?.data);
const eventAttemptId = (event: LocalFailureHistoryEventV1): string | null => {
  const data = eventData(event);
  const evidence = recordOf(data?.evidence);
  const id = data?.attempt_id ?? evidence?.attemptId;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

/**
 * Deriva o sinal de falha LOCAL a partir do histórico de eventos — do próprio item e,
 * quando houver, dos predecessores da mesma lineage de recuperação. PURA.
 *
 * - Só falhas de attempts LOCAIS contam: um attempt cuja evidência host-observada do coder
 *   declara placement não-local (ex.: OpenAI, que reusa o protocolo e os códigos `ollama_*`)
 *   é descartado inteiro. Attempt sem evidência de placement mantém o comportamento legado.
 * - Eventos de roteamento são ignorados: suas razões (`local_no_progress`...) são saídas
 *   do próprio sinal e não podem realimentá-lo.
 * - `ollama_submit_gate_unsatisfied` (sessão esgotada sem revisão validada) é ausência de
 *   progresso verificável do modelo local — mesma classe de `ollama_no_effective_edits`.
 */
export function deriveLocalFailureSignal(events: readonly LocalFailureHistoryEventV1[]): LocalFailureSignalV1 {
  const nonLocalAttempts = new Set<string>();
  for (const event of events) {
    if (event.event_type !== 'host_observed_coder_evidence_recorded') continue;
    const evidence = recordOf(eventData(event)?.evidence);
    const attemptId = eventAttemptId(event);
    if (attemptId && typeof evidence?.placement === 'string' && evidence.placement !== 'local') nonLocalAttempts.add(attemptId);
  }
  const relevant = events.filter(event => {
    if (/routing/.test(event.event_type)) return false;
    const attemptId = eventAttemptId(event);
    return attemptId === null || !nonLocalAttempts.has(attemptId);
  });
  const text = JSON.stringify(relevant);
  if (/ollama_read_round_limit|context_limit|context_window_exceeded/.test(text)) return 'model_capability';
  if (/ollama_no_effective_edits|ollama_submit_gate_unsatisfied|no_progress|loop_detected/.test(text)) return 'no_progress';
  if (/ollama_timeout|ollama_transport_error|provider_unavailable/.test(text)) return 'temporary_infrastructure';
  return 'none';
}
