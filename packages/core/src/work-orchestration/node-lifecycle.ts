// ============================================================
// PROVISIONAMENTO ON-DEMAND V1 — máquina de estados MÍNIMA e GERAL do ciclo de vida
// de um node de compute (puro, determinístico).
//
// O Execution Placement V0 já decide ONDE o coder roda (local/remote/defer) a partir de
// um catálogo de nodes com endpoint, health, enabled e billingMode. Mas ele assume que o
// node remoto JÁ EXISTE e está saudável. Este módulo modela o passo que faltava: o ciclo
// de vida governado de disponibilizar e desligar um node — SEM mover para a cloud, sem
// scheduler distribuído, sem autoscaling.
//
// Distinções que o vocabulário preserva (a pedido do recorte):
//   - `offline`         node CONFIGURADO no catálogo, mas não fisicamente disponível;
//   - `provisioning`    start pedido, subindo (ainda sem health);
//   - `ready`           fisicamente disponível E saudável, livre (recém-subido);
//   - `busy`            reservado/executando um workload;
//   - `idle`            livre DEPOIS de ter trabalhado (relógio de idle-timeout corre aqui);
//   - `shutting_down`   stop pedido;
// e os desfechos de FALHA, distintos de propósito:
//   - `provision_failed`  o start em si falhou (node nunca subiu);
//   - `health_failed`     subiu mas o health nunca passou, ou a saúde caiu em uso;
//   - `shutdown_failed`   o stop falhou (ATENÇÃO: um node pago pode seguir custando aqui).
//
// Este módulo NÃO cria servidores, NÃO chama provider, NÃO decide gasto. Só diz, dada uma
// transição observada, se ela é legal, um no-op idempotente, ou ilegal. A idempotência é
// deliberada: dois polls que observam o mesmo estado NÃO podem disparar duas provisões.
// ============================================================

export type NodeLifecycleState =
  | 'offline'
  | 'provisioning'
  | 'ready'
  | 'busy'
  | 'idle'
  | 'shutting_down'
  | 'provision_failed'
  | 'health_failed'
  | 'shutdown_failed';

/** Gatilhos de transição — cada um é um FATO observado pela Goma (nunca auto-relatado pelo
 * node). `provision_requested` é o único que INICIA compute; a camada acima é quem decide
 * (autorização/placement), aqui só se registra a transição. */
export type NodeLifecycleEvent =
  | 'provision_requested'
  | 'health_confirmed'
  | 'provision_failed'
  | 'health_lost'
  | 'reserved'
  | 'released'
  | 'shutdown_requested'
  | 'shutdown_confirmed'
  | 'shutdown_failed';

const TERMINAL_FAILURES: ReadonlySet<NodeLifecycleState> = new Set<NodeLifecycleState>([
  'provision_failed', 'health_failed', 'shutdown_failed',
]);

/** Um node está "vivo" (potencialmente custando/ocupando recurso) em qualquer estado que
 * não seja `offline`. `offline` é o único estado comprovadamente sem custo ativo. */
const LIVE_STATES: ReadonlySet<NodeLifecycleState> = new Set<NodeLifecycleState>([
  'provisioning', 'ready', 'busy', 'idle', 'shutting_down',
  // as falhas também podem deixar recurso pendurado até um teardown confirmado:
  'provision_failed', 'health_failed', 'shutdown_failed',
]);

/** Estados em que o node está livre para executar imediatamente (disponível e saudável). */
const AVAILABLE_STATES: ReadonlySet<NodeLifecycleState> = new Set<NodeLifecycleState>(['ready', 'idle']);

export const isNodeLifecycleFailure = (state: NodeLifecycleState): boolean => TERMINAL_FAILURES.has(state);
/** `offline` = sem custo/recurso ativo comprovado; qualquer outro estado pode custar. */
export const isNodeLive = (state: NodeLifecycleState): boolean => LIVE_STATES.has(state);
export const isNodeAvailableForWork = (state: NodeLifecycleState): boolean => AVAILABLE_STATES.has(state);

// Tabela de transições LEGAIS: from → (event → to). O que não está aqui é ilegal, EXCETO os
// no-ops idempotentes tratados abaixo. Escolhas de segurança:
//   - `provision_requested` só sai de `offline` (subir). Repetir enquanto já vivo é no-op.
//   - de uma FALHA só há caminho de teardown (`shutdown_requested`): reviver in-place não
//     existe no V0 — recuperar = uma NOVA provisão (novo ciclo), decidida/autorizada acima.
//   - `shutdown_requested` é aceito de qualquer estado vivo e livre/ocupado/doente: sempre
//     deve haver como MANDAR desligar um node que pode estar custando.
const TRANSITIONS: Readonly<Record<NodeLifecycleState, Partial<Record<NodeLifecycleEvent, NodeLifecycleState>>>> = {
  offline: {
    provision_requested: 'provisioning',
  },
  provisioning: {
    health_confirmed: 'ready',
    provision_failed: 'provision_failed',
    health_lost: 'health_failed',
    shutdown_requested: 'shutting_down',
  },
  ready: {
    reserved: 'busy',
    health_lost: 'health_failed',
    shutdown_requested: 'shutting_down',
  },
  busy: {
    released: 'idle',
    health_lost: 'health_failed',
    shutdown_requested: 'shutting_down',
  },
  idle: {
    reserved: 'busy',
    health_lost: 'health_failed',
    shutdown_requested: 'shutting_down',
  },
  shutting_down: {
    shutdown_confirmed: 'offline',
    shutdown_failed: 'shutdown_failed',
  },
  provision_failed: {
    shutdown_requested: 'shutting_down',
  },
  health_failed: {
    shutdown_requested: 'shutting_down',
  },
  shutdown_failed: {
    // retry idempotente do teardown; ou confirmação de que já sumiu.
    shutdown_requested: 'shutting_down',
    shutdown_confirmed: 'offline',
  },
};

// Para cada evento, os estados em que ele já está SATISFEITO — aplicar de novo é um no-op
// idempotente (ok, sem mudança), não um erro. Isto é o coração da defesa contra dupla
// provisão: `provision_requested` observado enquanto o node já está subindo/vivo não subir
// um segundo servidor.
const IDEMPOTENT_NOOP: Partial<Record<NodeLifecycleEvent, ReadonlySet<NodeLifecycleState>>> = {
  provision_requested: new Set<NodeLifecycleState>(['provisioning', 'ready', 'busy', 'idle']),
  health_confirmed: new Set<NodeLifecycleState>(['ready', 'idle', 'busy']),
  reserved: new Set<NodeLifecycleState>(['busy']),
  released: new Set<NodeLifecycleState>(['idle', 'ready']),
  shutdown_requested: new Set<NodeLifecycleState>(['shutting_down']),
  shutdown_confirmed: new Set<NodeLifecycleState>(['offline']),
};

export type NodeLifecycleTransition =
  | { readonly ok: true; readonly kind: 'transition'; readonly from: NodeLifecycleState; readonly to: NodeLifecycleState; readonly event: NodeLifecycleEvent }
  | { readonly ok: true; readonly kind: 'noop'; readonly from: NodeLifecycleState; readonly to: NodeLifecycleState; readonly event: NodeLifecycleEvent }
  | { readonly ok: false; readonly kind: 'illegal'; readonly from: NodeLifecycleState; readonly event: NodeLifecycleEvent; readonly reason: string };

/**
 * Aplica um evento de ciclo de vida a um estado — puro e determinístico. Fail-closed:
 * uma transição que não existe na tabela e não é um no-op idempotente é `illegal` (nunca
 * "na dúvida, avança"). Um no-op idempotente devolve `ok` com `kind:'noop'` e o MESMO
 * estado, para que polls repetidos convirjam sem efeito colateral.
 */
export function transitionNodeLifecycle(
  from: NodeLifecycleState,
  event: NodeLifecycleEvent,
): NodeLifecycleTransition {
  const to = TRANSITIONS[from][event];
  if (to !== undefined) return { ok: true, kind: 'transition', from, to, event };
  if (IDEMPOTENT_NOOP[event]?.has(from)) return { ok: true, kind: 'noop', from, to: from, event };
  return { ok: false, kind: 'illegal', from, event, reason: `Transição ilegal: ${event} a partir de ${from}.` };
}
