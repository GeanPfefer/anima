import {
  projectAutonomousQueue,
  selectNextAutonomousWork,
  type AutonomousQueueCandidate,
  type AutonomousQueueEntry,
  type WorkClaim,
  type WorkIntelligenceClassificationV1,
  type WorkItem,
} from '.';
import type { Json } from '@anima/types';

// SUP-03 — no máximo um trabalho ativo por alvo.

const baseSpec = { schema_version: 1, permissions: [], validation_criteria: [{ label: 'tests' }], limits: { max_attempts: 1 } };
const specFor = (target: Json): Json => ({ ...baseSpec, target } as Json);
const projectSpec = (reference: string): Json => specFor({ kind: 'project', reference });

const T0 = new Date('2026-07-21T12:00:00Z');
const classification: WorkIntelligenceClassificationV1 = {
  schemaVersion: 1, complexity: 'bounded', risk: 'low', reversibility: 'reversible',
  planClarity: 'clear', urgency: 'normal',
  provenance: { kind: 'human_confirmed', classifiedAt: '2026-07-28T12:00:00Z', classifierId: 'user:opaque' },
};
const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

const makeItem = (id: string, spec: Json, overrides: Partial<WorkItem> = {}): WorkItem => ({
  id, userId: 'u', sourceMessageId: 'm', state: 'approved', impactLevel: 'low', capability: 'programming', originalRequest: 'x',
  intent: { execution_spec: spec },
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'corrigir', includedScope: ['a.py'], excludedScope: ['deploy'], expectedEffects: ['testes verdes'], risks: [] } },
  proposalVersion: 1, createdAt: T0, updatedAt: T0, ...overrides,
});

const claimOn = (workItemId: string, overrides: Partial<WorkClaim> = {}): WorkClaim => ({
  claimId: `claim-${workItemId}`, workItemId, approvedProposalVersion: 1, ownerInstanceId: 'supervisor-1',
  acquiredAt: T0, expiresAt: at(300), attemptId: null, release: null, ...overrides,
});

// Item elegível aguardando execução no alvo indicado.
const waiting = (id: string, seq: number, reference: string, overrides: Partial<AutonomousQueueCandidate> = {}): AutonomousQueueCandidate => ({
  item: makeItem(id, projectSpec(reference)),
  currentClassification: classification,
  approval: { seq, approvedAt: at(seq), proposalVersion: 1 },
  openClaim: null,
  ...overrides,
});

// Item que não está na fila mas pode ocupar o alvo.
const occupant = (id: string, spec: Json, state: WorkItem['state'], openClaim: WorkClaim | null = null): AutonomousQueueCandidate => ({
  item: makeItem(id, spec, { state }),
  currentClassification: null,
  approval: null,
  openClaim,
});

const queueOf = (candidates: readonly AutonomousQueueCandidate[], now: Date = T0): readonly AutonomousQueueEntry[] =>
  projectAutonomousQueue(candidates, now);

describe('SUP-03 — dois itens no mesmo alvo', () => {
  test('ambos permanecem na fila enquanto ninguém tem posse', () => {
    const queue = queueOf([waiting('i1', 10, 'anima'), waiting('i2', 20, 'anima')]);
    expect(queue.map(entry => entry.workItemId)).toEqual(['i1', 'i2']);
    expect(queue.map(entry => entry.targetOccupied)).toEqual([false, false]);
  });

  test('somente um obtém posse ativa: o outro fica marcado como alvo ocupado', () => {
    const queue = queueOf([
      waiting('i1', 10, 'anima', { openClaim: claimOn('i1') }),
      waiting('i2', 20, 'anima'),
    ]);
    expect(queue.map(entry => entry.workItemId)).toEqual(['i2']);
    expect(queue[0]!.targetOccupied).toBe(true);
  });

  test('o segundo espera, não é descartado nem reordenado', () => {
    const selection = selectNextAutonomousWork(queueOf([
      waiting('i1', 10, 'anima', { openClaim: claimOn('i1') }),
      waiting('i2', 20, 'anima'),
    ]));
    expect(selection).toEqual({ outcome: 'waiting_for_targets', occupiedTargets: ['anima'] });
  });
});

describe('SUP-03 — alvos diferentes progridem em paralelo', () => {
  test('posse em um alvo não bloqueia outro alvo', () => {
    const queue = queueOf([
      waiting('i1', 10, 'anima', { openClaim: claimOn('i1') }),
      waiting('i2', 20, 'outro'),
    ]);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ workItemId: 'i2', targetOccupied: false });
  });

  test('a seleção escolhe o alvo livre mais antigo e explica o salto', () => {
    const selection = selectNextAutonomousWork(queueOf([
      waiting('i1', 10, 'anima', { openClaim: claimOn('i1') }),
      waiting('i2', 20, 'anima'),
      waiting('i3', 30, 'outro'),
    ]));
    expect(selection).toMatchObject({
      outcome: 'selected',
      entry: { workItemId: 'i3', queuePosition: 2 },
      rationale: { skippedOccupiedTargets: 1, selectedPosition: 2 },
    });
  });
});

describe('SUP-03 — execução em curso ocupa o alvo', () => {
  test('item em execução ocupa o alvo mesmo sem claim algum (execução comandada do INT-04)', () => {
    const queue = queueOf([occupant('i1', projectSpec('anima'), 'in_progress'), waiting('i2', 20, 'anima')]);
    expect(queue[0]).toMatchObject({ workItemId: 'i2', targetOccupied: true });
  });

  test('item em execução ocupa o alvo mesmo com o claim já expirado', () => {
    const queue = queueOf(
      [occupant('i1', projectSpec('anima'), 'in_progress', claimOn('i1')), waiting('i2', 20, 'anima')],
      at(301),
    );
    expect(queue[0]).toMatchObject({ workItemId: 'i2', targetOccupied: true });
  });
});

describe('SUP-03 — o alvo não fica bloqueado permanentemente', () => {
  test('claim expirado sobre item que não executa libera o alvo', () => {
    const queue = queueOf([waiting('i1', 10, 'anima', { openClaim: claimOn('i1') }), waiting('i2', 20, 'anima')], at(301));
    expect(queue.map(entry => [entry.workItemId, entry.targetOccupied])).toEqual([['i1', false], ['i2', false]]);
  });

  test('claim liberado libera o alvo', () => {
    const released = claimOn('i1', { attemptId: 'a1', release: { reason: 'attempt_finished', releasedAt: at(50) } });
    const queue = queueOf([waiting('i1', 10, 'anima', { openClaim: released }), waiting('i2', 20, 'anima')], at(60));
    expect(queue.every(entry => !entry.targetOccupied)).toBe(true);
  });

  test.each<WorkItem['state']>(['review', 'changes_requested', 'blocked'])(
    'item em %s aguarda humano e não bloqueia novos trabalhos no alvo',
    state => {
      const queue = queueOf([occupant('i1', projectSpec('anima'), state), waiting('i2', 20, 'anima')]);
      expect(queue[0]).toMatchObject({ workItemId: 'i2', targetOccupied: false });
    },
  );

  test.each<WorkItem['state']>(['completed', 'failed', 'rejected', 'cancelled'])(
    'item encerrado (%s) não bloqueia o alvo',
    state => {
      const queue = queueOf([occupant('i1', projectSpec('anima'), state), waiting('i2', 20, 'anima')]);
      expect(queue[0]!.targetOccupied).toBe(false);
    },
  );
});

describe('SUP-03 — definição de "mesmo alvo"', () => {
  test('o alvo é a referência, não o par kind+referência', () => {
    const queue = queueOf([
      occupant('i1', specFor({ kind: 'workspace', reference: 'anima' }), 'in_progress'),
      waiting('i2', 20, 'anima'),
    ]);
    expect(queue[0]!.targetOccupied).toBe(true);
  });

  test('a referência é comparada após aparar espaços', () => {
    const queue = queueOf([
      occupant('i1', specFor({ kind: 'project', reference: '  anima  ' }), 'in_progress'),
      waiting('i2', 20, 'anima'),
    ]);
    expect(queue[0]!.targetOccupied).toBe(true);
  });

  test('referências distintas são alvos distintos', () => {
    const queue = queueOf([occupant('i1', projectSpec('anima-web'), 'in_progress'), waiting('i2', 20, 'anima')]);
    expect(queue[0]!.targetOccupied).toBe(false);
  });
});

describe('SUP-03 — alvo ausente ou malformado falha fechado', () => {
  test.each<[string, Json]>([
    ['sem alvo declarado', baseSpec as Json],
    ['referência vazia', specFor({ kind: 'project', reference: '   ' })],
    ['referência não textual', specFor({ kind: 'project', reference: 42 })],
    ['alvo escalar', specFor('anima')],
  ])('item com %s não entra na fila', (_label, malformed) => {
    const queue = queueOf([{ item: makeItem('i1', malformed), currentClassification: classification, approval: { seq: 10, approvedAt: T0, proposalVersion: 1 }, openClaim: null }]);
    expect(queue).toEqual([]);
  });

  test('item em execução com alvo ilegível não ocupa alvo nenhum', () => {
    const queue = queueOf([
      { item: makeItem('i1', 'sem spec' as Json, { state: 'in_progress' }), currentClassification: null, approval: null, openClaim: null },
      waiting('i2', 20, 'anima'),
    ]);
    expect(queue[0]).toMatchObject({ workItemId: 'i2', targetOccupied: false });
  });
});

describe('SUP-03 — a seleção não produz efeito', () => {
  test('selecionar não vincula tentativa nem posse', () => {
    const candidates = [waiting('i1', 10, 'anima'), waiting('i2', 20, 'outro')];
    const selection = selectNextAutonomousWork(queueOf(candidates));
    expect(selection).toMatchObject({ outcome: 'selected', entry: { workItemId: 'i1' } });
    expect(candidates.every(candidate => candidate.openClaim === null)).toBe(true);
    expect(candidates.every(candidate => candidate.item.state === 'approved')).toBe(true);
  });

  test('consultas repetidas devolvem a mesma escolha', () => {
    const queue = queueOf([waiting('i1', 10, 'anima', { openClaim: claimOn('i1') }), waiting('i2', 20, 'outro')]);
    expect(selectNextAutonomousWork(queue)).toEqual(selectNextAutonomousWork(queue));
  });
});
