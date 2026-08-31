import type { LiveNodePriceQuoteV0 } from '@anima/core';
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
    if (type?.id !== gpuTypeId || typeof price !== 'number' || !Number.isFinite(price) || price <= 0
      || stock === 'None' || !Array.isArray(counts) || !counts.includes(config.gpuCount)) return { ok: false, reason: 'quote_unavailable' };
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
