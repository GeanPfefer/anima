/** @jest-environment node */
import type { ObservedCoderInput, ProviderApiReservationStateV1, ProviderPricingCatalogV1 } from '@anima/core';
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
  test('env ausente ⇒ absent (nenhum preço inventado)', () => {
    expect(loadProviderPricingCatalog({})).toEqual({ status: 'absent' });
  });
  test('arquivo ilegível ou inválido ⇒ invalid', () => {
    const env = { [PROVIDER_PRICING_CATALOG_ENV]: '/x.json' };
    expect(loadProviderPricingCatalog(env, () => '{not json')).toEqual({ status: 'invalid', reason: 'catalog_unreadable' });
    expect(loadProviderPricingCatalog(env, () => JSON.stringify({ schemaVersion: 1, catalogRef: 'c', entries: [{}] })).status).toBe('invalid');
  });
  test('arquivo válido ⇒ loaded', () => {
    const env = { [PROVIDER_PRICING_CATALOG_ENV]: '/x.json' };
    expect(loadProviderPricingCatalog(env, () => JSON.stringify(catalog))).toMatchObject({ status: 'loaded', catalog: { catalogRef: 'fixture@1' } });
  });
});
