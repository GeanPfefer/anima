/** @jest-environment node */
import { deriveAuthorityScope } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  grantPaidComputeAuthorization,
  listPaidComputeAuthorizations,
  listPaidComputeBudgetAudit,
  projectStoredPaidComputeAuthorization,
  revokePaidComputeAuthorization,
  settlePaidComputeBudgetReservation,
} from './paid-compute-authorization-store';

type BudgetEventRow = Database['public']['Tables']['paid_compute_budget_events']['Row'];
const budgetEvent = (over: Partial<BudgetEventRow>): BudgetEventRow => ({
  id: 'e', user_id: 'user-1', authorization_id: 'auth-1', reservation_id: 'r1', idempotency_key: 'k',
  event_type: 'reserved', provider_id: 'runpod', node_id: 'n', resource_class: null,
  work_item_id: 'w1', attempt_id: null, lease_id: 'lease-1', currency: 'USD', amount: 0.245,
  reason: null, created_at: '2026-09-10T00:00:00.000Z', ...over,
});

const auditClient = (
  auths: Array<{ id: string; max_cost_currency: string | null; max_cost_amount: number | null }>,
  events: BudgetEventRow[],
): SupabaseClient<Database> => ({
  from: (table: string) => {
    const rows = table === 'paid_compute_authorizations' ? auths : events;
    const chain: Record<string, unknown> = { select: () => chain, order: () => chain, limit: async () => ({ data: rows, error: null }) };
    return chain;
  },
} as unknown as SupabaseClient<Database>);

type Row = Database['public']['Tables']['paid_compute_authorizations']['Row'];

const row = (over: Partial<Row> = {}): Row => ({
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'user-1',
  provider_id: 'runpod',
  node_id: null,
  resource_class: null,
  capability_scope: null,
  work_item_id: null,
  max_duration_ms: 1_800_000,
  max_cost_currency: null,
  max_cost_amount: null,
  valid_from: '2026-08-31T00:00:00.000Z',
  valid_until: '2026-08-31T23:59:59.000Z',
  revoked_at: null,
  created_at: '2026-08-31T00:00:00.000Z',
  ...over,
});

const listClient = (rows: Row[], error: { code?: string; message?: string } | null = null): SupabaseClient<Database> => {
  const chain: Record<string, unknown> = {
    select: () => chain, order: () => chain, limit: async () => ({ data: rows, error }),
  };
  return { from: () => chain } as unknown as SupabaseClient<Database>;
};

const rpcClient = (result: { data: unknown; error: { code?: string; message?: string } | null }): { client: SupabaseClient<Database>; calls: Array<{ name: string; args: unknown }> } => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return result; } } as unknown as SupabaseClient<Database>;
  return { client, calls };
};

describe('paid-compute-authorization-store', () => {
  test('list mapeia envelope e calcula active dentro da janela, não revogada', async () => {
    const now = new Date('2026-08-31T12:00:00.000Z');
    const result = await listPaidComputeAuthorizations(listClient([
      row({ id: 'a', max_cost_currency: 'USD', max_cost_amount: 2.5, node_id: 'gpu-1', resource_class: 'gpu-24gb' }),
      row({ id: 'b', revoked_at: '2026-08-31T06:00:00.000Z' }),
      row({ id: 'c', valid_from: '2030-01-01T00:00:00.000Z', valid_until: '2030-01-02T00:00:00.000Z' }),
    ]), now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.authorizations[0]).toMatchObject({ id: 'a', providerId: 'runpod', nodeId: 'gpu-1', resourceClass: 'gpu-24gb', maxCost: { currency: 'USD', amount: 2.5 }, active: true });
    expect(result.authorizations[1]!.active).toBe(false); // revogada
    expect(result.authorizations[2]!.active).toBe(false); // ainda não começou
  });

  test('list propaga erro do banco como erro tipado', async () => {
    const result = await listPaidComputeAuthorizations(listClient([], { code: '42501', message: 'nope' }));
    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
  });

  test('grant repassa envelope à RPC (com nulls nos opcionais) e devolve o id', async () => {
    const { client, calls } = rpcClient({ data: { action: 'granted', authorization_id: 'new-id' }, error: null });
    const result = await grantPaidComputeAuthorization(client, {
      providerId: 'runpod', maxDurationMs: 60_000, validFrom: '2026-08-31T00:00:00.000Z', validUntil: '2026-08-31T01:00:00.000Z',
    });
    expect(result).toEqual({ ok: true, authorizationId: 'new-id' });
    expect(calls[0]!.name).toBe('grant_paid_compute_authorization');
    expect(calls[0]!.args).toMatchObject({ provider_id: 'runpod', node_id: null, resource_class: null, work_item_id: null, max_cost_currency: null, max_cost_amount: null });
  });

  test('grant inclui custo máximo quando fornecido', async () => {
    const { client, calls } = rpcClient({ data: { authorization_id: 'x' }, error: null });
    await grantPaidComputeAuthorization(client, {
      providerId: 'fly', nodeId: 'm1', resourceClass: 'gpu', workItemId: 'w1', maxDurationMs: 120_000,
      maxCost: { currency: 'USD', amount: 5 }, validFrom: 'a', validUntil: 'b',
    });
    expect(calls[0]!.args).toMatchObject({ node_id: 'm1', resource_class: 'gpu', work_item_id: 'w1', max_cost_currency: 'USD', max_cost_amount: 5 });
  });

  test('grant capability-based envia escopo e mantém resource_class nula', async () => {
    const { client, calls } = rpcClient({ data: { authorization_id: 'cap-x' }, error: null });
    const capabilityScope = { minimumVramGiB: 24, requiredGpuFeatures: ['cuda'], maxHourlyPrice: { currency: 'USD', amount: 0.8 }, maxNodes: 1 } as const;
    await grantPaidComputeAuthorization(client, {
      providerId: 'runpod', resourceClass: null, capabilityScope, workItemId: 'work-1',
      maxDurationMs: 1_800_000, maxCost: { currency: 'USD', amount: 1.5 },
      validFrom: '2026-09-10T00:00:00Z', validUntil: '2026-09-10T00:30:00Z',
    });
    expect(calls[0]!.args).toMatchObject({ resource_class: null, capability_scope: capabilityScope, work_item_id: 'work-1', max_cost_amount: 1.5 });
  });

  test('grant mapeia SQLSTATE de autorização humana negada (service_role) para forbidden', async () => {
    const { client } = rpcClient({ data: null, error: { code: '42501', message: 'human authenticated user required' } });
    const result = await grantPaidComputeAuthorization(client, { providerId: 'runpod', maxDurationMs: 1, validFrom: 'a', validUntil: 'b' });
    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
  });

  test('revoke chama a RPC idempotente e devolve o id', async () => {
    const { client, calls } = rpcClient({ data: { action: 'revoked', authorization_id: 'r1' }, error: null });
    const result = await revokePaidComputeAuthorization(client, 'r1');
    expect(result).toEqual({ ok: true, authorizationId: 'r1' });
    expect(calls[0]).toEqual({ name: 'revoke_paid_compute_authorization', args: { authorization_id: 'r1' } });
  });

  test('revoke de item inexistente/alheio → not_found', async () => {
    const { client } = rpcClient({ data: null, error: { code: 'P0002', message: 'authorization not found' } });
    expect(await revokePaidComputeAuthorization(client, 'r1')).toMatchObject({ ok: false, code: 'not_found' });
  });

  test('settle repassa custo/fonte à RPC e devolve custo liquidado + excesso liberado', async () => {
    const { client, calls } = rpcClient({ data: { action: 'settled', settled_amount: 0.0825, released: 0.1625, currency: 'USD', cost_source: 'estimated' }, error: null });
    const result = await settlePaidComputeBudgetReservation(client, { reservationId: 'r1', settled: { currency: 'USD', amount: 0.0825 }, costSource: 'estimated' });
    expect(result).toEqual({ ok: true, action: 'settled', settledAmount: 0.0825, releasedExcess: 0.1625, currency: 'USD', costSource: 'estimated' });
    expect(calls[0]!.name).toBe('settle_paid_compute_budget_reservation');
    expect(calls[0]!.args).toMatchObject({ reservation_id: 'r1', settled_currency: 'USD', settled_amount: 0.0825, cost_source: 'estimated' });
  });

  test('settle mapeia invariante violada (SQLSTATE 22023) para invalid_input', async () => {
    const { client } = rpcClient({ data: null, error: { code: '22023', message: 'settlement exceeds reservation' } });
    expect(await settlePaidComputeBudgetReservation(client, { reservationId: 'r1', settled: { currency: 'USD', amount: 99 }, costSource: 'estimated' }))
      .toMatchObject({ ok: false, code: 'invalid_input' });
  });
});

describe('listPaidComputeBudgetAudit — settlement reflete custo efetivo, não exposição máxima', () => {
  test('reserva liquidada: committed cai para o custo efetivo e o excesso é exposto por reserva', async () => {
    const result = await listPaidComputeBudgetAudit(auditClient(
      [{ id: 'auth-1', max_cost_currency: 'USD', max_cost_amount: 1.5 }],
      [
        budgetEvent({ event_type: 'reserved', reservation_id: 'r1', lease_id: 'lease-a', amount: 0.245 }),
        budgetEvent({ event_type: 'settled', reservation_id: 'r1', lease_id: 'lease-a', amount: 0.1625, reason: 'estimated' }),
        budgetEvent({ event_type: 'reserved', reservation_id: 'r2', lease_id: 'lease-b', amount: 0.245 }),
      ],
    ));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const b = result.budgets[0]!;
    // committed = 0.49 reservado − 0 voidado − 0.1625 excesso liberado = 0.3275.
    expect(b.reserved).toBeCloseTo(0.49, 6);
    expect(b.settledExcess).toBeCloseTo(0.1625, 6);
    expect(b.committed).toBeCloseTo(0.3275, 6);
    expect(b.remaining).toBeCloseTo(1.5 - 0.3275, 6);
    const settled = b.reservations.find(r => r.reservationId === 'r1')!;
    expect(settled).toMatchObject({ settled: true, costSource: 'estimated', releasedExcess: 0.1625 });
    expect(settled.settledCost).toBeCloseTo(0.0825, 6);
    const open = b.reservations.find(r => r.reservationId === 'r2')!;
    expect(open).toMatchObject({ settled: false, settledCost: null, costSource: null });
  });
});

describe('projectStoredPaidComputeAuthorization — Cloud Resource Matching V1 (leitura por capacidade)', () => {
  const withCost = (over: Partial<Row> = {}): Row => row({ max_cost_currency: 'USD', max_cost_amount: 1.5, ...over });

  test('capability_scope presente (resource_class NULL) → autoridade por capacidade LIMITADA, nunca ilimitada', () => {
    const parsed = projectStoredPaidComputeAuthorization({
      ...withCost({ resource_class: null }),
      capability_scope: { minimumVramGiB: 24, requiredGpuFeatures: ['cuda'], maxHourlyPrice: null, maxNodes: 1 },
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.capabilityScope).toEqual({ minimumVramGiB: 24, requiredGpuFeatures: ['cuda'], maxHourlyPrice: null, maxNodes: 1 });
    // A projeção NÃO pode virar "qualquer recurso do provider": o escopo derivado é bounded.
    expect(deriveAuthorityScope(parsed!)).toMatchObject({ kind: 'capability_bounds', providerId: 'runpod' });
  });

  test('SKU-fixa (resource_class, sem capability_scope) → escopo fixo, retrocompatível', () => {
    const parsed = projectStoredPaidComputeAuthorization(withCost({ resource_class: 'gpu-a40-48gb' }));
    expect(parsed).not.toBeNull();
    expect(deriveAuthorityScope(parsed!)).toEqual({ kind: 'fixed_resource_class', providerId: 'runpod', resourceClass: 'gpu-a40-48gb' });
  });

  test('coluna ausente (banco pré-migração) → capabilityScope null, comportamento idêntico ao anterior', () => {
    const parsed = projectStoredPaidComputeAuthorization(withCost({ resource_class: null })); // sem campo capability_scope
    expect(parsed).not.toBeNull();
    expect(parsed!.capabilityScope).toBeNull();
    expect(deriveAuthorityScope(parsed!)).toEqual({ kind: 'any_provider_resource', providerId: 'runpod' });
  });

  test('malformado: resource_class E capability_scope juntos → null (fail-closed, exclusividade)', () => {
    const parsed = projectStoredPaidComputeAuthorization({
      ...withCost({ resource_class: 'gpu-a40-48gb' }),
      capability_scope: { minimumVramGiB: 24, requiredGpuFeatures: ['cuda'], maxHourlyPrice: null, maxNodes: 1 },
    });
    expect(parsed).toBeNull();
  });
});
