import { FakeWorkExecutor, validateWorkExecutorTranscript, type WorkExecutorRequest, type WorkExecutorSignal } from '.';

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
    const signals = await collect(new FakeWorkExecutor([{ kind: 'decision_required', reason: 'architectural_decision', explanation: 'Há duas fronteiras válidas.' }]));
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
    const base = { attemptId: 'a', workItemId: 'w', approvedProposalVersion: 1 };
    expect(validateWorkExecutorTranscript([{ ...base, sequence: 2, kind: 'progress', message: 'x' }, { ...base, sequence: 3, kind: 'error', code: 'execution_failed', message: 'x', retryable: false, handoffReference: 'r' }])).toContain('sequência');
    expect(validateWorkExecutorTranscript([{ ...base, sequence: 1, kind: 'progress', message: 'x' }, { ...base, workItemId: 'outro', sequence: 2, kind: 'error', code: 'execution_failed', message: 'x', retryable: false, handoffReference: 'r' }])).toContain('correlação');
    expect(validateWorkExecutorTranscript([{ ...base, sequence: 1, kind: 'error', code: 'execution_failed', message: 'x', retryable: false, handoffReference: 'r' }, { ...base, sequence: 2, kind: 'cancelled', acknowledged: true, handoffReference: 'r' }])).toContain('suceder');
  });
});
