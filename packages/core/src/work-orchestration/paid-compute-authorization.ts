// ============================================================
// PROVISIONAMENTO ON-DEMAND V1 — AUTORIZAÇÃO FINANCEIRA fail-closed (invariante central).
//
// Princípio inegociável do recorte: NECESSIDADE DE RECURSO ≠ AUTORIZAÇÃO DE GASTO. O Anima
// NÃO pode transformar pressão de RAM em autorização financeira. Um node `paid` só pode ser
// provisionado/usado quando existe uma AUTORIZAÇÃO HUMANA explícita, com proveniência,
// compatível com o que se vai fazer. Um `boolean allowPaid=true` solto é insuficiente: a
// autorização carrega quem autorizou, para qual trabalho/provider/node, por quanto tempo e
// até que custo, e tem validade.
//
// Coerente com a invariante já existente no repo (`recovery-successor.ts`: um sucessor
// governado NUNCA pode introduzir `financial_authorization|paid_compute|auto.?provision`) e
// com o envelope de auto-aprovação (`autonomous-authorization.ts`: impacto `financial` está
// FORA da classe auto-aprovável). Ou seja: o caminho autônomo não fabrica sua própria
// autorização de gasto — ela é sempre um ato humano, avaliado aqui de forma determinística.
//
// Este módulo é PURO: valida uma autorização persistida contra um pedido concreto e devolve
// uma decisão tipada. Não persiste, não chama provider, não decide placement.
// ============================================================

import type { Json } from '@anima/types';

/** Modo de cobrança de um node de compute. `owned` = hardware próprio (Goma/Nomad); `paid`
 * = alugado por hora/minuto. `already_provisioned` = endpoint externo já ligado por um
 * humano (sem lifecycle de gasto sob controle do Anima). Só `paid` exige autorização. */
export type NodeBillingMode = 'owned' | 'already_provisioned' | 'paid';

/**
 * ESCOPO POR CAPACIDADE de uma autorização paga (Cloud Resource Matching V1). Alternativa à
 * `resourceClass` SKU-fixa: autoriza QUALQUER recurso do provider que satisfaça estes limites de
 * capacidade — sem amarrar a autoridade a uma GPU específica. Uma autoridade SKU-fixa (ex.: A40)
 * continua sendo A40-apenas; capability bounds é uma autoridade DIFERENTE, mais ampla, que o
 * humano concede explicitamente. As duas são mutuamente exclusivas por construção.
 */
export interface CloudCapabilityScopeV1 {
  readonly minimumVramGiB: number;
  readonly requiredGpuFeatures: readonly string[];
  /** Teto de preço por hora aceitável para qualquer recurso do escopo; `null` = sem teto horário
   * (o teto agregado `maxCostEstimate` continua sendo a barreira monetária). */
  readonly maxHourlyPrice: { readonly currency: string; readonly amount: number } | null;
  /** Máximo de nodes concorrentes que o escopo autoriza. */
  readonly maxNodes: number;
}

/** Autorização HUMANA de compute pago. Proveniência explícita e auditável: quem autorizou,
 * para qual provider/node/trabalho, com que teto de duração e custo, e por quanto tempo a
 * autorização vale. `authorizedByAuthor` é sempre `'user'` — uma autorização com autoria
 * `system` é malformada por construção (o sistema não autoriza o próprio gasto). */
export interface PaidComputeAuthorizationV1 {
  readonly schemaVersion: 1;
  readonly authorizationId: string;
  readonly authorizedBy: string;
  readonly authorizedByAuthor: 'user';
  readonly providerId: string;
  /** Node específico autorizado, ou `null` = qualquer node do provider. */
  readonly nodeId: string | null;
  /** Classe de recurso SKU-fixa autorizada, ou `null` = não amarrada a uma SKU. Mutuamente
   * exclusiva com `capabilityScope`. */
  readonly resourceClass: string | null;
  /** Escopo por CAPACIDADE (Cloud Resource Matching V1), quando a autoridade não é SKU-fixa.
   * Ausente/`null` = sem escopo por capacidade. Nunca coexiste com `resourceClass` não-nulo. */
  readonly capabilityScope?: CloudCapabilityScopeV1 | null;
  /** Trabalho correlacionado, ou `null` = não amarrado a um item específico. */
  readonly workItemId: string | null;
  /** Teto de duração ativa autorizada (ms). */
  readonly maxDurationMs: number;
  /** Teto de custo estimado, quando o provider/humano informou um valor; `null` = sem teto
   * monetário explícito (o envelope temporal é a única barreira determinística). */
  readonly maxCostEstimate: { readonly currency: string; readonly amount: number } | null;
  readonly validFrom: string;
  readonly validUntil: string;
}

/** O que se pretende fazer — a "necessidade" derivada de placement + lease. */
export interface PaidComputeRequest {
  readonly billingMode: NodeBillingMode;
  readonly providerId: string;
  readonly nodeId: string;
  readonly resourceClass: string | null;
  readonly workItemId: string | null;
  readonly requestedDurationMs: number;
  readonly estimatedCost?: { readonly currency: string; readonly amount: number } | null;
  /** Capacidades REAIS do recurso concreto escolhido (Cloud Resource Matching V1). Necessárias
   * SOMENTE quando a autoridade é por capacidade (`capabilityScope`); ignoradas quando a
   * autoridade é SKU-fixa. Ausência sob autoridade por capacidade ⇒ fail-closed. */
  readonly resourceCapabilities?: {
    readonly vramGiB: number;
    readonly gpuFeatures: readonly string[];
    readonly perHour: { readonly currency: string; readonly amount: number } | null;
  } | null;
}

export type PaidComputeDenialReason =
  | 'authorization_missing'
  | 'authorization_malformed'
  | 'authorization_author_not_human'
  | 'authorization_not_yet_valid'
  | 'authorization_expired'
  | 'provider_mismatch'
  | 'node_mismatch'
  | 'resource_class_mismatch'
  | 'resource_capabilities_required'
  | 'resource_capabilities_insufficient'
  | 'work_item_mismatch'
  | 'duration_exceeds_authorized'
  | 'aggregate_cost_ceiling_required'
  | 'cost_estimate_required'
  | 'cost_exceeds_authorized';

export type PaidComputeAuthorizationDecision =
  // Node não-pago: gasto não se aplica; segue sem exigir autorização financeira.
  | { readonly authorized: true; readonly requiresPayment: false; readonly reason: 'paid_not_required' }
  // Node pago com autorização humana compatível: liberado, carregando a referência auditável.
  | { readonly authorized: true; readonly requiresPayment: true; readonly authorizationRef: string }
  // Fail-closed: qualquer incompatibilidade/ausência exige (nova) decisão humana.
  | { readonly authorized: false; readonly reason: PaidComputeDenialReason };

const asObject = (v: Json | undefined): Record<string, Json | undefined> | null =>
  v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v) ? v : null;

const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const positiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isoInstant = (v: unknown): v is string => nonBlank(v) && !Number.isNaN(Date.parse(v));

const isCostShape = (v: unknown): v is { currency: string; amount: number } => {
  const o = v as { currency?: unknown; amount?: unknown } | null;
  return !!o && nonBlank(o.currency) && typeof o.amount === 'number' && Number.isFinite(o.amount) && o.amount >= 0;
};

const positiveNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Valida a forma de um escopo por capacidade persistido. `null` quando malformado. */
const parseCapabilityScope = (v: Json | undefined): CloudCapabilityScopeV1 | null => {
  const o = asObject(v);
  if (!o) return null;
  if (!positiveNum(o.minimumVramGiB)) return null;
  if (!Array.isArray(o.requiredGpuFeatures) || !o.requiredGpuFeatures.every(f => nonBlank(f))) return null;
  if (!positiveInt(o.maxNodes)) return null;
  if (o.maxHourlyPrice !== null && o.maxHourlyPrice !== undefined && !isCostShape(o.maxHourlyPrice)) return null;
  return {
    minimumVramGiB: o.minimumVramGiB,
    requiredGpuFeatures: (o.requiredGpuFeatures as string[]).map(String),
    maxHourlyPrice: o.maxHourlyPrice == null ? null : (o.maxHourlyPrice as { currency: string; amount: number }),
    maxNodes: o.maxNodes,
  };
};

/**
 * Reconstrói e valida uma `PaidComputeAuthorizationV1` de um JSON persistido. Fail-closed em
 * qualquer campo malformado. Não confere autoria humana nem validade temporal aqui (isso é
 * papel da AVALIAÇÃO contra o pedido) — só a forma estrutural. `null` quando inválida.
 */
export function parsePaidComputeAuthorization(value: Json | undefined): PaidComputeAuthorizationV1 | null {
  const root = asObject(value);
  if (!root || root.schemaVersion !== 1) return null;
  if (!nonBlank(root.authorizationId) || !nonBlank(root.authorizedBy)) return null;
  // Autoria humana é estrutural: uma autorização persistida com autoria diferente de 'user'
  // (ou ausente) é malformada — o sistema nunca autoriza o próprio gasto.
  if (root.authorizedByAuthor !== 'user') return null;
  if (!nonBlank(root.providerId)) return null;
  if (root.nodeId !== null && !nonBlank(root.nodeId)) return null;
  if (root.resourceClass !== null && !nonBlank(root.resourceClass)) return null;
  if (root.workItemId !== null && !nonBlank(root.workItemId)) return null;
  if (!positiveInt(root.maxDurationMs)) return null;
  if (root.maxCostEstimate !== null && !isCostShape(root.maxCostEstimate)) return null;
  if (!isoInstant(root.validFrom) || !isoInstant(root.validUntil)) return null;
  if (Date.parse(root.validUntil) <= Date.parse(root.validFrom)) return null;
  // Escopo por capacidade (opcional). Malformado quando presente e inválido; mutuamente exclusivo
  // com `resourceClass` SKU-fixa (uma autoridade não pode ser as duas coisas).
  let capabilityScope: CloudCapabilityScopeV1 | null = null;
  if (root.capabilityScope !== null && root.capabilityScope !== undefined) {
    capabilityScope = parseCapabilityScope(root.capabilityScope);
    if (capabilityScope === null) return null;
    if (root.resourceClass !== null) return null; // exclusividade: SKU-fixa XOR capability bounds
  }
  return {
    schemaVersion: 1,
    authorizationId: root.authorizationId,
    authorizedBy: root.authorizedBy,
    authorizedByAuthor: 'user',
    providerId: root.providerId,
    nodeId: (root.nodeId as string | null) ?? null,
    resourceClass: (root.resourceClass as string | null) ?? null,
    capabilityScope,
    workItemId: (root.workItemId as string | null) ?? null,
    maxDurationMs: root.maxDurationMs,
    maxCostEstimate: root.maxCostEstimate === null ? null : (root.maxCostEstimate as { currency: string; amount: number }),
    validFrom: root.validFrom,
    validUntil: root.validUntil,
  };
}

/**
 * Decide, PURA e fail-closed, se um pedido de compute pode consumir o node pedido. Node
 * não-pago dispensa autorização financeira (`paid_not_required`). Node `paid` exige uma
 * autorização humana válida, no prazo, do mesmo provider/node/classe/trabalho e com teto de
 * duração/custo compatível. Qualquer lacuna → `authorized:false` com razão tipada (requer
 * ato humano). A pressão de recurso NUNCA entra nesta decisão — a autorização é um artefato
 * humano explícito, não uma derivação da necessidade.
 */
export function evaluatePaidComputeAuthorization(
  request: PaidComputeRequest,
  authorization: PaidComputeAuthorizationV1 | null,
  now: Date,
): PaidComputeAuthorizationDecision {
  if (request.billingMode !== 'paid') {
    return { authorized: true, requiresPayment: false, reason: 'paid_not_required' };
  }
  if (authorization === null) return { authorized: false, reason: 'authorization_missing' };
  if (authorization.schemaVersion !== 1 || !nonBlank(authorization.authorizationId)
    || !nonBlank(authorization.providerId) || !positiveInt(authorization.maxDurationMs)
    || !isoInstant(authorization.validFrom) || !isoInstant(authorization.validUntil)) {
    return { authorized: false, reason: 'authorization_malformed' };
  }
  if (authorization.authorizedByAuthor !== 'user' || !nonBlank(authorization.authorizedBy)) {
    return { authorized: false, reason: 'authorization_author_not_human' };
  }

  const nowMs = now.getTime();
  if (nowMs < Date.parse(authorization.validFrom)) return { authorized: false, reason: 'authorization_not_yet_valid' };
  if (nowMs >= Date.parse(authorization.validUntil)) return { authorized: false, reason: 'authorization_expired' };

  if (authorization.providerId !== request.providerId) return { authorized: false, reason: 'provider_mismatch' };
  if (authorization.nodeId !== null && authorization.nodeId !== request.nodeId) return { authorized: false, reason: 'node_mismatch' };
  // Escopo de recurso: SKU-fixa XOR capacidade. Uma autoridade SKU-fixa (ex.: A40) só cobre a
  // classe exata — NUNCA vira autorização implícita de outra GPU. Uma autoridade por capacidade
  // cobre qualquer recurso cujas capacidades REAIS satisfaçam os limites concedidos.
  if (authorization.resourceClass !== null) {
    if (authorization.resourceClass !== request.resourceClass) return { authorized: false, reason: 'resource_class_mismatch' };
  } else if (authorization.capabilityScope != null) {
    const scope = authorization.capabilityScope;
    const caps = request.resourceCapabilities;
    if (!caps || typeof caps.vramGiB !== 'number' || !Number.isFinite(caps.vramGiB) || !Array.isArray(caps.gpuFeatures)) {
      return { authorized: false, reason: 'resource_capabilities_required' };
    }
    if (caps.vramGiB < scope.minimumVramGiB) return { authorized: false, reason: 'resource_capabilities_insufficient' };
    if (!scope.requiredGpuFeatures.every(f => caps.gpuFeatures.includes(f))) return { authorized: false, reason: 'resource_capabilities_insufficient' };
    if (scope.maxHourlyPrice != null) {
      if (!caps.perHour || caps.perHour.currency.toUpperCase() !== scope.maxHourlyPrice.currency.toUpperCase()
        || caps.perHour.amount > scope.maxHourlyPrice.amount) {
        return { authorized: false, reason: 'resource_capabilities_insufficient' };
      }
    }
  }
  if (authorization.workItemId !== null && authorization.workItemId !== request.workItemId) {
    return { authorized: false, reason: 'work_item_mismatch' };
  }
  if (!positiveInt(request.requestedDurationMs) || request.requestedDurationMs > authorization.maxDurationMs) {
    return { authorized: false, reason: 'duration_exceeds_authorized' };
  }
  // Compute pago exige um teto monetário agregado explícito. Autorizações históricas sem teto
  // continuam legíveis/revogáveis, mas não concedem autoridade financeira nova.
  if (authorization.maxCostEstimate === null) {
    return { authorized: false, reason: 'aggregate_cost_ceiling_required' };
  }
  if (authorization.maxCostEstimate !== null) {
    const cost = request.estimatedCost;
    if (!cost || !isCostShape(cost) || cost.currency !== authorization.maxCostEstimate.currency) {
      return { authorized: false, reason: 'cost_estimate_required' };
    }
    if (cost.amount > authorization.maxCostEstimate.amount) return { authorized: false, reason: 'cost_exceeds_authorized' };
  }
  return { authorized: true, requiresPayment: true, authorizationRef: authorization.authorizationId };
}
