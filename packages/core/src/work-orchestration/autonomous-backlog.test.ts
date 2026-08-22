import {
  planAutonomousBacklogTurn,
  type AutonomousQueueCandidate,
  type WorkIntelligenceClassificationV1,
  type WorkItem,
  type WorkState,
} from '.';
import type { Json } from '@anima/types';

const spec: Json = { schema_version: 1, target: { kind: 'project', reference: 'anima' }, permissions: [], validation_criteria: [{ label: 'tests' }], limits: { max_attempts: 1 } };
const T0 = new Date('2026-08-21T12:00:00Z');
const at = (s: number): Date => new Date(T0.getTime() + s * 1000);
const classification: WorkIntelligenceClassificationV1 = {
  schemaVersion: 1, complexity: 'bounded', risk: 'low', reversibility: 'reversible', planClarity: 'clear', urgency: 'normal',
  provenance: { kind: 'human_confirmed', classifiedAt: '2026-08-21T10:00:00Z', classifierId: 'user:opaque' },
};
const makeItem = (id: string, state: WorkState, target = 'anima'): WorkItem => ({
  id, userId: 'u', sourceMessageId: 'm', state, impactLevel: 'low', capability: 'programming', originalRequest: 'x',
  intent: { execution_spec: { ...(spec as object), target: { kind: 'project', reference: target } } as Json },
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: ['a.py'], excludedScope: ['deploy'], expectedEffects: ['ok'], risks: [] } },
  proposalVersion: 1, createdAt: T0, updatedAt: T0,
});
// Item pronto: approved + classificado + aprovação vigente.
const ready = (id: string, seq: number, target = 'anima'): AutonomousQueueCandidate => ({
  item: makeItem(id, 'approved', target), currentClassification: classification,
  approval: { seq, approvedAt: at(seq), proposalVersion: 1 }, openClaim: null,
});
// Item em outro estado (não entra na fila; conta só no pending por estado).
const inState = (id: string, state: WorkState, target = 'anima'): AutonomousQueueCandidate => ({
  item: makeItem(id, state, target), currentClassification: classification,
  approval: state === 'proposed' ? null : { seq: 1, approvedAt: at(1), proposalVersion: 1 }, openClaim: null,
});

describe('backlog autônomo — planAutonomousBacklogTurn', () => {
  test('escolhe o item PRONTO e livre de maior prioridade (FIFO)', () => {
    const d = planAutonomousBacklogTurn({ candidates: [ready('i2', 20, 'b'), ready('i1', 10, 'a')], now: T0 });
    expect(d.action).toBe('execute_next');
    if (d.action !== 'execute_next') throw new Error('x');
    expect(d.entry.workItemId).toBe('i1');
  });

  test('um item BLOQUEADO nunca congela o backlog: o pronto ainda executa', () => {
    const d = planAutonomousBacklogTurn({ candidates: [inState('b1', 'blocked', 'a'), ready('r1', 10, 'z')], now: T0 });
    expect(d).toMatchObject({ action: 'execute_next', entry: { workItemId: 'r1' } });
    if (d.action !== 'execute_next') throw new Error('x');
    expect(d.pending.blocked).toBe(1);
  });

  test('pressão do host tem precedência: para mesmo havendo item pronto', () => {
    const d = planAutonomousBacklogTurn({ candidates: [ready('r1', 10)], now: T0, hostPermitsAutonomousWork: false });
    expect(d).toMatchObject({ action: 'stop', reason: 'resource_pressure' });
  });

  test('elegível com alvo ocupado (por execução no mesmo alvo) → awaiting_target', () => {
    // r1 e o in_progress compartilham o alvo "anima": o alvo está ocupado.
    const d = planAutonomousBacklogTurn({ candidates: [ready('r1', 10, 'anima'), inState('p1', 'in_progress', 'anima')], now: T0 });
    expect(d).toMatchObject({ action: 'stop', reason: 'awaiting_target' });
    if (d.action !== 'stop') throw new Error('x');
    expect(d.pending).toMatchObject({ readyOccupied: 1, running: 1 });
  });

  test('nada pronto, só execução em andamento (alvo distinto) → work_in_progress', () => {
    const d = planAutonomousBacklogTurn({ candidates: [inState('p1', 'in_progress', 'anima')], now: T0 });
    expect(d).toMatchObject({ action: 'stop', reason: 'work_in_progress', pending: { running: 1 } });
  });

  test('só fronteira humana (proposed/review/changes_requested) → awaiting_human_or_recovery', () => {
    const d = planAutonomousBacklogTurn({ candidates: [inState('a', 'proposed'), inState('b', 'review'), inState('c', 'changes_requested')], now: T0 });
    expect(d).toMatchObject({ action: 'stop', reason: 'awaiting_human_or_recovery', pending: { awaitingHuman: 3 } });
  });

  test('só bloqueados → awaiting_human_or_recovery (humano OU recuperação por orçamento)', () => {
    const d = planAutonomousBacklogTurn({ candidates: [inState('a', 'blocked'), inState('b', 'blocked')], now: T0 });
    expect(d).toMatchObject({ action: 'stop', reason: 'awaiting_human_or_recovery', pending: { blocked: 2 } });
  });

  test('sem nenhum trabalho não encerrado → no_eligible_work', () => {
    expect(planAutonomousBacklogTurn({ candidates: [], now: T0 })).toMatchObject({ action: 'stop', reason: 'no_eligible_work', pending: { readyOccupied: 0, running: 0, awaitingHuman: 0, blocked: 0 } });
  });

  test('itens terminais no conjunto não geram ação nem contam como pendência autônoma', () => {
    const d = planAutonomousBacklogTurn({ candidates: [inState('x', 'completed'), inState('y', 'failed'), inState('z', 'rejected')], now: T0 });
    expect(d).toMatchObject({ action: 'stop', reason: 'no_eligible_work' });
  });

  test('é puro: os mesmos insumos produzem a mesma decisão', () => {
    const c = [inState('b1', 'blocked'), ready('r1', 10, 'z')];
    expect(planAutonomousBacklogTurn({ candidates: c, now: T0 })).toEqual(planAutonomousBacklogTurn({ candidates: c, now: at(5000) }));
  });
});
