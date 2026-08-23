import { subscribeWorkEventsWake } from './realtime-wake';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// Fiação da assinatura Realtime por um cliente FALSO (sem rede). Prova: autentica o canal
// com o token do usuário (RLS), assina INSERT em work_events, propaga o evento a onWake,
// reporta status e libera o canal no dispose.

function fakeClient() {
  const state = {
    authToken: null as string | null,
    channelName: null as string | null,
    onArgs: null as { type: string; filter: unknown } | null,
    eventCb: null as (() => void) | null,
    statusCb: null as ((s: string) => void) | null,
    subscribed: false,
    removed: 0,
  };
  const channel = {
    on(type: string, filter: unknown, cb: () => void) { state.onArgs = { type, filter }; state.eventCb = cb; return channel; },
    subscribe(statusCb: (s: string) => void) { state.subscribed = true; state.statusCb = statusCb; return channel; },
  };
  const client = {
    realtime: { setAuth(t: string) { state.authToken = t; } },
    channel(name: string) { state.channelName = name; return channel; },
    removeChannel(_ch: unknown) { state.removed++; return Promise.resolve('ok'); },
  };
  return { client: client as unknown as SupabaseClient<Database>, state };
}

describe('subscribeWorkEventsWake', () => {
  test('autentica o canal com o token do usuário e assina INSERT em work_events', () => {
    const { client, state } = fakeClient();
    subscribeWorkEventsWake({ client, accessToken: 'user-token', onWake: () => {} });
    expect(state.authToken).toBe('user-token'); // RLS por assinante — sem service_role.
    expect(state.channelName).toBe('resident-host-work-events');
    expect(state.onArgs).toEqual({ type: 'postgres_changes', filter: { event: 'INSERT', schema: 'public', table: 'work_events' } });
    expect(state.subscribed).toBe(true);
  });

  test('cada INSERT chama onWake', () => {
    const { client, state } = fakeClient();
    let wakes = 0;
    subscribeWorkEventsWake({ client, accessToken: 't', onWake: () => { wakes++; } });
    state.eventCb!();
    state.eventCb!();
    expect(wakes).toBe(2);
  });

  test('propaga status do canal', () => {
    const { client, state } = fakeClient();
    const statuses: string[] = [];
    subscribeWorkEventsWake({ client, accessToken: 't', onWake: () => {}, onStatus: (s) => statuses.push(s) });
    state.statusCb!('SUBSCRIBED');
    expect(statuses).toEqual(['SUBSCRIBED']);
  });

  test('dispose libera o canal', () => {
    const { client, state } = fakeClient();
    const handle = subscribeWorkEventsWake({ client, accessToken: 't', onWake: () => {} });
    handle.dispose();
    expect(state.removed).toBe(1);
  });
});
