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

// ============================================================
// Concessão/revogação/leitura owner-scoped para a UI humana. Toda decisão é ATO
// HUMANO: `grant`/`revoke` são as RPCs `SECURITY DEFINER` que exigem role
// `authenticated` (service_role é REVOKED — não fabrica autorização). A leitura é
// RLS select-own. Nenhuma credencial de provider passa por aqui — só o envelope
// de autorização (provider/node/classe/duração/custo/validade).
// ============================================================

/** Visão serializável de uma autorização para a UI. `active` = não revogada e agora
 * dentro da janela [validFrom, validUntil). */
export interface PaidComputeAuthorizationView {
  readonly id: string;
  readonly providerId: string;
  readonly nodeId: string | null;
  readonly resourceClass: string | null;
  readonly workItemId: string | null;
  readonly maxDurationMs: number;
  readonly maxCost: { readonly currency: string; readonly amount: number } | null;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly active: boolean;
}

export interface GrantPaidComputeAuthorizationInput {
  readonly providerId: string;
  readonly nodeId?: string | null;
  readonly resourceClass?: string | null;
  readonly workItemId?: string | null;
  readonly maxDurationMs: number;
  readonly maxCost?: { readonly currency: string; readonly amount: number } | null;
  readonly validFrom: string;
  readonly validUntil: string;
}

export type PaidComputeStoreError = { readonly ok: false; readonly code: string; readonly message: string };
export type GrantResult = { readonly ok: true; readonly authorizationId: string } | PaidComputeStoreError;
export type RevokeResult = { readonly ok: true; readonly authorizationId: string } | PaidComputeStoreError;

// Os tipos gerados do Supabase não modelam a nulabilidade dos ARGS de função
// (assumem todos obrigatórios/não-nulos); a função SQL aceita null nos opcionais.
type GrantArgs = Database['public']['Functions']['grant_paid_compute_authorization']['Args'];

/** SQLSTATE → código/UX estável. Fail-closed: desconhecido vira indisponível. */
const mapPgError = (error: { code?: string; message?: string } | null): PaidComputeStoreError => {
  const code = error?.code;
  const message = error?.message ?? 'Falha ao processar a autorização.';
  if (code === '42501') return { ok: false, code: 'forbidden', message };
  if (code === '22023') return { ok: false, code: 'invalid_input', message };
  if (code === 'P0002') return { ok: false, code: 'not_found', message };
  return { ok: false, code: 'unavailable', message };
};

const toView = (row: Database['public']['Tables']['paid_compute_authorizations']['Row'], now: Date): PaidComputeAuthorizationView => ({
  id: row.id,
  providerId: row.provider_id,
  nodeId: row.node_id,
  resourceClass: row.resource_class,
  workItemId: row.work_item_id,
  maxDurationMs: Number(row.max_duration_ms),
  maxCost: row.max_cost_currency === null || row.max_cost_amount === null
    ? null : { currency: row.max_cost_currency, amount: Number(row.max_cost_amount) },
  validFrom: row.valid_from,
  validUntil: row.valid_until,
  revokedAt: row.revoked_at,
  createdAt: row.created_at,
  active: row.revoked_at === null && now >= new Date(row.valid_from) && now < new Date(row.valid_until),
});

/** Lista as autorizações do usuário (RLS select-own), mais recentes primeiro. */
export async function listPaidComputeAuthorizations(
  client: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<{ readonly ok: true; readonly authorizations: readonly PaidComputeAuthorizationView[] } | PaidComputeStoreError> {
  const { data, error } = await client.from('paid_compute_authorizations').select('*')
    .order('created_at', { ascending: false }).limit(100);
  if (error) return mapPgError(error);
  return { ok: true, authorizations: (data ?? []).map(row => toView(row, now)) };
}

/** Concede uma autorização (ato humano; RPC exige role authenticated). */
export async function grantPaidComputeAuthorization(
  client: SupabaseClient<Database>,
  input: GrantPaidComputeAuthorizationInput,
): Promise<GrantResult> {
  const args = {
    provider_id: input.providerId,
    node_id: input.nodeId ?? null,
    resource_class: input.resourceClass ?? null,
    work_item_id: input.workItemId ?? null,
    max_duration_ms: input.maxDurationMs,
    max_cost_currency: input.maxCost?.currency ?? null,
    max_cost_amount: input.maxCost?.amount ?? null,
    valid_from: input.validFrom,
    valid_until: input.validUntil,
  } as unknown as GrantArgs;
  const { data, error } = await client.rpc('grant_paid_compute_authorization', args);
  if (error) return mapPgError(error);
  const authorizationId = (data as { authorization_id?: string } | null)?.authorization_id;
  if (!authorizationId) return { ok: false, code: 'unavailable', message: 'Concessão sem id de autorização.' };
  return { ok: true, authorizationId };
}

/** Revoga uma autorização (ato humano; idempotente; RPC exige role authenticated). */
export async function revokePaidComputeAuthorization(
  client: SupabaseClient<Database>,
  authorizationId: string,
): Promise<RevokeResult> {
  const { data, error } = await client.rpc('revoke_paid_compute_authorization', { authorization_id: authorizationId });
  if (error) return mapPgError(error);
  const id = (data as { authorization_id?: string } | null)?.authorization_id;
  if (!id) return { ok: false, code: 'unavailable', message: 'Revogação sem id de autorização.' };
  return { ok: true, authorizationId: id };
}
