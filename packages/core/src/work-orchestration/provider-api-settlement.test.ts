import {
  aggregateProviderApiAttemptUsage,
  deriveProviderApiSettlement,
  formatScaledDecimal,
  parseProviderPricingCatalog,
  resolveProviderPricing,
  toScaledDecimal,
  type ProviderApiReservationStateV1,
  type ProviderApiUsageAggregation,
  type ProviderPricingCatalogV1,
  type ProviderPricingEntryV1,
} from './provider-api-settlement';
import type { ProviderReportedUsageV1 } from './host-observed-coder-evidence';

// FIXTURE — preços FICTÍCIOS para teste. Não representam tarifa real de nenhum provider.
const entry = (over: Partial<ProviderPricingEntryV1> = {}): ProviderPricingEntryV1 => ({
  schemaVersion: 1, pricingVersion: 'fixture/test-model@v1', provider: 'openai', model: 'test-model',
  currency: 'USD', inputPerMillion: 2, cachedInputPerMillion: 0.5, outputPerMillion: 8,
  effectiveFrom: '2026-01-01T00:00:00Z', sourceRef: 'fixture:test-only', ...over,
});
const catalog = (entries: ProviderPricingEntryV1[] = [entry()]): ProviderPricingCatalogV1 =>
  ({ schemaVersion: 1, catalogRef: 'fixture-catalog@1', entries });

const reservation = (over: Partial<ProviderApiReservationStateV1> = {}): ProviderApiReservationStateV1 => ({
  reservationId: 'res-1', providerId: 'openai', resourceClass: 'provider_api:test-model', attemptId: 'att-1',
  currency: 'USD', amount: 3, createdAt: '2026-09-27T10:00:00Z', voided: false, settlement: null, ...over,
});

const usage = (over: Partial<ProviderReportedUsageV1> = {}): ProviderReportedUsageV1 => ({
  schemaVersion: 1, inputTokens: 100_000, cachedInputTokens: 40_000, outputTokens: 5_000, totalTokens: 105_000,
  reportedCallCount: 4, unreportedCallCount: 0, ...over,
});

const derive = (over: {
  usage?: ProviderApiUsageAggregation; reservation?: Partial<ProviderApiReservationStateV1>; catalog?: ProviderPricingCatalogV1 | null;
} = {}) => deriveProviderApiSettlement({
  attemptId: 'att-1', provider: 'openai', model: 'test-model',
  reservation: reservation(over.reservation),
  usage: over.usage ?? aggregateProviderApiAttemptUsage([{ providerUsage: usage(), providerCallCount: 4 }]),
  catalog: over.catalog === undefined ? catalog() : over.catalog,
});

describe('aritmética decimal exata', () => {
  test('escala sem perda e recusa exponencial/negativo/casas demais', () => {
    expect(toScaledDecimal(0.1, 9)).toBe(100_000_000n);
    expect(toScaledDecimal('1.25', 2)).toBe(125n);
    expect(toScaledDecimal('1.5000000000000', 2)).toBe(150n);
    expect(toScaledDecimal(1e-10, 9)).toBeNull();
    expect(toScaledDecimal('-1', 9)).toBeNull();
    expect(toScaledDecimal('0.0000000001', 9)).toBeNull();
    expect(formatScaledDecimal(1_230_000n, 6)).toBe('1.23');
    expect(formatScaledDecimal(0n, 6)).toBe('0');
  });

  test('frações de token: custo exato é preservado e o settlement arredonda PARA CIMA ao micro', () => {
    // 1 token de input a 2/M = 0.000002; 1 token de output a 0.3/M = 0.0000003 ⇒ exato 0.0000023.
    const d = derive({
      catalog: catalog([entry({ inputPerMillion: 2, outputPerMillion: 0.3, cachedInputPerMillion: undefined })]),
      usage: aggregateProviderApiAttemptUsage([{ providerUsage: usage({ inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 }), providerCallCount: 1 }]),
    });
    expect(d.kind).toBe('settle');
    if (d.kind !== 'settle') return;
    expect(d.provenance.exactCost).toBe('0.0000023');
    expect(d.settledAmount).toBe('0.000003');
  });

  test('sem ruído de ponto flutuante (0.1 + 0.2)', () => {
    const d = derive({
      catalog: catalog([entry({ inputPerMillion: 0.1, outputPerMillion: 0.2, cachedInputPerMillion: undefined })]),
      usage: aggregateProviderApiAttemptUsage([{ providerUsage: usage({ inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000_000, totalTokens: 2_000_000 }), providerCallCount: 1 }]),
    });
    expect(d.kind === 'settle' && d.settledAmount).toBe('0.3');
  });
});

describe('settlement provider_api', () => {
  test('success + usage + pricing válida → settle com proveniência completa', () => {
    const d = derive();
    // (60k × 2 + 40k × 0.5 + 5k × 8) / 1e6 = 0.12 + 0.02 + 0.04 = 0.18
    expect(d).toEqual({
      kind: 'settle', reservationId: 'res-1', currency: 'USD', settledAmount: '0.18',
      provenance: {
        schemaVersion: 1, method: 'usage_priced', attemptId: 'att-1', provider: 'openai', model: 'test-model',
        catalogRef: 'fixture-catalog@1', pricingVersion: 'fixture/test-model@v1', pricingSourceRef: 'fixture:test-only',
        pricingEffectiveFrom: '2026-01-01T00:00:00Z', currency: 'USD',
        rates: { inputPerMillion: '2', cachedInputPerMillion: '0.5', outputPerMillion: '8' },
        usage: { inputTokens: 100_000, cachedInputTokens: 40_000, outputTokens: 5_000, totalTokens: 105_000, reportedCallCount: 4 },
        exactCost: '0.18', rounding: 'ceil_to_1e-6_capped_at_reservation',
      },
    });
  });

  test('failure + usage + pricing válida → settle (custo não depende do desfecho)', () => {
    // Observações de uma attempt que FALHOU: 1ª edit ok, 2ª edit lançou erro com usage acumulada.
    const aggregated = aggregateProviderApiAttemptUsage([
      { providerUsage: usage({ inputTokens: 50_000, cachedInputTokens: 0, outputTokens: 1_000, totalTokens: 51_000, reportedCallCount: 2 }), providerCallCount: 2 },
      { providerUsage: usage({ inputTokens: 10_000, cachedInputTokens: 0, outputTokens: 0, totalTokens: 10_000, reportedCallCount: 1 }), providerCallCount: 1 },
    ]);
    const d = derive({ usage: aggregated });
    expect(d.kind).toBe('settle');
    // (60k × 2 + 1k × 8) / 1e6 = 0.128
    expect(d.kind === 'settle' && d.settledAmount).toBe('0.128');
    expect(d.kind === 'settle' && d.provenance.usage.reportedCallCount).toBe(3);
  });

  test('usage presente + pricing ausente → cost_unknown (catálogo ausente ou sem o modelo)', () => {
    expect(derive({ catalog: null })).toEqual({ kind: 'cost_unknown', reservationId: 'res-1', reason: 'pricing_catalog_absent' });
    expect(derive({ catalog: catalog([entry({ model: 'other-model' })]) }))
      .toEqual({ kind: 'cost_unknown', reservationId: 'res-1', reason: 'pricing_missing' });
    expect(derive({ catalog: catalog([]) })).toMatchObject({ kind: 'cost_unknown', reason: 'pricing_missing' });
  });

  test('pricing presente + usage ausente → cost_unknown (jamais zero)', () => {
    const d = derive({ usage: aggregateProviderApiAttemptUsage([]) });
    expect(d).toEqual({ kind: 'cost_unknown', reservationId: 'res-1', reason: 'usage_absent' });
  });

  test('provider falhou antes de qualquer usage (chamada despachada, sem usage) → cost_unknown', () => {
    const aggregated = aggregateProviderApiAttemptUsage([{ providerCallCount: 1 }]);
    expect(aggregated).toEqual({ status: 'incomplete' });
    expect(derive({ usage: aggregated })).toMatchObject({ kind: 'cost_unknown', reason: 'usage_incomplete' });
  });

  test('usage parcial (chamada despachada sem usage) ou legada sem cobertura → cost_unknown', () => {
    expect(derive({ usage: aggregateProviderApiAttemptUsage([{ providerUsage: usage({ unreportedCallCount: 1 }), providerCallCount: 5 }]) }))
      .toMatchObject({ kind: 'cost_unknown', reason: 'usage_incomplete' });
    const legacy = usage();
    delete (legacy as { reportedCallCount?: number }).reportedCallCount;
    delete (legacy as { unreportedCallCount?: number }).unreportedCallCount;
    expect(derive({ usage: aggregateProviderApiAttemptUsage([{ providerUsage: legacy, providerCallCount: 4 }]) }))
      .toMatchObject({ kind: 'cost_unknown', reason: 'usage_incomplete' });
  });

  test('usage inconsistente → cost_unknown', () => {
    const d = derive({ usage: aggregateProviderApiAttemptUsage([{ providerUsage: usage({ cachedInputTokens: 200_000 }), providerCallCount: 4 }]) });
    expect(d).toMatchObject({ kind: 'cost_unknown', reason: 'usage_inconsistent' });
  });

  test('replay idempotente: mesma versão/valor ⇒ already_settled (no-op)', () => {
    const d = derive({ reservation: { settlement: { costSource: 'usage_priced', releasedExcess: 2.82, pricingVersion: 'fixture/test-model@v1' } } });
    expect(d).toEqual({ kind: 'already_settled', reservationId: 'res-1', settledAmount: '0.18' });
  });

  test('double settlement com valor/fonte divergente ⇒ conflict (nunca liquida duas vezes)', () => {
    const otherAmount = derive({ reservation: { settlement: { costSource: 'usage_priced', releasedExcess: 2.5, pricingVersion: 'fixture/test-model@v1' } } });
    expect(otherAmount.kind).toBe('settlement_conflict');
    const otherSource = derive({ reservation: { settlement: { costSource: 'estimated', releasedExcess: 2.82, pricingVersion: null } } });
    expect(otherSource.kind).toBe('settlement_conflict');
  });

  test('pricing version mismatch: replay com outra versão ⇒ conflict; versão fora da vigência ⇒ pricing_missing', () => {
    const v2 = catalog([entry({ pricingVersion: 'fixture/test-model@v2' })]);
    const replay = derive({ catalog: v2, reservation: { settlement: { costSource: 'usage_priced', releasedExcess: 2.82, pricingVersion: 'fixture/test-model@v1' } } });
    expect(replay).toMatchObject({ kind: 'settlement_conflict', proposed: { pricingVersion: 'fixture/test-model@v2' }, existing: { pricingVersion: 'fixture/test-model@v1' } });
    // A reserva foi aberta ANTES da vigência da versão ⇒ nenhuma versão cobre o instante.
    const future = catalog([entry({ effectiveFrom: '2026-10-01T00:00:00Z' })]);
    expect(derive({ catalog: future })).toMatchObject({ kind: 'cost_unknown', reason: 'pricing_missing' });
    // Versão expirada antes da reserva.
    const expired = catalog([entry({ effectiveUntil: '2026-09-01T00:00:00Z' })]);
    expect(derive({ catalog: expired })).toMatchObject({ kind: 'cost_unknown', reason: 'pricing_missing' });
  });

  test('versão escolhida pela vigência no instante da reserva; sobreposição ⇒ ambiguous', () => {
    const cat = catalog([
      entry({ pricingVersion: 'v1', effectiveUntil: '2026-09-01T00:00:00Z', inputPerMillion: 100 }),
      entry({ pricingVersion: 'v2', effectiveFrom: '2026-09-01T00:00:00Z' }),
    ]);
    const d = derive({ catalog: cat });
    expect(d.kind === 'settle' && d.provenance.pricingVersion).toBe('v2');
    expect(resolveProviderPricing(catalog([entry({ pricingVersion: 'a' }), entry({ pricingVersion: 'b' })]),
      { provider: 'openai', model: 'test-model', at: '2026-09-27T10:00:00Z' })).toEqual({ ok: false, reason: 'pricing_ambiguous' });
  });

  test('teto da reserva: custo derivado > R ⇒ requires_human_reconciliation (não clampa em silêncio)', () => {
    const d = derive({ reservation: { amount: 0.1 } });
    expect(d).toEqual({
      kind: 'requires_human_reconciliation', reservationId: 'res-1', reason: 'derived_cost_exceeds_reservation',
      derivedCost: '0.18', reserved: '0.1', currency: 'USD',
    });
  });

  test('teto da reserva: custo exato ≤ R mas arredondamento cruzaria R ⇒ liquida exatamente R', () => {
    // exato 0.0000023 ≤ R=0.0000025; ceil ao micro = 0.000003 > R ⇒ S = R.
    const d = derive({
      reservation: { amount: '0.0000025' },
      catalog: catalog([entry({ inputPerMillion: 2, outputPerMillion: 0.3, cachedInputPerMillion: undefined })]),
      usage: aggregateProviderApiAttemptUsage([{ providerUsage: usage({ inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 }), providerCallCount: 1 }]),
    });
    expect(d.kind === 'settle' && d.settledAmount).toBe('0.0000025');
  });

  test('coerência: provider/modelo/moeda divergentes da reserva ⇒ cost_unknown', () => {
    expect(derive({ reservation: { providerId: 'runpod' } })).toMatchObject({ kind: 'cost_unknown', reason: 'provider_mismatch' });
    expect(derive({ reservation: { resourceClass: 'provider_api:other-model' } })).toMatchObject({ kind: 'cost_unknown', reason: 'model_mismatch' });
    expect(derive({ reservation: { currency: 'BRL' } })).toMatchObject({ kind: 'cost_unknown', reason: 'currency_mismatch' });
    expect(derive({ reservation: { attemptId: 'att-other' } })).toMatchObject({ kind: 'cost_unknown', reason: 'reservation_invalid' });
  });

  test('reserva anulada ⇒ not_applicable', () => {
    expect(derive({ reservation: { voided: true } })).toEqual({ kind: 'not_applicable', reservationId: 'res-1', reason: 'reservation_voided' });
  });

  test('histórico: reserva antiga com evidência legada (sem cobertura) e sem preço vigente permanece cost_unknown', () => {
    // Forma real das reservas 7398bb8d/11031d53: usage agregada SEM cobertura, pricing inexistente.
    const legacy: ProviderReportedUsageV1 = { schemaVersion: 1, inputTokens: 234_756, cachedInputTokens: 89_127, outputTokens: 7_876, totalTokens: 242_632 };
    const old = { createdAt: '2026-09-14T20:00:00Z', resourceClass: 'provider_api:test-model' };
    expect(derive({ reservation: old, catalog: null, usage: aggregateProviderApiAttemptUsage([{ providerUsage: legacy, providerCallCount: 18 }]) }))
      .toMatchObject({ kind: 'cost_unknown' });
    // Mesmo com um catálogo cuja vigência começa DEPOIS da reserva, nada retroage.
    expect(derive({ reservation: old, catalog: catalog([entry({ effectiveFrom: '2026-09-27T00:00:00Z' })]) }))
      .toMatchObject({ kind: 'cost_unknown', reason: 'pricing_missing' });
  });
});

describe('catálogo de preços (fail-closed)', () => {
  test('catálogo válido é aceito; duplicata idêntica é deduplicada', () => {
    const r = parseProviderPricingCatalog({ schemaVersion: 1, catalogRef: 'c@1', entries: [entry(), entry()] });
    expect(r.ok && r.catalog.entries).toHaveLength(1);
  });

  test.each([
    ['sem catalogRef', { schemaVersion: 1, entries: [] }],
    ['schema errado', { schemaVersion: 2, catalogRef: 'c', entries: [] }],
    ['versão ausente', { schemaVersion: 1, catalogRef: 'c', entries: [{ ...entry(), pricingVersion: '' }] }],
    ['sem sourceRef', { schemaVersion: 1, catalogRef: 'c', entries: [{ ...entry(), sourceRef: ' ' }] }],
    ['sem effectiveFrom', { schemaVersion: 1, catalogRef: 'c', entries: [{ ...entry(), effectiveFrom: undefined }] }],
    ['janela invertida', { schemaVersion: 1, catalogRef: 'c', entries: [entry({ effectiveUntil: '2025-01-01T00:00:00Z' })] }],
    ['tarifa negativa', { schemaVersion: 1, catalogRef: 'c', entries: [entry({ inputPerMillion: -1 })] }],
    ['tarifa com casas demais', { schemaVersion: 1, catalogRef: 'c', entries: [entry({ outputPerMillion: 0.0000000001 })] }],
    ['versão duplicada divergente', { schemaVersion: 1, catalogRef: 'c', entries: [entry(), entry({ inputPerMillion: 3 })] }],
  ])('rejeita o catálogo inteiro: %s', (_label, value) => {
    expect(parseProviderPricingCatalog(value).ok).toBe(false);
  });
});

describe('dimensões de cobrança declaradas pela versão (tier, long context, cache write)', () => {
  // FIXTURE — tarifas FICTÍCIAS; o catálogo oficial é testado em apps/web.
  const strict = (over: Partial<ProviderPricingEntryV1> = {}) => catalog([entry({
    cacheWriteInputPerMillion: 2.5, longContextInputThresholdTokens: 272_000, serviceTier: 'default', ...over,
  })]);
  const facts = (over: Partial<ProviderReportedUsageV1> = {}) => aggregateProviderApiAttemptUsage([{
    providerUsage: usage({ cacheWriteInputTokens: 20_000, maxCallInputTokens: 30_000, serviceTiers: ['default'], providerModels: ['test-model'], ...over }),
    providerCallCount: 4,
  }]);

  test('cache write precificado à parte: partição input = não-cacheado + lido + escrito (exato)', () => {
    // (40k × 2 + 40k × 0.5 + 20k × 2.5 + 5k × 8) / 1e6 = 0.08 + 0.02 + 0.05 + 0.04 = 0.19
    const d = derive({ catalog: strict(), usage: facts() });
    expect(d).toMatchObject({
      kind: 'settle', settledAmount: '0.19',
      provenance: {
        exactCost: '0.19', serviceTier: 'default', longContextInputThresholdTokens: 272_000,
        rates: { inputPerMillion: '2', cachedInputPerMillion: '0.5', cacheWriteInputPerMillion: '2.5', outputPerMillion: '8' },
        usage: { cacheWriteInputTokens: 20_000, maxCallInputTokens: 30_000, serviceTiers: ['default'], providerModels: ['test-model'] },
      },
    });
  });

  test('fato declarado mas não reportado pelo provider ⇒ usage_pricing_facts_missing (nunca presume zero)', () => {
    const missing = (key: keyof ProviderReportedUsageV1) => aggregateProviderApiAttemptUsage([{
      providerUsage: { ...usage({ cacheWriteInputTokens: 0, maxCallInputTokens: 30_000, serviceTiers: ['default'] }), [key]: undefined },
      providerCallCount: 4,
    }]);
    for (const key of ['cacheWriteInputTokens', 'maxCallInputTokens', 'serviceTiers'] as const) {
      expect(derive({ catalog: strict(), usage: missing(key) })).toMatchObject({ kind: 'cost_unknown', reason: 'usage_pricing_facts_missing' });
    }
  });

  test('fato só conta quando TODA observação o reportou', () => {
    const mixed = aggregateProviderApiAttemptUsage([
      { providerUsage: usage({ cacheWriteInputTokens: 0, maxCallInputTokens: 10, serviceTiers: ['default'] }), providerCallCount: 4 },
      { providerUsage: usage({ maxCallInputTokens: 10, serviceTiers: ['default'] }), providerCallCount: 4 },
    ]);
    expect(mixed.status === 'complete' && mixed.usage.cacheWriteInputTokens).toBeUndefined();
    expect(derive({ catalog: strict(), usage: mixed })).toMatchObject({ kind: 'cost_unknown', reason: 'usage_pricing_facts_missing' });
  });

  test('tier diferente do precificado (flex/priority) ⇒ service_tier_mismatch', () => {
    expect(derive({ catalog: strict(), usage: facts({ serviceTiers: ['default', 'priority'] }) }))
      .toMatchObject({ kind: 'cost_unknown', reason: 'service_tier_mismatch' });
  });

  test('requisição acima do limiar de long context ⇒ long_context_unpriced; no limiar ainda precifica', () => {
    expect(derive({ catalog: strict(), usage: facts({ inputTokens: 300_000, totalTokens: 305_000, maxCallInputTokens: 272_001 }) }))
      .toMatchObject({ kind: 'cost_unknown', reason: 'long_context_unpriced' });
    expect(derive({ catalog: strict(), usage: facts({ inputTokens: 300_000, totalTokens: 305_000, maxCallInputTokens: 272_000 }) }).kind).toBe('settle');
  });

  test('cache writes observados sem tarifa na versão ⇒ pricing_category_missing', () => {
    expect(derive({ catalog: strict({ cacheWriteInputPerMillion: undefined }), usage: facts() }))
      .toMatchObject({ kind: 'cost_unknown', reason: 'pricing_category_missing' });
  });

  test('modelo ecoado pelo provider diferente do precificado (alias/snapshot) ⇒ model_mismatch', () => {
    expect(derive({ catalog: strict(), usage: facts({ providerModels: ['test-model-2026-05-01'] }) }))
      .toMatchObject({ kind: 'cost_unknown', reason: 'model_mismatch' });
  });

  test('usage com lido + escrito > input ⇒ inconsistent', () => {
    expect(facts({ cacheWriteInputTokens: 60_001 })).toEqual({ status: 'inconsistent' });
  });

  test('catálogo rejeita dimensões malformadas', () => {
    for (const bad of [{ cacheWriteInputPerMillion: -1 }, { longContextInputThresholdTokens: 0 }, { serviceTier: ' ' }]) {
      expect(parseProviderPricingCatalog({ schemaVersion: 1, catalogRef: 'c', entries: [entry(bad as Partial<ProviderPricingEntryV1>)] }).ok).toBe(false);
    }
  });
});
