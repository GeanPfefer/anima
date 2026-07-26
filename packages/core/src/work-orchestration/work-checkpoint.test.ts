import {
  projectCheckpointContinuation,
  reconcileCheckpointDelivery,
  sameWorkCheckpoint,
  selectLatestCheckpoint,
  type PersistedCheckpoint,
  type WorkCheckpointV1,
} from '.';

const checkpoint = (overrides: Partial<WorkCheckpointV1> = {}): WorkCheckpointV1 => ({
  schemaVersion: 1,
  handoffReference: 'runner-bundle:cp',
  completedSteps: ['Escrever o parser'],
  remainingSteps: ['Cobrir o caso de erro'],
  nextStep: 'Adicionar o teste do caso de erro',
  decisions: [],
  risks: ['O caso de erro pode exigir nova validação'],
  touchedResources: ['packages/core/src/x.ts'],
  validations: [{ label: 'parser', outcome: 'passed' }],
  failures: [],
  evidenceReferences: ['runner-evidence:e1'],
  ...overrides,
});

const persisted = (signalSequence: number, cp: WorkCheckpointV1 = checkpoint()): PersistedCheckpoint => ({
  workItemId: 'work-1',
  attemptId: 'attempt-1',
  approvedProposalVersion: 3,
  claimId: 'claim-1',
  signalSequence,
  checkpoint: cp,
});

describe('Etapa 2A — reconcileCheckpointDelivery', () => {
  test('primeiro checkpoint válido é registrado', () => {
    expect(reconcileCheckpointDelivery(null, persisted(2))).toEqual({ action: 'recorded' });
  });

  test('sequência crescente NÃO consecutiva é registrada', () => {
    expect(reconcileCheckpointDelivery(persisted(2), persisted(5))).toEqual({ action: 'recorded' });
  });

  test('mesma sequência com conteúdo idêntico é replay idempotente', () => {
    expect(reconcileCheckpointDelivery(persisted(4), persisted(4))).toEqual({ action: 'replayed' });
  });

  test('mesma sequência com conteúdo diferente é conflito', () => {
    const outcome = reconcileCheckpointDelivery(persisted(4), persisted(4, checkpoint({ nextStep: 'Outro passo' })));
    expect(outcome.action).toBe('conflict');
  });

  test('sequência menor que a última é regressão recusada', () => {
    const outcome = reconcileCheckpointDelivery(persisted(5), persisted(3));
    expect(outcome.action).toBe('regression');
  });

  test('correlação divergente falha fechada', () => {
    const incoming: PersistedCheckpoint = { ...persisted(6), attemptId: 'outra-tentativa' };
    const outcome = reconcileCheckpointDelivery(persisted(5), incoming);
    expect(outcome.action).toBe('invalid');
  });

  test('payload malformado falha fechado, sem registrar', () => {
    const outcome = reconcileCheckpointDelivery(null, persisted(1, checkpoint({ nextStep: '   ' })));
    expect(outcome.action).toBe('invalid');
  });

  test('ambos completed e remaining vazios falham fechado', () => {
    const outcome = reconcileCheckpointDelivery(null, persisted(1, checkpoint({ completedSteps: [], remainingSteps: [] })));
    expect(outcome.action).toBe('invalid');
  });

  test('sequência não inteira ou não positiva é inválida', () => {
    expect(reconcileCheckpointDelivery(null, persisted(0)).action).toBe('invalid');
    expect(reconcileCheckpointDelivery(null, persisted(1.5)).action).toBe('invalid');
  });
});

describe('Etapa 2A — sameWorkCheckpoint', () => {
  test('conteúdo idêntico é igual', () => {
    expect(sameWorkCheckpoint(checkpoint(), checkpoint())).toBe(true);
  });

  test('ordem diferente de lista não é igual', () => {
    expect(sameWorkCheckpoint(
      checkpoint({ completedSteps: ['a', 'b'] }),
      checkpoint({ completedSteps: ['b', 'a'] }),
    )).toBe(false);
  });

  test('validação diferente não é igual', () => {
    expect(sameWorkCheckpoint(
      checkpoint({ validations: [{ label: 'x', outcome: 'passed' }] }),
      checkpoint({ validations: [{ label: 'x', outcome: 'failed' }] }),
    )).toBe(false);
  });
});

describe('Etapa 2A — selectLatestCheckpoint', () => {
  test('escolhe a maior sequência, mesmo fora de ordem', () => {
    const list = [persisted(2), persisted(5), persisted(3)];
    const latest = selectLatestCheckpoint(list);
    expect(latest).toEqual({ found: true, checkpoint: expect.objectContaining({ signalSequence: 5 }) });
  });

  test('ausência é tipada', () => {
    expect(selectLatestCheckpoint([])).toEqual({ found: false });
  });

  test('preserva o histórico: não muta a entrada', () => {
    const list = [persisted(2), persisted(5), persisted(3)];
    const snapshot = list.map(entry => entry.signalSequence);
    selectLatestCheckpoint(list);
    expect(list.map(entry => entry.signalSequence)).toEqual(snapshot);
    expect(list).toHaveLength(3);
  });
});

describe('Etapa 2A — projectCheckpointContinuation', () => {
  test('projeta continuação sem status nem stopReason terminais', () => {
    const projection = projectCheckpointContinuation(persisted(4));
    expect(projection).toEqual({
      workItemId: 'work-1',
      attemptId: 'attempt-1',
      approvedProposalVersion: 3,
      handoffReference: 'runner-bundle:cp',
      remainingSteps: ['Cobrir o caso de erro'],
      nextStep: 'Adicionar o teste do caso de erro',
      risks: ['O caso de erro pode exigir nova validação'],
      touchedResources: ['packages/core/src/x.ts'],
      previousFailures: [],
    });
    expect(projection).not.toHaveProperty('status');
    expect(projection).not.toHaveProperty('stopReason');
  });

  test('a projeção é apenas dado, não autorização de retomada', () => {
    const projection = projectCheckpointContinuation(persisted(4));
    // Nenhum campo de decisão/elegibilidade/autorização é derivado aqui.
    expect(projection).not.toHaveProperty('eligible');
    expect(projection).not.toHaveProperty('authorized');
    expect(projection).not.toHaveProperty('resume');
  });
});
