import { createWakeCoordinator } from './wake';

// Fake timer controlável: captura callbacks e permite dispará-los manualmente, para
// provar o fallback 'poll' de forma determinística sem relógio real.
function fakeTimers() {
  const timers = new Map<number, () => void>();
  let id = 0;
  const setTimer = ((cb: () => void) => { const t = ++id; timers.set(t, cb); return t as unknown; }) as typeof setTimeout;
  const clearTimer = ((t: unknown) => { timers.delete(t as number); }) as typeof clearTimeout;
  const fireAll = () => { for (const [t, cb] of [...timers]) { timers.delete(t); cb(); } };
  return { setTimer, clearTimer, fireAll, get pending() { return timers.size; } };
}

const fresh = () => {
  const ft = fakeTimers();
  const coord = createWakeCoordinator({ setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  return { ft, coord };
};

describe('createWakeCoordinator', () => {
  test('sinal ANTES da espera (coalescido durante running) → resolve JÁ com a razão', async () => {
    const { coord } = fresh();
    coord.signal('event');
    const reason = await coord.wait({ backoffMs: 999_999, signal: new AbortController().signal });
    expect(reason).toBe('event');
  });

  test('múltiplos sinais antes da espera → COALESCIDOS a um (2ª espera vai a poll)', async () => {
    const { ft, coord } = fresh();
    coord.signal('event');
    coord.signal('event');
    coord.signal('explicit');
    expect(await coord.wait({ backoffMs: 1, signal: new AbortController().signal })).toBe('event'); // 1ª razão
    // Pendente consumido: a próxima espera NÃO retorna outro evento — só o fallback poll.
    const p = coord.wait({ backoffMs: 1, signal: new AbortController().signal });
    ft.fireAll();
    expect(await p).toBe('poll');
  });

  test('espera e então sinal → a espera resolve com a razão sinalizada', async () => {
    const { coord } = fresh();
    const p = coord.wait({ backoffMs: 999_999, signal: new AbortController().signal });
    coord.signal('event');
    expect(await p).toBe('event');
  });

  test('sem sinal → fallback poll quando o timer dispara', async () => {
    const { ft, coord } = fresh();
    const p = coord.wait({ backoffMs: 5, signal: new AbortController().signal });
    expect(ft.pending).toBe(1);
    ft.fireAll();
    expect(await p).toBe('poll');
  });

  test('abort durante a espera → cancelled', async () => {
    const { coord } = fresh();
    const c = new AbortController();
    const p = coord.wait({ backoffMs: 999_999, signal: c.signal });
    c.abort();
    expect(await p).toBe('cancelled');
  });

  test('já abortado → cancelled imediato, sem timer', async () => {
    const { ft, coord } = fresh();
    const c = new AbortController();
    c.abort();
    expect(await coord.wait({ backoffMs: 999_999, signal: c.signal })).toBe('cancelled');
    expect(ft.pending).toBe(0);
  });

  test('dispose durante a espera → resolve cancelled e limpa timers', async () => {
    const { ft, coord } = fresh();
    const p = coord.wait({ backoffMs: 999_999, signal: new AbortController().signal });
    coord.dispose();
    expect(await p).toBe('cancelled');
    expect(ft.pending).toBe(0);
  });

  test('sinal resolve a espera atual e não deixa pendência (próxima espera vai a poll)', async () => {
    const { ft, coord } = fresh();
    const p1 = coord.wait({ backoffMs: 1, signal: new AbortController().signal });
    coord.signal('explicit');
    expect(await p1).toBe('explicit');
    const p2 = coord.wait({ backoffMs: 1, signal: new AbortController().signal });
    ft.fireAll();
    expect(await p2).toBe('poll');
  });

  test('timer é limpo ao resolver por sinal (sem vazamento)', async () => {
    const { ft, coord } = fresh();
    const p = coord.wait({ backoffMs: 999_999, signal: new AbortController().signal });
    expect(ft.pending).toBe(1);
    coord.signal('event');
    await p;
    expect(ft.pending).toBe(0);
  });
});
