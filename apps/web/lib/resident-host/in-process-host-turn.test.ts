import { createInProcessHostTurnPort, mapHostTurnResult } from './in-process-host-turn';
import type { BacklogHostTurnResult } from '../work-orchestration/autonomous-backlog-host-turn';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// O adapter in-process compõe a MESMA composition root da rota atrás de um cliente
// user-scoped construído do token. Provamos por doubles (sem Supabase/Next reais): mapeia
// o resultado, constrói o cliente do TOKEN (user-scoped, nunca service_role), fail-closed
// sem token, e nunca lança.

const RESULT: BacklogHostTurnResult = {
  cyclesExecuted: 1,
  turnsExecuted: 1,
  itemsTouched: 1,
  stopReason: 'max_cycles_reached',
  continuation: 'stop',
  moreWorkAvailable: false,
  lastOutcome: 'execution_completed',
  cycles: [
    {
      turnsExecuted: 1,
      itemsTouched: 1,
      stopReason: 'max_turns_reached',
      pending: { readyOccupied: 0, running: 0, awaitingHuman: 0, blocked: 0 },
      lastOutcome: 'execution_completed',
      turns: [{ workItemId: 'w1', outcome: 'execution_completed' }],
    },
  ],
};

const MAPPED = {
  ok: true, continuation: 'stop', stopReason: 'max_cycles_reached',
  moreWorkAvailable: false, cyclesExecuted: 1, itemsTouched: 1, workItemIds: ['w1'],
} as const;

// Sentinela de cliente — o adapter nunca o inspeciona, só o repassa à composition root.
const SENTINEL_CLIENT = { __brand: 'user-scoped' } as unknown as SupabaseClient<Database>;

describe('mapHostTurnResult (puro)', () => {
  test('mapeia o resultado + extrai os IDs distintos de work_items tocados', () => {
    expect(mapHostTurnResult(RESULT)).toEqual(MAPPED);
  });
  test('dedupe de workItemIds através de ciclos/voltas', () => {
    const dup: BacklogHostTurnResult = {
      ...RESULT, itemsTouched: 2,
      cycles: [
        { turnsExecuted: 1, itemsTouched: 1, stopReason: 'max_turns_reached', pending: { readyOccupied: 0, running: 0, awaitingHuman: 0, blocked: 0 }, lastOutcome: 'execution_completed', turns: [{ workItemId: 'a', outcome: 'execution_completed' }, { workItemId: null, outcome: 'selection_not_executable' }] },
        { turnsExecuted: 1, itemsTouched: 1, stopReason: 'max_turns_reached', pending: { readyOccupied: 0, running: 0, awaitingHuman: 0, blocked: 0 }, lastOutcome: 'execution_completed', turns: [{ workItemId: 'a', outcome: 'execution_completed' }, { workItemId: 'b', outcome: 'execution_completed' }] },
      ],
    };
    const out = mapHostTurnResult(dup);
    expect(out.ok).toBe(true);
    if (out.ok) expect([...out.workItemIds].sort()).toEqual(['a', 'b']);
  });
});

describe('createInProcessHostTurnPort', () => {
  const config = { ownerInstanceId: 'supervisor-test', maxTurnsPerCycle: 1, maxCycles: 2 };

  test('constrói o cliente do access token (user-scoped) e roda a composição real', async () => {
    const built: string[] = [];
    const seen: unknown[] = [];
    const port = createInProcessHostTurnPort(config, {
      buildClient: (token) => { built.push(token); return SENTINEL_CLIENT; },
      runHostTurn: async (input) => { seen.push(input); return RESULT; },
    });
    const out = await port({ userId: 'u1', accessToken: 'user-token' }, new AbortController().signal);

    expect(out).toEqual(MAPPED);
    // A ÚNICA construção de cliente veio do token do usuário — nenhum outro caminho.
    expect(built).toEqual(['user-token']);
    const input = seen[0] as { client: unknown; ownerInstanceId: string; maxTurnsPerCycle: number; maxCycles: number };
    expect(input.client).toBe(SENTINEL_CLIENT);
    expect(input.ownerInstanceId).toBe('supervisor-test');
    expect(input.maxTurnsPerCycle).toBe(1);
    expect(input.maxCycles).toBe(2);
  });

  test('fail-closed sem access token: não constrói cliente nem roda a composição', async () => {
    const built: string[] = [];
    const ran = { count: 0 };
    const port = createInProcessHostTurnPort(config, {
      buildClient: (token) => { built.push(token); return SENTINEL_CLIENT; },
      runHostTurn: async () => { ran.count++; return RESULT; },
    });
    const out = await port({ userId: 'u1', accessToken: '' }, new AbortController().signal);
    expect(out).toEqual({ ok: false, error: 'identity_missing' });
    expect(built).toEqual([]);   // nenhum cliente construído — nenhum caminho privilegiado.
    expect(ran.count).toBe(0);
  });

  test('nunca lança: erro da composição vira {ok:false}', async () => {
    const port = createInProcessHostTurnPort(config, {
      buildClient: () => SENTINEL_CLIENT,
      runHostTurn: async () => { throw new Error('supabase down'); },
    });
    const out = await port({ userId: 'u1', accessToken: 't' }, new AbortController().signal);
    expect(out).toEqual({ ok: false, error: 'supabase down' });
  });

  test('cancelamento durante a composição → {ok:false, error:cancelled}', async () => {
    const controller = new AbortController();
    const port = createInProcessHostTurnPort(config, {
      buildClient: () => SENTINEL_CLIENT,
      runHostTurn: async () => { controller.abort(); throw new Error('aborted mid-run'); },
    });
    const out = await port({ userId: 'u1', accessToken: 't' }, controller.signal);
    expect(out).toEqual({ ok: false, error: 'cancelled' });
  });

  test('propaga o AbortSignal do chamador à composição', async () => {
    const controller = new AbortController();
    let received: AbortSignal | null = null;
    const port = createInProcessHostTurnPort(config, {
      buildClient: () => SENTINEL_CLIENT,
      runHostTurn: async (input) => { received = input.signal; return RESULT; },
    });
    await port({ userId: 'u1', accessToken: 't' }, controller.signal);
    expect(received).toBe(controller.signal);
  });
});
