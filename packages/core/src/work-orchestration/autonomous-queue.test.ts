import {
  projectAutonomousQueue,
  type AutonomousQueueCandidate,
  type WorkClaim,
  type WorkIntelligenceClassificationV1,
  type WorkItem,
} from '.';
import type { Json } from '@anima/types';

const spec: Json = { schema_version: 1, target: { kind: 'project', reference: 'anima' }, permissions: [], validation_criteria: [{ label: 'tests' }], limits: { max_attempts: 1 } };
const makeItem = (id: string, overrides: Partial<WorkItem> = {}): WorkItem => ({
  id, userId: 'u', sourceMessageId: 'm', state: 'approved', impactLevel: 'low', capability: 'programming', originalRequest: 'x',
  intent: { execution_spec: spec },
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'corrigir', includedScope: ['a.py'], excludedScope: ['deploy'], expectedEffects: ['testes verdes'], risks: [] } },
  proposalVersion: 1, createdAt: new Date('2026-07-21T10:00:00Z'), updatedAt: new Date('2026-07-21T10:00:00Z'), ...overrides,
});

const T0 = new Date('2026-07-21T12:00:00Z');
const classification: WorkIntelligenceClassificationV1 = {
  schemaVersion: 1, complexity: 'bounded', risk: 'low', reversibility: 'reversible',
  planClarity: 'clear', urgency: 'normal',
  provenance: { kind: 'human_confirmed', classifiedAt: '2026-07-28T12:00:00Z', classifierId: 'user:opaque' },
};
const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

const candidate = (id: string, seq: number, overrides: Partial<AutonomousQueueCandidate> = {}): AutonomousQueueCandidate => ({
  item: makeItem(id),
  currentClassification: classification,
  approval: { seq, approvedAt: at(seq), proposalVersion: 1 },
  openClaim: null,
  ...overrides,
});

const claim = (overrides: Partial<WorkClaim> = {}): WorkClaim => ({
  claimId: 'c1', workItemId: 'i1', approvedProposalVersion: 1, ownerInstanceId: 'supervisor-1',
  acquiredAt: T0, expiresAt: at(300), attemptId: null, release: null, ...overrides,
});

const ids = (candidates: readonly AutonomousQueueCandidate[], now: Date = T0): readonly string[] =>
  projectAutonomousQueue(candidates, now).map(entry => entry.workItemId);

describe('fila autônoma — projeção', () => {
  test('itens elegíveis entram na fila com posição e correlação', () => {
    expect(projectAutonomousQueue([candidate('i1', 10)], T0)).toEqual([
      { workItemId: 'i1', approvedProposalVersion: 1, approvalSeq: 10, approvedAt: at(10), capability: 'programming', targetReference: 'anima', queuePosition: 1, targetOccupied: false },
    ]);
  });

  test('fila vazia quando não há candidatos', () => expect(projectAutonomousQueue([], T0)).toEqual([]));

  test('a fila é derivada, não armazenada: os mesmos insumos produzem a mesma fila', () => {
    const input = [candidate('i2', 20), candidate('i1', 10)];
    expect(projectAutonomousQueue(input, T0)).toEqual(projectAutonomousQueue(input, at(5000)));
  });
});

describe('fila autônoma — ordenação determinística', () => {
  test('aprovação mais antiga primeiro, pela sequência do log', () =>
    expect(ids([candidate('i3', 30), candidate('i1', 10), candidate('i2', 20)])).toEqual(['i1', 'i2', 'i3']));

  test('a ordem independe da ordem de entrada', () =>
    expect(ids([candidate('i2', 20), candidate('i1', 10)])).toEqual(ids([candidate('i1', 10), candidate('i2', 20)])));

  test('a ordem não usa horário: sequência menor vence relógio mais antigo', () => {
    const older = candidate('i-tarde', 5, { approval: { seq: 5, approvedAt: at(9999), proposalVersion: 1 } });
    expect(ids([candidate('i-cedo', 90), older])).toEqual(['i-tarde', 'i-cedo']);
  });

  test('posições são contíguas a partir de 1', () =>
    expect(projectAutonomousQueue([candidate('i3', 30), candidate('i1', 10), candidate('i2', 20)], T0).map(e => e.queuePosition)).toEqual([1, 2, 3]));

  test('empate de sequência é impossível no log, mas a ordem continua total', () =>
    expect(ids([candidate('ib', 10), candidate('ia', 10)])).toEqual(['ia', 'ib']));
});

describe('fila autônoma — posse retira o item da fila', () => {
  test('item com claim ativo não está aguardando execução', () =>
    expect(ids([candidate('i1', 10, { openClaim: claim() })])).toEqual([]));

  test('claim expirado devolve o item à fila para retomada', () =>
    expect(ids([candidate('i1', 10, { openClaim: claim() })], at(301))).toEqual(['i1']));

  test('claim liberado não retém o item', () =>
    expect(ids([candidate('i1', 10, { openClaim: claim({ release: { reason: 'attempt_finished', releasedAt: at(50) } }) })], at(60))).toEqual(['i1']));

  test('a fila preserva os demais itens quando um é reivindicado', () =>
    expect(ids([candidate('i1', 10, { openClaim: claim() }), candidate('i2', 20)])).toEqual(['i2']));
});

describe('fila autônoma — checkpoints humanos e inelegibilidade (fail-closed)', () => {
  test('item sem classificação vigente não entra na fila', () =>
    expect(ids([candidate('i1', 10, { currentClassification: null })])).toEqual([]));

  test('item com classificação incompleta não entra na fila', () =>
    expect(ids([candidate('i1', 10, {
      currentClassification: { ...classification, risk: 'unknown' },
    })])).toEqual([]));

  test.each<WorkItem['state']>(['proposed', 'review', 'changes_requested', 'blocked'])('item em %s aguarda humano e não entra na fila', state =>
    expect(ids([candidate('i1', 10, { item: makeItem('i1', { state }) })])).toEqual([]));

  test('item já em execução não entra na fila', () =>
    expect(ids([candidate('i1', 10, { item: makeItem('i1', { state: 'in_progress' }) })])).toEqual([]));

  test.each<WorkItem['state']>(['completed', 'failed', 'rejected', 'cancelled'])('item encerrado (%s) sai da fila', state =>
    expect(ids([candidate('i1', 10, { item: makeItem('i1', { state }) })])).toEqual([]));

  test('item sem especificação de execução não entra na fila', () =>
    expect(ids([candidate('i1', 10, { item: makeItem('i1', { intent: {} }) })])).toEqual([]));

  test('item com escopo vago não entra na fila', () => {
    const vague = makeItem('i1');
    expect(ids([candidate('i1', 10, { item: { ...vague, proposal: { schemaVersion: 1, data: { ...vague.proposal.data, includedScope: [] } } } })])).toEqual([]);
  });

  test('item nunca aprovado não entra na fila', () =>
    expect(ids([candidate('i1', 10, { approval: null })])).toEqual([]));

  test('aprovação de versão obsoleta não sustenta posição na fila', () =>
    expect(ids([candidate('i1', 10, { item: makeItem('i1', { proposalVersion: 2 }) })])).toEqual([]));

  test.each([0, -1, 1.5])('sequência de aprovação inválida (%s) exclui o item', seq =>
    expect(ids([candidate('i1', 10, { approval: { seq, approvedAt: T0, proposalVersion: 1 } })])).toEqual([]));

  test('dependência ainda não concluída mantém o item fora da fila', () => {
    const dependencyId = '11111111-1111-4111-8111-111111111111';
    const itemId = '22222222-2222-4222-8222-222222222222';
    const dependent = candidate(itemId, 20, { item: makeItem(itemId, { intent: { execution_spec: { ...(spec as object), depends_on_work_item_ids: [dependencyId] } as Json } }) });
    expect(ids([candidate(dependencyId, 10), dependent])).toEqual([dependencyId]);
  });

  test('dependência completed libera o dependente sem reordenar approvals', () => {
    const dependencyId = '11111111-1111-4111-8111-111111111111';
    const itemId = '22222222-2222-4222-8222-222222222222';
    const dependency = candidate(dependencyId, 10, { item: makeItem(dependencyId, { state: 'completed' }) });
    const dependent = candidate(itemId, 20, { item: makeItem(itemId, { intent: { execution_spec: { ...(spec as object), depends_on_work_item_ids: [dependencyId] } as Json } }) });
    expect(ids([dependency, dependent])).toEqual([itemId]);
  });

  test('dependência ausente ou própria falha fechado', () => {
    const itemId = '22222222-2222-4222-8222-222222222222';
    const withDependency = (dependencyId: string) => candidate(itemId, 20, { item: makeItem(itemId, { intent: { execution_spec: { ...(spec as object), depends_on_work_item_ids: [dependencyId] } as Json } }) });
    expect(ids([withDependency('11111111-1111-4111-8111-111111111111')])).toEqual([]);
    expect(ids([withDependency(itemId)])).toEqual([]);
  });
});
