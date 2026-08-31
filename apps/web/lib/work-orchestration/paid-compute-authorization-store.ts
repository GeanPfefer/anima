import { parsePaidComputeAuthorization, type PaidComputeAuthorizationV1 } from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function readActivePaidComputeAuthorization(
  client: SupabaseClient<Database>,
  input: { readonly providerId: string; readonly nodeId: string; readonly resourceClass: string | null; readonly workItemId: string; readonly now: Date },
): Promise<PaidComputeAuthorizationV1 | null> {
  const { data, error } = await client.from('paid_compute_authorizations').select('*')
    .eq('provider_id', input.providerId).is('revoked_at', null)
    .lte('valid_from', input.now.toISOString()).gt('valid_until', input.now.toISOString())
    .order('created_at', { ascending: false }).limit(20);
  if (error) return null;
  for (const row of data ?? []) {
    if (row.node_id !== null && row.node_id !== input.nodeId) continue;
    if (row.resource_class !== null && row.resource_class !== input.resourceClass) continue;
    if (row.work_item_id !== null && row.work_item_id !== input.workItemId) continue;
    const parsed = parsePaidComputeAuthorization({
      schemaVersion: 1,
      authorizationId: row.id,
      authorizedBy: row.user_id,
      authorizedByAuthor: 'user',
      providerId: row.provider_id,
      nodeId: row.node_id,
      resourceClass: row.resource_class,
      workItemId: row.work_item_id,
      maxDurationMs: Number(row.max_duration_ms),
      maxCostEstimate: row.max_cost_currency === null ? null : { currency: row.max_cost_currency, amount: Number(row.max_cost_amount) },
      validFrom: row.valid_from,
      validUntil: row.valid_until,
    } as unknown as Json);
    if (parsed) return parsed;
  }
  return null;
}
