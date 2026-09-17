// READ-ONLY: reconstrói o ledger de compute pago inteiro (todas as autoridades e todos os eventos
// brutos) pela identidade residente (GoTrue→Bearer→RLS, NUNCA service_role). NÃO chama nenhuma RPC
// de escrita (reserve/void/settle), NÃO toca o provider, NÃO cria Pod. Apenas SELECT.
import { resolveCliIdentity } from '@/cli/identity';

const money = (v: number): number => Math.round((v + Number.EPSILON) * 1_000_000) / 1_000_000;

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;

  const auths = await client.from('paid_compute_authorizations').select('*').order('created_at', { ascending: true });
  if (auths.error) throw new Error(`auths: ${auths.error.code} ${auths.error.message}`);
  const events = await client.from('paid_compute_budget_events').select('*').order('created_at', { ascending: true }).limit(5000);
  if (events.error) throw new Error(`events: ${events.error.code} ${events.error.message}`);

  const byAuth = new Map<string, typeof events.data>();
  for (const e of events.data ?? []) {
    const list = byAuth.get(e.authorization_id) ?? [];
    list.push(e);
    byAuth.set(e.authorization_id, list);
  }

  const report = (auths.data ?? []).map(a => {
    const rows = byAuth.get(a.id) ?? [];
    const reserves = rows.filter(r => r.event_type === 'reserved');
    const voids = rows.filter(r => r.event_type === 'voided');
    const settles = rows.filter(r => r.event_type === 'settled');
    const reserved = money(reserves.reduce((s, r) => s + Number(r.amount), 0));
    const voided = money(voids.reduce((s, r) => s + Number(r.amount), 0));
    const settledExcess = money(settles.reduce((s, r) => s + Number(r.amount), 0));
    const committed = money(reserved - voided - settledExcess);
    const voidIds = new Set(voids.map(v => v.reservation_id));
    const settleById = new Map(settles.map(s => [s.reservation_id, s]));
    return {
      authorizationId: a.id,
      providerId: a.provider_id,
      nodeId: a.node_id,
      resourceClass: a.resource_class,
      workItemId: a.work_item_id,
      maxCost: a.max_cost_currency === null ? null : { currency: a.max_cost_currency, amount: Number(a.max_cost_amount) },
      maxHourly: (a as { capability_scope?: { maxHourlyPrice?: unknown } | null }).capability_scope?.maxHourlyPrice ?? null,
      maxNodes: (a as { capability_scope?: { maxNodes?: unknown } | null }).capability_scope?.maxNodes ?? null,
      validFrom: a.valid_from,
      validUntil: a.valid_until,
      revokedAt: a.revoked_at,
      totals: { reserved, voided, settledExcess, committed, reservationCount: reserves.length,
        pendingCount: reserves.filter(r => !voidIds.has(r.reservation_id) && !settleById.has(r.reservation_id)).length,
        remaining: a.max_cost_amount === null ? null : money(Number(a.max_cost_amount) - committed) },
      reservations: reserves.map(r => {
        const settle = settleById.get(r.reservation_id);
        const voidEv = voids.find(v => v.reservation_id === r.reservation_id);
        return {
          reservationId: r.reservation_id,
          createdAt: r.created_at,
          amount: Number(r.amount),
          currency: r.currency,
          providerId: r.provider_id,
          nodeId: r.node_id,
          workItemId: r.work_item_id,
          attemptId: r.attempt_id,
          leaseId: r.lease_id,
          idempotencyKey: r.idempotency_key,
          resourceClass: r.resource_class,
          state: voidIds.has(r.reservation_id) ? 'voided' : settle ? 'settled' : 'PENDING',
          voidReason: voidEv?.reason ?? null,
          settledExcessReleased: settle ? Number(settle.amount) : null,
          settledCost: settle ? money(Number(r.amount) - Number(settle.amount)) : null,
          costSource: settle?.reason ?? null,
          settledAt: settle?.created_at ?? null,
        };
      }),
    };
  });

  console.log(JSON.stringify({ mode: 'READ_ONLY', userId, authorityCount: report.length,
    totalEvents: events.data?.length ?? 0, authorities: report }, null, 2));
}

void main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
