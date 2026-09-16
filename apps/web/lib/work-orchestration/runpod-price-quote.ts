import type { CloudResourceAvailabilityV1, CloudResourceCandidateV1, LiveNodePriceQuoteV0 } from '@anima/core';
import { fetchHttpClient, type HttpClient } from './runpod-node-provisioner';

export interface RunPodPriceQuoteConfig {
  readonly graphqlBase: string;
  readonly apiKey: string;
  readonly gpuTypeIds: readonly string[];
  readonly gpuCount: number;
  readonly cloudType: 'SECURE' | 'COMMUNITY';
  readonly resourceClass: string;
  readonly freshnessMs: number;
}

export type RunPodPriceQuoteResult =
  | { readonly ok: true; readonly quote: LiveNodePriceQuoteV0 }
  | { readonly ok: false; readonly reason: 'auth_invalid' | 'provider_unreachable' | 'rate_limited' | 'quote_unavailable' | 'quote_invalid' };

const obj = (v: unknown): Record<string, unknown> | null => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** Query GraphQL estritamente read-only. A API key é exigida pelo RunPod; fica apenas na URL em
 * memória porque esta API documenta `api_key` como query param. Nunca é logada/persistida. */
export async function readRunPodLivePriceQuote(
  config: RunPodPriceQuoteConfig,
  signal: AbortSignal,
  http: HttpClient = fetchHttpClient,
  now: () => Date = () => new Date(),
): Promise<RunPodPriceQuoteResult> {
  if (config.gpuTypeIds.length === 0 || !Number.isInteger(config.gpuCount) || config.gpuCount <= 0
    || !Number.isInteger(config.freshnessMs) || config.freshnessMs <= 0) return { ok: false, reason: 'quote_invalid' };
  const prices: number[] = [];
  for (const gpuTypeId of config.gpuTypeIds) {
    let response;
    try {
      const url = `${config.graphqlBase.replace(/\/+$/, '')}?api_key=${encodeURIComponent(config.apiKey)}`;
      response = await http.send({ method: 'POST', url, headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ query: 'query Price($id: String!, $gpuCount: Int!, $secure: Boolean!) { gpuTypes(input: { id: $id }) { id lowestPrice(input: { gpuCount: $gpuCount, secureCloud: $secure }) { stockStatus uninterruptablePrice availableGpuCounts } } }',
          variables: { id: gpuTypeId, gpuCount: config.gpuCount, secure: config.cloudType === 'SECURE' } }) });
    } catch { return { ok: false, reason: 'provider_unreachable' }; }
    if (response.status === 401 || response.status === 403) return { ok: false, reason: 'auth_invalid' };
    if (response.status === 429) return { ok: false, reason: 'rate_limited' };
    if (response.status < 200 || response.status >= 300) return { ok: false, reason: 'provider_unreachable' };
    let parsed: unknown;
    try { parsed = JSON.parse(response.body); } catch { return { ok: false, reason: 'quote_invalid' }; }
    const root = obj(parsed); const data = obj(root?.data); const types = data?.gpuTypes;
    if (!root || Array.isArray(root.errors) || !Array.isArray(types) || types.length !== 1) return { ok: false, reason: 'quote_unavailable' };
    const type = obj(types[0]); const lowest = obj(type?.lowestPrice);
    const price = lowest?.uninterruptablePrice; const stock = lowest?.stockStatus; const counts = lowest?.availableGpuCounts;
    // `availableGpuCounts` pode vir null/ausente na resposta REAL do RunPod mesmo com estoque
    // (ex.: A40 SECURE com stockStatus 'High'): quando é array, exige conter gpuCount; quando
    // null/ausente, a disponibilidade é decidida pelo stockStatus (string diferente de 'None').
    const countsGate = counts == null ? true : (Array.isArray(counts) && counts.includes(config.gpuCount));
    if (type?.id !== gpuTypeId || typeof price !== 'number' || !Number.isFinite(price) || price <= 0
      || typeof stock !== 'string' || stock === 'None' || !countsGate) return { ok: false, reason: 'quote_unavailable' };
    prices.push(price);
  }
  const quotedAt = now();
  return { ok: true, quote: {
    providerId: 'runpod', resourceClass: config.resourceClass, currency: 'USD',
    // O provider pode escolher qualquer GPU da lista de prioridade: reserva pelo MAIOR quote.
    perHour: Math.max(...prices), quotedAt: quotedAt.toISOString(),
    validUntil: new Date(quotedAt.getTime() + config.freshnessMs).toISOString(), kind: 'lowest_available',
  } };
}

// ============================================================
// CLOUD RESOURCE MATCHING V1 — INVENTÁRIO normalizado de candidatos (read-only).
//
// Diferente de `readRunPodLivePriceQuote` (que exige TODA a lista disponível e reserva pelo maior
// preço), este leitor devolve uma LISTA de candidatos com VRAM, preço e disponibilidade por SKU —
// para o matcher tático (`matchCloudResource`) filtrar/ranquear. A40 indisponível NÃO interrompe a
// busca: vira um candidato `unavailable` entre os demais. Uma cotação individual ausente pula
// aquele candidato e CONTINUA. Só falha global (fecha) em erro de credencial/rede/rate em TODAS as
// consultas. Estritamente read-only; nenhuma criação de recurso, nenhum gasto.
// ============================================================

export interface RunPodInventoryConfig {
  readonly graphqlBase: string;
  readonly apiKey: string;
  /** Pool tático de SKUs a considerar (configurado pelo operador dentro da estratégia cloud). */
  readonly gpuTypeIds: readonly string[];
  readonly gpuCount: number;
  readonly cloudType: 'SECURE' | 'COMMUNITY';
}

export type RunPodInventoryResult =
  | { readonly ok: true; readonly candidates: readonly CloudResourceCandidateV1[] }
  | { readonly ok: false; readonly reason: 'auth_invalid' | 'provider_unreachable' | 'rate_limited' | 'inventory_invalid' };

/** Classe canônica derivada de displayName + VRAM (ex.: 'A40' + 48 → 'gpu-a40-48gb'). Casa com a
 * `resourceClass` SKU-fixa histórica da autoridade. PURA. */
export function canonicalGpuResourceClass(displayName: string, memoryInGb: number): string {
  const slug = displayName.toLowerCase().replace(/nvidia/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const mem = Number.isFinite(memoryInGb) && memoryInGb > 0 ? Math.round(memoryInGb) : 0;
  return `gpu-${slug || 'unknown'}-${mem}gb`;
}

const availabilityFromStock = (stock: string | null): CloudResourceAvailabilityV1 => {
  if (stock === null || stock.trim().length === 0 || stock === 'None') return 'unavailable';
  return stock === 'Low' ? 'limited' : 'available';
};

export async function readRunPodResourceInventory(
  config: RunPodInventoryConfig,
  signal: AbortSignal,
  http: HttpClient = fetchHttpClient,
): Promise<RunPodInventoryResult> {
  if (config.gpuTypeIds.length === 0 || !Number.isInteger(config.gpuCount) || config.gpuCount <= 0) {
    return { ok: false, reason: 'inventory_invalid' };
  }
  const candidates: CloudResourceCandidateV1[] = [];
  let transportFailures = 0;
  for (const gpuTypeId of config.gpuTypeIds) {
    let response;
    try {
      const url = `${config.graphqlBase.replace(/\/+$/, '')}?api_key=${encodeURIComponent(config.apiKey)}`;
      response = await http.send({ method: 'POST', url, headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ query: 'query Inv($id: String!, $gpuCount: Int!, $secure: Boolean!) { gpuTypes(input: { id: $id }) { id displayName memoryInGb lowestPrice(input: { gpuCount: $gpuCount, secureCloud: $secure }) { stockStatus uninterruptablePrice availableGpuCounts } } }',
          variables: { id: gpuTypeId, gpuCount: config.gpuCount, secure: config.cloudType === 'SECURE' } }) });
    } catch { transportFailures++; continue; }
    // Credencial/rate inválidos fecham GLOBALMENTE — não adianta tentar outros SKUs.
    if (response.status === 401 || response.status === 403) return { ok: false, reason: 'auth_invalid' };
    if (response.status === 429) return { ok: false, reason: 'rate_limited' };
    if (response.status < 200 || response.status >= 300) { transportFailures++; continue; }
    let parsed: unknown;
    try { parsed = JSON.parse(response.body); } catch { continue; }
    const root = obj(parsed); const data = obj(root?.data); const types = data?.gpuTypes;
    if (!root || Array.isArray(root.errors) || !Array.isArray(types) || types.length !== 1) continue; // cotação individual indisponível: pula e continua
    const type = obj(types[0]); const lowest = obj(type?.lowestPrice);
    if (type?.id !== gpuTypeId) continue;
    const displayName = typeof type.displayName === 'string' && type.displayName.trim().length > 0 ? type.displayName : gpuTypeId;
    const memoryInGb = typeof type.memoryInGb === 'number' && Number.isFinite(type.memoryInGb) && type.memoryInGb > 0 ? type.memoryInGb : 0;
    const stock = typeof lowest?.stockStatus === 'string' ? lowest.stockStatus : null;
    const price = lowest?.uninterruptablePrice;
    const perHour = typeof price === 'number' && Number.isFinite(price) && price > 0 ? { currency: 'USD', amount: price } : null;
    candidates.push({
      providerId: 'runpod',
      resourceClass: canonicalGpuResourceClass(displayName, memoryInGb),
      gpuTypeId,
      displayName,
      vramGiB: memoryInGb,
      // Todas as GPUs RunPod são NVIDIA/CUDA; features mais específicas exigiriam outra fonte.
      gpuFeatures: ['cuda'],
      availability: availabilityFromStock(stock),
      perHour,
    });
  }
  // Nenhum candidato E todas as consultas falharam no transporte ⇒ inventário indisponível (fecha).
  if (candidates.length === 0 && transportFailures > 0) return { ok: false, reason: 'provider_unreachable' };
  return { ok: true, candidates };
}
