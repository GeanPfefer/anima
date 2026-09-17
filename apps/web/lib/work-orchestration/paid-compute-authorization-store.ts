import { parsePaidComputeAuthorization, type CloudCapabilityScopeV1, type NodeCostSourceV1, type PaidComputeAuthorizationV1 } from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

type StoredPaidComputeAuthorizationRow = Database['public']['Tables']['paid_compute_authorizations']['Row'];

/**
 * Projeta uma linha persistida em `PaidComputeAuthorizationV1`, INCLUINDO o escopo por capacidade
 * quando presente. DEFENSIVO e RETROCOMPATÍVEL: antes da migração 20260910000000 a coluna não
 * existe, `capability_scope` vem `undefined` e é projetada como `null` (comportamento idêntico ao
 * anterior). O parser do core aplica a exclusividade SKU-fixa XOR capacidade e a forma mínima do
 * escopo — uma linha malformada vira `null` (fail-closed), nunca uma autoridade ilimitada. PURO.
 *
 * Sem esta projeção, uma autoridade por capacidade (resource_class NULL) seria reconstruída SEM os
 * limites e `deriveAuthorityScope` a classificaria como `any_provider_resource` (qualquer GPU do
 * provider) — perda de segurança. Por isso ela acompanha, obrigatoriamente, a coluna nova.
 */
export function projectStoredPaidComputeAuthorization(row: StoredPaidComputeAuthorizationRow): PaidComputeAuthorizationV1 | null {
  return parsePaidComputeAuthorization({
    schemaVersion: 1,
    authorizationId: row.id,
    authorizedBy: row.user_id,
    authorizedByAuthor: 'user',
    providerId: row.provider_id,
    nodeId: row.node_id,
    resourceClass: row.resource_class,
    capabilityScope: row.capability_scope ?? null,
    workItemId: row.work_item_id,
    maxDurationMs: Number(row.max_duration_ms),
    maxCostEstimate: row.max_cost_currency === null ? null : { currency: row.max_cost_currency, amount: Number(row.max_cost_amount) },
    validFrom: row.valid_from,
    validUntil: row.valid_until,
  } as unknown as Json);
}

export async function readActivePaidComputeAuthorization(
  client: SupabaseClient<Database>,
  // `nodeId` aceita `null` = consulta não amarrada a um node específico (casa autoridades
  // node-agnósticas: `row.node_id IS NULL`). O runtime passa sempre um nodeId concreto; scripts de
  // reconciliação de uma autoridade node-agnóstica passam `null`. O filtro abaixo já trata os dois.
  input: { readonly providerId: string; readonly nodeId: string | null; readonly resourceClass: string | null; readonly workItemId: string; readonly now: Date },
): Promise<PaidComputeAuthorizationV1 | null> {
  const { data, error } = await client.from('paid_compute_authorizations').select('*')
    .eq('provider_id', input.providerId).is('revoked_at', null)
    .lte('valid_from', input.now.toISOString()).gt('valid_until', input.now.toISOString())
    .order('created_at', { ascending: false }).limit(20);
  if (error) return null;
  for (const row of data ?? []) {
    if (row.node_id !== null && row.node_id !== input.nodeId) continue;
    // Autoridade SKU-fixa: só casa a classe exata. Autoridade por capacidade (resource_class NULL)
    // casa qualquer classe pedida — os limites de capacidade são impostos depois, na AVALIAÇÃO
    // (`evaluatePaidComputeAuthorization` com `resourceCapabilities`), nunca aqui.
    if (row.resource_class !== null && row.resource_class !== input.resourceClass) continue;
    if (row.work_item_id !== null && row.work_item_id !== input.workItemId) continue;
    const parsed = projectStoredPaidComputeAuthorization(row);
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
  readonly capabilityScope: CloudCapabilityScopeV1 | null;
  readonly workItemId: string | null;
  readonly maxDurationMs: number;
  readonly maxCost: { readonly currency: string; readonly amount: number } | null;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly active: boolean;
}

export interface PaidComputeBudgetAuditView {
  readonly authorizationId: string;
  readonly ceiling: { readonly currency: string; readonly amount: number } | null;
  readonly reserved: number;
  readonly voided: number;
  /** Excesso total liberado por settlement (Σ dos eventos `settled`). Reduz o committed. */
  readonly settledExcess: number;
  readonly committed: number;
  readonly remaining: number | null;
  readonly reservations: readonly {
    readonly reservationId: string; readonly leaseId: string; readonly workItemId: string;
    readonly nodeId: string; readonly amount: number; readonly currency: string;
    readonly createdAt: string; readonly voided: boolean; readonly voidReason: string | null;
    /** Liquidada? Quando true, `settledCost` é o custo efetivo/estimado (S) e `costSource` a fonte. */
    readonly settled: boolean;
    readonly settledCost: number | null;
    readonly releasedExcess: number | null;
    readonly costSource: NodeCostSourceV1 | null;
  }[];
}

export interface GrantPaidComputeAuthorizationInput {
  readonly providerId: string;
  readonly nodeId?: string | null;
  readonly resourceClass?: string | null;
  readonly capabilityScope?: CloudCapabilityScopeV1 | null;
  readonly workItemId?: string | null;
  readonly maxDurationMs: number;
  readonly maxCost?: { readonly currency: string; readonly amount: number } | null;
  readonly validFrom: string;
  readonly validUntil: string;
}

export type PaidComputeStoreError = { readonly ok: false; readonly code: string; readonly message: string };
export type GrantResult = { readonly ok: true; readonly authorizationId: string } | PaidComputeStoreError;
export type RevokeResult = { readonly ok: true; readonly authorizationId: string } | PaidComputeStoreError;
export type BudgetReservationResult =
  | { readonly ok: true; readonly action: 'reserved' | 'replayed'; readonly reservationId: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

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
  capabilityScope: projectStoredPaidComputeAuthorization(row)?.capabilityScope ?? null,
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

/** Projeção READ-ONLY do ledger por autorização. Não participa da admissão: READ MODEL != WRITE GATE. */
export async function listPaidComputeBudgetAudit(
  client: SupabaseClient<Database>,
): Promise<{ readonly ok: true; readonly budgets: readonly PaidComputeBudgetAuditView[] } | PaidComputeStoreError> {
  const [auths, events] = await Promise.all([
    client.from('paid_compute_authorizations').select('id,max_cost_currency,max_cost_amount').order('created_at', { ascending: false }).limit(100),
    client.from('paid_compute_budget_events').select('*').order('created_at', { ascending: true }).limit(2000),
  ]);
  if (auths.error) return mapPgError(auths.error);
  if (events.error) return mapPgError(events.error);
  const byAuth = new Map<string, Database['public']['Tables']['paid_compute_budget_events']['Row'][]>();
  for (const event of events.data ?? []) byAuth.set(event.authorization_id, [...(byAuth.get(event.authorization_id) ?? []), event]);
  return { ok: true, budgets: (auths.data ?? []).map(auth => {
    const rows = byAuth.get(auth.id) ?? [];
    const voidIds = new Set(rows.filter(e => e.event_type === 'voided').map(e => e.reservation_id));
    const reserves = rows.filter(e => e.event_type === 'reserved');
    const reserved = reserves.reduce((sum, e) => sum + Number(e.amount), 0);
    const voided = rows.filter(e => e.event_type === 'voided').reduce((sum, e) => sum + Number(e.amount), 0);
    // Um evento `settled` grava o EXCESSO liberado (R − S). committed passa a refletir o custo
    // efetivo/estimado (Σ_aberta R + Σ_liquidada S), não a exposição máxima.
    const settledExcess = rows.filter(e => e.event_type === 'settled').reduce((sum, e) => sum + Number(e.amount), 0);
    const committed = reserved - voided - settledExcess;
    const ceiling = auth.max_cost_currency === null || auth.max_cost_amount === null
      ? null : { currency: auth.max_cost_currency, amount: Number(auth.max_cost_amount) };
    const asCostSource = (reason: string | null): NodeCostSourceV1 | null =>
      reason === 'estimated' || reason === 'provider_confirmed' ? reason : null;
    return {
      authorizationId: auth.id, ceiling, reserved, voided, settledExcess, committed,
      remaining: ceiling === null ? null : Math.max(0, ceiling.amount - committed),
      reservations: reserves.map(e => {
        const voidEvent = rows.find(v => v.event_type === 'voided' && v.reservation_id === e.reservation_id);
        const settleEvent = rows.find(s => s.event_type === 'settled' && s.reservation_id === e.reservation_id);
        const released = settleEvent ? Number(settleEvent.amount) : null;
        return { reservationId: e.reservation_id, leaseId: e.lease_id, workItemId: e.work_item_id,
          nodeId: e.node_id, amount: Number(e.amount), currency: e.currency, createdAt: e.created_at,
          voided: voidIds.has(e.reservation_id), voidReason: voidEvent?.reason ?? null,
          settled: settleEvent !== undefined,
          // Custo liquidado S = reserva − excesso liberado (derivado; sem coluna extra no schema).
          settledCost: released === null ? null : Number(e.amount) - released,
          releasedExcess: released,
          costSource: asCostSource(settleEvent?.reason ?? null) };
      }),
    };
  }) };
}

/** Lê o ledger canônico de UMA autoridade, sem depender das janelas paginadas da tela de audit. */
export async function readPaidComputeBudgetAudit(
  client: SupabaseClient<Database>, authorizationId: string,
): Promise<{ readonly ok: true; readonly budget: PaidComputeBudgetAuditView | null } | PaidComputeStoreError> {
  const [auth, events] = await Promise.all([
    client.from('paid_compute_authorizations').select('id,max_cost_currency,max_cost_amount').eq('id', authorizationId).maybeSingle(),
    client.from('paid_compute_budget_events').select('*').eq('authorization_id', authorizationId).order('created_at', { ascending: true }),
  ]);
  if (auth.error) return mapPgError(auth.error);
  if (events.error) return mapPgError(events.error);
  if (auth.data === null) return { ok: true, budget: null };
  const rows = events.data ?? [];
  const voidIds = new Set(rows.filter(e => e.event_type === 'voided').map(e => e.reservation_id));
  const reserves = rows.filter(e => e.event_type === 'reserved');
  const reserved = reserves.reduce((sum, e) => sum + Number(e.amount), 0);
  const voided = rows.filter(e => e.event_type === 'voided').reduce((sum, e) => sum + Number(e.amount), 0);
  const settledExcess = rows.filter(e => e.event_type === 'settled').reduce((sum, e) => sum + Number(e.amount), 0);
  const committed = reserved - voided - settledExcess;
  const ceiling = auth.data.max_cost_currency === null || auth.data.max_cost_amount === null
    ? null : { currency: auth.data.max_cost_currency, amount: Number(auth.data.max_cost_amount) };
  const asCostSource = (reason: string | null): NodeCostSourceV1 | null =>
    reason === 'estimated' || reason === 'provider_confirmed' ? reason : null;
  return { ok: true, budget: {
    authorizationId: auth.data.id, ceiling, reserved, voided, settledExcess, committed,
    remaining: ceiling === null ? null : Math.max(0, ceiling.amount - committed),
    reservations: reserves.map(e => {
      const voidEvent = rows.find(v => v.event_type === 'voided' && v.reservation_id === e.reservation_id);
      const settleEvent = rows.find(s => s.event_type === 'settled' && s.reservation_id === e.reservation_id);
      const released = settleEvent ? Number(settleEvent.amount) : null;
      return { reservationId: e.reservation_id, leaseId: e.lease_id, workItemId: e.work_item_id,
        nodeId: e.node_id, amount: Number(e.amount), currency: e.currency, createdAt: e.created_at,
        voided: voidIds.has(e.reservation_id), voidReason: voidEvent?.reason ?? null,
        settled: settleEvent !== undefined, settledCost: released === null ? null : Number(e.amount) - released,
        releasedExcess: released, costSource: asCostSource(settleEvent?.reason ?? null) };
    }),
  } };
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
    ...(input.capabilityScope ? { capability_scope: {
      minimumVramGiB: input.capabilityScope.minimumVramGiB,
      requiredGpuFeatures: [...input.capabilityScope.requiredGpuFeatures],
      maxHourlyPrice: input.capabilityScope.maxHourlyPrice === null ? null : {
        currency: input.capabilityScope.maxHourlyPrice.currency,
        amount: input.capabilityScope.maxHourlyPrice.amount,
      },
      maxNodes: input.capabilityScope.maxNodes,
    } } : {}),
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

/** Reserva exposição estimada no ledger autoritativo. A RPC serializa por autorização e é o
 * write gate; esta função não calcula saldo localmente. */
export async function reservePaidComputeBudget(
  client: SupabaseClient<Database>,
  input: {
    readonly authorizationId: string; readonly idempotencyKey: string;
    readonly providerId: string; readonly nodeId: string; readonly resourceClass: string | null;
    readonly workItemId: string; readonly attemptId: string | null; readonly leaseId: string;
    readonly estimate: { readonly currency: string; readonly amount: number };
  },
): Promise<BudgetReservationResult> {
  type Args = Database['public']['Functions']['reserve_paid_compute_budget']['Args'];
  const { data, error } = await client.rpc('reserve_paid_compute_budget', {
    authorization_id: input.authorizationId, idempotency_key: input.idempotencyKey,
    provider_id: input.providerId, node_id: input.nodeId, resource_class: input.resourceClass,
    work_item_id: input.workItemId, attempt_id: input.attemptId, lease_id: input.leaseId,
    estimate_currency: input.estimate.currency, estimate_amount: input.estimate.amount,
  } as unknown as Args);
  if (error) return mapPgError(error);
  const value = data as { action?: string; reason?: string; reservation_id?: string } | null;
  if (value?.action === 'denied') {
    return { ok: false, code: value.reason ?? 'aggregate_budget_denied', message: value.reason ?? 'Reserva financeira negada.' };
  }
  if ((value?.action === 'reserved' || value?.action === 'replayed') && value.reservation_id) {
    return { ok: true, action: value.action, reservationId: value.reservation_id };
  }
  return { ok: false, code: 'unavailable', message: 'Reserva financeira sem confirmação durável.' };
}

export type BudgetSettlementResult =
  | { readonly ok: true; readonly action: 'settled' | 'replayed'; readonly settledAmount: number; readonly releasedExcess: number; readonly currency: string; readonly costSource: NodeCostSourceV1 }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * Liquida uma reserva do ledger (append-only): registra o custo efetivo/estimado e libera o
 * excesso da reserva conservadora de volta ao envelope da sessão. `settled` é o custo liquidado S
 * (a RPC grava o excesso R−S e impõe 0 ≤ S ≤ R); `costSource` distingue estimativa de custo
 * confirmado pelo provider. A RPC serializa na linha da autorização e é idempotente por reserva.
 * NÃO exige autoridade vigente (liberar excesso / registrar custo real é seguro pós-hoc).
 */
export async function settlePaidComputeBudgetReservation(
  client: SupabaseClient<Database>,
  input: {
    readonly reservationId: string;
    readonly settled: { readonly currency: string; readonly amount: number };
    readonly costSource: NodeCostSourceV1;
  },
): Promise<BudgetSettlementResult> {
  const { data, error } = await client.rpc('settle_paid_compute_budget_reservation', {
    reservation_id: input.reservationId, settled_currency: input.settled.currency,
    settled_amount: input.settled.amount, cost_source: input.costSource,
  });
  if (error) return mapPgError(error);
  const value = data as { action?: string; settled_amount?: number; released?: number; currency?: string; cost_source?: string } | null;
  if ((value?.action === 'settled' || value?.action === 'replayed')
    && typeof value.settled_amount === 'number' && typeof value.released === 'number'
    && typeof value.currency === 'string'
    && (value.cost_source === 'estimated' || value.cost_source === 'provider_confirmed')) {
    return { ok: true, action: value.action, settledAmount: value.settled_amount, releasedExcess: value.released, currency: value.currency, costSource: value.cost_source };
  }
  return { ok: false, code: 'unavailable', message: 'Settlement financeiro sem confirmação durável.' };
}

/** Anula uma reserva somente quando existe prova de que nenhum efeito financeiro ocorreu. */
export async function voidPaidComputeBudgetReservation(
  client: SupabaseClient<Database>, reservationId: string,
  reason: 'provider_not_called' | 'provider_rejected_before_create',
): Promise<{ readonly ok: true } | PaidComputeStoreError> {
  const { data, error } = await client.rpc('void_paid_compute_budget_reservation', {
    reservation_id: reservationId, reason,
  });
  if (error) return mapPgError(error);
  const action = (data as { action?: string } | null)?.action;
  return action === 'voided' || action === 'replayed'
    ? { ok: true }
    : { ok: false, code: 'unavailable', message: 'Anulação financeira sem confirmação durável.' };
}
