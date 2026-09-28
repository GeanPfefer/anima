/** @jest-environment node */
import { resolveProviderPricing, type ObservedCoderInput, type ProviderApiReservationStateV1, type ProviderPricingCatalogV1 } from '@anima/core';
import {
  loadProviderPricingCatalog,
  settleProviderApiAttemptCost,
  PROVIDER_PRICING_CATALOG_ENV,
  type ProviderApiSettlementStore,
} from './provider-api-settlement';

// FIXTURE — preço FICTÍCIO de teste; não é tarifa real de nenhum provider.
const catalog: ProviderPricingCatalogV1 = {
  schemaVersion: 1, catalogRef: 'fixture@1', entries: [{
    schemaVersion: 1, pricingVersion: 'fixture/gpt-test@v1', provider: 'openai', model: 'gpt-test', currency: 'USD',
    inputPerMillion: 2, cachedInputPerMillion: 0.5, outputPerMillion: 8,
    effectiveFrom: '2026-01-01T00:00:00Z', sourceRef: 'fixture:test-only',
  }],
};

const reservation = (over: Partial<ProviderApiReservationStateV1> = {}): ProviderApiReservationStateV1 => ({
  reservationId: 'res-1', providerId: 'openai', resourceClass: 'provider_api:gpt-test', attemptId: 'att-1',
  currency: 'USD', amount: 3, createdAt: '2026-09-27T10:00:00Z', voided: false, settlement: null, ...over,
});

const observation = (over: Partial<ObservedCoderInput> = {}): ObservedCoderInput => ({
  backendId: 'openai:gpt-test', durationMs: 1000, outcome: 'succeeded', placement: 'remote', nodeId: 'openai-api', model: 'gpt-test',
  providerCallCount: 2,
  providerUsage: { schemaVersion: 1, inputTokens: 100_000, cachedInputTokens: 40_000, outputTokens: 5_000, totalTokens: 105_000, reportedCallCount: 2, unreportedCallCount: 0 },
  ...over,
});

/** Store em memória que imita o ledger: um settle grava; replay idêntico ⇒ `replayed`. */
function fakeStore(initial: ProviderApiReservationStateV1 | null) {
  let current = initial;
  const writes: Parameters<ProviderApiSettlementStore['settle']>[0][] = [];
  const store: ProviderApiSettlementStore = {
    readReservation: async () => ({ ok: true, reservation: current }),
    settle: async input => {
      writes.push(input);
      current = { ...current!, settlement: { costSource: 'usage_priced', releasedExcess: 3 - Number(input.settledAmount), pricingVersion: input.provenance.pricingVersion } };
      return { ok: true, action: 'settled', settledAmount: Number(input.settledAmount), releasedExcess: 3 - Number(input.settledAmount), currency: input.currency, pricingVersion: input.provenance.pricingVersion };
    },
  };
  return { store, writes, state: () => current };
}

const run = (store: ProviderApiSettlementStore, observations: ObservedCoderInput[] = [observation()], cat: ProviderPricingCatalogV1 | null = catalog) =>
  settleProviderApiAttemptCost(store, { attemptId: 'att-1', provider: 'openai', coderObservations: observations, catalog: cat });

describe('settlement pós-attempt provider_api', () => {
  test('attempt com sucesso: grava usage_priced com proveniência e fecha a reserva', async () => {
    const { store, writes } = fakeStore(reservation());
    const outcome = await run(store);
    expect(outcome.kind).toBe('settled');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ reservationId: 'res-1', currency: 'USD', settledAmount: '0.18', provenance: { pricingVersion: 'fixture/gpt-test@v1', method: 'usage_priced' } });
  });

  test('attempt que FALHOU com usage consumida também liquida', async () => {
    const { store, writes } = fakeStore(reservation());
    const outcome = await run(store, [observation({ outcome: 'failed' })]);
    expect(outcome.kind).toBe('settled');
    expect(writes).toHaveLength(1);
  });

  test('replay: segunda execução não escreve de novo (already_settled)', async () => {
    const { store, writes } = fakeStore(reservation());
    await run(store);
    const second = await run(store);
    expect(second).toMatchObject({ kind: 'not_settled', decision: { kind: 'already_settled', settledAmount: '0.18' } });
    expect(writes).toHaveLength(1);
  });

  test('sem catálogo: nenhuma escrita, reserva segue cost_unknown', async () => {
    const { store, writes, state } = fakeStore(reservation());
    expect(await run(store, [observation()], null)).toMatchObject({ kind: 'not_settled', decision: { kind: 'cost_unknown', reason: 'pricing_catalog_absent' } });
    expect(writes).toHaveLength(0);
    expect(state()!.settlement).toBeNull();
  });

  test('provider falhou antes de qualquer usage: nenhuma escrita', async () => {
    const { store, writes } = fakeStore(reservation());
    const failed = observation({ outcome: 'failed', providerCallCount: 1 });
    delete (failed as { providerUsage?: unknown }).providerUsage;
    expect(await run(store, [failed])).toMatchObject({ decision: { kind: 'cost_unknown', reason: 'usage_incomplete' } });
    expect(writes).toHaveLength(0);
  });

  test('attempt sem reserva (admissão nunca reservou) ⇒ no_reservation', async () => {
    const { store, writes } = fakeStore(null);
    expect(await run(store)).toEqual({ kind: 'no_reservation' });
    expect(writes).toHaveLength(0);
  });

  test('modelo observado divergente entre observações ⇒ model_mismatch, sem escrita', async () => {
    const { store, writes } = fakeStore(reservation());
    expect(await run(store, [observation(), observation({ model: 'gpt-other' })]))
      .toMatchObject({ decision: { kind: 'cost_unknown', reason: 'model_mismatch' } });
    expect(writes).toHaveLength(0);
  });

  test('custo acima da reserva ⇒ reconciliação humana, sem escrita', async () => {
    const { store, writes } = fakeStore(reservation({ amount: 0.1 }));
    expect(await run(store)).toMatchObject({ decision: { kind: 'requires_human_reconciliation' } });
    expect(writes).toHaveLength(0);
  });

  test('erro do store na leitura/escrita é devolvido, nunca lançado (fail-open)', async () => {
    const readFail: ProviderApiSettlementStore = { readReservation: async () => ({ ok: false, code: 'unavailable', message: 'x' }), settle: jest.fn() };
    expect(await run(readFail)).toMatchObject({ kind: 'store_error', stage: 'read' });
    const writeFail: ProviderApiSettlementStore = { readReservation: async () => ({ ok: true, reservation: reservation() }), settle: async () => ({ ok: false, code: 'conflict', message: 'y' }) };
    expect(await run(writeFail)).toMatchObject({ kind: 'store_error', stage: 'settle', decision: { kind: 'settle' } });
  });
});

describe('carregamento do catálogo de preços', () => {
  test('env ausente ⇒ catálogo versionado do repositório', () => {
    expect(loadProviderPricingCatalog({})).toMatchObject({ status: 'loaded', source: 'repository', catalog: { catalogRef: 'anima/provider-pricing-catalog@2026-09-28.1' } });
  });
  test('sem env e sem catálogo do repositório ⇒ absent (nenhum preço inventado)', () => {
    expect(loadProviderPricingCatalog({}, () => '', null)).toEqual({ status: 'absent' });
  });
  test('arquivo ilegível ou inválido ⇒ invalid', () => {
    const env = { [PROVIDER_PRICING_CATALOG_ENV]: '/x.json' };
    expect(loadProviderPricingCatalog(env, () => '{not json')).toEqual({ status: 'invalid', source: 'env', reason: 'catalog_unreadable' });
    expect(loadProviderPricingCatalog(env, () => JSON.stringify({ schemaVersion: 1, catalogRef: 'c', entries: [{}] })).status).toBe('invalid');
  });
  test('env válida SUBSTITUI o catálogo do repositório', () => {
    const env = { [PROVIDER_PRICING_CATALOG_ENV]: '/x.json' };
    expect(loadProviderPricingCatalog(env, () => JSON.stringify(catalog))).toMatchObject({ status: 'loaded', source: 'env', catalog: { catalogRef: 'fixture@1' } });
  });
});

describe('catálogo OFICIAL versionado (OpenAI, consultado em 2026-09-28)', () => {
  type Usage = NonNullable<ObservedCoderInput['providerUsage']>;
  const official = (): ProviderPricingCatalogV1 => {
    const load = loadProviderPricingCatalog({});
    if (load.status !== 'loaded') throw new Error(`catálogo oficial inválido: ${JSON.stringify(load)}`);
    return load.catalog;
  };
  const SOL = 'gpt-5.6-sol';
  const solReservation = (over: Partial<ProviderApiReservationStateV1> = {}) =>
    reservation({ resourceClass: `provider_api:${SOL}`, createdAt: '2026-10-01T12:00:00Z', amount: 3, ...over });
  const solObservation = (usage: Partial<Usage> = {}, model = SOL) => observation({
    backendId: `openai:${model}`, model, providerCallCount: 3,
    providerUsage: {
      schemaVersion: 1, inputTokens: 190_000, cachedInputTokens: 100_000, cacheWriteInputTokens: 50_000, outputTokens: 6_000, totalTokens: 196_000,
      reportedCallCount: 3, unreportedCallCount: 0, maxCallInputTokens: 70_000, serviceTiers: ['default'], providerModels: [model], ...usage,
    },
  });
  const settle = (res: ProviderApiReservationStateV1, obs: ObservedCoderInput[], cat: ProviderPricingCatalogV1 = official()) =>
    settleProviderApiAttemptCost(fakeStore(res).store, { attemptId: 'att-1', provider: 'openai', coderObservations: obs, catalog: cat });

  test('parseia; identidade exata openai/gpt-5.6-sol e openai/gpt-5.6-terra; sourceRef oficial', () => {
    const cat = official();
    expect(cat.entries.map(e => [e.provider, e.model, e.pricingVersion])).toEqual([
      ['openai', 'gpt-5.6-sol', 'openai/gpt-5.6-sol@2026-09-28'],
      ['openai', 'gpt-5.6-terra', 'openai/gpt-5.6-terra@2026-09-28'],
    ]);
    for (const e of cat.entries) {
      expect(e.sourceRef).toContain('https://developers.openai.com/api/docs/pricing');
      expect(e).toMatchObject({ currency: 'USD', serviceTier: 'default', longContextInputThresholdTokens: 272_000, effectiveFrom: '2026-09-28T00:00:00Z' });
    }
  });

  test('gpt-5.6-sol: aritmética exata com cache read + cache write e proveniência completa', async () => {
    // (40k × 4 + 100k × 0.4 + 50k × 5 + 6k × 20) / 1e6 = 0.16 + 0.04 + 0.25 + 0.12 = 0.57
    const outcome = await settle(solReservation(), [solObservation()]);
    expect(outcome).toMatchObject({
      kind: 'settled', decision: { settledAmount: '0.57', provenance: {
        model: SOL, catalogRef: 'anima/provider-pricing-catalog@2026-09-28.1', pricingVersion: 'openai/gpt-5.6-sol@2026-09-28',
        pricingEffectiveFrom: '2026-09-28T00:00:00Z', exactCost: '0.57', serviceTier: 'default',
        rates: { inputPerMillion: '4', cachedInputPerMillion: '0.4', cacheWriteInputPerMillion: '5', outputPerMillion: '20' },
      } },
    });
    expect(outcome.kind === 'settled' && outcome.decision.provenance.pricingSourceRef).toContain('developers.openai.com');
  });

  test('gpt-5.6-terra resolve a PRÓPRIA versão; alias não casa por acidente', async () => {
    const terra = 'gpt-5.6-terra';
    const outcome = await settle(solReservation({ resourceClass: `provider_api:${terra}` }), [solObservation({}, terra)]);
    // (40k × 2 + 100k × 0.2 + 50k × 2.5 + 6k × 12) / 1e6 = 0.08 + 0.02 + 0.125 + 0.072 = 0.297
    expect(outcome).toMatchObject({ kind: 'settled', decision: { settledAmount: '0.297', provenance: { pricingVersion: 'openai/gpt-5.6-terra@2026-09-28' } } });
    for (const alias of ['gpt-5.6', 'gpt-5.6-sol-latest', 'GPT-5.6-SOL', 'gpt-5.6-luna']) {
      expect(await settle(solReservation({ resourceClass: `provider_api:${alias}` }), [solObservation({}, alias)]))
        .toMatchObject({ kind: 'not_settled', decision: { kind: 'cost_unknown', reason: 'pricing_missing' } });
    }
  });

  test('temporal: reservas anteriores ao effectiveFrom NÃO são reprecificadas', async () => {
    for (const createdAt of ['2026-09-25T19:29:00Z', '2026-09-27T23:59:59Z']) {
      expect(await settle(solReservation({ createdAt }), [solObservation()]))
        .toMatchObject({ kind: 'not_settled', decision: { kind: 'cost_unknown', reason: 'pricing_missing' } });
    }
  });

  test('Sol: "at least through 2026-11-21" é garantia (metadata), NÃO effectiveUntil; Terra sem prazo artificial', async () => {
    const cat = official();
    const sol = cat.entries.find(e => e.model === SOL)!;
    const terra = cat.entries.find(e => e.model === 'gpt-5.6-terra')!;
    expect(sol.effectiveUntil).toBeUndefined();
    expect(sol.sourceGuaranteedThrough).toBe('2026-11-21');
    expect(sol.sourceRef).toContain('at least through November 21, 2026');
    expect(terra.effectiveUntil).toBeUndefined();
    expect(terra.sourceGuaranteedThrough).toBeUndefined();
    // O dia 21/11 inteiro (UTC) está coberto; a versão não expira por inferência.
    expect(await settle(solReservation({ createdAt: '2026-11-21T12:00:00Z' }), [solObservation()]))
      .toMatchObject({ kind: 'settled', decision: { provenance: { pricingSourceGuaranteedThrough: '2026-11-21' } } });
    // Depois: a versão continua a ÚNICA vigente, mas o preço não é mais garantido ⇒ recusa visível.
    expect(resolveProviderPricing(cat, { provider: 'openai', model: SOL, at: '2026-12-01T00:00:00Z' })).toMatchObject({ ok: true, entry: { pricingVersion: 'openai/gpt-5.6-sol@2026-09-28' } });
    expect(await settle(solReservation({ createdAt: '2026-12-01T00:00:00Z' }), [solObservation()]))
      .toMatchObject({ kind: 'not_settled', decision: { kind: 'cost_unknown', reason: 'pricing_guarantee_lapsed' } });
    // Terra não tem garantia publicada nem prazo: segue precificável (sem data inventada).
    expect((await settle(solReservation({ createdAt: '2027-01-15T00:00:00Z', resourceClass: 'provider_api:gpt-5.6-terra' }), [solObservation({}, 'gpt-5.6-terra')])).kind).toBe('settled');
  });

  test('nova versão futura (com a anterior FECHADA por evidência real) não retroage; sem fechar ⇒ ambiguous', async () => {
    const base = official();
    const sol = base.entries.find(e => e.model === SOL)!;
    const next = { ...sol, pricingVersion: 'openai/gpt-5.6-sol@2026-12-01', inputPerMillion: 8, effectiveFrom: '2026-12-01T00:00:00Z', sourceGuaranteedThrough: undefined };
    const closed = { ...base, entries: [{ ...sol, effectiveUntil: '2026-12-01T00:00:00Z' }, base.entries.find(e => e.model !== SOL)!, next] };
    expect(await settle(solReservation(), [solObservation()], closed))
      .toMatchObject({ kind: 'settled', decision: { provenance: { pricingVersion: 'openai/gpt-5.6-sol@2026-09-28' } } });
    expect(await settle(solReservation({ createdAt: '2026-12-02T00:00:00Z' }), [solObservation()], closed))
      .toMatchObject({ kind: 'settled', decision: { provenance: { pricingVersion: 'openai/gpt-5.6-sol@2026-12-01' } } });
    const open = { ...base, entries: [...base.entries, next] };
    expect(await settle(solReservation({ createdAt: '2026-12-02T00:00:00Z' }), [solObservation()], open))
      .toMatchObject({ kind: 'not_settled', decision: { kind: 'cost_unknown', reason: 'pricing_ambiguous' } });
  });

  test('fatos exigidos pelo catálogo oficial ausentes ou fora do precificado ⇒ cost_unknown', async () => {
    const cases: Array<[Partial<Usage>, string]> = [
      [{ cacheWriteInputTokens: undefined }, 'usage_pricing_facts_missing'],
      [{ serviceTiers: undefined }, 'usage_pricing_facts_missing'],
      [{ maxCallInputTokens: undefined }, 'usage_pricing_facts_missing'],
      [{ serviceTiers: ['flex'] }, 'service_tier_mismatch'],
      [{ maxCallInputTokens: 272_001, inputTokens: 300_000, totalTokens: 306_000 }, 'long_context_unpriced'],
      [{ providerModels: ['gpt-5.6-sol-2026-06-01'] }, 'model_mismatch'],
    ];
    for (const [usage, reason] of cases) {
      expect(await settle(solReservation(), [solObservation(usage)])).toMatchObject({ kind: 'not_settled', decision: { kind: 'cost_unknown', reason } });
    }
  });

  test('evidência B1 anterior a esta unidade (sem fatos de precificação) permanece cost_unknown', async () => {
    const legacyB1 = observation({ model: SOL, providerCallCount: 20,
      providerUsage: { schemaVersion: 1, inputTokens: 192_000, cachedInputTokens: 0, outputTokens: 6_700, totalTokens: 198_700, reportedCallCount: 20, unreportedCallCount: 0 } });
    expect(await settle(solReservation(), [legacyB1]))
      .toMatchObject({ kind: 'not_settled', decision: { kind: 'cost_unknown', reason: 'usage_pricing_facts_missing' } });
  });
});
