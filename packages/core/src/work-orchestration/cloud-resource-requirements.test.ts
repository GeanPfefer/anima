import {
  CLOUD_VRAM_OPERATIONAL_MARGIN,
  QWEN3_CODER_OBSERVED_VRAM_GIB,
  deriveMinimumVramGiB,
  deriveQwen3CoderCloudRequirements,
} from './cloud-resource-requirements';

describe('deriveMinimumVramGiB — piso derivado de evidência + margem, nunca SKU fixa', () => {
  test('aplica margem operacional sobre a VRAM de pesos observada e arredonda para cima', () => {
    // Evidência Bobcat: 18.8 GiB de pesos; margem 1.25 ⇒ 23.5 ⇒ ceil = 24.
    expect(deriveMinimumVramGiB(QWEN3_CODER_OBSERVED_VRAM_GIB, CLOUD_VRAM_OPERATIONAL_MARGIN)).toBe(24);
  });
  test('entradas inválidas → NaN (fail-safe, não inventa piso)', () => {
    expect(Number.isNaN(deriveMinimumVramGiB(0))).toBe(true);
    expect(Number.isNaN(deriveMinimumVramGiB(18.8, 0.5))).toBe(true);
  });
});

describe('deriveQwen3CoderCloudRequirements — requisitos por capacidade, não por SKU', () => {
  test('piso de VRAM sai da evidência (24 GiB), NÃO dos 48 GiB da A40', () => {
    const req = deriveQwen3CoderCloudRequirements();
    expect(req.minimumVramGiB).toBe(24);
    expect(req.minimumVramGiB).toBeLessThan(48);
    expect(req.strategy).toBe('cloud_self_hosted');
    expect(req.requiredGpuFeatures).toEqual(['cuda']);
    expect(req.maxNodes).toBe(1);
  });
  test('overrides ajustam tetos e restrições sem reintroduzir SKU fixa', () => {
    const req = deriveQwen3CoderCloudRequirements({
      maxHourlyPrice: { currency: 'USD', amount: 0.6 },
      maxEstimatedCost: { currency: 'USD', amount: 0.3 },
      maxNodes: 1,
      providerConstraints: { allowedProviderIds: ['runpod'], cloudType: 'SECURE' },
    });
    expect(req.maxHourlyPrice).toEqual({ currency: 'USD', amount: 0.6 });
    expect(req.providerConstraints).toEqual({ allowedProviderIds: ['runpod'], cloudType: 'SECURE' });
    expect(req).not.toHaveProperty('resourceClass');
  });
});
