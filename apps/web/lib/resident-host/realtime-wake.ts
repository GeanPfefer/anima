import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Fonte de wake EVENT-DRIVEN do resident host (ADR-003, AUTO_EVENT_WAKE).
//
// Assina o Realtime de INSERTs em `public.work_events` (migration
// `20260823000000_work_events_realtime`) e chama `onWake()` a cada mudança — o sinal que
// o `WakeCoordinator` transforma em wake coalescido. A RLS de `work_events` é a autoridade:
// o Realtime aplica a política SELECT por assinante usando o JWT do usuário, então o
// resident host (com o Bearer do usuário) só recebe eventos DAQUELE usuário. NUNCA
// service_role. A fonte do wake NÃO é a fonte da decisão: `onWake` só diz "acorde".
//
// Thin e injetável: o cliente é injetado (o entry passa um `createBearerClient`). Um teste
// exercita a fiação por um cliente falso.
// ============================================================

export interface RealtimeWakeHandle {
  readonly dispose: () => void;
}

export interface SubscribeWorkEventsWakeInput {
  readonly client: SupabaseClient<Database>;
  /** Access token do usuário para autenticar o canal Realtime (RLS por assinante). */
  readonly accessToken: string;
  /** Chamado a cada INSERT observado em `work_events` (o coordenador coalesce). */
  readonly onWake: () => void;
  /** Status do canal (`SUBSCRIBED`/`CHANNEL_ERROR`/…), para telemetria. */
  readonly onStatus?: (status: string) => void;
  readonly channelName?: string;
}

/** Assina INSERTs de `work_events` via Realtime. Devolve um handle para `dispose()` no
 * shutdown. Best-effort: falha de assinatura não derruba o runner — o fallback de poll do
 * coordenador cobre eventos perdidos. */
export function subscribeWorkEventsWake(input: SubscribeWorkEventsWakeInput): RealtimeWakeHandle {
  // O canal Realtime precisa do JWT do usuário para a RLS de postgres_changes.
  input.client.realtime.setAuth(input.accessToken);
  const channel = input.client
    .channel(input.channelName ?? 'resident-host-work-events')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'work_events' },
      () => input.onWake(),
    )
    .subscribe((status) => input.onStatus?.(status));

  return {
    dispose: () => {
      void input.client.removeChannel(channel);
    },
  };
}
