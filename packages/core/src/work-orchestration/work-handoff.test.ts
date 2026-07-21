import {
  buildWorkHandoff,
  buildWorkHandoffPayload,
  finishExecutionAttempt,
  produceResultForIntegration,
  readHandoffReferenceForIntegration,
  reconcileWorkHandoff,
  requiresStructuredHandoff,
  startExecutionAttempt,
  type BuildWorkHandoffInput,
  type ExecutionAttemptStopReason,
  type TerminalExecutionAttempt,
  type WorkHandoffV1,
} from '.';

const T0 = new Date('2026-07-21T12:00:00Z');
const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

const HANDOFF_REF = 'local-runner:anima:20260721T120000Z-result.zip:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const terminalAttempt = (
  status: TerminalExecutionAttempt['status'],
  stopReason: ExecutionAttemptStopReason,
  overrides: Partial<TerminalExecutionAttempt> = {},
): TerminalExecutionAttempt => {
  const started = startExecutionAttempt({
    attemptId: 'attempt-1', workItemId: 'item-1', approvedProposalVersion: 2, executorId: 'local-runner-v1', startedAt: T0,
  });
  if (!started.ok) throw new Error('fixture inválida');
  const finished = finishExecutionAttempt(started.value, {
    status, finishedAt: at(60), resultSummary: 'resumo', stopReason, handoffReference: HANDOFF_REF,
  });
  if (!finished.ok) throw new Error(`fixture inválida: ${finished.explanation}`);
  return { ...finished.value, ...overrides };
};

const pausedAttempt = (): TerminalExecutionAttempt => terminalAttempt('paused', 'human_input_required');
const succeededAttempt = (): TerminalExecutionAttempt => terminalAttempt('succeeded', 'result_produced');

const baseInput = (attempt: TerminalExecutionAttempt, overrides: Partial<BuildWorkHandoffInput> = {}): BuildWorkHandoffInput => ({
  attempt,
  claimId: 'claim-1',
  completedSteps: ['isolou a workspace', 'reproduziu a falha em calculator.py'],
  remainingSteps: ['corrigir o operador de soma'],
  decisions: ['manter a assinatura pública de add()'],
  risks: ['o gate de testes cobre apenas um caso'],
  nextStep: 'aplicar a correção mínima e reexecutar python -m unittest',
  touchedResources: ['calculator.py'],
  validations: [{ label: 'python -m unittest', outcome: 'failed' }],
  failures: ['AssertionError: 2 + 2 != 5'],
  evidenceReferences: ['runner-evidence:20260721T120000Z.json'],
  ...overrides,
});

const built = (input: BuildWorkHandoffInput): WorkHandoffV1 => {
  const result = buildWorkHandoff(input);
  if (!result.ok) throw new Error(`esperava handoff válido, veio ${result.defect}: ${result.explanation}`);
  return result.value;
};

describe('handoff obrigatório — toda interrupção deixa estado transferível', () => {
  test.each<TerminalExecutionAttempt['status']>(['succeeded', 'failed', 'timed_out', 'cancelled', 'paused', 'blocked'])(
    'desfecho %s exige handoff estruturado',
    status => expect(requiresStructuredHandoff(status)).toBe(true),
  );

  test('pausa por decisão humana produz handoff completo', () => {
    const handoff = built(baseInput(pausedAttempt()));
    expect(handoff).toMatchObject({
      schemaVersion: 1, workItemId: 'item-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
      claimId: 'claim-1', status: 'paused', stopReason: 'human_input_required', handoffReference: HANDOFF_REF,
    });
  });

  test('a execução comandada do INT-04 não tem claim e ainda assim produz handoff', () =>
    expect(built(baseInput(pausedAttempt(), { claimId: null })).claimId).toBeNull());

  test.each<[TerminalExecutionAttempt['status'], ExecutionAttemptStopReason]>([
    ['paused', 'human_input_required'],
    ['blocked', 'dependency_unavailable'],
    ['timed_out', 'time_limit_reached'],
    ['failed', 'executor_failure'],
    ['cancelled', 'cancelled_by_user'],
  ])('encerrar em %s sem referência de handoff é recusado na própria transição', (status, stopReason) => {
    const started = startExecutionAttempt({
      attemptId: 'attempt-1', workItemId: 'item-1', approvedProposalVersion: 2, executorId: 'local-runner-v1', startedAt: T0,
    });
    if (!started.ok) throw new Error('fixture inválida');
    expect(finishExecutionAttempt(started.value, {
      status, finishedAt: at(60), resultSummary: 'resumo', stopReason, handoffReference: '   ',
    })).toMatchObject({ ok: false, defect: 'invalid_attempt' });
  });
});

describe('handoff obrigatório — conteúdo mínimo verificável', () => {
  test('sem próximo passo o handoff é recusado', () =>
    expect(buildWorkHandoff(baseInput(pausedAttempt(), { nextStep: '   ' })))
      .toMatchObject({ ok: false, defect: 'invalid_handoff' }));

  test('sem nada feito nem restante o handoff não permite retomada', () =>
    expect(buildWorkHandoff(baseInput(pausedAttempt(), { completedSteps: [], remainingSteps: [] })))
      .toMatchObject({ ok: false, defect: 'invalid_handoff' }));

  test.each<[string, Partial<BuildWorkHandoffInput>]>([
    ['passo em branco', { completedSteps: ['  '] }],
    ['decisão em branco', { decisions: [''] }],
    ['risco em branco', { risks: ['   '] }],
    ['recurso em branco', { touchedResources: ['  '] }],
    ['evidência em branco', { evidenceReferences: ['  '] }],
  ])('texto livre sem estrutura é recusado (%s)', (_label, overrides) =>
    expect(buildWorkHandoff(baseInput(pausedAttempt(), overrides))).toMatchObject({ ok: false, defect: 'invalid_handoff' }));

  test.each<[string, unknown]>([
    ['rótulo vazio', [{ label: '', outcome: 'passed' }]],
    ['resultado fora do vocabulário', [{ label: 'testes', outcome: 'talvez' }]],
    ['entrada não estruturada', ['testes passaram']],
  ])('validação malformada é recusada (%s)', (_label, validations) =>
    expect(buildWorkHandoff(baseInput(pausedAttempt(), { validations: validations as BuildWorkHandoffInput['validations'] })))
      .toMatchObject({ ok: false, defect: 'invalid_handoff' }));

  test('handoff não carrega segredo nem caminho absoluto local', () =>
    expect(buildWorkHandoff(baseInput(pausedAttempt(), { touchedResources: ['C:/Users/gean/anima/calculator.py'] })))
      .toMatchObject({ ok: false, defect: 'sensitive_data' }));

  test('credencial em decisão é recusada', () =>
    expect(buildWorkHandoff(baseInput(pausedAttempt(), { decisions: ['usei api_key: abc123 para o gate'] })))
      .toMatchObject({ ok: false, defect: 'sensitive_data' }));
});

describe('handoff obrigatório — correlação', () => {
  test('correlaciona item, versão aprovada, tentativa e claim', () => {
    const handoff = built(baseInput(pausedAttempt()));
    expect([handoff.workItemId, handoff.approvedProposalVersion, handoff.attemptId, handoff.claimId])
      .toEqual(['item-1', 2, 'attempt-1', 'claim-1']);
  });

  test('a referência do artefato é exatamente a da tentativa — narrativa e artefato não se separam', () =>
    expect(built(baseInput(pausedAttempt())).handoffReference).toBe(pausedAttempt().handoffReference));

  test('claim com identificador vazio falha fechado', () =>
    expect(buildWorkHandoff(baseInput(pausedAttempt(), { claimId: '   ' })))
      .toMatchObject({ ok: false, defect: 'correlation_mismatch' }));

  test('tentativa sem correlação não produz handoff', () =>
    expect(buildWorkHandoff(baseInput({ ...pausedAttempt(), attemptId: '' })))
      .toMatchObject({ ok: false, defect: 'correlation_mismatch' }));

  test('o handoff não declara objetivo nem escopo: eles vêm da versão aprovada', () => {
    const handoff = built(baseInput(pausedAttempt()));
    expect(Object.keys(handoff)).toEqual(expect.not.arrayContaining(['objective', 'includedScope', 'excludedScope', 'proposal']));
  });
});

describe('handoff obrigatório — sucesso exige evidência', () => {
  test('sucesso sem validação aprovada é recusado', () =>
    expect(buildWorkHandoff(baseInput(succeededAttempt(), { validations: [], failures: [] })))
      .toMatchObject({ ok: false, defect: 'unsupported_success_claim' }));

  test('relato declarado não sustenta sucesso', () =>
    expect(buildWorkHandoff(baseInput(succeededAttempt(), { validations: [{ label: 'testes', outcome: 'declared' }], failures: [] })))
      .toMatchObject({ ok: false, defect: 'unsupported_success_claim' }));

  test('sucesso com validação aprovada é aceito', () =>
    expect(built(baseInput(succeededAttempt(), {
      validations: [{ label: 'python -m unittest', outcome: 'passed' }], failures: [], remainingSteps: [],
    })).status).toBe('succeeded'));
});

describe('handoff obrigatório — falhas não podem ser escondidas', () => {
  test('validação reprovada é incompatível com sucesso', () =>
    expect(buildWorkHandoff(baseInput(succeededAttempt(), {
      validations: [{ label: 'testes', outcome: 'passed' }, { label: 'lint', outcome: 'failed' }],
    }))).toMatchObject({ ok: false, defect: 'hidden_failure' }));

  test('validação reprovada exige falha registrada', () =>
    expect(buildWorkHandoff(baseInput(pausedAttempt(), { failures: [] })))
      .toMatchObject({ ok: false, defect: 'hidden_failure' }));

  test('tentativa que falhou precisa registrar a falha', () =>
    expect(buildWorkHandoff(baseInput(terminalAttempt('failed', 'executor_failure'), { validations: [], failures: [] })))
      .toMatchObject({ ok: false, defect: 'hidden_failure' }));

  test('as falhas encontradas ficam preservadas no handoff', () =>
    expect(built(baseInput(pausedAttempt())).failures).toEqual(['AssertionError: 2 + 2 != 5']));

  test('handoffs de tentativas distintas coexistem: nenhum apaga o anterior', () => {
    const first = built(baseInput(pausedAttempt()));
    const second = built(baseInput({ ...pausedAttempt(), attemptId: 'attempt-2' }, { failures: ['outra falha'] }));
    expect(reconcileWorkHandoff(first, second)).toMatchObject({ ok: false, defect: 'correlation_mismatch' });
    expect(first.failures).toEqual(['AssertionError: 2 + 2 != 5']);
  });
});

describe('handoff obrigatório — replay idempotente', () => {
  test('reentregar o mesmo handoff devolve o existente', () => {
    const handoff = built(baseInput(pausedAttempt()));
    expect(reconcileWorkHandoff(handoff, built(baseInput(pausedAttempt())))).toEqual({ ok: true, value: handoff });
  });

  test('reentregar com conteúdo divergente falha fechado', () => {
    const handoff = built(baseInput(pausedAttempt()));
    const divergent = built(baseInput(pausedAttempt(), { nextStep: 'outra coisa completamente diferente' }));
    expect(reconcileWorkHandoff(handoff, divergent)).toMatchObject({ ok: false, defect: 'handoff_conflict' });
  });

  test('divergência apenas nas evidências também é conflito', () => {
    const handoff = built(baseInput(pausedAttempt()));
    const divergent = built(baseInput(pausedAttempt(), { evidenceReferences: ['runner-evidence:outra.json'] }));
    expect(reconcileWorkHandoff(handoff, divergent)).toMatchObject({ ok: false, defect: 'handoff_conflict' });
  });
});

describe('handoff obrigatório — compatibilidade com o INT-04 e o INT-03', () => {
  test('a referência projetada para integração é a mesma do handoff produzido', () => {
    const handoff = built(baseInput(succeededAttempt(), {
      validations: [{ label: 'python -m unittest', outcome: 'passed' }], failures: [], remainingSteps: [],
    }));
    expect(readHandoffReferenceForIntegration(handoff)).toBe(HANDOFF_REF);
  });

  test('a fronteira de integração do INT-03 continua aceitando o mesmo par tentativa/handoff', () => {
    const attempt = succeededAttempt();
    const handoff = built(baseInput(attempt, {
      validations: [{ label: 'python -m unittest', outcome: 'passed' }], failures: [], remainingSteps: [],
    }));
    const boundary = produceResultForIntegration({
      attempt,
      resultCorrelation: { workItemId: 'item-1', attemptId: 'attempt-1', approvedProposalVersion: 2, origin: 'executor' },
      workItemState: 'review',
      handoff: { kind: 'execution_result', reference: readHandoffReferenceForIntegration(handoff), resultEventId: 'result-1' },
    });
    expect(boundary.ok).toBe(true);
  });

  test('handoff de referência opaca no formato do INT-04 é aceito sem adaptação', () =>
    expect(built(baseInput(pausedAttempt())).handoffReference).toMatch(/^local-runner:[^:]+:[^:]+:sha256:[0-9a-f]{64}$/));
});

describe('handoff obrigatório — nenhum efeito externo', () => {
  test('produzir handoff não autoriza aplicação, integração ou publicação', () => {
    const handoff = built(baseInput(succeededAttempt(), {
      validations: [{ label: 'testes', outcome: 'passed' }], failures: [], remainingSteps: [],
    }));
    expect(Object.keys(handoff)).toEqual(expect.not.arrayContaining(['authorized', 'applied', 'integrated', 'merged', 'published']));
  });

  test('o payload é apenas projeção append-only, sem estado de item ou claim', () => {
    const payload = buildWorkHandoffPayload(built(baseInput(pausedAttempt())));
    expect(payload.schema_version).toBe(1);
    expect(Object.keys(payload.data)).toEqual(expect.not.arrayContaining(['work_state', 'item_state', 'claim_released_at', 'integration']));
  });

  test('construir o handoff não altera a tentativa de origem', () => {
    const attempt = pausedAttempt();
    const snapshot = JSON.stringify(attempt);
    built(baseInput(attempt));
    expect(JSON.stringify(attempt)).toBe(snapshot);
  });

  test('o payload preserva correlação e evidências sem inventar campos', () => {
    const payload = buildWorkHandoffPayload(built(baseInput(pausedAttempt())));
    expect(payload.data).toMatchObject({
      work_item_id: 'item-1', attempt_id: 'attempt-1', approved_proposal_version: 2, claim_id: 'claim-1',
      status: 'paused', stop_reason: 'human_input_required', handoff_reference: HANDOFF_REF,
      next_step: 'aplicar a correção mínima e reexecutar python -m unittest',
      failures: ['AssertionError: 2 + 2 != 5'],
    });
  });
});
