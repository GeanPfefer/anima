import type { NodePriceHintV0 } from './node-lease';

/** Quote read-only observado imediatamente antes da admissão. `lowest_available` descreve o
 * campo do catálogo; não é preço contratado, billing observado nem custo final. */
export interface LiveNodePriceQuoteV0 {
  readonly providerId: string;
  readonly resourceClass: string;
  readonly currency: string;
  readonly perHour: number;
  readonly quotedAt: string;
  /** Freshness LOCAL do consumidor, não SLA/garantia do provider. */
  readonly validUntil: string;
  readonly kind: 'lowest_available';
}

export type ConservativePriceDecision =
  | { readonly ok: true; readonly priceHint: NodePriceHintV0; readonly basis: 'configured' | 'live' }
  | { readonly ok: false; readonly reason: 'configured_price_required' | 'live_price_required' | 'quote_malformed' | 'quote_stale' | 'provider_mismatch' | 'resource_class_mismatch' | 'currency_mismatch' };

const positive = (n: number): boolean => Number.isFinite(n) && n > 0;
const nonBlank = (s: string): boolean => s.trim().length > 0;

/** Política fail-closed: os dois sinais são obrigatórios e, quando compatíveis/frescos, vence o
 * MAIOR. Preço live menor nunca reduz retroativamente o limite configurado. */
export function selectConservativePaidComputePrice(input: {
  readonly configured: NodePriceHintV0 | null;
  readonly live: LiveNodePriceQuoteV0 | null;
  readonly expectedProviderId: string;
  readonly expectedResourceClass: string;
  readonly now: Date;
}): ConservativePriceDecision {
  const { configured, live } = input;
  if (!configured || !nonBlank(configured.currency) || !positive(configured.perHour)) return { ok: false, reason: 'configured_price_required' };
  if (!live) return { ok: false, reason: 'live_price_required' };
  if (!nonBlank(live.providerId) || !nonBlank(live.resourceClass) || !nonBlank(live.currency)
    || !positive(live.perHour) || Number.isNaN(Date.parse(live.quotedAt)) || Number.isNaN(Date.parse(live.validUntil))
    || Date.parse(live.validUntil) <= Date.parse(live.quotedAt) || live.kind !== 'lowest_available') {
    return { ok: false, reason: 'quote_malformed' };
  }
  if (live.providerId !== input.expectedProviderId) return { ok: false, reason: 'provider_mismatch' };
  if (live.resourceClass !== input.expectedResourceClass) return { ok: false, reason: 'resource_class_mismatch' };
  if (live.currency.toUpperCase() !== configured.currency.toUpperCase()) return { ok: false, reason: 'currency_mismatch' };
  if (input.now.getTime() < Date.parse(live.quotedAt) || input.now.getTime() >= Date.parse(live.validUntil)) return { ok: false, reason: 'quote_stale' };
  const useLive = live.perHour >= configured.perHour;
  return { ok: true, basis: useLive ? 'live' : 'configured', priceHint: {
    currency: configured.currency.toUpperCase(), perHour: Math.max(configured.perHour, live.perHour),
  } };
}
