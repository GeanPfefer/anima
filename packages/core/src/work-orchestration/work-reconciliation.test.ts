import {
  planWorkResumption,
  reconcileSupervisedWork,
  reconciliationAcceptsNoResult,
  reconciliationStartsNoExecution,
  type ReconciliationAttempt,
  type WorkClaim,
  type WorkItem,
  type WorkReconciliationInput,
} from '.';
import type { Json } from '@anima/types';

const T0 = new Date('2026-07-21T12:00:00Z');
const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

const spec = (limits: Json = { max_attempts: 3 }): Json => ({
  schema_version: 1, target: { kind: 'project', reference: 'anima' }, permissions: [],
  validation_criteria: [{ label: 'tests' }], limits,
});

const makeItem = (overrides: Partial<WorkItem> = {}, limits?: Json): WorkItem => ({
  id: 'item-1', userId: 'u', sourceMessageId: 'm', state: 'in_progress', impactLevel: 'low', capability: 'programming', originalRequest: 'x',
  intent: { execution_spec: spec(limits) },
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'corrigir', includedScope: ['a.py'], excludedScope: ['deploy'], expectedEffects: ['testes verdes'], risks: [] } },
  proposalVersion: 2, createdAt: T0, updatedAt: T0, ...overrides,
});

const claim = (overrides: Partial<WorkClaim> = {}): WorkClaim => ({
  claimId: 'claim-1', workItemId: 'item-1', approvedProposalVersion: 2, ownerInstanceId: 'supervisor-1',
  acquiredAt: T0, expiresAt: at(300), attemptId: 'attempt-1', release: null, ...overrides,
});

const attempt = (overrides: Partial<ReconciliationAttempt> = {}): ReconciliationAttempt => ({
  attemptId: 'attempt-1', startedAt: T0, terminal: null, claim: claim(), ...overrides,
});

const input = (overrides: Partial<WorkReconciliationInput> = {}): WorkReconciliationInput => ({
  item: makeItem(), attempt: attempt(), openClaim: claim(), openClaimAttemptTerminal: null,
  declaredDurationMinutes: null, now: at(60), ...overrides,
});

const findings = (decision: ReturnType<typeof reconcileSupervisedWork>): readonly string[] =>
  decision.outcomes.map(outcome => outcome.finding);

describe('reconcileSupervisedWork — nada a reconciliar', () => {
  it('não relata nada quando o item está parado e consistente', () => {
    const decision = reconcileSupervisedWork(input({ item: makeItem({ state: 'approved' }), attempt: null, openClaim: null }));
    expect(findings(decision)).toEqual(['nothing_to_reconcile']);
    expect(decision.resultingState).toBe('approved');
    expect(decision.claimRelease).toBeNull();
    expect(decision.abandonment).toBeNull();
  });
});

describe('reconcileSupervisedWork — posse', () => {
  it('não toma nem libera claim ainda ativo', () => {
    const decision = reconcileSupervisedWork(input({ item: makeItem({ state: 'approved' }), attempt: null }));
    expect(findings(decision)).toContain('claim_active');
    expect(decision.claimRelease).toBeNull();
  });

  it('recolhe lease vencido com a razão declarada, sem apagar a linha', () => {
    const vencido = claim({ expiresAt: at(30), attemptId: null });
    const decision = reconcileSupervisedWork(input({
      item: makeItem({ state: 'approved' }), attempt: null, openClaim: vencido,
    }));
    expect(findings(decision)).toContain('claim_expired');
    expect(decision.claimRelease).toBe('expired');
    // A decisão descreve a liberação; ela não substitui nem reescreve o claim.
    expect(vencido.release).toBeNull();
  });

  it('libera posse cuja tentativa já terminou por fato, não por relógio', () => {
    // O lease continua ativo: se a decisão dependesse de tempo, nada aconteceria.
    const decision = reconcileSupervisedWork(input({
      item: makeItem({ state: 'review' }),
      attempt: attempt({ terminal: 'result_submitted' }),
      openClaim: claim({ expiresAt: at(3600) }),
    }));
    expect(findings(decision)).toContain('claim_open_after_terminal');
    expect(decision.claimRelease).toBe('attempt_finished');
  });
});

describe('reconcileSupervisedWork — tentativa interrompida', () => {
  it('protege tentativa cujo lease ainda vale', () => {
    const decision = reconcileSupervisedWork(input());
    expect(findings(decision)).toContain('attempt_within_declared_bounds');
    expect(decision.resultingState).toBe('in_progress');
    expect(decision.abandonment).toBeNull();
  });

  it('abandona tentativa cujo lease foi excedido', () => {
    const vencido = claim({ expiresAt: at(30) });
    const decision = reconcileSupervisedWork(input({
      attempt: attempt({ claim: vencido }), openClaim: vencido,
    }));
    expect(decision.abandonment).toEqual({
      attemptId: 'attempt-1', reason: 'lease_expired', exceededBounds: ['claim_lease'],
    });
    expect(decision.resultingState).toBe('approved');
  });

  it('abandona tentativa comandada pelo limite de duração declarado na proposta', () => {
    const decision = reconcileSupervisedWork(input({
      attempt: attempt({ claim: null }), openClaim: null,
      declaredDurationMinutes: 5, now: at(3600),
    }));
    expect(decision.abandonment).toEqual({
      attemptId: 'attempt-1', reason: 'duration_limit_exceeded', exceededBounds: ['declared_duration'],
    });
    expect(decision.resultingState).toBe('approved');
  });

  it('exige TODOS os limites declarados excedidos, não apenas um', () => {
    // Lease vencido, duração declarada ainda dentro: a execução pode seguir viva.
    const vencido = claim({ expiresAt: at(30) });
    const decision = reconcileSupervisedWork(input({
      attempt: attempt({ claim: vencido }), openClaim: vencido,
      declaredDurationMinutes: 600, now: at(60),
    }));
    expect(decision.abandonment).toBeNull();
    expect(decision.resultingState).toBe('in_progress');
    expect(findings(decision)).toContain('attempt_within_declared_bounds');
    // A posse vencida ainda assim é recolhida: recolher é seguro, abandonar não.
    expect(decision.claimRelease).toBe('expired');
  });

  it('nomeia os dois limites quando ambos foram excedidos', () => {
    const vencido = claim({ expiresAt: at(30) });
    const decision = reconcileSupervisedWork(input({
      attempt: attempt({ claim: vencido }), openClaim: vencido,
      declaredDurationMinutes: 5, now: at(3600),
    }));
    expect(decision.abandonment).toEqual({
      attemptId: 'attempt-1', reason: 'declared_bounds_exceeded',
      exceededBounds: ['claim_lease', 'declared_duration'],
    });
  });

  it('sem limite declarado não conclui nada e sai para decisão humana', () => {
    const decision = reconcileSupervisedWork(input({
      attempt: attempt({ claim: null }), openClaim: null,
      declaredDurationMinutes: null, now: at(30 * 24 * 3600),
    }));
    expect(findings(decision)).toEqual(['attempt_without_declared_bound']);
    expect(decision.outcomes[0]?.action).toBe('requires_human');
    expect(decision.resultingState).toBe('in_progress');
    expect(decision.abandonment).toBeNull();
  });

  it('ignora limite de duração não positivo ou fracionário, falhando fechado', () => {
    for (const invalido of [0, -5, 2.5, Number.NaN]) {
      const decision = reconcileSupervisedWork(input({
        attempt: attempt({ claim: null }), openClaim: null,
        declaredDurationMinutes: invalido, now: at(30 * 24 * 3600),
      }));
      expect(decision.abandonment).toBeNull();
      expect(findings(decision)).toContain('attempt_without_declared_bound');
    }
  });

  it('relata item em execução sem tentativa correlacionada sem tocá-lo', () => {
    const decision = reconcileSupervisedWork(input({ attempt: null, openClaim: null }));
    expect(findings(decision)).toEqual(['attempt_missing']);
    expect(decision.outcomes[0]?.action).toBe('requires_human');
    expect(decision.resultingState).toBe('in_progress');
  });
});

describe('reconcileSupervisedWork — desfecho já persistido', () => {
  it.each([
    ['result_submitted', 'review'],
    ['execution_failed', 'failed'],
    ['work_cancelled', 'cancelled'],
    ['attempt_abandoned', 'approved'],
  ] as const)('materializa %s como %s sem duplicar o evento', (terminal, expected) => {
    const decision = reconcileSupervisedWork(input({
      attempt: attempt({ terminal }), openClaim: null,
    }));
    expect(findings(decision)).toContain('terminal_not_materialized');
    expect(decision.resultingState).toBe(expected);
    // Nenhum abandono é inventado sobre uma tentativa que já tem desfecho.
    expect(decision.abandonment).toBeNull();
  });

  it('não reavalia limites de uma tentativa que já terminou', () => {
    const vencido = claim({ expiresAt: at(30) });
    const decision = reconcileSupervisedWork(input({
      attempt: attempt({ terminal: 'result_submitted', claim: vencido }), openClaim: vencido,
      declaredDurationMinutes: 1, now: at(3600),
    }));
    expect(decision.abandonment).toBeNull();
    expect(decision.resultingState).toBe('review');
    expect(decision.claimRelease).toBe('attempt_finished');
  });
});

describe('reconcileSupervisedWork — idempotência', () => {
  it('converge: reaplicar a decisão sobre o estado resultante não muda mais nada', () => {
    const vencido = claim({ expiresAt: at(30) });
    const primeira = reconcileSupervisedWork(input({
      attempt: attempt({ claim: vencido }), openClaim: vencido,
    }));
    expect(primeira.abandonment).not.toBeNull();

    // Estado depois da primeira passada: item aprovado, posse liberada, tentativa
    // com desfecho de abandono registrado.
    const liberado = claim({ expiresAt: at(30), release: { reason: 'expired', releasedAt: at(60) } });
    const segunda = reconcileSupervisedWork(input({
      item: makeItem({ state: primeira.resultingState }),
      attempt: attempt({ terminal: 'attempt_abandoned', claim: liberado }),
      openClaim: null,
    }));
    expect(segunda.abandonment).toBeNull();
    expect(segunda.claimRelease).toBeNull();
    expect(segunda.resultingState).toBe('approved');
    expect(findings(segunda)).toEqual(['nothing_to_reconcile']);
  });
});

describe('reconcileSupervisedWork — o que jamais faz', () => {
  const cenarios: readonly WorkReconciliationInput[] = [
    input(),
    input({ attempt: attempt({ claim: claim({ expiresAt: at(30) }) }), openClaim: claim({ expiresAt: at(30) }) }),
    input({ attempt: attempt({ claim: null }), openClaim: null, declaredDurationMinutes: 5, now: at(3600) }),
    input({ item: makeItem({ state: 'review' }), attempt: attempt({ terminal: 'result_submitted' }) }),
    input({ item: makeItem({ state: 'approved' }), attempt: null }),
  ];

  it('nunca inicia execução', () => {
    for (const cenario of cenarios) {
      const decision = reconcileSupervisedWork(cenario);
      expect(reconciliationStartsNoExecution(cenario.item.state, decision)).toBe(true);
    }
  });

  it('nunca aceita, autoriza ou integra resultado', () => {
    for (const cenario of cenarios) {
      const decision = reconcileSupervisedWork(cenario);
      expect(reconciliationAcceptsNoResult(decision)).toBe(true);
      expect(decision.resultingState).not.toBe('completed');
    }
  });

  it('nunca conclui sucesso nem fracasso a partir do desaparecimento do executor', () => {
    // A única evidência é a ausência: nenhum desfecho persistido, executor sumido.
    const vencido = claim({ expiresAt: at(30) });
    const decision = reconcileSupervisedWork(input({
      attempt: attempt({ claim: vencido }), openClaim: vencido,
    }));
    expect(decision.resultingState).not.toBe('review');
    expect(decision.resultingState).not.toBe('failed');
    expect(decision.resultingState).not.toBe('completed');
    expect(decision.resultingState).toBe('approved');
  });
});

describe('SUP-04 destrava o AUTO-05 sem atropelá-lo', () => {
  // Antes da reconciliação o item está `in_progress` e o AUTO-05 recusa por
  // contrato. Depois, ele volta a `approved` — e o AUTO-05 continua soberano
  // sobre se a retomada é segura.
  const vencido = claim({ expiresAt: at(30) });
  const item = makeItem();

  it('o AUTO-05 recusa retomar item em execução, apontando para a reconciliação', () => {
    const decision = planWorkResumption({
      item, scenario: 'machine_restart', lastHandoff: null, openClaim: vencido,
      previousAttemptIds: ['attempt-1'], nextAttemptId: 'attempt-2', nextClaimId: 'claim-2', now: at(60),
    });
    expect(decision.outcome).toBe('refused');
  });

  it('a reconciliação restaura elegibilidade sem retomar por conta própria', () => {
    const reconciled = reconcileSupervisedWork(input({ item, attempt: attempt({ claim: vencido }), openClaim: vencido }));
    expect(reconciled.resultingState).toBe('approved');

    // Elegível — e ainda assim o AUTO-05 recusa sem checkpoint. Reconciliar não
    // autoriza retomar; são duas decisões distintas e ambas precisam passar.
    const resumption = planWorkResumption({
      item: makeItem({ state: reconciled.resultingState }),
      scenario: 'machine_restart', lastHandoff: null, openClaim: null,
      previousAttemptIds: ['attempt-1'], nextAttemptId: 'attempt-2', nextClaimId: 'claim-2', now: at(60),
    });
    expect(resumption.outcome).toBe('refused');
    if (resumption.outcome === 'refused') expect(resumption.reason).toBe('checkpoint_missing');
  });
});
