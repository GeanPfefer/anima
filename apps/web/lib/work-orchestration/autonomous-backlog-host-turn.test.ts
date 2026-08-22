import {
  runAutonomousBacklogHostTurn,
  classifyCycleContinuation,
  type BacklogHostTurnDependencies,
} from './autonomous-backlog-host-turn';
import type { BacklogCycleResult, BacklogCycleStopReason } from './autonomous-backlog-driver';
import type { SupervisorTurnOutcome } from './supervisor';

// ============================================================
// O host-turn é a CONTINUAÇÃO entre ciclos. A continuidade DENTRO de um ciclo já
// é provada em autonomous-backlog-driver.test. Aqui provamos o que é exclusivo do
// host: continuar sozinho SÓ quando um ciclo bateu no bound (max_turns_reached) e
// há mais trabalho, parar tipado nas fronteiras, respeitar o 2º bound (maxCycles),
// o cancelamento e a pressão de recurso — tudo por doubles, sem execução real.
// ============================================================

const EMPTY_PENDING = { readyOccupied: 0, running: 0, awaitingHuman: 0, blocked: 0 };

const cycle = (
  stopReason: BacklogCycleStopReason,
  turns: readonly [string, SupervisorTurnOutcome][] = [],
): BacklogCycleResult => ({
  turnsExecuted: turns.length,
  itemsTouched: new Set(turns.map(([id]) => id)).size,
  stopReason,
  pending: EMPTY_PENDING,
  lastOutcome: turns.length > 0 ? turns[turns.length - 1]![1] : null,
  turns: turns.map(([workItemId, outcome]) => ({ workItemId, outcome })),
});

const cycleScript = (results: readonly BacklogCycleResult[]) => {
  const calls = { count: 0, signals: [] as AbortSignal[] };
  const run = async (signal: AbortSignal): Promise<BacklogCycleResult> => {
    const r = results[Math.min(calls.count, results.length - 1)] ?? cycle('no_eligible_work');
    calls.count++; calls.signals.push(signal);
    return r;
  };
  return { run, calls };
};

const peekScript = (value: boolean) => {
  const calls = { count: 0 };
  const peek = async (): Promise<boolean> => { calls.count++; return value; };
  return { peek, calls };
};

const host = (over: Partial<BacklogHostTurnDependencies>): BacklogHostTurnDependencies => ({
  runCycle: async () => cycle('no_eligible_work'),
  peekMoreWork: async () => false,
  maxCycles: 5,
  signal: new AbortController().signal,
  ...over,
});

describe('host-turn do backlog — runAutonomousBacklogHostTurn', () => {
  // (1) cycle max_turns_reached + ainda há trabalho → continuation = continue.
  test('bound de ciclo atingido com mais trabalho → continuation=continue no bound de host', async () => {
    const cy = cycleScript([cycle('max_turns_reached', [['A', 'execution_completed']])]);
    const pk = peekScript(true);
    const r = await runAutonomousBacklogHostTurn(host({ runCycle: cy.run, peekMoreWork: pk.peek, maxCycles: 1 }));
    expect(r.stopReason).toBe('max_cycles_reached');
    expect(r.continuation).toBe('continue');
    expect(r.moreWorkAvailable).toBe(true);
    expect(r.cyclesExecuted).toBe(1);
    expect(r.turnsExecuted).toBe(1);
    expect(pk.calls.count).toBe(1);
  });

  // (2) max_turns_reached + replan no_eligible_work → não continua.
  test('próximo ciclo descobre fila drenada → para em no_eligible_work (stop)', async () => {
    const cy = cycleScript([
      cycle('max_turns_reached', [['A', 'execution_completed']]),
      cycle('no_eligible_work'),
    ]);
    const r = await runAutonomousBacklogHostTurn(host({ runCycle: cy.run, maxCycles: 5 }));
    expect(r.cyclesExecuted).toBe(2);
    expect(r.stopReason).toBe('no_eligible_work');
    expect(r.continuation).toBe('stop');
    expect(r.moreWorkAvailable).toBe(false);
    expect(r.turnsExecuted).toBe(1);
  });

  // (3) A→review + B ready → B executado em ciclo seguinte.
  test('A→review num ciclo, B pronto no próximo → ambos executados (não congela)', async () => {
    const cy = cycleScript([
      cycle('max_turns_reached', [['A', 'execution_completed']]),
      cycle('max_turns_reached', [['B', 'execution_completed']]),
    ]);
    const r = await runAutonomousBacklogHostTurn(host({ runCycle: cy.run, peekMoreWork: async () => false, maxCycles: 2 }));
    expect(r.cyclesExecuted).toBe(2);
    expect(r.itemsTouched).toBe(2);
    expect(r.stopReason).toBe('max_cycles_reached');
    expect(r.cycles.flatMap(c => c.turns.map(t => t.workItemId))).toEqual(['A', 'B']);
  });

  // (4) só fronteira humana → wait.
  test('só fronteira humana/recuperação → continuation=wait, zero voltas', async () => {
    const cy = cycleScript([cycle('awaiting_human_or_recovery')]);
    const r = await runAutonomousBacklogHostTurn(host({ runCycle: cy.run }));
    expect(r.cyclesExecuted).toBe(1);
    expect(r.turnsExecuted).toBe(0);
    expect(r.stopReason).toBe('awaiting_human_or_recovery');
    expect(r.continuation).toBe('wait');
  });

  // (5) resource pressure entre ciclos → não inicia próximo.
  test('pressão de recurso no ciclo seguinte → para em resource_pressure sem nova execução', async () => {
    const cy = cycleScript([
      cycle('max_turns_reached', [['A', 'execution_completed']]),
      cycle('resource_pressure'), // hostPermits caiu: 0 voltas
    ]);
    const r = await runAutonomousBacklogHostTurn(host({ runCycle: cy.run, maxCycles: 5 }));
    expect(r.cyclesExecuted).toBe(2);
    expect(r.cycles[1]!.turnsExecuted).toBe(0);
    expect(r.stopReason).toBe('resource_pressure');
    expect(r.continuation).toBe('wait');
    expect(r.turnsExecuted).toBe(1);
  });

  // (6) cancel entre ciclos → não inicia próximo.
  test('cancelamento entre ciclos: nenhum ciclo adicional', async () => {
    const controller = new AbortController();
    let n = 0;
    const runCycle = async (signal: AbortSignal): Promise<BacklogCycleResult> => {
      n++; controller.abort(); // o cancelamento chega durante/entre ciclos
      return cycle('max_turns_reached', [['A', 'execution_completed']]);
    };
    const r = await runAutonomousBacklogHostTurn(host({ runCycle, signal: controller.signal, maxCycles: 5 }));
    expect(n).toBe(1);
    expect(r.cyclesExecuted).toBe(1);
    expect(r.stopReason).toBe('cancelled');
    expect(r.continuation).toBe('stop');
  });

  test('cancelamento antes do primeiro ciclo: nenhum ciclo, sem peek', async () => {
    const controller = new AbortController(); controller.abort();
    const cy = cycleScript([cycle('max_turns_reached')]);
    const pk = peekScript(true);
    const r = await runAutonomousBacklogHostTurn(host({ runCycle: cy.run, peekMoreWork: pk.peek, signal: controller.signal }));
    expect(r.cyclesExecuted).toBe(0);
    expect(r.stopReason).toBe('cancelled');
    expect(cy.calls.count).toBe(0);
    expect(pk.calls.count).toBe(0);
  });

  // (7) maxCycles atingido + ainda há backlog → para com bound tipado, sem fingir conclusão.
  test('maxCycles atingido com mais trabalho → max_cycles_reached + continue (não finge conclusão)', async () => {
    const cy = cycleScript([
      cycle('max_turns_reached', [['A', 'execution_completed']]),
      cycle('max_turns_reached', [['B', 'execution_completed']]),
    ]);
    const pk = peekScript(true);
    const r = await runAutonomousBacklogHostTurn(host({ runCycle: cy.run, peekMoreWork: pk.peek, maxCycles: 2 }));
    expect(r.cyclesExecuted).toBe(2);
    expect(r.stopReason).toBe('max_cycles_reached');
    expect(r.continuation).toBe('continue'); // sinaliza que há mais — não é "concluído"
    expect(r.moreWorkAvailable).toBe(true);
    expect(cy.calls.count).toBe(2); // respeitou o bound: não rodou um 3º ciclo
  });

  // (8) cycle falha → sem spin/retry infinito.
  test('ciclo com cabeça não-executável → para (stop), sem retry infinito', async () => {
    const cy = cycleScript([cycle('turn_not_executable')]);
    const r = await runAutonomousBacklogHostTurn(host({ runCycle: cy.run, maxCycles: 50 }));
    expect(r.cyclesExecuted).toBe(1);
    expect(cy.calls.count).toBe(1);
    expect(r.stopReason).toBe('turn_not_executable');
    expect(r.continuation).toBe('stop');
  });

  test('ciclo com tentativa aberta (turn_incomplete) → wait (retomar depois), sem spin', async () => {
    const cy = cycleScript([cycle('turn_incomplete')]);
    const r = await runAutonomousBacklogHostTurn(host({ runCycle: cy.run, maxCycles: 50 }));
    expect(r.cyclesExecuted).toBe(1);
    expect(r.stopReason).toBe('turn_incomplete');
    expect(r.continuation).toBe('wait');
  });

  // (9) claim race/rejection → comportamento seguro sem duplicar.
  test('corrida perdida (item assumido por outro host) → wait/stop tipado, sem spin', async () => {
    const cy = cycleScript([cycle('work_in_progress')]);
    const r = await runAutonomousBacklogHostTurn(host({ runCycle: cy.run, maxCycles: 5 }));
    expect(r.cyclesExecuted).toBe(1);
    expect(r.stopReason).toBe('work_in_progress');
    expect(r.continuation).toBe('wait');
    expect(cy.calls.count).toBe(1);
  });

  // (10) zero trabalho → zero execução do Supervisor.
  test('backlog vazio → 1 ciclo com 0 voltas, para em no_eligible_work', async () => {
    const cy = cycleScript([cycle('no_eligible_work')]);
    const r = await runAutonomousBacklogHostTurn(host({ runCycle: cy.run }));
    expect(r.turnsExecuted).toBe(0);
    expect(r.stopReason).toBe('no_eligible_work');
    expect(r.continuation).toBe('stop');
  });

  test('itemsTouched é distinto entre ciclos', async () => {
    const cy = cycleScript([
      cycle('max_turns_reached', [['A', 'attempt_start_refused']]),
      cycle('max_turns_reached', [['A', 'execution_completed']]), // mesmo item de novo
      cycle('no_eligible_work'),
    ]);
    const r = await runAutonomousBacklogHostTurn(host({ runCycle: cy.run, maxCycles: 5 }));
    expect(r.itemsTouched).toBe(1);
    expect(r.turnsExecuted).toBe(2);
  });

  test('maxCycles não positivo → nenhum ciclo, max_cycles_reached, sem peek', async () => {
    const cy = cycleScript([cycle('max_turns_reached')]);
    const pk = peekScript(true);
    const r = await runAutonomousBacklogHostTurn(host({ runCycle: cy.run, peekMoreWork: pk.peek, maxCycles: 0 }));
    expect(r.cyclesExecuted).toBe(0);
    expect(r.stopReason).toBe('max_cycles_reached');
    expect(r.moreWorkAvailable).toBe(false);
    expect(pk.calls.count).toBe(0); // sem ciclos rodados, não há o que "sobrar"
    expect(cy.calls.count).toBe(0);
  });

  test('drenou exatamente no bound de host (peek=false) → max_cycles_reached + stop', async () => {
    const cy = cycleScript([cycle('max_turns_reached', [['A', 'execution_completed']])]);
    const pk = peekScript(false);
    const r = await runAutonomousBacklogHostTurn(host({ runCycle: cy.run, peekMoreWork: pk.peek, maxCycles: 1 }));
    expect(r.stopReason).toBe('max_cycles_reached');
    expect(r.continuation).toBe('stop');
    expect(r.moreWorkAvailable).toBe(false);
    expect(pk.calls.count).toBe(1);
  });
});

describe('classifyCycleContinuation — mapeamento puro razão→veredito', () => {
  const cases: readonly [BacklogCycleStopReason, string][] = [
    ['max_turns_reached', 'continue'],
    ['no_eligible_work', 'stop'],
    ['turn_not_executable', 'stop'],
    ['control_applied', 'stop'],
    ['cancelled', 'stop'],
    ['awaiting_target', 'wait'],
    ['work_in_progress', 'wait'],
    ['awaiting_human_or_recovery', 'wait'],
    ['resource_pressure', 'wait'],
    ['budget_exhausted', 'wait'],
    ['turn_incomplete', 'wait'],
  ];
  test.each(cases)('%s → %s', (reason, expected) => {
    expect(classifyCycleContinuation(reason)).toBe(expected);
  });
});
