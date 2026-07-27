import {
  type AbandonedCheckpointV1,
  INTERRUPTION_SCENARIOS,
  buildWorkHandoff,
  describesRecoverableInterruption,
  finishExecutionAttempt,
  planWorkResumption,
  startExecutionAttempt,
  type InterruptionScenario,
  type WorkClaim,
  type WorkHandoffV1,
  type WorkItem,
  type WorkResumptionInput,
} from '.';
import type { Json } from '@anima/types';

const T0 = new Date('2026-07-21T12:00:00Z');
const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);
const HANDOFF_REF = 'local-runner:anima:20260721T120000Z-result.zip:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const spec = (limits: Json = { max_attempts: 3 }): Json => ({
  schema_version: 1, target: { kind: 'project', reference: 'anima' }, permissions: [],
  validation_criteria: [{ label: 'tests' }], limits,
});

const makeItem = (overrides: Partial<WorkItem> = {}, limits?: Json): WorkItem => ({
  id: 'item-1', userId: 'u', sourceMessageId: 'm', state: 'approved', impactLevel: 'low', capability: 'programming', originalRequest: 'x',
  intent: { execution_spec: spec(limits) },
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'corrigir', includedScope: ['a.py'], excludedScope: ['deploy'], expectedEffects: ['testes verdes'], risks: [] } },
  proposalVersion: 2, createdAt: T0, updatedAt: T0, ...overrides,
});

const makeHandoff = (overrides: Partial<Parameters<typeof buildWorkHandoff>[0]> = {}, attemptOverrides: Record<string, unknown> = {}): WorkHandoffV1 => {
  const started = startExecutionAttempt({
    attemptId: 'attempt-1', workItemId: 'item-1', approvedProposalVersion: 2, executorId: 'local-runner-v1', startedAt: T0,
  });
  if (!started.ok) throw new Error('fixture inválida');
  const finished = finishExecutionAttempt(started.value, {
    status: 'paused', finishedAt: at(60), resultSummary: 'pausado', stopReason: 'human_input_required', handoffReference: HANDOFF_REF,
  });
  if (!finished.ok) throw new Error('fixture inválida');
  const result = buildWorkHandoff({
    attempt: { ...finished.value, ...attemptOverrides },
    claimId: 'claim-1',
    completedSteps: ['isolou a workspace'],
    remainingSteps: ['corrigir o operador de soma'],
    decisions: ['manter a assinatura de add()'],
    risks: ['gate cobre apenas um caso'],
    nextStep: 'aplicar a correção mínima e reexecutar os testes',
    touchedResources: ['calculator.py'],
    validations: [{ label: 'python -m unittest', outcome: 'failed' }],
    failures: ['AssertionError: 2 + 2 != 5'],
    evidenceReferences: ['runner-evidence:20260721.json'],
    ...overrides,
  });
  if (!result.ok) throw new Error(`fixture inválida: ${result.explanation}`);
  return result.value;
};

const claim = (overrides: Partial<WorkClaim> = {}): WorkClaim => ({
  claimId: 'claim-1', workItemId: 'item-1', approvedProposalVersion: 2, ownerInstanceId: 'supervisor-morto',
  acquiredAt: T0, expiresAt: at(300), attemptId: 'attempt-1', release: null, ...overrides,
});

const abandonedCheckpoint = (overrides: Partial<AbandonedCheckpointV1> = {}): AbandonedCheckpointV1 => ({
  schemaVersion: 1, workItemId: 'item-1', sourceAttemptId: 'attempt-1', sourceClaimId: 'claim-1',
  approvedProposalVersion: 2, checkpointEventSeq: 40, checkpointSignalSequence: 4, abandonmentEventSeq: 41,
  handoffReference: HANDOFF_REF, completedSteps: ['isolou a workspace'],
  remainingSteps: ['corrigir o operador de soma'], nextStep: 'corrigir e testar',
  decisions: ['manter assinatura'], risks: ['cobertura parcial'], touchedResources: ['calculator.py'],
  validations: [{ label: 'python -m unittest', outcome: 'failed' }],
  failures: ['AssertionError'], evidenceReferences: ['runner-evidence:1'],
  abandonmentReason: 'lease_expired', abandonedAt: at(400).toISOString(), ...overrides,
});

const abandonedSource = (checkpoint: AbandonedCheckpointV1 | null = abandonedCheckpoint()) => ({
  kind: 'abandoned_checkpoint' as const, checkpoint, sourceAttemptId: 'attempt-1', sourceClaimId: 'claim-1',
  approvedProposalVersion: 2, abandonmentEventSeq: 41, abandonmentReason: 'lease_expired' as const,
  abandonedAt: at(400).toISOString(),
});

const makeInput = (overrides: Partial<WorkResumptionInput> = {}): WorkResumptionInput => ({
  item: makeItem(),
  source: { kind: 'terminal_handoff', scenario: 'machine_restart', handoff: makeHandoff() },
  openClaim: null,
  previousAttemptIds: ['attempt-1'],
  nextAttemptId: 'attempt-2',
  nextClaimId: 'claim-2',
  now: at(400),
  ...overrides,
});

describe('retomada — todo cenário do Marco 003 tem caminho', () => {
  test('a lista de cenários é exatamente a do marco, sem "outro"', () =>
    expect([...INTERRUPTION_SCENARIOS]).toEqual([
      'provider_limit_reached', 'application_shutdown', 'machine_restart',
      'container_runtime_unavailable', 'network_failure', 'model_failure', 'executor_change',
    ]));

  test.each<InterruptionScenario>([...INTERRUPTION_SCENARIOS])('%s retoma pelo checkpoint persistido', scenario => {
    const decision = planWorkResumption(makeInput({ source: { kind: 'terminal_handoff', scenario, handoff: makeHandoff() } }));
    expect(decision).toMatchObject({
      outcome: 'resume',
      plan: { scenario, resumeFromAttemptId: 'attempt-1', resumeFromHandoffReference: HANDOFF_REF, attemptNumber: 2 },
    });
  });

  test.each<InterruptionScenario>([...INTERRUPTION_SCENARIOS])('%s é reconhecido como interrupção recuperável', scenario =>
    expect(describesRecoverableInterruption(scenario)).toBe(true));

  test('cenário fora da lista é defeito', () =>
    expect(planWorkResumption(makeInput({ source: { kind: 'terminal_handoff', scenario: 'gato_no_teclado' as InterruptionScenario, handoff: makeHandoff() } })))
      .toMatchObject({ outcome: 'refused', reason: 'scenario_not_allowed' }));
});

describe('retomada — parte do checkpoint, nunca da memória', () => {
  test('sem checkpoint não se retoma: exige reparação ou decisão humana', () =>
    expect(planWorkResumption(makeInput({ source: { kind: 'terminal_handoff', scenario: 'machine_restart', handoff: null } })))
      .toMatchObject({ outcome: 'refused', reason: 'checkpoint_missing' }));

  test('o contexto carregado vem exclusivamente do handoff persistido', () => {
    const decision = planWorkResumption(makeInput());
    expect(decision).toMatchObject({
      outcome: 'resume',
      plan: {
        carriedContext: {
          remainingSteps: ['corrigir o operador de soma'],
          nextStep: 'aplicar a correção mínima e reexecutar os testes',
          risks: ['gate cobre apenas um caso'],
          touchedResources: ['calculator.py'],
          previousFailures: ['AssertionError: 2 + 2 != 5'],
        },
      },
    });
  });

  test('as falhas anteriores atravessam a interrupção', () => {
    const decision = planWorkResumption(makeInput());
    expect(decision.outcome === 'resume' && decision.plan.carriedContext.previousFailures).toEqual(['AssertionError: 2 + 2 != 5']);
  });

  test('checkpoint de outro item é recusado', () => {
    const alheio = { ...makeHandoff(), workItemId: 'item-9' };
    expect(planWorkResumption(makeInput({ source: { kind: 'terminal_handoff', scenario: 'machine_restart', handoff: alheio } })))
      .toMatchObject({ outcome: 'refused', reason: 'checkpoint_correlation_mismatch' });
  });

  test('checkpoint de tentativa ausente do histórico é recusado', () =>
    expect(planWorkResumption(makeInput({ previousAttemptIds: ['attempt-outra'] })))
      .toMatchObject({ outcome: 'refused', reason: 'checkpoint_correlation_mismatch' }));
});

describe('retomada — fonte de checkpoint abandonado', () => {
  test('checkpoint abandonado válido autoriza sem cenário externo', () =>
    expect(planWorkResumption(makeInput({ source: abandonedSource() }))).toMatchObject({
      outcome: 'resume',
      plan: {
        sourceKind: 'abandoned_checkpoint', abandonmentReason: 'lease_expired',
        resumeFromAttemptId: 'attempt-1', resumeFromCheckpointEventSeq: 40,
        resumeFromCheckpointSignalSequence: 4,
      },
    }));

  test('abandono sem checkpoint exige humano e não executa do zero', () =>
    expect(planWorkResumption(makeInput({ source: abandonedSource(null) })))
      .toMatchObject({ outcome: 'requires_human' }));

  test('razão de abandono fora do vocabulário é recusada', () =>
    expect(planWorkResumption(makeInput({
      source: { ...abandonedSource(), abandonmentReason: 'machine_restart' },
    }))).toMatchObject({ outcome: 'refused', reason: 'invalid_resumption_request' }));

  test('checkpoint isolado sem prova de abandono correlacionada é recusado', () =>
    expect(planWorkResumption(makeInput({
      source: { ...abandonedSource(), abandonmentEventSeq: 99 },
    }))).toMatchObject({ outcome: 'refused', reason: 'checkpoint_correlation_mismatch' }));

  test('não fabrica status, stopReason ou cenário externo', () => {
    const decision = planWorkResumption(makeInput({ source: abandonedSource() }));
    if (decision.outcome !== 'resume') throw new Error('esperava retomada');
    expect(decision.plan).not.toHaveProperty('status');
    expect(decision.plan).not.toHaveProperty('stopReason');
    expect(decision.plan).not.toHaveProperty('scenario');
  });
});

describe('retomada — escopo aprovado não muda', () => {
  test('checkpoint de versão anterior não retoma sobre a proposta vigente', () =>
    expect(planWorkResumption(makeInput({ item: makeItem({ proposalVersion: 3 }) })))
      .toMatchObject({ outcome: 'refused', reason: 'checkpoint_correlation_mismatch' }));

  test('o plano preserva a versão aprovada exata', () =>
    expect(planWorkResumption(makeInput())).toMatchObject({ outcome: 'resume', plan: { approvedProposalVersion: 2 } }));

  test('item que deixou de ser elegível não retoma', () =>
    expect(planWorkResumption(makeInput({ item: makeItem({ intent: {} }) })))
      .toMatchObject({ outcome: 'refused', reason: 'work_not_resumable' }));
});

describe('retomada — identidades novas, nunca reaproveitadas', () => {
  test('a retomada exige nova tentativa e novo claim', () =>
    expect(planWorkResumption(makeInput())).toMatchObject({
      outcome: 'resume', plan: { nextAttemptId: 'attempt-2', nextClaimId: 'claim-2' },
    }));

  test('reaproveitar a tentativa anterior é recusado', () =>
    expect(planWorkResumption(makeInput({ nextAttemptId: 'attempt-1' })))
      .toMatchObject({ outcome: 'refused', reason: 'identifier_reused' }));

  test('reaproveitar o claim anterior é recusado — não há renovação silenciosa', () =>
    expect(planWorkResumption(makeInput({ nextClaimId: 'claim-1' })))
      .toMatchObject({ outcome: 'refused', reason: 'identifier_reused' }));

  test('identificadores em branco falham fechado', () =>
    expect(planWorkResumption(makeInput({ nextAttemptId: '  ' })))
      .toMatchObject({ outcome: 'refused', reason: 'invalid_resumption_request' }));
});

describe('retomada — nunca duplica execução em curso', () => {
  test('claim ainda ativo impede retomada paralela', () =>
    expect(planWorkResumption(makeInput({ openClaim: claim(), now: at(100) })))
      .toMatchObject({ outcome: 'refused', reason: 'claim_still_active' }));

  test('claim expirado libera a retomada', () =>
    expect(planWorkResumption(makeInput({ openClaim: claim(), now: at(400) })))
      .toMatchObject({ outcome: 'resume' }));

  test('tentativa ainda aberta exige reconciliação antes de retomar', () =>
    expect(planWorkResumption(makeInput({ item: makeItem({ state: 'in_progress' }) })))
      .toMatchObject({ outcome: 'refused', reason: 'work_not_resumable' }));

  test.each<WorkItem['state']>(['review', 'changes_requested', 'blocked', 'completed', 'rejected', 'cancelled'])(
    'item em %s não é retomado automaticamente',
    state => expect(planWorkResumption(makeInput({ item: makeItem({ state }) })))
      .toMatchObject({ outcome: 'refused', reason: 'work_not_resumable' }),
  );
});

describe('retomada — checkpoints humanos continuam soberanos', () => {
  test('item bloqueado aguarda resolução humana, não retomada automática', () =>
    expect(planWorkResumption(makeInput({ item: makeItem({ state: 'blocked' }) })))
      .toMatchObject({ outcome: 'refused', reason: 'work_not_resumable' }));

  test('resolver o bloqueio devolve o item a aprovado e aí a retomada segue', () =>
    expect(planWorkResumption(makeInput({ item: makeItem({ state: 'approved' }) })))
      .toMatchObject({ outcome: 'resume' }));

  test('item aguardando revisão não é retomado por trás do humano', () =>
    expect(planWorkResumption(makeInput({ item: makeItem({ state: 'review' }) })))
      .toMatchObject({ outcome: 'refused', reason: 'work_not_resumable' }));
});

describe('retomada — limite esgotado vira interrupção, não loop', () => {
  test('atingir o limite de tentativas escala para decisão humana', () => {
    const decision = planWorkResumption(makeInput({
      item: makeItem({}, { max_attempts: 2 }),
      previousAttemptIds: ['attempt-1', 'attempt-2'],
      nextAttemptId: 'attempt-3',
    }));
    expect(decision).toMatchObject({
      outcome: 'requires_human',
      reason: 'persistent_inability_after_limits',
      reachedLimit: 'attempts',
    });
  });

  test('dentro do limite a retomada segue', () =>
    expect(planWorkResumption(makeInput({
      item: makeItem({}, { max_attempts: 3 }), previousAttemptIds: ['attempt-1', 'attempt-2'], nextAttemptId: 'attempt-3',
    }))).toMatchObject({ outcome: 'resume', plan: { attemptNumber: 3 } }));

  test('sem limite de tentativas declarado, outro limite não bloqueia a retomada', () =>
    expect(planWorkResumption(makeInput({ item: makeItem({}, { max_duration_minutes: 30 }) })))
      .toMatchObject({ outcome: 'resume' }));
});

describe('retomada — planejar não produz efeito', () => {
  test('planejar não adquire posse nem inicia tentativa', () => {
    const input = makeInput();
    planWorkResumption(input);
    expect(input.openClaim).toBeNull();
    expect(input.item.state).toBe('approved');
  });

  test('planejar não altera o checkpoint de origem', () => {
    const handoff = makeHandoff();
    const snapshot = JSON.stringify(handoff);
    planWorkResumption(makeInput({ source: { kind: 'terminal_handoff', scenario: 'machine_restart', handoff } }));
    expect(JSON.stringify(handoff)).toBe(snapshot);
  });

  test('o plano não carrega autorização de aplicação ou integração', () => {
    const decision = planWorkResumption(makeInput());
    if (decision.outcome !== 'resume') throw new Error('esperava plano');
    expect(Object.keys(decision.plan)).toEqual(expect.not.arrayContaining(['authorized', 'apply', 'integrate', 'merge']));
  });

  test('o mesmo pedido produz sempre o mesmo plano', () => {
    const input = makeInput();
    expect(planWorkResumption(input)).toEqual(planWorkResumption(input));
  });
});
