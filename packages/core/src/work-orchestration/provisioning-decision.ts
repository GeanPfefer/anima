// ============================================================
// PROVISIONAMENTO ON-DEMAND V1 — DECISÃO de provisionamento (pura), SEPARADA do placement.
//
// Fronteira central do recorte: `decideCoderPlacement` NÃO cria servidores. Ele decide a
// NECESSIDADE (local/remote/defer). Quando o placement diz "remote", ESTA camada decide o
// que fazer com o node — executar, provisionar, aguardar, esperar autorização ou adiar —
// subordinada à autorização financeira e ao estado do ciclo de vida.
//
//   necessidade (placement)  ≠  decisão de provisionamento  ≠  efeito externo (provisioner)
//
// Puro e determinístico. Fail-closed no dinheiro: se o node é `paid` e a autorização humana
// não está válida, NENHUMA ação de compute pago acontece — em QUALQUER estado do ciclo de
// vida —, devolvendo `waiting_authorization`. Idempotente: um node já subindo/desligando
// NUNCA dispara uma segunda provisão (defesa contra dois polls observando o mesmo estado).
// ============================================================

import type { NodeLifecycleState } from './node-lifecycle';
import { isNodeAvailableForWork } from './node-lifecycle';
import type { NodeBillingMode, PaidComputeAuthorizationDecision, PaidComputeDenialReason } from './paid-compute-authorization';

export interface ProvisioningDecisionInput {
  readonly lifecycleState: NodeLifecycleState;
  readonly billingMode: NodeBillingMode;
  /** Decisão financeira já avaliada pelo chamador (evaluatePaidComputeAuthorization). */
  readonly authorization: PaidComputeAuthorizationDecision;
}

export type ProvisioningDecisionV0 =
  // Node disponível (ready/idle) e autorizado → executar o coder agora.
  | { readonly action: 'execute' }
  // Node offline e autorizado → iniciar o lifecycle de provisão.
  | { readonly action: 'provision' }
  // Node subindo → aguardar (idempotente: não provisiona de novo).
  | { readonly action: 'await_provisioning' }
  // Node pago sem autorização humana válida → esperar autorização (fail-closed).
  | { readonly action: 'waiting_authorization'; readonly reason: PaidComputeDenialReason }
  // Node ocupado, desligando ou doente → adiar esta volta (razão observável).
  | { readonly action: 'defer'; readonly reason: 'node_busy' | 'node_shutting_down' | 'node_unhealthy' | 'node_shutdown_failed' };

/**
 * Decide o próximo passo de provisionamento — puro. A ordem é deliberada:
 *   1. Barreira financeira PRIMEIRO: node `paid` sem autorização válida ⇒ waiting_authorization,
 *      independentemente do estado (não se executa nem provisiona compute pago sem autorização).
 *   2. Estado do ciclo de vida: disponível ⇒ execute; offline ⇒ provision; subindo ⇒ await
 *      (idempotente); ocupado/desligando/doente ⇒ defer com razão. Recuperar de uma falha é
 *      uma NOVA decisão autorizada, não um auto-retry aqui (evita laços de gasto).
 */
export function decideCoderProvisioning(input: ProvisioningDecisionInput): ProvisioningDecisionV0 {
  // 1. Fail-closed no dinheiro. `paid` exige autorização válida antes de qualquer ação.
  if (input.billingMode === 'paid' && !input.authorization.authorized) {
    return { action: 'waiting_authorization', reason: input.authorization.reason };
  }

  // 2. Estado do ciclo de vida.
  if (isNodeAvailableForWork(input.lifecycleState)) return { action: 'execute' };
  switch (input.lifecycleState) {
    case 'offline':
      return { action: 'provision' };
    case 'provisioning':
      return { action: 'await_provisioning' };
    case 'busy':
      return { action: 'defer', reason: 'node_busy' };
    case 'shutting_down':
      return { action: 'defer', reason: 'node_shutting_down' };
    case 'provision_failed':
    case 'health_failed':
      return { action: 'defer', reason: 'node_unhealthy' };
    case 'shutdown_failed':
      return { action: 'defer', reason: 'node_shutdown_failed' };
    default:
      // Exaustividade defensiva: um estado novo não tratado NUNCA cai em provisão.
      return { action: 'defer', reason: 'node_unhealthy' };
  }
}
