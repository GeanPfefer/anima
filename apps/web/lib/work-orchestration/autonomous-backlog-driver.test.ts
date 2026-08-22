import {
  runAutonomousBacklogCycle,
  classifyTurnForDriver,
  type BacklogCycleDependencies,
} from './autonomous-backlog-driver';
import type { SupervisorTurnOutcome, SupervisorTurnResult } from './supervisor';
import type {
  AutonomousQueueCandidate,
  AutonomousQueueEntry,
  WorkIntelligenceClassificationV1,
  WorkItem,
  WorkState,
} from '@anima/core';
import type { Json } from '@anima/types';

// ============================================================
// O driver é a ITERAÇÃO; a política pura (`planAutonomousBacklogTurn`) já é
// provada no core. Aqui provamos o que é responsabilidade EXCLUSIVA do driver:
// executar exatamente uma volta por iteração, respeitar a política e o host,
// classificar o desfecho, parar sem spin, honrar o limite estrutural e o
// cancelamento — usando doubles, sem gastar execução real.
//
// QUAL item roda é decisão server-side do Supervisor (provada em supervisor.test),
// então o fake de `runTurn` roteiriza o desfecho; o de `readBacklog` roteiriza o
// estado do backlog que a política enxerga a cada iteração.
// ============================================================

const spec: Json = {
  schema_version: 1,
  target: { kind: 'project', reference: 'anima' },
  permissions: [],
  validation_criteria: [{ label: 'tests' }],
  limits: { max_attempts: 1 },
};
const T0 = new Date('2026-08-21T12:00:00Z');
const classification: WorkIntelligenceClassificationV1 = {
  schemaVersion: 1, complexity: 'bounded', risk: 'low', reversibility: 'reversible', planClarity: 'clear', urgency: 'normal',
  provenance: { kind: 'human_confirmed', classifiedAt: '2026-08-21T10:00:00Z', classifierId: 'user:opaque' },
};
const makeItem = (id: string, state: WorkState, target: string): WorkItem => ({
  id, userId: 'u', sourceMessageId: 'm', state, impactLevel: 'low', capability: 'programming', originalRequest: 'x',
  intent: { execution_spec: { ...(spec as object), target: { kind: 'project', reference: target } } as Json },
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: ['a.py'], excludedScope: ['deploy'], expectedEffects: ['ok'], risks: [] } },
  proposalVersion: 1, createdAt: T0, updatedAt: T0,
});
// Item PRONTO: approved + classificado + aprovação vigente, sem claim.
const ready = (id: string, seq: number, target = id): AutonomousQueueCandidate => ({
  item: makeItem(id, 'approved', target), currentClassification: classification,
  approval: { seq, approvedAt: new Date(T0.getTime() + seq * 1000), proposalVersion: 1 }, openClaim: null,
});
// Item em outro estado (não entra na fila; conta no `pending` por estado).
const inState = (id: string, state: WorkState, target = id): AutonomousQueueCandidate => ({
  item: makeItem(id, state, target), currentClassification: classification,
  approval: state === 'proposed' ? null : { seq: 1, approvedAt: T0, proposalVersion: 1 }, openClaim: null,
});

type Snapshot = readonly AutonomousQueueCandidate[];

const turn = (outcome: SupervisorTurnOutcome, workItemId: string | null = 'i'): SupervisorTurnResult => ({
  outcome, reconciliation: [],
  selection: workItemId === null ? null : {
    workItemId, approvedProposalVersion: 1, approvalSeq: 1, targetReference: workItemId,
    selectionPolicy: 'oldest_approval_first', queueSize: 1, runnerUpApprovalSeq: null, skippedOccupiedTargets: 0,
  },
  claimId: null, attemptId: null, terminalKind: null, routingDecision: null, routingAdjustment: null,
  claimReleased: false, requiresAnotherTurn: false, refusal: null, gaps: [],
});

// Roteiriza o backlog por iteração; repete o último quando esgota (o maxTurns e as
// paradas garantem terminação — o último costuma ser vazio ou levar a um stop).
const backlogScript = (snaps: readonly Snapshot[]) => {
  let i = 0;
  const calls = { count: 0 };
  const read = async (): Promise<Snapshot> => { calls.count++; return snaps[Math.min(i++, snaps.length - 1)] ?? []; };
  return { read, calls };
};

// Roteiriza os desfechos das voltas; conta as chamadas e captura entrada/sinal.
const turnScript = (results: readonly SupervisorTurnResult[]) => {
  const calls = { count: 0, entries: [] as string[], signals: [] as AbortSignal[] };
  const run = async (entry: AutonomousQueueEntry, signal: AbortSignal): Promise<SupervisorTurnResult> => {
    const r = results[Math.min(calls.count, results.length - 1)] ?? turn('no_eligible_work', null);
    calls.count++; calls.entries.push(entry.workItemId); calls.signals.push(signal);
    return r;
  };
  return { run, calls };
};

const cycle = (over: Partial<BacklogCycleDependencies>): BacklogCycleDependencies => ({
  readBacklog: async () => [],
  hostPermitsAutonomousWork: () => true,
  runTurn: async () => turn('no_eligible_work', null),
  maxTurns: 20,
  signal: new AbortController().signal,
  now: () => T0,
  ...over,
});

describe('driver do backlog autônomo — runAutonomousBacklogCycle', () => {
  // (1) ready A + ready B → executa A, terminal elegível, executa B, esvazia.
  test('executa itens elegíveis em sequência e para quando a fila esvazia', async () => {
    const backlog = backlogScript([[ready('A', 10), ready('B', 20)], [ready('B', 20)], []]);
    const turns = turnScript([turn('execution_completed', 'A'), turn('execution_completed', 'B')]);
    const result = await runAutonomousBacklogCycle(cycle({ readBacklog: backlog.read, runTurn: turns.run }));
    expect(result.turnsExecuted).toBe(2);
    expect(result.itemsTouched).toBe(2);
    expect(result.stopReason).toBe('no_eligible_work');
    expect(result.turns.map(t => t.workItemId)).toEqual(['A', 'B']);
    expect(turns.calls.count).toBe(2);
  });

  // (2) blocked A + ready B → não congela → executa B, depois para na fronteira.
  test('um item bloqueado nunca congela o backlog: o pronto executa', async () => {
    const backlog = backlogScript([[inState('A', 'blocked'), ready('B', 20)], [inState('A', 'blocked')]]);
    const turns = turnScript([turn('execution_completed', 'B')]);
    const result = await runAutonomousBacklogCycle(cycle({ readBacklog: backlog.read, runTurn: turns.run }));
    expect(result.turnsExecuted).toBe(1);
    expect(result.itemsTouched).toBe(1);
    expect(result.stopReason).toBe('awaiting_human_or_recovery');
    expect(result.pending.blocked).toBe(1);
  });

  // (3) ready A → review → o driver para porque o próximo exige revisão humana.
  test('para na fronteira humana quando o item vai a review e nada mais está pronto', async () => {
    const backlog = backlogScript([[ready('A', 10)], [inState('A', 'review')]]);
    const turns = turnScript([turn('execution_completed', 'A')]);
    const result = await runAutonomousBacklogCycle(cycle({ readBacklog: backlog.read, runTurn: turns.run }));
    expect(result.turnsExecuted).toBe(1);
    expect(result.stopReason).toBe('awaiting_human_or_recovery');
    expect(result.pending.awaitingHuman).toBe(1);
  });

  // (4) resource pressure → zero novas execuções.
  test('pressão do host: zero execuções, para em resource_pressure', async () => {
    const backlog = backlogScript([[ready('A', 10)]]);
    const turns = turnScript([turn('execution_completed', 'A')]);
    const result = await runAutonomousBacklogCycle(cycle({
      readBacklog: backlog.read, runTurn: turns.run, hostPermitsAutonomousWork: () => false,
    }));
    expect(result.turnsExecuted).toBe(0);
    expect(result.stopReason).toBe('resource_pressure');
    expect(turns.calls.count).toBe(0);
  });

  // (5) item já running → não inicia concorrência ilegal.
  test('item em execução: não inicia nova volta, para em work_in_progress', async () => {
    const backlog = backlogScript([[inState('A', 'in_progress')]]);
    const turns = turnScript([turn('execution_completed', 'A')]);
    const result = await runAutonomousBacklogCycle(cycle({ readBacklog: backlog.read, runTurn: turns.run }));
    expect(result.turnsExecuted).toBe(0);
    expect(result.stopReason).toBe('work_in_progress');
    expect(result.pending.running).toBe(1);
    expect(turns.calls.count).toBe(0);
  });

  // (6) executor/turn falha → não entra em spin.
  test('cabeça não-executável não gira em falso: para em turn_not_executable', async () => {
    // A política insiste em execute_next (backlog nunca esvazia), mas a volta não é
    // executável; sem a parada anti-spin, isto seria loop infinito.
    const backlog = backlogScript([[ready('A', 10)]]);
    const turns = turnScript([turn('selection_not_executable', 'A')]);
    const result = await runAutonomousBacklogCycle(cycle({ readBacklog: backlog.read, runTurn: turns.run, maxTurns: 50 }));
    expect(result.turnsExecuted).toBe(1);
    expect(result.stopReason).toBe('turn_not_executable');
    expect(turns.calls.count).toBe(1);
  });

  test('falha terminal de execução conta como toque e o ciclo segue até esvaziar', async () => {
    const backlog = backlogScript([[ready('A', 10)], []]);
    const turns = turnScript([turn('execution_failed', 'A')]);
    const result = await runAutonomousBacklogCycle(cycle({ readBacklog: backlog.read, runTurn: turns.run }));
    expect(result.turnsExecuted).toBe(1);
    expect(result.itemsTouched).toBe(1);
    expect(result.stopReason).toBe('no_eligible_work');
  });

  // (7) policy no_eligible_work → zero IO de execução.
  test('backlog vazio: zero execuções, para em no_eligible_work', async () => {
    const backlog = backlogScript([[]]);
    const turns = turnScript([turn('execution_completed', 'A')]);
    const result = await runAutonomousBacklogCycle(cycle({ readBacklog: backlog.read, runTurn: turns.run }));
    expect(result.turnsExecuted).toBe(0);
    expect(result.stopReason).toBe('no_eligible_work');
    expect(turns.calls.count).toBe(0);
  });

  // (8) max-turn bound → para mesmo com backlog restante.
  test('limite estrutural de voltas para mesmo com backlog restante', async () => {
    const backlog = backlogScript([[ready('A', 10), ready('B', 20)]]); // nunca esvazia (repete)
    const turns = turnScript([turn('execution_completed', 'A')]); // sempre completo
    const result = await runAutonomousBacklogCycle(cycle({ readBacklog: backlog.read, runTurn: turns.run, maxTurns: 3 }));
    expect(result.turnsExecuted).toBe(3);
    expect(result.stopReason).toBe('max_turns_reached');
    expect(turns.calls.count).toBe(3);
  });

  test('maxTurns não positivo: nenhuma volta, para em max_turns_reached', async () => {
    const backlog = backlogScript([[ready('A', 10)]]);
    const turns = turnScript([turn('execution_completed', 'A')]);
    const result = await runAutonomousBacklogCycle(cycle({ readBacklog: backlog.read, runTurn: turns.run, maxTurns: 0 }));
    expect(result.turnsExecuted).toBe(0);
    expect(result.stopReason).toBe('max_turns_reached');
    expect(turns.calls.count).toBe(0);
  });

  // (9) cancel signal → para deterministicamente.
  test('cancelamento antes da primeira volta: para sem ler o backlog', async () => {
    const controller = new AbortController();
    controller.abort();
    const backlog = backlogScript([[ready('A', 10)]]);
    const turns = turnScript([turn('execution_completed', 'A')]);
    const result = await runAutonomousBacklogCycle(cycle({
      readBacklog: backlog.read, runTurn: turns.run, signal: controller.signal,
    }));
    expect(result.turnsExecuted).toBe(0);
    expect(result.stopReason).toBe('cancelled');
    expect(backlog.calls.count).toBe(0);
    expect(turns.calls.count).toBe(0);
  });

  test('cancelamento no meio: para na verificação do topo da próxima iteração', async () => {
    const controller = new AbortController();
    const backlog = backlogScript([[ready('A', 10), ready('B', 20)]]); // nunca esvazia
    const turns = turnScript([turn('execution_completed', 'A')]);
    const runTurn = async (entry: AutonomousQueueEntry, signal: AbortSignal): Promise<SupervisorTurnResult> => {
      controller.abort(); // o cancelamento chega DURANTE a volta
      return turns.run(entry, signal);
    };
    const result = await runAutonomousBacklogCycle(cycle({
      readBacklog: backlog.read, runTurn, signal: controller.signal, maxTurns: 50,
    }));
    expect(result.turnsExecuted).toBe(1);
    expect(result.stopReason).toBe('cancelled');
  });

  // (10) race/claim rejection → seguro, sem duplicar execução.
  test('corrida de claim perdida: reavalia com segurança, sem duplicar execução', async () => {
    // A perde a corrida; o vencedor passa a executá-la (in_progress na 2ª leitura).
    const backlog = backlogScript([[ready('A', 10)], [inState('A', 'in_progress')]]);
    const turns = turnScript([turn('claim_refused', 'A')]);
    const result = await runAutonomousBacklogCycle(cycle({ readBacklog: backlog.read, runTurn: turns.run }));
    expect(result.turnsExecuted).toBe(1);
    expect(result.itemsTouched).toBe(0); // claim recusado não tocou o item
    expect(result.stopReason).toBe('work_in_progress');
    expect(turns.calls.count).toBe(1); // exatamente uma volta: nada duplicado
  });

  // Fronteiras de fim-de-ciclo explícitas.
  test('orçamento atingido encerra o ciclo em budget_exhausted', async () => {
    const backlog = backlogScript([[ready('A', 10)]]);
    const turns = turnScript([turn('budget_interrupted', 'A')]);
    const result = await runAutonomousBacklogCycle(cycle({ readBacklog: backlog.read, runTurn: turns.run }));
    expect(result.turnsExecuted).toBe(1);
    expect(result.itemsTouched).toBe(1);
    expect(result.stopReason).toBe('budget_exhausted');
  });

  test('pausa/cancelamento do usuário no checkpoint encerra em control_applied', async () => {
    const backlog = backlogScript([[ready('A', 10)]]);
    const turns = turnScript([turn('control_applied', 'A')]);
    const result = await runAutonomousBacklogCycle(cycle({ readBacklog: backlog.read, runTurn: turns.run }));
    expect(result.stopReason).toBe('control_applied');
  });

  test('tentativa aberta sem terminal confiável encerra em turn_incomplete (sem loop apertado)', async () => {
    const backlog = backlogScript([[ready('A', 10)]]);
    const turns = turnScript([turn('execution_interrupted', 'A')]);
    const result = await runAutonomousBacklogCycle(cycle({ readBacklog: backlog.read, runTurn: turns.run, maxTurns: 50 }));
    expect(result.turnsExecuted).toBe(1);
    expect(result.stopReason).toBe('turn_incomplete');
    expect(turns.calls.count).toBe(1);
  });

  test('itemsTouched conta itens DISTINTOS mesmo com múltiplas voltas no mesmo item', async () => {
    const backlog = backlogScript([[ready('A', 10)], [ready('A', 10)], []]);
    const turns = turnScript([turn('attempt_start_refused', 'A'), turn('execution_completed', 'A')]);
    const result = await runAutonomousBacklogCycle(cycle({ readBacklog: backlog.read, runTurn: turns.run }));
    expect(result.turnsExecuted).toBe(2);
    expect(result.itemsTouched).toBe(1);
    expect(result.stopReason).toBe('no_eligible_work');
  });

  test('explicabilidade humana: "executei N e parei porque o próximo exige humano"', async () => {
    const backlog = backlogScript([
      [ready('A', 10), ready('B', 20), ready('C', 30)],
      [ready('B', 20), ready('C', 30)],
      [ready('C', 30)],
      [inState('D', 'review')],
    ]);
    const turns = turnScript([
      turn('execution_completed', 'A'), turn('execution_completed', 'B'), turn('execution_completed', 'C'),
    ]);
    const result = await runAutonomousBacklogCycle(cycle({ readBacklog: backlog.read, runTurn: turns.run }));
    expect(result.turnsExecuted).toBe(3);
    expect(result.itemsTouched).toBe(3);
    expect(result.stopReason).toBe('awaiting_human_or_recovery');
    expect(result.lastOutcome).toBe('execution_completed');
  });
});

describe('classifyTurnForDriver — mapeamento puro de desfecho → veredito', () => {
  const cases: readonly [SupervisorTurnOutcome, boolean, string | null][] = [
    ['execution_completed', true, null],
    ['execution_failed', true, null],
    ['execution_cancelled', true, null],
    ['decision_required', true, null],
    ['resumption_requires_human', true, null],
    ['claim_refused', false, null],
    ['attempt_start_refused', true, null],
    ['budget_interrupted', true, 'budget_exhausted'],
    ['control_applied', true, 'control_applied'],
    ['execution_interrupted', true, 'turn_incomplete'],
    ['terminal_refused', true, 'turn_incomplete'],
    ['selection_not_executable', false, 'turn_not_executable'],
    ['routing_unavailable', false, 'turn_not_executable'],
    ['routing_refused', false, 'turn_not_executable'],
    ['no_eligible_work', false, 'no_eligible_work'],
  ];
  test.each(cases)('%s → touched=%s stop=%s', (outcome, touched, stop) => {
    expect(classifyTurnForDriver(outcome)).toEqual({ touched, stop });
  });
});
