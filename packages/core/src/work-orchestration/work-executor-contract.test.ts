import { FakeWorkExecutor, buildWorktreeHandoff, validateWorkCheckpoint, validateWorkExecutorTranscript, type WorkCheckpointV1, type WorkExecutorRequest, type WorkExecutorSignal } from '.';

const request: WorkExecutorRequest = {
  attemptId: 'attempt-1', workItemId: 'work-1', approvedProposalVersion: 3, capability: 'programming', objective: 'Implementar contrato',
  includedScope: ['packages/core'], excludedScope: ['apps'], target: { kind: 'project', reference: 'anima' }, permissions: ['read', 'test'],
  validationCriteria: [{ label: 'core verde', command: 'npm test' }], limits: { maxAttempts: 2 }, contextReferences: [{ kind: 'message', id: 'm1' }],
};
const collect = async (fake: FakeWorkExecutor, value = request, signal = new AbortController().signal): Promise<WorkExecutorSignal[]> => {
  const result: WorkExecutorSignal[] = [];
  for await (const entry of fake.execute(value, signal)) result.push(entry);
  return result;
};

describe('INT-01 — contrato WorkExecutorAdapter', () => {
  test('executor falso exercita progresso e resultado com correlação completa', async () => {
    const signals = await collect(new FakeWorkExecutor([
      { kind: 'progress', message: 'Analisando contrato.' },
      { kind: 'result', summary: 'Contrato pronto.', resultReferences: ['commit:abc'], validations: [{ label: 'core', outcome: 'passed' }], limitations: [], handoffReference: 'commit:abc' },
    ]));
    expect(signals.map(value => value.kind)).toEqual(['progress', 'result']);
    expect(signals).toEqual(expect.arrayContaining([expect.objectContaining({ attemptId: 'attempt-1', workItemId: 'work-1', approvedProposalVersion: 3 })]));
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
  });

  test('executor falso exercita decisão necessária tipada', async () => {
    const signals = await collect(new FakeWorkExecutor([{ kind: 'decision_required', reason: 'architectural_decision', explanation: 'Há duas fronteiras válidas.', options: [{ id: 'continuar', label: 'Continuar', effect: 'resume' }, { id: 'cancelar', label: 'Encerrar', effect: 'cancel' }] }]));
    expect(signals).toEqual([expect.objectContaining({ kind: 'decision_required', reason: 'architectural_decision' })]);
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
  });

  test('executor falso exercita erro tipado', async () => {
    const signals = await collect(new FakeWorkExecutor([{ kind: 'error', code: 'execution_failed', message: 'Falhou.', retryable: true, handoffReference: 'report:failure' }]));
    expect(signals).toEqual([expect.objectContaining({ kind: 'error', code: 'execution_failed', retryable: true })]);
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
  });

  test('cancelamento cooperativo emite terminal reconhecido', async () => {
    const controller = new AbortController(); controller.abort();
    const signals = await collect(new FakeWorkExecutor([{ kind: 'progress', message: 'Não deve executar.' }]), request, controller.signal);
    expect(signals).toEqual([expect.objectContaining({ kind: 'cancelled', acknowledged: true })]);
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
  });

  test('cancelamento durante o fluxo encerra depois do progresso já emitido', async () => {
    const controller = new AbortController();
    const iterator = new FakeWorkExecutor([{ kind: 'progress', message: 'Etapa concluída.' }, { kind: 'progress', message: 'Etapa seguinte.' }]).execute(request, controller.signal)[Symbol.asyncIterator]();
    expect(await iterator.next()).toMatchObject({ value: { kind: 'progress', sequence: 1 }, done: false });
    controller.abort();
    expect(await iterator.next()).toMatchObject({ value: { kind: 'cancelled', sequence: 2, acknowledged: true }, done: false });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  test('reentrega idêntica devolve o mesmo transcript sem executar efeitos novamente', async () => {
    const fake = new FakeWorkExecutor([{ kind: 'result', summary: 'Feito.', resultReferences: [], validations: [], limitations: [], handoffReference: 'commit:abc' }]);
    const first = await collect(fake); const second = await collect(fake);
    expect(second).toEqual(first);
    expect(fake.executionCount).toBe(1);
  });

  test('reentregas concorrentes compartilham a mesma execução', async () => {
    const fake = new FakeWorkExecutor([{ kind: 'progress', message: 'Executando.' }, { kind: 'result', summary: 'Feito.', resultReferences: [], validations: [], limitations: [], handoffReference: 'commit:abc' }]);
    const [first, second] = await Promise.all([collect(fake), collect(fake)]);
    expect(second).toEqual(first);
    expect(fake.executionCount).toBe(1);
  });

  test('mesmo attemptId com entrada diferente falha fechado', async () => {
    const fake = new FakeWorkExecutor([{ kind: 'result', summary: 'Feito.', resultReferences: [], validations: [], limitations: [], handoffReference: 'commit:abc' }]);
    await collect(fake);
    const signals = await collect(fake, { ...request, objective: 'Objetivo adulterado' });
    expect(signals).toEqual([expect.objectContaining({ kind: 'error', code: 'attempt_payload_conflict', retryable: false })]);
    expect(fake.executionCount).toBe(1);
  });

  test('entrada vaga falha fechado antes do script', async () => {
    const signals = await collect(new FakeWorkExecutor([{ kind: 'result', summary: 'Não pode ocorrer.', resultReferences: [], validations: [], limitations: [], handoffReference: 'x' }]), { ...request, includedScope: [] });
    expect(signals).toEqual([expect.objectContaining({ kind: 'error', code: 'invalid_request' })]);
  });

  test('script sem terminal recebe erro de violação do contrato', async () => {
    const signals = await collect(new FakeWorkExecutor([{ kind: 'progress', message: 'Ainda trabalhando.' }]));
    expect(signals.map(value => value.kind)).toEqual(['progress', 'error']);
    expect(signals[1]).toMatchObject({ kind: 'error', code: 'contract_violation' });
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
  });

  test('validador recusa sequência quebrada, correlação divergente e dois terminais', () => {
    const base = { attemptId: 'a', workItemId: 'w', approvedProposalVersion: 1, origin: 'executor' as const };
    expect(validateWorkExecutorTranscript([{ ...base, sequence: 2, kind: 'progress', message: 'x' }, { ...base, sequence: 3, kind: 'error', code: 'execution_failed', message: 'x', retryable: false, handoffReference: 'r' }])).toContain('sequência');
    expect(validateWorkExecutorTranscript([{ ...base, sequence: 1, kind: 'progress', message: 'x' }, { ...base, workItemId: 'outro', sequence: 2, kind: 'error', code: 'execution_failed', message: 'x', retryable: false, handoffReference: 'r' }])).toContain('correlação');
    expect(validateWorkExecutorTranscript([{ ...base, sequence: 1, kind: 'error', code: 'execution_failed', message: 'x', retryable: false, handoffReference: 'r' }, { ...base, sequence: 2, kind: 'cancelled', acknowledged: true, handoffReference: 'r' }])).toContain('suceder');
  });
});

const checkpoint: WorkCheckpointV1 = {
  schemaVersion: 1,
  handoffReference: 'runner-bundle:partial-1',
  completedSteps: ['Escrever o parser'],
  remainingSteps: ['Cobrir o caso de erro'],
  nextStep: 'Adicionar o teste do caso de erro',
  decisions: [],
  risks: ['O caso de erro pode exigir nova validação'],
  touchedResources: ['packages/core/src/x.ts'],
  validations: [{ label: 'parser', outcome: 'passed' }],
  failures: [],
  evidenceReferences: ['runner-evidence:e1'],
};
const corr = { attemptId: 'a', workItemId: 'w', approvedProposalVersion: 1, origin: 'executor' as const };
const resultAt = (sequence: number): WorkExecutorSignal =>
  ({ ...corr, sequence, kind: 'result', summary: 'ok', resultReferences: [], validations: [], limitations: [], handoffReference: 'commit:z' });

describe('INT-01 — checkpoint mid-flight na transcrição', () => {
  test('transcrição só com terminal continua válida (compatibilidade)', async () => {
    const signals = await collect(new FakeWorkExecutor([{ kind: 'result', summary: 'Feito.', resultReferences: [], validations: [], limitations: [], handoffReference: 'commit:abc' }]));
    expect(signals.map(value => value.kind)).toEqual(['result']);
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
  });

  test('um checkpoint seguido de terminal é válido', async () => {
    const signals = await collect(new FakeWorkExecutor([
      { kind: 'checkpoint', checkpoint },
      { kind: 'result', summary: 'Feito.', resultReferences: [], validations: [{ label: 'core', outcome: 'passed' }], limitations: [], handoffReference: 'commit:abc' },
    ]));
    expect(signals.map(value => value.kind)).toEqual(['checkpoint', 'result']);
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
  });

  test('múltiplos checkpoints intercalados com progress são válidos e a sequência é da transcrição inteira', async () => {
    const signals = await collect(new FakeWorkExecutor([
      { kind: 'progress', message: 'Começando.' },
      { kind: 'checkpoint', checkpoint },
      { kind: 'progress', message: 'Continuando.' },
      { kind: 'checkpoint', checkpoint: { ...checkpoint, nextStep: 'Segundo passo concreto' } },
      { kind: 'result', summary: 'Feito.', resultReferences: [], validations: [{ label: 'core', outcome: 'passed' }], limitations: [], handoffReference: 'commit:abc' },
    ]));
    expect(signals.map(value => value.kind)).toEqual(['progress', 'checkpoint', 'progress', 'checkpoint', 'result']);
    expect(signals.map(value => value.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
  });

  test('checkpoint é não-terminal: script só com checkpoint recebe erro de violação do contrato', async () => {
    const signals = await collect(new FakeWorkExecutor([{ kind: 'checkpoint', checkpoint }]));
    expect(signals.map(value => value.kind)).toEqual(['checkpoint', 'error']);
    expect(signals[1]).toMatchObject({ kind: 'error', code: 'contract_violation' });
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
  });

  test('transcrição só com checkpoint, sem terminal, é recusada pelo validador', () => {
    expect(validateWorkExecutorTranscript([{ ...corr, sequence: 1, kind: 'checkpoint', checkpoint }]))
      .toContain('exatamente uma condição terminal');
  });

  test('checkpoint depois do terminal é recusado', () => {
    expect(validateWorkExecutorTranscript([resultAt(1), { ...corr, sequence: 2, kind: 'checkpoint', checkpoint }]))
      .toContain('suceder');
  });

  test('sequência não contígua envolvendo checkpoint é recusada', () => {
    expect(validateWorkExecutorTranscript([
      { ...corr, sequence: 1, kind: 'progress', message: 'x' },
      { ...corr, sequence: 3, kind: 'checkpoint', checkpoint },
      resultAt(4),
    ])).toContain('sequência');
  });

  test('correlação divergente em checkpoint é recusada', () => {
    expect(validateWorkExecutorTranscript([
      { ...corr, sequence: 1, kind: 'progress', message: 'x' },
      { ...corr, workItemId: 'outro', sequence: 2, kind: 'checkpoint', checkpoint },
      resultAt(3),
    ])).toContain('correlação');
  });

  test('origem diferente de executor em checkpoint é recusada', () => {
    expect(validateWorkExecutorTranscript([
      { ...corr, origin: 'user', sequence: 1, kind: 'checkpoint', checkpoint },
      resultAt(2),
    ])).toContain('correlação');
  });

  test('FakeWorkExecutor emite e preserva o checkpoint com correlação completa', async () => {
    const signals = await collect(new FakeWorkExecutor([
      { kind: 'checkpoint', checkpoint },
      { kind: 'result', summary: 'Feito.', resultReferences: [], validations: [{ label: 'core', outcome: 'passed' }], limitations: [], handoffReference: 'commit:abc' },
    ]));
    expect(signals[0]).toMatchObject({ kind: 'checkpoint', checkpoint, attemptId: 'attempt-1', workItemId: 'work-1', approvedProposalVersion: 3, origin: 'executor', sequence: 1 });
  });

  test('executores sem checkpoint continuam compatíveis', async () => {
    const fake = new FakeWorkExecutor([
      { kind: 'progress', message: 'Sem checkpoint.' },
      { kind: 'result', summary: 'Feito.', resultReferences: [], validations: [{ label: 'core', outcome: 'passed' }], limitations: [], handoffReference: 'commit:abc' },
    ]);
    const signals = await collect(fake);
    expect(signals.map(value => value.kind)).toEqual(['progress', 'result']);
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
    expect(fake.executionCount).toBe(1);
  });
});

describe('INT-01 — validateWorkCheckpoint (régua estrutural do payload)', () => {
  test('checkpoint completo é aceito', () => {
    expect(validateWorkCheckpoint(checkpoint)).toBeNull();
  });

  test('nextStep vazio é recusado', () => {
    expect(validateWorkCheckpoint({ ...checkpoint, nextStep: '   ' })).toContain('próximo passo');
  });

  test('handoffReference vazio é recusado', () => {
    expect(validateWorkCheckpoint({ ...checkpoint, handoffReference: '' })).toContain('handoff');
  });

  test('completedSteps e remainingSteps ambos vazios são recusados', () => {
    expect(validateWorkCheckpoint({ ...checkpoint, completedSteps: [], remainingSteps: [] })).toContain('retomada');
  });

  test('entrada textual vazia numa lista é recusada', () => {
    expect(validateWorkCheckpoint({ ...checkpoint, risks: ['   '] })).toContain('lista estruturada');
  });

  test('validação com outcome inválido é recusada (payload malformado)', () => {
    expect(validateWorkCheckpoint({ ...checkpoint, validations: [{ label: 'x', outcome: 'aprovado' as never }] })).toContain('lista estruturada');
  });

  test('dado sensível no checkpoint é recusado, reusando a régua única de sanitização', () => {
    expect(validateWorkCheckpoint({ ...checkpoint, touchedResources: ['C:\\Users\\gean\\secret.txt'] })).toContain('credenciais');
  });

  test('schemaVersion não suportada é recusada', () => {
    expect(validateWorkCheckpoint({ ...checkpoint, schemaVersion: 2 as never })).toContain('Versão');
  });
});

describe('validateWorkExecutorTranscript — worktreeHandoff opcional (INT-05)', () => {
  const validHandoff = () => {
    const r = buildWorktreeHandoff({
      workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 3,
      executorId: 'worktree-v1', backendId: 'ollama', model: null,
      baseSha: 'a'.repeat(40), branch: 'anima-work/attempt-1', commitSha: 'b'.repeat(40),
      status: 'succeeded', changedFiles: ['docs/a.md'],
      diffFiles: [{ path: 'docs/a.md', insertions: 1, deletions: 0 }],
      gates: [{ label: 'g', command: 'npm run typecheck', exitCode: 0, outcome: 'passed' }],
    });
    if (!r.ok) throw new Error(r.explanation);
    return r.value;
  };
  const resultSignal = (handoff?: unknown): WorkExecutorSignal => ({
    attemptId: 'attempt-1', workItemId: 'work-1', approvedProposalVersion: 3, origin: 'executor', sequence: 1,
    kind: 'result', summary: 'ok', resultReferences: [], validations: [], limitations: [], handoffReference: 'worktree:x',
    ...(handoff !== undefined ? { worktreeHandoff: handoff } : {}),
  } as WorkExecutorSignal);

  test('ausência do campo é aceita (outros executores não emitem)', () => {
    expect(validateWorkExecutorTranscript([resultSignal()])).toBeNull();
  });
  test('presença válida e correlacionada é aceita', () => {
    expect(validateWorkExecutorTranscript([resultSignal(validHandoff())])).toBeNull();
  });
  test('handoff malformado é recusado fail-closed', () => {
    expect(validateWorkExecutorTranscript([resultSignal({ schemaVersion: 1, invalido: true })])).toMatch(/worktreeHandoff/i);
  });
  test('handoff com correlação divergente é recusado', () => {
    expect(validateWorkExecutorTranscript([resultSignal({ ...validHandoff(), attemptId: 'outra-tentativa' })])).toMatch(/correlação/i);
  });
});
