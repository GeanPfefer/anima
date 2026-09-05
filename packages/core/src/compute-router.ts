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
  readonly preferred: { readonly provider: ComputeProviderV1; readonly model: string } | null;
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
    paidAuthorityRequired: true, economicsBasis: basis };
  const selected = (provider: ComputeProviderV1, reasonCode: ComputeRouteReasonCodeV1, reason: string): ComputeRouteDecisionV1 => ({
    ...base, status: 'selected', selectedProvider: provider,
    selectedModel: provider === 'ollama' ? input.local.model : input.openai.model,
    placement: provider === 'ollama' ? 'local' : 'provider_api', reasonCode, reason,
    fallbackChain: provider === 'ollama' ? ['ollama', 'openai'] : ['openai', 'ollama'],
    authorizationId: provider === 'openai' ? input.paidAuthority.authorizationId : null,
  });

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
  if (input.preferred?.provider === 'openai' && input.preferred.model === input.openai.model && openaiAdmissible) {
    return selected('openai', 'preferred_candidate', 'A preferência aprovada aponta para um candidato OpenAI admissível.');
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
