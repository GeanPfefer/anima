import {
  costPerVerifiedOutcome,
  settlePaidComputeUsage,
  type PaidComputeUsageV1,
  type TokenPricingV1,
} from './paid-compute-settlement';

const usage = (over: Partial<PaidComputeUsageV1> = {}): PaidComputeUsageV1 => ({
  inputTokens: 4123, outputTokens: 1142, cachedInputTokens: 1121, totalTokens: 5265,
  providerCallCount: 3, providerRequestIds: ['resp_a', 'resp_b', 'resp_c'], ...over,
});

describe('reserved ≠ settled', () => {
  test('sem pricing: custo permanece unresolved e o teto NÃO vira custo', () => {
    const s = settlePaidComputeUsage({
      authorizedCeiling: { currency: 'USD', amount: 0.25 },
      reservedExposure: { currency: 'USD', amount: 0.25 },
      usage: usage(),
    });
    expect(s.settledCost).toEqual({ status: 'unresolved', reason: 'pricing_unversioned' });
    // As quatro grandezas ficam separadas: teto e reserva intactos, uso preservado.
    expect(s.authorizedCeiling).toEqual({ currency: 'USD', amount: 0.25 });
    expect(s.reservedExposure).toEqual({ currency: 'USD', amount: 0.25 });
    expect(s.usage.totalTokens).toBe(5265);
    expect(s.usage.providerRequestIds).toEqual(['resp_a', 'resp_b', 'resp_c']);
  });

  test('com pricing versionado: custo é resolvido (cache cobrado à parte)', () => {
    const pricing: TokenPricingV1 = {
      currency: 'USD', pricingRef: 'openai-2026-09@v1',
      inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.75,
    };
    const s = settlePaidComputeUsage({
      authorizedCeiling: { currency: 'USD', amount: 0.25 },
      reservedExposure: { currency: 'USD', amount: 0.25 },
      usage: usage({ inputTokens: 1_000_000, cachedInputTokens: 400_000, outputTokens: 200_000, totalTokens: 1_200_000 }),
      pricing,
    });
    // uncached 600k*3 + cached 400k*0.75 + output 200k*15, tudo por milhão.
    const expected = (600_000 / 1e6) * 3 + (400_000 / 1e6) * 0.75 + (200_000 / 1e6) * 15;
    expect(s.settledCost).toEqual({ status: 'resolved', currency: 'USD', amount: expected, pricingRef: 'openai-2026-09@v1' });
  });

  test('pricing sem taxa de cache usa a taxa de input (conservador)', () => {
    const s = settlePaidComputeUsage({
      authorizedCeiling: null, reservedExposure: null,
      usage: usage({ inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 0, totalTokens: 1_000_000 }),
      pricing: { currency: 'USD', pricingRef: 'p@1', inputPerMillion: 2, outputPerMillion: 8 },
    });
    expect(s.settledCost).toMatchObject({ status: 'resolved', amount: 2 }); // 1M input * 2 (cache à mesma taxa)
  });

  test('pricing inválido não fabrica custo', () => {
    const s = settlePaidComputeUsage({
      authorizedCeiling: null, reservedExposure: null, usage: usage(),
      pricing: { currency: 'USD', pricingRef: 'x', inputPerMillion: Number.NaN, outputPerMillion: 1 },
    });
    expect(s.settledCost).toEqual({ status: 'unresolved', reason: 'pricing_invalid' });
  });

  test('cost_per_verified: unresolved enquanto o custo é unresolved ou não há verificados', () => {
    const unresolved = settlePaidComputeUsage({ authorizedCeiling: null, reservedExposure: null, usage: usage() });
    expect(costPerVerifiedOutcome(unresolved, 1)).toEqual({ status: 'unresolved', reason: 'pricing_unversioned' });

    const resolved = settlePaidComputeUsage({
      authorizedCeiling: null, reservedExposure: null,
      usage: usage({ inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0, totalTokens: 1_000_000 }),
      pricing: { currency: 'USD', pricingRef: 'p@1', inputPerMillion: 10, outputPerMillion: 0 },
    });
    expect(costPerVerifiedOutcome(resolved, 0)).toEqual({ status: 'unresolved', reason: 'no_verified_outcomes' });
    expect(costPerVerifiedOutcome(resolved, 2)).toEqual({ status: 'resolved', currency: 'USD', amount: 5, pricingRef: 'p@1' });
  });
});
