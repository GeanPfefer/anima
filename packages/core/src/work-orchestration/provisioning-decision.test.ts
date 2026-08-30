import { decideCoderProvisioning } from './provisioning-decision';
import type { PaidComputeAuthorizationDecision } from './paid-compute-authorization';
import type { NodeLifecycleState } from './node-lifecycle';

const authorized: PaidComputeAuthorizationDecision = { authorized: true, requiresPayment: true, authorizationRef: 'auth-1' };
const notRequired: PaidComputeAuthorizationDecision = { authorized: true, requiresPayment: false, reason: 'paid_not_required' };
const denied: PaidComputeAuthorizationDecision = { authorized: false, reason: 'authorization_missing' };

describe('decideCoderProvisioning — separação necessidade ≠ decisão financeira ≠ efeito', () => {
  test('node disponível (ready/idle) → execute', () => {
    for (const state of ['ready', 'idle'] as const) {
      expect(decideCoderProvisioning({ lifecycleState: state, billingMode: 'owned', authorization: notRequired })).toEqual({ action: 'execute' });
    }
  });

  test('node owned offline → provision (sem gate financeiro)', () => {
    expect(decideCoderProvisioning({ lifecycleState: 'offline', billingMode: 'owned', authorization: notRequired })).toEqual({ action: 'provision' });
  });

  test('node paid offline COM autorização → provision', () => {
    expect(decideCoderProvisioning({ lifecycleState: 'offline', billingMode: 'paid', authorization: authorized })).toEqual({ action: 'provision' });
  });
});

describe('decideCoderProvisioning — fail-closed no dinheiro em qualquer estado', () => {
  test.each(['offline', 'ready', 'idle', 'provisioning', 'busy'] as NodeLifecycleState[])(
    'paid sem autorização em %s → waiting_authorization (nunca executa/provisiona)',
    state => {
      expect(decideCoderProvisioning({ lifecycleState: state, billingMode: 'paid', authorization: denied }))
        .toEqual({ action: 'waiting_authorization', reason: 'authorization_missing' });
    },
  );
});

describe('decideCoderProvisioning — idempotência e adiamento', () => {
  test('provisioning → await_provisioning (não dispara segunda provisão)', () => {
    expect(decideCoderProvisioning({ lifecycleState: 'provisioning', billingMode: 'owned', authorization: notRequired })).toEqual({ action: 'await_provisioning' });
  });

  test('busy/shutting_down/falhas → defer com razão observável', () => {
    expect(decideCoderProvisioning({ lifecycleState: 'busy', billingMode: 'owned', authorization: notRequired })).toEqual({ action: 'defer', reason: 'node_busy' });
    expect(decideCoderProvisioning({ lifecycleState: 'shutting_down', billingMode: 'owned', authorization: notRequired })).toEqual({ action: 'defer', reason: 'node_shutting_down' });
    expect(decideCoderProvisioning({ lifecycleState: 'provision_failed', billingMode: 'owned', authorization: notRequired })).toEqual({ action: 'defer', reason: 'node_unhealthy' });
    expect(decideCoderProvisioning({ lifecycleState: 'health_failed', billingMode: 'owned', authorization: notRequired })).toEqual({ action: 'defer', reason: 'node_unhealthy' });
    expect(decideCoderProvisioning({ lifecycleState: 'shutdown_failed', billingMode: 'owned', authorization: notRequired })).toEqual({ action: 'defer', reason: 'node_shutdown_failed' });
  });

  test('uma falha NÃO gera auto-retry de provisão (evita laço de gasto)', () => {
    const decision = decideCoderProvisioning({ lifecycleState: 'provision_failed', billingMode: 'paid', authorization: authorized });
    expect(decision.action).not.toBe('provision');
    expect(decision).toEqual({ action: 'defer', reason: 'node_unhealthy' });
  });
});
