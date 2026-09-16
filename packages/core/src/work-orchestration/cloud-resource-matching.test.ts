import {
  deriveAuthorityScope,
  matchCloudResource,
  type CloudResourceAuthorityScopeV1,
  type CloudResourceCandidateV1,
} from './cloud-resource-matching';
import { deriveQwen3CoderCloudRequirements, type CloudComputeRequirementsV1 } from './cloud-resource-requirements';
import type { PaidComputeAuthorizationV1 } from './paid-compute-authorization';

const HALF_HOUR_MS = 30 * 60_000;

const requirements = (overrides: Partial<Parameters<typeof deriveQwen3CoderCloudRequirements>[0]> = {}): CloudComputeRequirementsV1 =>
  deriveQwen3CoderCloudRequirements(overrides);

const candidate = (overrides: Partial<CloudResourceCandidateV1> = {}): CloudResourceCandidateV1 => ({
  providerId: 'runpod',
  resourceClass: 'gpu-a40-48gb',
  gpuTypeId: 'NVIDIA A40',
  displayName: 'A40',
  vramGiB: 48,
  gpuFeatures: ['cuda'],
  availability: 'available',
  perHour: { currency: 'USD', amount: 0.49 },
  ...overrides,
});

const A40 = candidate();
const A6000 = candidate({ resourceClass: 'gpu-a6000-48gb', gpuTypeId: 'NVIDIA RTX A6000', displayName: 'A6000', vramGiB: 48, perHour: { currency: 'USD', amount: 0.44 } });
const L40S = candidate({ resourceClass: 'gpu-l40s-48gb', gpuTypeId: 'NVIDIA L40S', displayName: 'L40S', vramGiB: 48, perHour: { currency: 'USD', amount: 0.79 } });
const A100 = candidate({ resourceClass: 'gpu-a100-80gb', gpuTypeId: 'NVIDIA A100 80GB', displayName: 'A100', vramGiB: 80, perHour: { currency: 'USD', amount: 1.19 } });
const T4 = candidate({ resourceClass: 'gpu-t4-16gb', gpuTypeId: 'NVIDIA T4', displayName: 'T4', vramGiB: 16, perHour: { currency: 'USD', amount: 0.2 } });

const fixedA40Scope: CloudResourceAuthorityScopeV1 = { kind: 'fixed_resource_class', providerId: 'runpod', resourceClass: 'gpu-a40-48gb' };
const capabilityScope: CloudResourceAuthorityScopeV1 = { kind: 'capability_bounds', providerId: 'runpod', scope: { minimumVramGiB: 24, requiredGpuFeatures: ['cuda'], maxHourlyPrice: null, maxNodes: 1 } };
const anyScope: CloudResourceAuthorityScopeV1 = { kind: 'any_provider_resource', providerId: 'runpod' };

const match = (inventory: readonly CloudResourceCandidateV1[] | null, scope: CloudResourceAuthorityScopeV1, req = requirements()) =>
  matchCloudResource({ requirements: req, inventory, authorityScope: scope, leaseDurationMs: HALF_HOUR_MS });

describe('deriveAuthorityScope — projeta a autoridade humana sem ampliar', () => {
  const base: PaidComputeAuthorizationV1 = {
    schemaVersion: 1, authorizationId: 'a', authorizedBy: 'u', authorizedByAuthor: 'user', providerId: 'runpod',
    nodeId: null, resourceClass: 'gpu-a40-48gb', workItemId: null, maxDurationMs: 1, maxCostEstimate: null,
    validFrom: '2026-01-01T00:00:00Z', validUntil: '2026-01-02T00:00:00Z',
  };
  test('resourceClass não-nulo → SKU fixa', () => {
    expect(deriveAuthorityScope(base)).toEqual({ kind: 'fixed_resource_class', providerId: 'runpod', resourceClass: 'gpu-a40-48gb' });
  });
  test('capabilityScope presente (resourceClass null) → capability bounds', () => {
    const scope = { minimumVramGiB: 24, requiredGpuFeatures: ['cuda'], maxHourlyPrice: null, maxNodes: 1 };
    expect(deriveAuthorityScope({ ...base, resourceClass: null, capabilityScope: scope }))
      .toEqual({ kind: 'capability_bounds', providerId: 'runpod', scope });
  });
  test('ambos nulos → qualquer recurso do provider', () => {
    expect(deriveAuthorityScope({ ...base, resourceClass: null, capabilityScope: null }))
      .toEqual({ kind: 'any_provider_resource', providerId: 'runpod' });
  });
});

describe('matchCloudResource — seleção tática', () => {
  test('1) A40 disponível e adequada sob autoridade A40 → seleciona A40', () => {
    const result = match([A40], fixedA40Scope);
    expect(result).toMatchObject({ ok: true, chosen: { candidate: { gpuTypeId: 'NVIDIA A40' }, estimatedCost: { currency: 'USD', amount: 0.245 } } });
  });

  test('2) A40 indisponível + outra GPU compatível → seleciona a alternativa', () => {
    const result = match([{ ...A40, availability: 'unavailable' }, A6000], capabilityScope);
    expect(result).toMatchObject({ ok: true, chosen: { candidate: { gpuTypeId: 'NVIDIA RTX A6000' } } });
    if (result.ok) expect(result.eliminated.map(e => e.candidate.gpuTypeId)).toEqual(['NVIDIA A40']);
  });

  test('3) múltiplas GPUs compatíveis → ranking determinístico pelo menor custo', () => {
    const result = match([L40S, A100, A6000], capabilityScope);
    expect(result).toMatchObject({ ok: true, chosen: { candidate: { gpuTypeId: 'NVIDIA RTX A6000' } } });
    if (result.ok) expect(result.chosen.rationale.survivorsConsidered).toBe(3);
  });

  test('3a) teto US$1/h mantém a mais barata quando várias estão disponíveis', () => {
    const bounded: CloudResourceAuthorityScopeV1 = { kind: 'capability_bounds', providerId: 'runpod', scope: { minimumVramGiB: 24, requiredGpuFeatures: ['cuda'], maxHourlyPrice: { currency: 'USD', amount: 1 }, maxNodes: 1 } };
    const result = match([L40S, A40, A6000], bounded, requirements({ maxHourlyPrice: { currency: 'USD', amount: 1 } }));
    expect(result).toMatchObject({ ok: true, chosen: { candidate: { gpuTypeId: 'NVIDIA RTX A6000' } } });
  });

  test('3aa) teto US$1/h usa SKU mais cara somente quando as mais baratas estão indisponíveis', () => {
    const bounded: CloudResourceAuthorityScopeV1 = { kind: 'capability_bounds', providerId: 'runpod', scope: { minimumVramGiB: 24, requiredGpuFeatures: ['cuda'], maxHourlyPrice: { currency: 'USD', amount: 1 }, maxNodes: 1 } };
    const result = match([{ ...A6000, availability: 'unavailable' }, { ...A40, availability: 'unavailable' }, L40S], bounded, requirements({ maxHourlyPrice: { currency: 'USD', amount: 1 } }));
    expect(result).toMatchObject({ ok: true, chosen: { candidate: { gpuTypeId: 'NVIDIA L40S' }, estimatedCost: { currency: 'USD', amount: 0.395 } } });
  });

  test('3b) empate de custo → desempata pelo MENOR excesso de VRAM', () => {
    const cheapBig = candidate({ resourceClass: 'gpu-x-80gb', gpuTypeId: 'GPU-X-80', vramGiB: 80, perHour: { currency: 'USD', amount: 0.44 } });
    const cheapSmall = candidate({ resourceClass: 'gpu-y-48gb', gpuTypeId: 'GPU-Y-48', vramGiB: 48, perHour: { currency: 'USD', amount: 0.44 } });
    const result = match([cheapBig, cheapSmall], capabilityScope);
    expect(result).toMatchObject({ ok: true, chosen: { candidate: { gpuTypeId: 'GPU-Y-48' } } });
  });

  test('4) GPU barata mas VRAM insuficiente → NÃO escolhida (fica em eliminated), escolhe a adequada', () => {
    const result = match([T4, A6000], capabilityScope);
    expect(result).toMatchObject({ ok: true, chosen: { candidate: { gpuTypeId: 'NVIDIA RTX A6000' } } });
    if (result.ok) {
      const t4 = result.eliminated.find(e => e.candidate.gpuTypeId === 'NVIDIA T4');
      expect(t4?.reasons).toContain('vram_below_minimum');
    }
  });

  test('5) GPU compatível mas acima do budget → rejeitada (all_exceed_budget)', () => {
    const req = requirements({ maxHourlyPrice: { currency: 'USD', amount: 0.5 } });
    const result = match([A100], capabilityScope, req);
    expect(result).toMatchObject({ ok: false, blocker: 'all_exceed_budget' });
    if (!result.ok) expect(result.eliminated.some(e => e.reasons.includes('above_hourly_price'))).toBe(true);
  });

  test('5b) custo estimado da lease acima do teto agregado → all_exceed_budget', () => {
    const req = requirements({ maxEstimatedCost: { currency: 'USD', amount: 0.1 } });
    const result = match([A6000], capabilityScope, req); // 0.44 * 0.5h = 0.22 > 0.1
    expect(result).toMatchObject({ ok: false, blocker: 'all_exceed_budget' });
    if (!result.ok) expect(result.eliminated.some(e => e.reasons.includes('above_estimated_cost'))).toBe(true);
  });

  test('6) nenhuma GPU compatível → blocker explícito no_compatible_cloud_resource', () => {
    expect(match([T4], capabilityScope)).toMatchObject({ ok: false, blocker: 'no_compatible_cloud_resource' });
    expect(match([], capabilityScope)).toMatchObject({ ok: false, blocker: 'no_compatible_cloud_resource' });
  });

  test('7) autoridade fixa em A40: A40 indisponível + A6000 compatível → NÃO usa A6000 (authority_scope_insufficient)', () => {
    const result = match([{ ...A40, availability: 'unavailable' }, A6000], fixedA40Scope);
    expect(result).toMatchObject({ ok: false, blocker: 'authority_scope_insufficient' });
    if (!result.ok) {
      const a6000 = result.eliminated.find(e => e.candidate.gpuTypeId === 'NVIDIA RTX A6000');
      expect(a6000?.reasons).toContain('outside_authority_scope');
    }
  });

  test('8) autoridade por capacidade → permite candidato compatível dentro dos limites', () => {
    const bounded: CloudResourceAuthorityScopeV1 = { kind: 'capability_bounds', providerId: 'runpod', scope: { minimumVramGiB: 24, requiredGpuFeatures: ['cuda'], maxHourlyPrice: { currency: 'USD', amount: 0.6 }, maxNodes: 1 } };
    const result = match([A6000, A100], bounded); // A100 @1.19 fora do teto horário do escopo; A6000 dentro
    expect(result).toMatchObject({ ok: true, chosen: { candidate: { gpuTypeId: 'NVIDIA RTX A6000' } } });
    if (result.ok) {
      const a100 = result.eliminated.find(e => e.candidate.gpuTypeId === 'NVIDIA A100 80GB');
      expect(a100?.reasons).toContain('outside_authority_scope');
    }
  });

  test('12) inventário null → fail-closed provider_inventory_unavailable', () => {
    expect(match(null, capabilityScope)).toMatchObject({ ok: false, blocker: 'provider_inventory_unavailable' });
  });

  test('13) cotação individual indisponível (perHour null) não interrompe a avaliação dos outros', () => {
    const priceless = candidate({ resourceClass: 'gpu-a40-48gb', gpuTypeId: 'NVIDIA A40', perHour: null });
    const result = match([priceless, A6000], capabilityScope);
    expect(result).toMatchObject({ ok: true, chosen: { candidate: { gpuTypeId: 'NVIDIA RTX A6000' } } });
    if (result.ok) {
      const p = result.eliminated.find(e => e.candidate.gpuTypeId === 'NVIDIA A40');
      expect(p?.reasons).toContain('price_unknown');
    }
  });

  test('provider proibido por constraint → provider_mismatch (não é candidato compatível)', () => {
    const req = requirements({ providerConstraints: { allowedProviderIds: ['aws'], cloudType: null } });
    const result = match([A6000], anyScope, req);
    expect(result).toMatchObject({ ok: false, blocker: 'no_compatible_cloud_resource' });
    if (!result.ok) expect(result.eliminated.some(e => e.reasons.includes('provider_mismatch'))).toBe(true);
  });
});
