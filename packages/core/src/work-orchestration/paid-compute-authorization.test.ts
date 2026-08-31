import {
  evaluatePaidComputeAuthorization,
  parsePaidComputeAuthorization,
  type PaidComputeAuthorizationV1,
  type PaidComputeRequest,
} from './paid-compute-authorization';
import type { Json } from '@anima/types';

const NOW = new Date('2026-08-30T12:00:00.000Z');

const auth = (overrides: Partial<PaidComputeAuthorizationV1> = {}): PaidComputeAuthorizationV1 => ({
  schemaVersion: 1,
  authorizationId: 'auth-1',
  authorizedBy: 'user-gean',
  authorizedByAuthor: 'user',
  providerId: 'runpod',
  nodeId: 'gpu-a',
  resourceClass: 'gpu-16gb',
  workItemId: 'item-1',
  maxDurationMs: 60 * 60_000,
  maxCostEstimate: { currency: 'USD', amount: 2 },
  validFrom: '2026-08-30T11:00:00.000Z',
  validUntil: '2026-08-30T13:00:00.000Z',
  ...overrides,
});

const paidRequest = (overrides: Partial<PaidComputeRequest> = {}): PaidComputeRequest => ({
  billingMode: 'paid',
  providerId: 'runpod',
  nodeId: 'gpu-a',
  resourceClass: 'gpu-16gb',
  workItemId: 'item-1',
  requestedDurationMs: 30 * 60_000,
  estimatedCost: { currency: 'USD', amount: 1 },
  ...overrides,
});

describe('evaluatePaidComputeAuthorization — node não-pago dispensa autorização', () => {
  test.each(['owned', 'already_provisioned'] as const)('%s → paid_not_required sem autorização', mode => {
    const decision = evaluatePaidComputeAuthorization(paidRequest({ billingMode: mode }), null, NOW);
    expect(decision).toEqual({ authorized: true, requiresPayment: false, reason: 'paid_not_required' });
  });
});

describe('evaluatePaidComputeAuthorization — pago libera só com autorização humana compatível', () => {
  test('autorização válida e compatível → autorizado carregando a referência', () => {
    const decision = evaluatePaidComputeAuthorization(paidRequest(), auth(), NOW);
    expect(decision).toEqual({ authorized: true, requiresPayment: true, authorizationRef: 'auth-1' });
  });

  test('autorização por node/classe/trabalho curinga (null) libera qualquer pedido do provider', () => {
    const wildcard = auth({ nodeId: null, resourceClass: null, workItemId: null });
    expect(evaluatePaidComputeAuthorization(paidRequest({ nodeId: 'gpu-z', resourceClass: 'cpu', workItemId: 'item-9' }), wildcard, NOW))
      .toMatchObject({ authorized: true, requiresPayment: true });
  });
});

describe('evaluatePaidComputeAuthorization — fail-closed (necessidade ≠ autorização de gasto)', () => {
  test('autorização histórica sem teto agregado não concede nova autoridade', () => {
    expect(evaluatePaidComputeAuthorization(paidRequest(), auth({ maxCostEstimate: null }), NOW))
      .toEqual({ authorized: false, reason: 'aggregate_cost_ceiling_required' });
  });
  test('ausência de autorização é negada, nunca liberada por pressão de recurso', () => {
    expect(evaluatePaidComputeAuthorization(paidRequest(), null, NOW)).toEqual({ authorized: false, reason: 'authorization_missing' });
  });

  test('autoria não-humana (system) é recusada', () => {
    const forged = { ...auth(), authorizedByAuthor: 'system' } as unknown as PaidComputeAuthorizationV1;
    expect(evaluatePaidComputeAuthorization(paidRequest(), forged, NOW)).toEqual({ authorized: false, reason: 'authorization_author_not_human' });
  });

  test('autorização expirada e ainda não vigente são recusadas', () => {
    expect(evaluatePaidComputeAuthorization(paidRequest(), auth({ validUntil: '2026-08-30T11:30:00.000Z' }), NOW))
      .toEqual({ authorized: false, reason: 'authorization_expired' });
    expect(evaluatePaidComputeAuthorization(paidRequest(), auth({ validFrom: '2026-08-30T12:30:00.000Z', validUntil: '2026-08-30T14:00:00.000Z' }), NOW))
      .toEqual({ authorized: false, reason: 'authorization_not_yet_valid' });
  });

  test('provider/node/classe/trabalho divergentes são recusados com razão específica', () => {
    expect(evaluatePaidComputeAuthorization(paidRequest({ providerId: 'aws' }), auth(), NOW)).toEqual({ authorized: false, reason: 'provider_mismatch' });
    expect(evaluatePaidComputeAuthorization(paidRequest({ nodeId: 'gpu-b' }), auth(), NOW)).toEqual({ authorized: false, reason: 'node_mismatch' });
    expect(evaluatePaidComputeAuthorization(paidRequest({ resourceClass: 'gpu-24gb' }), auth(), NOW)).toEqual({ authorized: false, reason: 'resource_class_mismatch' });
    expect(evaluatePaidComputeAuthorization(paidRequest({ workItemId: 'item-2' }), auth(), NOW)).toEqual({ authorized: false, reason: 'work_item_mismatch' });
  });

  test('duração pedida acima do teto autorizado é recusada', () => {
    expect(evaluatePaidComputeAuthorization(paidRequest({ requestedDurationMs: 90 * 60_000 }), auth(), NOW))
      .toEqual({ authorized: false, reason: 'duration_exceeds_authorized' });
  });

  test('teto de custo exige estimativa presente na mesma moeda e recusa quando excede', () => {
    const capped = auth({ maxCostEstimate: { currency: 'USD', amount: 2 } });
    expect(evaluatePaidComputeAuthorization(paidRequest({ estimatedCost: null }), capped, NOW)).toEqual({ authorized: false, reason: 'cost_estimate_required' });
    expect(evaluatePaidComputeAuthorization(paidRequest({ estimatedCost: { currency: 'BRL', amount: 1 } }), capped, NOW)).toEqual({ authorized: false, reason: 'cost_estimate_required' });
    expect(evaluatePaidComputeAuthorization(paidRequest({ estimatedCost: { currency: 'USD', amount: 3 } }), capped, NOW)).toEqual({ authorized: false, reason: 'cost_exceeds_authorized' });
    expect(evaluatePaidComputeAuthorization(paidRequest({ estimatedCost: { currency: 'USD', amount: 1.5 } }), capped, NOW)).toMatchObject({ authorized: true, requiresPayment: true });
  });
});

describe('parsePaidComputeAuthorization — fail-closed', () => {
  const good: Json = {
    schemaVersion: 1, authorizationId: 'auth-1', authorizedBy: 'user-gean', authorizedByAuthor: 'user',
    providerId: 'runpod', nodeId: 'gpu-a', resourceClass: 'gpu-16gb', workItemId: 'item-1',
    maxDurationMs: 3_600_000, maxCostEstimate: null, validFrom: '2026-08-30T11:00:00.000Z', validUntil: '2026-08-30T13:00:00.000Z',
  };

  test('JSON bem-formado reconstrói a autorização', () => {
    expect(parsePaidComputeAuthorization(good)).toMatchObject({ authorizationId: 'auth-1', authorizedByAuthor: 'user' });
  });

  test('autoria diferente de user é malformada (null)', () => {
    expect(parsePaidComputeAuthorization({ ...good, authorizedByAuthor: 'system' } as Json)).toBeNull();
  });

  test('validUntil <= validFrom é malformada', () => {
    expect(parsePaidComputeAuthorization({ ...good, validUntil: '2026-08-30T11:00:00.000Z' } as Json)).toBeNull();
  });

  test('maxDurationMs não-positivo é malformado', () => {
    expect(parsePaidComputeAuthorization({ ...good, maxDurationMs: 0 } as Json)).toBeNull();
  });
});
