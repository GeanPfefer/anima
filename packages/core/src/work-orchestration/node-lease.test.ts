import {
  deriveBoundedLease,
  estimateLeaseCost,
  evaluateLeaseStatus,
  parseNodeLease,
  type NodeLeaseV0,
} from './node-lease';
import type { PaidComputeAuthorizationV1 } from './paid-compute-authorization';
import type { Json } from '@anima/types';

const authorization = (over: Partial<PaidComputeAuthorizationV1> = {}): PaidComputeAuthorizationV1 => ({
  schemaVersion: 1, authorizationId: 'auth-1', authorizedBy: 'user-1', authorizedByAuthor: 'user',
  providerId: 'runpod', nodeId: null, resourceClass: null, workItemId: null,
  maxDurationMs: 30 * 60_000, maxCostEstimate: null,
  validFrom: '2026-08-31T00:00:00.000Z', validUntil: '2026-08-31T02:00:00.000Z', ...over,
});

const lease = (overrides: Partial<NodeLeaseV0> = {}): NodeLeaseV0 => ({
  schemaVersion: 1,
  nodeId: 'gpu-a',
  providerId: 'runpod',
  billingMode: 'paid',
  workItemId: 'item-1',
  attemptId: 'att-1',
  maxActiveDurationMs: 30 * 60_000,
  idleTimeoutMs: 5 * 60_000,
  leaseExpiresAt: '2026-08-30T13:00:00.000Z',
  authorizationRef: 'auth-1',
  priceHint: null,
  ...overrides,
});

const at = (iso: string) => new Date(iso);

describe('evaluateLeaseStatus — deterministicamente decide se o node deve seguir ativo', () => {
  test('dentro de todos os limites → ativo com duração observada', () => {
    const status = evaluateLeaseStatus({
      lease: lease(), now: at('2026-08-30T12:10:00.000Z'), activeSince: at('2026-08-30T12:00:00.000Z'), idleSince: null,
    });
    expect(status).toEqual({ status: 'active', activeDurationMs: 10 * 60_000 });
  });

  test('prazo absoluto vence mesmo ocupado (precedência deadline)', () => {
    const status = evaluateLeaseStatus({
      lease: lease(), now: at('2026-08-30T13:00:00.000Z'), activeSince: at('2026-08-30T12:59:00.000Z'), idleSince: null,
    });
    expect(status).toMatchObject({ status: 'expired', reason: 'deadline' });
  });

  test('duração ativa acima do teto → expired max_duration', () => {
    const status = evaluateLeaseStatus({
      lease: lease(), now: at('2026-08-30T12:31:00.000Z'), activeSince: at('2026-08-30T12:00:00.000Z'), idleSince: null,
    });
    expect(status).toMatchObject({ status: 'expired', reason: 'max_duration' });
  });

  test('ocioso além do idle timeout → expired idle_timeout', () => {
    const status = evaluateLeaseStatus({
      lease: lease(), now: at('2026-08-30T12:20:00.000Z'), activeSince: at('2026-08-30T12:15:00.000Z'), idleSince: at('2026-08-30T12:14:00.000Z'),
    });
    expect(status).toMatchObject({ status: 'expired', reason: 'idle_timeout' });
  });

  test('ocupado (idleSince null) não expira por ocioso', () => {
    const status = evaluateLeaseStatus({
      lease: lease({ idleTimeoutMs: 60_000 }), now: at('2026-08-30T12:20:00.000Z'), activeSince: at('2026-08-30T12:15:00.000Z'), idleSince: null,
    });
    expect(status.status).toBe('active');
  });

  test('clock inconsistente (agora antes de activeSince) trata duração como 0, não negativa', () => {
    const status = evaluateLeaseStatus({
      lease: lease(), now: at('2026-08-30T11:59:00.000Z'), activeSince: at('2026-08-30T12:00:00.000Z'), idleSince: null,
    });
    expect(status).toEqual({ status: 'active', activeDurationMs: 0 });
  });
});

describe('estimateLeaseCost — custo derivado, nunca inventado', () => {
  test('sem price hint → null (não inventa número)', () => {
    expect(estimateLeaseCost(null, 3_600_000)).toBeNull();
  });

  test('com price hint → preço × horas', () => {
    expect(estimateLeaseCost({ currency: 'USD', perHour: 2 }, 3_600_000)).toEqual({ currency: 'USD', amount: 2 });
    expect(estimateLeaseCost({ currency: 'USD', perHour: 2 }, 1_800_000)).toEqual({ currency: 'USD', amount: 1 });
  });
});

describe('parseNodeLease — fail-closed', () => {
  const good: Json = {
    schemaVersion: 1, nodeId: 'gpu-a', providerId: 'runpod', billingMode: 'paid', workItemId: 'item-1', attemptId: 'att-1',
    maxActiveDurationMs: 1_800_000, idleTimeoutMs: 300_000, leaseExpiresAt: '2026-08-30T13:00:00.000Z', authorizationRef: 'auth-1', priceHint: null,
  };

  test('lease bem-formado reconstrói', () => {
    expect(parseNodeLease(good)).toMatchObject({ nodeId: 'gpu-a', billingMode: 'paid', authorizationRef: 'auth-1' });
  });

  test('lease pago SEM authorizationRef é inválido (não se aluga sem autorização)', () => {
    expect(parseNodeLease({ ...good, authorizationRef: null } as Json)).toBeNull();
  });

  test('lease owned pode ter authorizationRef null', () => {
    expect(parseNodeLease({ ...good, billingMode: 'owned', authorizationRef: null } as Json)).toMatchObject({ billingMode: 'owned', authorizationRef: null });
  });

  test('price hint malformado invalida', () => {
    expect(parseNodeLease({ ...good, priceHint: { currency: 'USD', perHour: -1 } } as Json)).toBeNull();
  });
});

describe('deriveBoundedLease (autoridade humana = teto duro)', () => {
  const now = new Date('2026-08-31T00:00:00.000Z');
  const base = { nodeId: 'gpu-a', workItemId: 'item-1', attemptId: 'att-1', idleTimeoutMs: 60_000, priceHint: null, now };

  test('pedido dentro da autoridade → deadline = agora + duração pedida', () => {
    const r = deriveBoundedLease({ ...base, authorization: authorization(), requestedDurationMs: 10 * 60_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lease.maxActiveDurationMs).toBe(10 * 60_000);
    expect(r.lease.leaseExpiresAt).toBe('2026-08-31T00:10:00.000Z');
    expect(r.lease).toMatchObject({ billingMode: 'paid', providerId: 'runpod', authorizationRef: 'auth-1' });
    // Round-trip válido e o status respeita o deadline clampado.
    expect(parseNodeLease(r.lease as unknown as Json)).not.toBeNull();
  });

  test('duração pedida excede maxDurationMs → clampa à autoridade', () => {
    const r = deriveBoundedLease({ ...base, authorization: authorization({ maxDurationMs: 5 * 60_000 }), requestedDurationMs: 30 * 60_000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lease.maxActiveDurationMs).toBe(5 * 60_000);
  });

  test('validUntil mais cedo que agora+duração → deadline clampado à validade (invariante-chave)', () => {
    const r = deriveBoundedLease({ ...base, authorization: authorization({ validUntil: '2026-08-31T00:05:00.000Z' }), requestedDurationMs: 30 * 60_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Deadline absoluto NUNCA passa da janela da autorização, mesmo com duração maior autorizada.
    expect(r.lease.leaseExpiresAt).toBe('2026-08-31T00:05:00.000Z');
  });

  test('janela da autoridade já esgotada → fail-closed (authority_window_elapsed)', () => {
    const r = deriveBoundedLease({ ...base, authorization: authorization({ validUntil: '2026-08-30T23:59:59.000Z' }), requestedDurationMs: 10 * 60_000 });
    expect(r).toEqual({ ok: false, reason: 'authority_window_elapsed' });
  });

  test('duração pedida não-positiva → fail-closed (authority_duration_zero)', () => {
    expect(deriveBoundedLease({ ...base, authorization: authorization(), requestedDurationMs: 0 })).toEqual({ ok: false, reason: 'authority_duration_zero' });
  });

  test('lease derivada expira determinística no deadline via evaluateLeaseStatus', () => {
    const r = deriveBoundedLease({ ...base, authorization: authorization({ validUntil: '2026-08-31T00:05:00.000Z' }), requestedDurationMs: 30 * 60_000 });
    if (!r.ok) throw new Error('esperava lease');
    const status = evaluateLeaseStatus({ lease: r.lease, now: new Date('2026-08-31T00:06:00.000Z'), activeSince: now, idleSince: null });
    expect(status).toMatchObject({ status: 'expired', reason: 'deadline' });
  });
});
