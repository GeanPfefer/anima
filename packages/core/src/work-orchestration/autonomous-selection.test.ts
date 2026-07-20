import { selectNextAutonomousWork, type AutonomousQueueEntry } from '.';

const T0 = new Date('2026-07-21T12:00:00Z');

const entry = (id: string, approvalSeq: number, queuePosition: number): AutonomousQueueEntry => ({
  workItemId: id,
  approvedProposalVersion: 1,
  approvalSeq,
  approvedAt: T0,
  capability: 'programming',
  targetReference: 'anima',
  queuePosition,
});

describe('seleção autônoma — política determinística', () => {
  test('fila vazia não seleciona nada', () => expect(selectNextAutonomousWork([])).toEqual({ outcome: 'empty_queue' }));

  test('escolhe a aprovação mais antiga e justifica a escolha', () => {
    expect(selectNextAutonomousWork([entry('i1', 10, 1), entry('i2', 20, 2), entry('i3', 30, 3)])).toEqual({
      outcome: 'selected',
      entry: entry('i1', 10, 1),
      rationale: { policy: 'oldest_approval_first', queueSize: 3, selectedPosition: 1, approvalSeq: 10, runnerUpApprovalSeq: 20 },
    });
  });

  test('com um único item não há segundo colocado', () => {
    const decision = selectNextAutonomousWork([entry('i1', 10, 1)]);
    expect(decision).toMatchObject({ outcome: 'selected', rationale: { queueSize: 1, runnerUpApprovalSeq: null } });
  });

  test('a seleção é reproduzível: a mesma fila escolhe sempre o mesmo item', () => {
    const queue = [entry('i1', 10, 1), entry('i2', 20, 2)];
    expect(selectNextAutonomousWork(queue)).toEqual(selectNextAutonomousWork(queue));
  });

  test('a política não pondera capacidade nem alvo', () => {
    const queue = [
      { ...entry('i1', 10, 1), capability: 'research' as const, targetReference: 'outro' },
      entry('i2', 20, 2),
    ];
    expect(selectNextAutonomousWork(queue)).toMatchObject({ outcome: 'selected', entry: { workItemId: 'i1' } });
  });

  test('a política não usa horário de aprovação', () => {
    const queue = [
      { ...entry('i1', 10, 1), approvedAt: new Date('2030-01-01T00:00:00Z') },
      { ...entry('i2', 20, 2), approvedAt: new Date('2020-01-01T00:00:00Z') },
    ];
    expect(selectNextAutonomousWork(queue)).toMatchObject({ outcome: 'selected', entry: { workItemId: 'i1' } });
  });
});

describe('seleção autônoma — fila ambígua não autoriza execução', () => {
  test('posições que não começam em 1 são recusadas', () =>
    expect(selectNextAutonomousWork([entry('i1', 10, 2)])).toMatchObject({ outcome: 'refused', reason: 'positions_not_contiguous' }));

  test('posições com lacuna são recusadas', () =>
    expect(selectNextAutonomousWork([entry('i1', 10, 1), entry('i2', 20, 3)])).toMatchObject({ outcome: 'refused', reason: 'positions_not_contiguous' }));

  test('ordem não crescente na sequência de aprovação é recusada', () =>
    expect(selectNextAutonomousWork([entry('i1', 30, 1), entry('i2', 20, 2)])).toMatchObject({ outcome: 'refused', reason: 'order_not_monotonic' }));

  test('sequência repetida é ambígua e recusada', () =>
    expect(selectNextAutonomousWork([entry('i1', 10, 1), entry('i2', 10, 2)])).toMatchObject({ outcome: 'refused', reason: 'order_not_monotonic' }));

  test('item repetido na fila é recusado', () =>
    expect(selectNextAutonomousWork([entry('i1', 10, 1), entry('i1', 20, 2)])).toMatchObject({ outcome: 'refused', reason: 'duplicate_work_item' }));

  test('a recusa não escolhe nenhum item', () => {
    const decision = selectNextAutonomousWork([entry('i1', 30, 1), entry('i2', 20, 2)]);
    expect(decision).not.toHaveProperty('entry');
  });
});
