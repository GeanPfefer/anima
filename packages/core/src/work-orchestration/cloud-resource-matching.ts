// ============================================================
// CLOUD RESOURCE MATCHING V1 — SELEÇÃO TÁTICA de recurso GPU compatível (pura, determinística).
//
// SEGUNDO nível de decisão (o primeiro é `compute-strategy-decision`): DEPOIS que o humano
// escolheu a estratégia `cloud_self_hosted`, o Anima escolhe SOZINHO o recurso concreto — desde
// que satisfaça os requisitos do workload, a autoridade humana e o budget. A40 deixa de ser
// requisito: se indisponível, a busca CONTINUA por candidatos compatíveis.
//
// Pipeline:
//   requirements
//     → inventory normalizado (candidatos com VRAM/preço/disponibilidade)
//     → filtro de capacidade (VRAM, features, provider)
//     → filtro de autoridade (o que o humano autorizou: SKU fixa | capability bounds | qualquer)
//     → filtro de budget (preço/hora e custo estimado da lease)
//     → ranking determinístico
//     → candidato escolhido + rationale
//
// Fail-closed com razão PRECISA (não esconde tudo sob um código genérico): distingue
// `no_compatible_cloud_resource`, `all_exceed_budget`, `authority_scope_insufficient` e
// `provider_inventory_unavailable`. NÃO cria Pod, NÃO chama provider, NÃO gasta.
// ============================================================

import type { CloudCapabilityScopeV1, PaidComputeAuthorizationV1 } from './paid-compute-authorization';
import type { CloudComputeRequirementsV1, GpuFeatureV1, RequirementMoneyV1 } from './cloud-resource-requirements';

export type CloudResourceAvailabilityV1 = 'available' | 'limited' | 'unavailable';

/** Candidato de recurso já NORMALIZADO a partir do inventário do provider. `perHour` `null` =
 * preço indisponível na cotação (não confundir com grátis). `vramGiB` é a VRAM real da GPU. */
export interface CloudResourceCandidateV1 {
  readonly providerId: string;
  /** Classe canônica (ex.: 'gpu-a40-48gb') — casa com a `resourceClass` da autoridade SKU-fixa. */
  readonly resourceClass: string;
  /** Id de SKU no provider (ex.: 'NVIDIA A40'). */
  readonly gpuTypeId: string;
  readonly displayName: string;
  readonly vramGiB: number;
  readonly gpuFeatures: readonly GpuFeatureV1[];
  readonly availability: CloudResourceAvailabilityV1;
  readonly perHour: RequirementMoneyV1 | null;
}

/** Escopo de autoridade projetado da autorização humana — o que o filtro de autoridade aplica. */
export type CloudResourceAuthorityScopeV1 =
  | { readonly kind: 'fixed_resource_class'; readonly providerId: string; readonly resourceClass: string }
  | { readonly kind: 'capability_bounds'; readonly providerId: string; readonly scope: CloudCapabilityScopeV1 }
  | { readonly kind: 'any_provider_resource'; readonly providerId: string };

export type CloudResourceEliminationReasonV1 =
  | 'provider_mismatch'
  | 'vram_below_minimum'
  | 'missing_gpu_feature'
  | 'unavailable'
  | 'price_unknown'
  | 'above_hourly_price'
  | 'above_estimated_cost'
  | 'outside_authority_scope';

export interface EliminatedCloudCandidateV1 {
  readonly candidate: CloudResourceCandidateV1;
  readonly reasons: readonly CloudResourceEliminationReasonV1[];
}

export type CloudResourceMatchBlockerV1 =
  | 'provider_inventory_unavailable'
  | 'no_compatible_cloud_resource'
  | 'all_exceed_budget'
  | 'authority_scope_insufficient';

export interface ChosenCloudResourceV1 {
  readonly candidate: CloudResourceCandidateV1;
  readonly estimatedCost: RequirementMoneyV1;
  readonly rationale: {
    /** Critérios aplicados, em ordem. */
    readonly rankedBy: readonly ['estimated_cost_asc', 'vram_excess_asc', 'availability', 'deterministic'];
    readonly estimatedCost: RequirementMoneyV1;
    /** VRAM acima do piso (GiB) — excesso de capacidade escolhido. */
    readonly vramExcessGiB: number;
    /** Quantos candidatos sobreviveram a todos os filtros (o escolhido é o topo do ranking). */
    readonly survivorsConsidered: number;
  };
}

export type CloudResourceMatchResultV1 =
  | { readonly ok: true; readonly chosen: ChosenCloudResourceV1; readonly eliminated: readonly EliminatedCloudCandidateV1[] }
  | { readonly ok: false; readonly blocker: CloudResourceMatchBlockerV1; readonly detail: string; readonly eliminated: readonly EliminatedCloudCandidateV1[] };

/** Projeta a autoridade humana persistida no escopo que o matcher aplica. Uma autoridade SKU-fixa
 * (ex.: A40) NUNCA vira autorização de outra GPU; capability bounds autoriza qualquer recurso
 * dentro dos limites; ambos nulos = qualquer recurso do provider. PURA. */
export function deriveAuthorityScope(authorization: PaidComputeAuthorizationV1): CloudResourceAuthorityScopeV1 {
  if (authorization.resourceClass !== null) {
    return { kind: 'fixed_resource_class', providerId: authorization.providerId, resourceClass: authorization.resourceClass };
  }
  if (authorization.capabilityScope != null) {
    return { kind: 'capability_bounds', providerId: authorization.providerId, scope: authorization.capabilityScope };
  }
  return { kind: 'any_provider_resource', providerId: authorization.providerId };
}

const HOUR_MS = 3_600_000;

const estimateCost = (perHour: RequirementMoneyV1, leaseDurationMs: number): RequirementMoneyV1 => ({
  currency: perHour.currency,
  amount: perHour.amount * (leaseDurationMs / HOUR_MS),
});

const hasAllFeatures = (candidate: CloudResourceCandidateV1, required: readonly GpuFeatureV1[]): boolean =>
  required.every(feature => candidate.gpuFeatures.includes(feature));

const providerAllowed = (candidate: CloudResourceCandidateV1, req: CloudComputeRequirementsV1): boolean => {
  const allowed = req.providerConstraints?.allowedProviderIds;
  return allowed == null || allowed.includes(candidate.providerId);
};

const withinAuthorityScope = (candidate: CloudResourceCandidateV1, scope: CloudResourceAuthorityScopeV1): boolean => {
  if (candidate.providerId !== scope.providerId) return false;
  if (scope.kind === 'fixed_resource_class') return candidate.resourceClass === scope.resourceClass;
  if (scope.kind === 'any_provider_resource') return true;
  const bounds = scope.scope;
  if (candidate.vramGiB < bounds.minimumVramGiB) return false;
  if (!hasAllFeatures(candidate, bounds.requiredGpuFeatures)) return false;
  if (bounds.maxHourlyPrice != null) {
    if (candidate.perHour == null) return false;
    if (candidate.perHour.currency.toUpperCase() !== bounds.maxHourlyPrice.currency.toUpperCase()) return false;
    if (candidate.perHour.amount > bounds.maxHourlyPrice.amount) return false;
  }
  return true;
};

interface CandidateAssessment {
  readonly candidate: CloudResourceCandidateV1;
  readonly reasons: CloudResourceEliminationReasonV1[];
  readonly capabilityOk: boolean;
  readonly availableOk: boolean;
  readonly budgetOk: boolean;
  readonly authorityOk: boolean;
  readonly estimatedCost: RequirementMoneyV1 | null;
}

const assess = (
  candidate: CloudResourceCandidateV1,
  req: CloudComputeRequirementsV1,
  scope: CloudResourceAuthorityScopeV1,
  leaseDurationMs: number,
): CandidateAssessment => {
  const reasons: CloudResourceEliminationReasonV1[] = [];

  // Capacidade (inclui provider permitido: um candidato de provider proibido não é "compatível").
  const providerOk = providerAllowed(candidate, req);
  const vramOk = candidate.vramGiB >= req.minimumVramGiB;
  const featuresOk = hasAllFeatures(candidate, req.requiredGpuFeatures);
  if (!providerOk) reasons.push('provider_mismatch');
  if (!vramOk) reasons.push('vram_below_minimum');
  if (!featuresOk) reasons.push('missing_gpu_feature');
  const capabilityOk = providerOk && vramOk && featuresOk;

  // Disponibilidade.
  const availableOk = candidate.availability !== 'unavailable';
  if (!availableOk) reasons.push('unavailable');

  // Budget (preço/hora e custo estimado da lease).
  let budgetOk = true;
  let estimatedCost: RequirementMoneyV1 | null = null;
  if (candidate.perHour == null) {
    budgetOk = false;
    reasons.push('price_unknown');
  } else {
    estimatedCost = estimateCost(candidate.perHour, leaseDurationMs);
    if (req.maxHourlyPrice != null
      && (candidate.perHour.currency.toUpperCase() !== req.maxHourlyPrice.currency.toUpperCase()
        || candidate.perHour.amount > req.maxHourlyPrice.amount)) {
      budgetOk = false;
      reasons.push('above_hourly_price');
    }
    if (req.maxEstimatedCost != null
      && (estimatedCost.currency.toUpperCase() !== req.maxEstimatedCost.currency.toUpperCase()
        || estimatedCost.amount > req.maxEstimatedCost.amount)) {
      budgetOk = false;
      reasons.push('above_estimated_cost');
    }
  }

  // Autoridade humana (o que foi concedido).
  const authorityOk = withinAuthorityScope(candidate, scope);
  if (!authorityOk) reasons.push('outside_authority_scope');

  return { candidate, reasons, capabilityOk, availableOk, budgetOk, authorityOk, estimatedCost };
};

const availabilityRank = (availability: CloudResourceAvailabilityV1): number =>
  availability === 'available' ? 0 : availability === 'limited' ? 1 : 2;

/**
 * Escolhe, PURA e determinística, o recurso cloud concreto. Ranking dos sobreviventes (que já
 * satisfazem capacidade + disponibilidade + autoridade + budget), em ordem:
 *   1. menor custo estimado;
 *   2. menor excesso de VRAM (não escolhe a GPU mais poderosa só porque existe);
 *   3. melhor disponibilidade;
 *   4. desempate determinístico (resourceClass, depois gpuTypeId).
 * Nunca escolhe abaixo dos requisitos para economizar. Fail-closed com razão precisa.
 */
export function matchCloudResource(input: {
  readonly requirements: CloudComputeRequirementsV1;
  /** Inventário normalizado; `null` = provider não devolveu inventário confiável. */
  readonly inventory: readonly CloudResourceCandidateV1[] | null;
  readonly authorityScope: CloudResourceAuthorityScopeV1;
  /** Duração da lease (ms) usada para estimar o custo agregado. */
  readonly leaseDurationMs: number;
}): CloudResourceMatchResultV1 {
  if (input.inventory === null) {
    return { ok: false, blocker: 'provider_inventory_unavailable', detail: 'O provider não devolveu inventário confiável.', eliminated: [] };
  }

  const assessments = input.inventory.map(c => assess(c, input.requirements, input.authorityScope, input.leaseDurationMs));
  const survivors = assessments.filter(a => a.reasons.length === 0);
  const eliminated: EliminatedCloudCandidateV1[] = assessments
    .filter(a => a.reasons.length > 0)
    .map(a => ({ candidate: a.candidate, reasons: a.reasons }));

  if (survivors.length === 0) {
    const compatibleAvailable = assessments.filter(a => a.capabilityOk && a.availableOk);
    let blocker: CloudResourceMatchBlockerV1;
    let detail: string;
    if (compatibleAvailable.length === 0) {
      blocker = 'no_compatible_cloud_resource';
      detail = 'Nenhum recurso disponível satisfaz os requisitos de capacidade do workload.';
    } else if (compatibleAvailable.some(a => a.budgetOk && !a.authorityOk)) {
      blocker = 'authority_scope_insufficient';
      detail = 'Há recurso compatível, disponível e dentro do budget, mas fora do escopo da autoridade humana vigente.';
    } else if (compatibleAvailable.some(a => a.authorityOk && !a.budgetOk)) {
      blocker = 'all_exceed_budget';
      detail = 'Os recursos compatíveis e autorizados excedem o teto de preço/custo.';
    } else if (compatibleAvailable.some(a => !a.authorityOk)) {
      blocker = 'authority_scope_insufficient';
      detail = 'Os recursos compatíveis e disponíveis estão fora do escopo da autoridade humana vigente.';
    } else {
      blocker = 'all_exceed_budget';
      detail = 'Os recursos compatíveis e disponíveis excedem o teto de preço/custo.';
    }
    return { ok: false, blocker, detail, eliminated };
  }

  const ranked = [...survivors].sort((left, right) => {
    const cost = left.estimatedCost!.amount - right.estimatedCost!.amount;
    if (cost !== 0) return cost;
    const excess = left.candidate.vramGiB - right.candidate.vramGiB;
    if (excess !== 0) return excess;
    const avail = availabilityRank(left.candidate.availability) - availabilityRank(right.candidate.availability);
    if (avail !== 0) return avail;
    const cls = left.candidate.resourceClass.localeCompare(right.candidate.resourceClass);
    if (cls !== 0) return cls;
    return left.candidate.gpuTypeId.localeCompare(right.candidate.gpuTypeId);
  });

  const best = ranked[0]!; // survivors.length > 0 garantido acima
  return {
    ok: true,
    chosen: {
      candidate: best.candidate,
      estimatedCost: best.estimatedCost!,
      rationale: {
        rankedBy: ['estimated_cost_asc', 'vram_excess_asc', 'availability', 'deterministic'],
        estimatedCost: best.estimatedCost!,
        vramExcessGiB: best.candidate.vramGiB - input.requirements.minimumVramGiB,
        survivorsConsidered: survivors.length,
      },
    },
    eliminated,
  };
}
