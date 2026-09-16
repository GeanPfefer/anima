/** @jest-environment node */
import { deriveQwen3CoderCloudRequirements, type CloudResourceCandidateV1, type PaidComputeAuthorizationV1 } from '@anima/core';
import { describeCloudResourcePlan, planCloudResourceProvisioning } from './cloud-resource-plan';
import type { RunPodInventoryResult } from './runpod-price-quote';

const HALF_HOUR_MS = 30 * 60_000;

const auth = (overrides: Partial<PaidComputeAuthorizationV1> = {}): PaidComputeAuthorizationV1 => ({
  schemaVersion: 1, authorizationId: 'auth-8a2515d8', authorizedBy: 'user-gean', authorizedByAuthor: 'user',
  providerId: 'runpod', nodeId: 'runpod-a40-test2', resourceClass: 'gpu-a40-48gb', workItemId: '8a2515d8',
  maxDurationMs: 30 * 60_000, maxCostEstimate: { currency: 'USD', amount: 1.5 },
  validFrom: '2026-09-09T00:00:00Z', validUntil: '2026-09-09T23:59:59Z',
  ...overrides,
});

const candidate = (gpuTypeId: string, resourceClass: string, vramGiB: number, amount: number | null, availability: 'available' | 'unavailable' = 'available') => ({
  providerId: 'runpod', resourceClass, gpuTypeId, displayName: gpuTypeId, vramGiB,
  gpuFeatures: ['cuda'] as const, availability, perHour: amount === null ? null : { currency: 'USD', amount },
});

const inventory = (candidates: readonly CloudResourceCandidateV1[]): (() => Promise<RunPodInventoryResult>) =>
  async () => ({ ok: true, candidates });

describe('planCloudResourceProvisioning — composição sem efeito', () => {
  const requirements = deriveQwen3CoderCloudRequirements({ maxEstimatedCost: { currency: 'USD', amount: 1.5 } });

  test('autoridade A40-fixa + só A6000 disponível → authority_scope_insufficient (não escolhe outra GPU)', async () => {
    const plan = await planCloudResourceProvisioning({
      requirements, authorization: auth(), leaseDurationMs: HALF_HOUR_MS,
      readInventory: inventory([
        candidate('NVIDIA A40', 'gpu-a40-48gb', 48, null, 'unavailable'),
        candidate('NVIDIA RTX A6000', 'gpu-rtx-a6000-48gb', 48, 0.44),
      ]),
    });
    expect(plan).toMatchObject({ ok: false, blocker: 'authority_scope_insufficient' });
    expect(plan.authorityScope).toEqual({ kind: 'fixed_resource_class', providerId: 'runpod', resourceClass: 'gpu-a40-48gb' });
  });

  test('autoridade por capacidade + A40 indisponível → escolhe alternativa compatível mais barata', async () => {
    const capAuth = auth({ resourceClass: null, capabilityScope: { minimumVramGiB: 24, requiredGpuFeatures: ['cuda'], maxHourlyPrice: { currency: 'USD', amount: 1 }, maxNodes: 1 } });
    const plan = await planCloudResourceProvisioning({
      requirements, authorization: capAuth, leaseDurationMs: HALF_HOUR_MS,
      readInventory: inventory([
        candidate('NVIDIA A40', 'gpu-a40-48gb', 48, null, 'unavailable'),
        candidate('NVIDIA RTX A6000', 'gpu-rtx-a6000-48gb', 48, 0.44),
        candidate('NVIDIA L40S', 'gpu-l40s-48gb', 48, 0.79),
      ]),
    });
    expect(plan).toMatchObject({ ok: true, chosen: { candidate: { gpuTypeId: 'NVIDIA RTX A6000' } } });
    expect(plan.authorityScope.kind).toBe('capability_bounds');
  });

  test('falha de leitura do inventário → provider_inventory_unavailable com motivo preservado', async () => {
    const plan = await planCloudResourceProvisioning({
      requirements, authorization: auth(), leaseDurationMs: HALF_HOUR_MS,
      readInventory: async () => ({ ok: false, reason: 'provider_unreachable' }),
    });
    expect(plan).toMatchObject({ ok: false, blocker: 'provider_inventory_unavailable', detail: 'inventory_read:provider_unreachable' });
  });
});

describe('describeCloudResourcePlan — relatório de seleção (Cloud GPU Test #2)', () => {
  const requirements = deriveQwen3CoderCloudRequirements({ maxEstimatedCost: { currency: 'USD', amount: 1.5 } });
  const capAuth = auth({ resourceClass: null, capabilityScope: { minimumVramGiB: 24, requiredGpuFeatures: ['cuda'], maxHourlyPrice: { currency: 'USD', amount: 1 }, maxNodes: 1 } });

  test('seleção: registra requisitos, escolhido, VRAM/preço, rationale e rejeitados COM razão', async () => {
    const plan = await planCloudResourceProvisioning({
      requirements, authorization: capAuth, leaseDurationMs: HALF_HOUR_MS,
      readInventory: inventory([
        candidate('NVIDIA A40', 'gpu-a40-48gb', 48, null, 'unavailable'),
        candidate('NVIDIA RTX A6000', 'gpu-rtx-a6000-48gb', 48, 0.44),
        candidate('NVIDIA T4', 'gpu-t4-16gb', 16, 0.2),
      ]),
    });
    const report = describeCloudResourcePlan(plan, requirements);
    expect(report.requirements).toMatchObject({ model: 'qwen3-coder:latest', minimumVramGiB: 24, requiredGpuFeatures: ['cuda'] });
    expect(report.authorityScope.kind).toBe('capability_bounds');
    expect(report.outcome).toMatchObject({ kind: 'selected', gpuTypeId: 'NVIDIA RTX A6000', vramGiB: 48, perHour: { currency: 'USD', amount: 0.44 }, estimatedCost: { currency: 'USD', amount: 0.22 } });
    // A40 (indisponível) e T4 (VRAM insuficiente) ficam registrados como rejeitados com a razão.
    const a40 = report.rejected.find(r => r.gpuTypeId === 'NVIDIA A40');
    const t4 = report.rejected.find(r => r.gpuTypeId === 'NVIDIA T4');
    expect(a40?.reasons).toContain('unavailable');
    expect(a40?.reasons).toContain('price_unknown');
    expect(t4?.reasons).toContain('vram_below_minimum');
    expect(report.consideredCount).toBe(3);
  });

  test('blocker: registra requisitos + blocker + detalhe (sem escolhido)', async () => {
    const plan = await planCloudResourceProvisioning({
      requirements, authorization: auth(), leaseDurationMs: HALF_HOUR_MS, // autoridade A40-fixa
      readInventory: inventory([
        candidate('NVIDIA A40', 'gpu-a40-48gb', 48, null, 'unavailable'),
        candidate('NVIDIA RTX A6000', 'gpu-rtx-a6000-48gb', 48, 0.44),
      ]),
    });
    const report = describeCloudResourcePlan(plan, requirements);
    expect(report.outcome).toMatchObject({ kind: 'blocked', blocker: 'authority_scope_insufficient' });
    expect(report.authorityScope).toEqual({ kind: 'fixed_resource_class', providerId: 'runpod', resourceClass: 'gpu-a40-48gb' });
  });
});
