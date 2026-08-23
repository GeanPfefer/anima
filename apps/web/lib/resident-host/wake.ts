import type { WakeReason } from './resident-host';

// ============================================================
// Coordenador de wake do resident host (ADR-003, AUTO_EVENT_WAKE).
//
// Une as FONTES de wake (evento Realtime de `work_events`, wake explícito por stdin,
// timer de poll de fallback, cancelamento) atrás do porto `waitForWake` da engine.
// Princípios (do norte):
//   - Fonte do wake ≠ fonte da decisão: o coordenador só diz "acorde"; a engine
//     reconcilia e a política pura decide. Evento perdido/duplicado é seguro.
//   - COALESCING: sinais que chegam enquanto a engine está RODANDO (não esperando) viram
//     UM wake pendente; 20 eventos ⇒ 1 reconcile. Sinais durante uma espera resolvem-na.
//   - Fallback timer é SAFETY NET (não scheduler): se um evento se perde, o poll lento
//     eventualmente reconcilia.
//
// Puro-ish e testável: sem rede, sem Supabase. A assinatura Realtime (efeito) chama
// `signal('event')`; o stdin chama `signal('explicit')`; o timer resolve `'poll'`.
// ============================================================

export interface WakeCoordinator {
  /** Sinaliza um wake. Se há uma espera ativa, resolve-a; senão marca pendente (coalescido). */
  readonly signal: (reason: Extract<WakeReason, 'event' | 'explicit' | 'recovery'>) => void;
  /** Implementação do porto `waitForWake` da engine. */
  readonly wait: (input: { readonly backoffMs: number; readonly signal: AbortSignal }) => Promise<WakeReason>;
  /** Libera timers/listeners pendentes (shutdown). */
  readonly dispose: () => void;
}

type Waiter = { readonly resolve: (reason: WakeReason) => void; readonly cleanup: () => void };

export function createWakeCoordinator(
  deps: { readonly setTimer?: typeof setTimeout; readonly clearTimer?: typeof clearTimeout } = {},
): WakeCoordinator {
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;

  // Um wake que chegou sem ninguém esperando — coalescido a UM. Guarda a PRIMEIRA razão
  // (qualquer wake dispara o mesmo reconcile; a razão é só telemetria).
  let pending: WakeReason | null = null;
  let waiter: Waiter | null = null;

  const signal = (reason: Extract<WakeReason, 'event' | 'explicit' | 'recovery'>): void => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w.cleanup();
      w.resolve(reason);
      return;
    }
    // Coalesce: mantém a primeira razão pendente.
    if (pending === null) pending = reason;
  };

  const wait = ({ backoffMs, signal: abortSignal }: { backoffMs: number; signal: AbortSignal }): Promise<WakeReason> => {
    if (abortSignal.aborted) return Promise.resolve('cancelled');
    // Wake pendente (coalescido durante o running) → resolve JÁ, consumindo-o.
    if (pending !== null) {
      const reason = pending;
      pending = null;
      return Promise.resolve(reason);
    }
    return new Promise<WakeReason>((resolve) => {
      let settled = false;
      const settle = (reason: WakeReason): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(reason);
      };
      const timer = setTimer(() => settle('poll'), backoffMs);
      const onAbort = (): void => settle('cancelled');
      abortSignal.addEventListener('abort', onAbort, { once: true });
      const cleanup = (): void => {
        clearTimer(timer);
        abortSignal.removeEventListener('abort', onAbort);
        if (waiter === thisWaiter) waiter = null;
      };
      const thisWaiter: Waiter = { resolve: settle, cleanup };
      waiter = thisWaiter;
    });
  };

  const dispose = (): void => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w.cleanup();
      w.resolve('cancelled');
    }
    pending = null;
  };

  return { signal, wait, dispose };
}
