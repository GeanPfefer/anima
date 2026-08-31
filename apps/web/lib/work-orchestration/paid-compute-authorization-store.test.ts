/** @jest-environment node */
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  grantPaidComputeAuthorization,
  listPaidComputeAuthorizations,
  revokePaidComputeAuthorization,
} from './paid-compute-authorization-store';

type Row = Database['public']['Tables']['paid_compute_authorizations']['Row'];

const row = (over: Partial<Row> = {}): Row => ({
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'user-1',
  provider_id: 'runpod',
  node_id: null,
  resource_class: null,
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
});
