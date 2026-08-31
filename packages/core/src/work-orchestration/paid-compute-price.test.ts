import { selectConservativePaidComputePrice, type LiveNodePriceQuoteV0 } from './paid-compute-price';

const now = new Date('2026-08-31T12:00:30Z');
const live = (over: Partial<LiveNodePriceQuoteV0> = {}): LiveNodePriceQuoteV0 => ({
  providerId: 'runpod', resourceClass: 'gpu-a40', currency: 'USD', perHour: 0.7,
  quotedAt: '2026-08-31T12:00:00Z', validUntil: '2026-08-31T12:01:00Z', kind: 'lowest_available', ...over,
});
const decide = (configured = 0.4, quote: LiveNodePriceQuoteV0 | null = live()) => selectConservativePaidComputePrice({
  configured: configured < 0 ? null : { currency: 'USD', perHour: configured }, live: quote,
  expectedProviderId: 'runpod', expectedResourceClass: 'gpu-a40', now,
});

test('live maior vence; live menor nunca reduz configured', () => {
  expect(decide()).toMatchObject({ ok: true, basis: 'live', priceHint: { perHour: 0.7 } });
  expect(decide(0.9)).toMatchObject({ ok: true, basis: 'configured', priceHint: { perHour: 0.9 } });
});

test.each([
  ['configured ausente', decide(-1), 'configured_price_required'],
  ['live ausente', decide(0.4, null), 'live_price_required'],
  ['stale', decide(0.4, live({ validUntil: '2026-08-31T12:00:20Z' })), 'quote_stale'],
  ['moeda', decide(0.4, live({ currency: 'BRL' })), 'currency_mismatch'],
  ['provider', decide(0.4, live({ providerId: 'other' })), 'provider_mismatch'],
  ['classe', decide(0.4, live({ resourceClass: 'gpu-4090' })), 'resource_class_mismatch'],
  ['zero', decide(0.4, live({ perHour: 0 })), 'quote_malformed'],
] as const)('%s falha fechado', (_label, result, reason) => expect(result).toEqual({ ok: false, reason }));
