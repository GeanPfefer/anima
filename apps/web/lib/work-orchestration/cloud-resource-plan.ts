import {
  deriveAuthorityScope,
  matchCloudResource,
  type ChosenCloudResourceV1,
  type CloudComputeRequirementsV1,
  type CloudResourceAuthorityScopeV1,
  type CloudResourceMatchBlockerV1,
  type EliminatedCloudCandidateV1,
  type PaidComputeAuthorizationV1,
} from '@anima/core';
import type { RunPodInventoryResult } from './runpod-price-quote';

// ============================================================
// CLOUD RESOURCE MATCHING V1 — PROJEÇÃO/composição reutilizável (sem efeito).
//
// Amarra os pedaços PUROS numa decisão tática única, SEM criar Pod, sem chamar provider mutante e
// sem gastar: lê inventário read-only (injetável), projeta a AUTORIDADE humana vigente no escopo,
// e delega ao matcher. Uma autoridade SKU-fixa (ex.: A40) continua A40-apenas; só uma autoridade
// por capacidade — concedida pelo humano — permite escolher outra GPU. O caller decide o que fazer
// com o candidato escolhido (provisão canônica) ou com o blocker.
// ============================================================

export type CloudResourcePlanBlockerV1 = CloudResourceMatchBlockerV1;

export type CloudResourcePlanV1 =
  | {
      readonly ok: true;
      readonly chosen: ChosenCloudResourceV1;
      readonly authorityScope: CloudResourceAuthorityScopeV1;
      readonly eliminated: readonly EliminatedCloudCandidateV1[];
    }
  | {
      readonly ok: false;
      readonly blocker: CloudResourcePlanBlockerV1;
      readonly detail: string;
      readonly authorityScope: CloudResourceAuthorityScopeV1;
      readonly eliminated: readonly EliminatedCloudCandidateV1[];
    };

/**
 * Planeja o recurso cloud concreto para um workload sob `cloud_self_hosted`. `readInventory` é a
 * leitura read-only do inventário do provider (injetável para prova). Falha na leitura vira
 * inventário `null` → `provider_inventory_unavailable`, preservando o motivo no `detail`.
 * PURA em relação a efeitos externos (não provisiona, não gasta).
 */
export async function planCloudResourceProvisioning(input: {
  readonly requirements: CloudComputeRequirementsV1;
  /** Autoridade humana vigente (define o escopo aplicado — SKU-fixa | capacidade | qualquer). */
  readonly authorization: PaidComputeAuthorizationV1;
  readonly leaseDurationMs: number;
  readonly readInventory: () => Promise<RunPodInventoryResult>;
}): Promise<CloudResourcePlanV1> {
  const authorityScope = deriveAuthorityScope(input.authorization);
  const inventory = await input.readInventory();
  const candidates = inventory.ok ? inventory.candidates : null;
  const result = matchCloudResource({
    requirements: input.requirements,
    inventory: candidates,
    authorityScope,
    leaseDurationMs: input.leaseDurationMs,
  });
  if (result.ok) {
    return { ok: true, chosen: result.chosen, authorityScope, eliminated: result.eliminated };
  }
  const detail = inventory.ok ? result.detail : `inventory_read:${inventory.reason}`;
  return { ok: false, blocker: result.blocker, detail, authorityScope, eliminated: result.eliminated };
}

// ============================================================
// CLOUD RESOURCE MATCHING V1 — RELATÓRIO estruturado da seleção (puro, serializável).
//
// Projeta um `CloudResourcePlanV1` + os requisitos numa EVIDÊNCIA legível/persistível: requisitos,
// escopo da autoridade, candidatos considerados, candidatos rejeitados COM razão, e o recurso
// escolhido (GPU concreta, VRAM, preço, custo estimado, rationale) OU o blocker. É exatamente a
// parte de SELEÇÃO que o "Cloud GPU Test #2" (autoprov de GPU cloud self-hosted compatível) deve
// registrar — sem provisionar, sem gastar. A prova viva anexa depois provisioning/bootstrap/tunnel/
// coder/gate/Verifier/custo.
// ============================================================

export interface CloudResourceMatchReportV1 {
  readonly requirements: {
    readonly model: string;
    readonly runtime: string;
    readonly strategy: CloudComputeRequirementsV1['strategy'];
    readonly minimumVramGiB: number;
    readonly requiredGpuFeatures: readonly string[];
    readonly maxHourlyPrice: CloudComputeRequirementsV1['maxHourlyPrice'];
    readonly maxEstimatedCost: CloudComputeRequirementsV1['maxEstimatedCost'];
  };
  readonly authorityScope: CloudResourceAuthorityScopeV1;
  readonly consideredCount: number;
  readonly rejected: readonly {
    readonly gpuTypeId: string;
    readonly resourceClass: string;
    readonly vramGiB: number;
    readonly perHour: ChosenCloudResourceV1['candidate']['perHour'];
    readonly availability: ChosenCloudResourceV1['candidate']['availability'];
    readonly reasons: readonly string[];
  }[];
  readonly outcome:
    | {
        readonly kind: 'selected';
        readonly gpuTypeId: string;
        readonly resourceClass: string;
        readonly vramGiB: number;
        readonly perHour: ChosenCloudResourceV1['candidate']['perHour'];
        readonly estimatedCost: ChosenCloudResourceV1['estimatedCost'];
        readonly vramExcessGiB: number;
        readonly survivorsConsidered: number;
        readonly rankedBy: ChosenCloudResourceV1['rationale']['rankedBy'];
      }
    | { readonly kind: 'blocked'; readonly blocker: CloudResourcePlanBlockerV1; readonly detail: string };
}

/** Constrói o relatório de seleção a partir do plano + requisitos. PURO e determinístico. */
export function describeCloudResourcePlan(
  plan: CloudResourcePlanV1,
  requirements: CloudComputeRequirementsV1,
): CloudResourceMatchReportV1 {
  const rejected = plan.eliminated.map(e => ({
    gpuTypeId: e.candidate.gpuTypeId,
    resourceClass: e.candidate.resourceClass,
    vramGiB: e.candidate.vramGiB,
    perHour: e.candidate.perHour,
    availability: e.candidate.availability,
    reasons: e.reasons,
  }));
  const requirementsView: CloudResourceMatchReportV1['requirements'] = {
    model: requirements.model,
    runtime: requirements.runtime,
    strategy: requirements.strategy,
    minimumVramGiB: requirements.minimumVramGiB,
    requiredGpuFeatures: requirements.requiredGpuFeatures,
    maxHourlyPrice: requirements.maxHourlyPrice,
    maxEstimatedCost: requirements.maxEstimatedCost,
  };
  if (plan.ok) {
    return {
      requirements: requirementsView,
      authorityScope: plan.authorityScope,
      consideredCount: rejected.length + 1,
      rejected,
      outcome: {
        kind: 'selected',
        gpuTypeId: plan.chosen.candidate.gpuTypeId,
        resourceClass: plan.chosen.candidate.resourceClass,
        vramGiB: plan.chosen.candidate.vramGiB,
        perHour: plan.chosen.candidate.perHour,
        estimatedCost: plan.chosen.estimatedCost,
        vramExcessGiB: plan.chosen.rationale.vramExcessGiB,
        survivorsConsidered: plan.chosen.rationale.survivorsConsidered,
        rankedBy: plan.chosen.rationale.rankedBy,
      },
    };
  }
  return {
    requirements: requirementsView,
    authorityScope: plan.authorityScope,
    consideredCount: rejected.length,
    rejected,
    outcome: { kind: 'blocked', blocker: plan.blocker, detail: plan.detail },
  };
}
