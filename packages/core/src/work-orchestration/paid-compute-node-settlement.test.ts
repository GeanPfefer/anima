import { settleNodeLeaseCost } from './paid-compute-node-settlement';

describe('settleNodeLeaseCost', () => {
  test('estimativa preço/h × vida faturável libera o excesso da reserva conservadora', () => {
    // Cenário da barreira 2026-09-10: reserva 0.245 (30 min @ 0.49/h), Pod viveu ~606s.
    const s = settleNodeLeaseCost({
      reserved: { currency: 'USD', amount: 0.245 },
      billableDurationMs: 606_000,
      priceHint: { currency: 'USD', perHour: 0.49 },
    });
    expect(s).not.toBeNull();
    // 0.49 * 606/3600 = 0.08248...; arredondado PARA CIMA a 0.0001 = 0.0825.
    expect(s!.source).toBe('estimated');
    expect(s!.settledAmount).toBeCloseTo(0.0825, 6);
    expect(s!.releasedExcess).toBeCloseTo(0.245 - 0.0825, 6);
    expect(s!.settledAmount + s!.releasedExcess).toBeCloseTo(0.245, 9);
  });

  test('arredondamento é conservador (para CIMA), nunca sub-reporta o custo', () => {
    const s = settleNodeLeaseCost({
      reserved: { currency: 'USD', amount: 1 },
      billableDurationMs: 600_100, // custo bruto ligeiramente acima de um múltiplo do incremento
      priceHint: { currency: 'USD', perHour: 0.49 },
    })!;
    const raw = 0.49 * (600_100 / 3_600_000);
    expect(s.settledAmount).toBeGreaterThanOrEqual(raw);
    expect(s.settledAmount - raw).toBeLessThanOrEqual(0.0001 + 1e-9);
  });

  test('custo confirmado pelo provider é preferido e marcado provider_confirmed', () => {
    const s = settleNodeLeaseCost({
      reserved: { currency: 'USD', amount: 0.245 },
      billableDurationMs: 606_000,
      priceHint: { currency: 'USD', perHour: 0.49 },
      providerConfirmedCost: { currency: 'USD', amount: 0.09 },
    })!;
    expect(s.source).toBe('provider_confirmed');
    expect(s.settledAmount).toBe(0.09);
    expect(s.releasedExcess).toBeCloseTo(0.155, 9);
  });

  test('settlement nunca excede a reserva (clamp a R)', () => {
    const confirmed = settleNodeLeaseCost({
      reserved: { currency: 'USD', amount: 0.1 },
      billableDurationMs: 0,
      priceHint: { currency: 'USD', perHour: 0 },
      providerConfirmedCost: { currency: 'USD', amount: 0.5 }, // acima da reserva
    })!;
    expect(confirmed.settledAmount).toBe(0.1);
    expect(confirmed.releasedExcess).toBe(0);

    const estimated = settleNodeLeaseCost({
      reserved: { currency: 'USD', amount: 0.1 },
      billableDurationMs: 3_600_000, // 1h @ 0.49 = 0.49 > reserva
      priceHint: { currency: 'USD', perHour: 0.49 },
    })!;
    expect(estimated.settledAmount).toBe(0.1);
    expect(estimated.releasedExcess).toBe(0);
  });

  test('settlement nunca gera committed negativo (S ≥ 0)', () => {
    const s = settleNodeLeaseCost({
      reserved: { currency: 'USD', amount: 0.245 },
      billableDurationMs: 0,
      priceHint: { currency: 'USD', perHour: 0.49 },
    })!;
    expect(s.settledAmount).toBe(0);
    expect(s.releasedExcess).toBeCloseTo(0.245, 9);
  });

  test('sem preço utilizável → conservador: mantém a reserva inteira (não inventa número menor)', () => {
    const noHint = settleNodeLeaseCost({ reserved: { currency: 'USD', amount: 0.245 }, billableDurationMs: 606_000, priceHint: null })!;
    expect(noHint.settledAmount).toBe(0.245);
    expect(noHint.releasedExcess).toBe(0);
    // preço em outra moeda também é inutilizável para a reserva
    const wrongCurrency = settleNodeLeaseCost({ reserved: { currency: 'USD', amount: 0.245 }, billableDurationMs: 606_000, priceHint: { currency: 'EUR', perHour: 0.49 } })!;
    expect(wrongCurrency.settledAmount).toBe(0.245);
  });

  test('custo confirmado em outra moeda é ignorado e cai na estimativa', () => {
    const s = settleNodeLeaseCost({
      reserved: { currency: 'USD', amount: 0.245 },
      billableDurationMs: 606_000,
      priceHint: { currency: 'USD', perHour: 0.49 },
      providerConfirmedCost: { currency: 'EUR', amount: 0.09 },
    })!;
    expect(s.source).toBe('estimated');
  });

  test('reserva inválida → null (fail-closed; caller mantém reserva conservadora)', () => {
    expect(settleNodeLeaseCost({ reserved: { currency: 'USD', amount: 0 }, billableDurationMs: 1, priceHint: null })).toBeNull();
    expect(settleNodeLeaseCost({ reserved: { currency: '', amount: 1 }, billableDurationMs: 1, priceHint: null })).toBeNull();
  });
});
