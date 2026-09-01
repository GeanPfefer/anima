import type { BacklogHostTurnResult } from './autonomous-backlog-host-turn';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@anima/types';

// Amarração por workItemId (ADR-003, Governed Retry V0): quando a invocação veio de um
// ato explícito (sinal/retry governado), esta volta é limitada ao item pedido. Provamos
// que o ciclo real recebe SÓ o item solicitado e que um pedido inelegível/inexistente
// esvazia o backlog em vez de cair em "qualquer item elegível" (sem fallback global).

jest.mock('./autonomous-backlog-deps', () => ({ buildProjectBacklogCycleDeps: jest.fn() }));
jest.mock('./autonomous-backlog-driver', () => ({ runAutonomousBacklogCycle: jest.fn() }));
jest.mock('./autonomous-backlog-host-turn', () => ({ runAutonomousBacklogHostTurn: jest.fn() }));

import { runProjectBacklogHostTurn } from './backlog-host-turn-run';
import { buildProjectBacklogCycleDeps } from './autonomous-backlog-deps';
import { runAutonomousBacklogCycle } from './autonomous-backlog-driver';
import { runAutonomousBacklogHostTurn } from './autonomous-backlog-host-turn';

const RESULT = { cyclesExecuted: 0, turnsExecuted: 0, itemsTouched: 0, stopReason: 'max_cycles_reached', continuation: 'stop', moreWorkAvailable: false, lastOutcome: null, cycles: [] } as unknown as BacklogHostTurnResult;
type RawEntry = string | { readonly id: string; readonly state?: string };
const candidate = (entry: RawEntry) => (typeof entry === 'string' ? { item: { id: entry } } : { item: { id: entry.id, state: entry.state } });

// O host-turn é mockado: apenas dispara UM ciclo e devolve o resultado. O ciclo captura o
// que `readBacklog` (possivelmente filtrado pela amarração) realmente entrega ao driver.
function wire(rawBacklog: readonly RawEntry[]): () => Promise<string[]> {
  let seen: string[] = [];
  (buildProjectBacklogCycleDeps as jest.Mock).mockReturnValue({
    readBacklog: async () => rawBacklog.map(candidate),
    hostPermitsAutonomousWork: () => true,
    runTurn: jest.fn(),
  });
  (runAutonomousBacklogCycle as jest.Mock).mockImplementation(async (deps: { readBacklog: () => Promise<ReadonlyArray<{ item: { id: string } }>> }) => {
    seen = (await deps.readBacklog()).map(entry => entry.item.id);
    return { turnsExecuted: 0, itemsTouched: 0, stopReason: 'max_turns_reached', turns: [] };
  });
  (runAutonomousBacklogHostTurn as jest.Mock).mockImplementation(async (deps: { runCycle: (signal: AbortSignal) => Promise<unknown> }) => {
    await deps.runCycle(new AbortController().signal);
    return RESULT;
  });
  return async () => seen;
}

const run = (requestedWorkItemId?: string) => runProjectBacklogHostTurn({
  client: {} as SupabaseClient<Database>, ownerInstanceId: 'owner', maxTurnsPerCycle: 1, maxCycles: 1,
  signal: new AbortController().signal, ...(requestedWorkItemId ? { requestedWorkItemId } : {}),
});

describe('runProjectBacklogHostTurn — amarração por workItemId', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sinal para A com A e B elegíveis entrega SÓ A ao ciclo', async () => {
    const readSeen = wire(['A', 'B']);
    await run('A');
    expect(await readSeen()).toEqual(['A']);
  });

  test('item pedido inelegível/inexistente esvazia o backlog — sem fallback para outro', async () => {
    const readSeen = wire(['A', 'B']);
    await run('C');
    expect(await readSeen()).toEqual([]);
  });

  test('sinal para B preserva a dependência `completed` A (senão B sairia da fila por dependência)', async () => {
    // B (pedido) depende de A (completed). A amarração mantém B E A (inerte), descarta X.
    const readSeen = wire([{ id: 'B', state: 'approved' }, { id: 'A', state: 'completed' }, { id: 'X', state: 'approved' }]);
    await run('B');
    expect((await readSeen()).sort()).toEqual(['A', 'B']);
  });

  test('sem ato explícito mantém o backlog autônomo íntegro (comportamento idle)', async () => {
    const readSeen = wire(['A', 'B']);
    await run();
    expect(await readSeen()).toEqual(['A', 'B']);
  });
});
