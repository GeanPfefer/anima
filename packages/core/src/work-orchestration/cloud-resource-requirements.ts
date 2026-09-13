// ============================================================
// CLOUD RESOURCE MATCHING V1 — REQUISITOS DE CAPACIDADE do workload (puro).
//
// O workload declara REQUISITOS/CAPABILITIES, não uma SKU fixa de GPU. Assim a estratégia
// `cloud_self_hosted` pode ser satisfeita por QUALQUER recurso compatível (A40, A6000, L40S,
// A100, RTX 6000 Ada, …), e a ausência de uma A40 específica deixa de ser um blocker.
//
// A derivação para o qwen3-coder parte de EVIDÊNCIA histórica: a prova Bobcat observou o modelo
// ocupando ~18.8 GiB de VRAM em A40 com todas as camadas na GPU. Isso é o piso de PESOS; o
// requisito operacional soma uma MARGEM (KV cache do contexto, overhead do runtime, fragmentação)
// e arredonda para um piso seguro — NÃO transformamos "18.8" cegamente em mínimo absoluto.
// ============================================================

/** Feature de GPU exigida pelo workload (ex.: 'cuda', 'bf16'). String livre por design: o
 * catálogo de features evolui; o matcher só compara conjuntos. */
export type GpuFeatureV1 = string;

export interface RequirementMoneyV1 {
  readonly currency: string;
  readonly amount: number;
}

/** Restrições de provider para a estratégia cloud (opostas a requisitos de capacidade). */
export interface CloudProviderConstraintsV1 {
  /** Providers permitidos, ou `null` = qualquer provider da estratégia. */
  readonly allowedProviderIds: readonly string[] | null;
  /** Tipo de nuvem exigido (RunPod: SECURE × COMMUNITY), ou `null` = indiferente. */
  readonly cloudType: 'SECURE' | 'COMMUNITY' | null;
}

/**
 * Requisitos de um workload sob a estratégia `cloud_self_hosted`. É o contrato mínimo que
 * substitui a SKU fixa: capacidade obrigatória (VRAM, features), limites de contexto, e tetos
 * de preço/custo/quantidade. Provider-agnóstico.
 */
export interface CloudComputeRequirementsV1 {
  readonly schemaVersion: 1;
  readonly strategy: 'cloud_self_hosted';
  /** Runtime que servirá o modelo (ex.: 'ollama'). */
  readonly runtime: string;
  readonly model: string;
  /** Piso de VRAM (GiB) para caber pesos + contexto + overhead. */
  readonly minimumVramGiB: number;
  /** Piso de RAM de sistema (GiB), quando relevante; `null` = sem exigência explícita. */
  readonly minimumSystemRamGiB: number | null;
  readonly requiredGpuFeatures: readonly GpuFeatureV1[];
  /** Contexto (tokens) que o runtime precisa servir; `null` = default do runtime. */
  readonly contextTokens: number | null;
  /** Teto de preço por hora aceitável; `null` = sem teto horário explícito (o custo agregado
   * ainda é limitado por `maxEstimatedCost` e pela autoridade humana). */
  readonly maxHourlyPrice: RequirementMoneyV1 | null;
  /** Teto de custo ESTIMADO da lease; `null` = sem teto agregado neste contrato (a autoridade
   * humana continua sendo o teto duro de gasto). */
  readonly maxEstimatedCost: RequirementMoneyV1 | null;
  /** Máximo de nodes concorrentes que o workload pode usar. */
  readonly maxNodes: number;
  readonly providerConstraints: CloudProviderConstraintsV1 | null;
}

/** VRAM (GiB) de PESOS observada na prova Bobcat do qwen3-coder em A40, todas as camadas na GPU. */
export const QWEN3_CODER_OBSERVED_VRAM_GIB = 18.8;

/** Margem operacional multiplicativa sobre a VRAM de pesos observada: cobre KV cache do contexto,
 * overhead do runtime e fragmentação. Documentada e testável (não é número mágico escondido). */
export const CLOUD_VRAM_OPERATIONAL_MARGIN = 1.25;

/** Deriva o piso de VRAM (GiB) a partir da VRAM de pesos observada + margem operacional, com teto
 * mínimo arredondado para cima. PURO. */
export function deriveMinimumVramGiB(observedWeightsGiB: number, margin: number = CLOUD_VRAM_OPERATIONAL_MARGIN): number {
  if (!Number.isFinite(observedWeightsGiB) || observedWeightsGiB <= 0 || !Number.isFinite(margin) || margin < 1) {
    return Number.NaN;
  }
  return Math.ceil(observedWeightsGiB * margin);
}

/**
 * Requisitos canônicos do coder qwen3 sob `cloud_self_hosted`, derivados da evidência Bobcat.
 * `overrides` permite ajustar tetos de preço/custo/nodes e restrições de provider por prova/tarefa
 * SEM reintroduzir SKU fixa. O piso de VRAM sai de `deriveMinimumVramGiB` (não é hardcode de A40).
 */
export function deriveQwen3CoderCloudRequirements(overrides: {
  readonly model?: string;
  readonly runtime?: string;
  readonly contextTokens?: number | null;
  readonly maxHourlyPrice?: RequirementMoneyV1 | null;
  readonly maxEstimatedCost?: RequirementMoneyV1 | null;
  readonly maxNodes?: number;
  readonly providerConstraints?: CloudProviderConstraintsV1 | null;
} = {}): CloudComputeRequirementsV1 {
  return {
    schemaVersion: 1,
    strategy: 'cloud_self_hosted',
    runtime: overrides.runtime ?? 'ollama',
    model: overrides.model ?? 'qwen3-coder:latest',
    minimumVramGiB: deriveMinimumVramGiB(QWEN3_CODER_OBSERVED_VRAM_GIB),
    minimumSystemRamGiB: null,
    // O coder precisa de CUDA; features mais específicas ficam vazias até haver evidência de que
    // são obrigatórias (evitamos exigir o que o workload não comprovou precisar).
    requiredGpuFeatures: ['cuda'],
    contextTokens: overrides.contextTokens ?? null,
    maxHourlyPrice: overrides.maxHourlyPrice ?? null,
    maxEstimatedCost: overrides.maxEstimatedCost ?? null,
    maxNodes: overrides.maxNodes ?? 1,
    providerConstraints: overrides.providerConstraints ?? null,
  };
}
