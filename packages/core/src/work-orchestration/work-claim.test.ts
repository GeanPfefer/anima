import {
  acquireWorkClaim,
  bindAttemptToWorkClaim,
  buildWorkClaimReleasedPayload,
  buildWorkClaimedPayload,
  deriveWorkClaimStatus,
  releaseWorkClaim,
  type AcquireWorkClaimInput,
  type WorkClaim,
  type WorkItem,
} from '.';
import type { Json } from '@anima/types';

const spec: Json = { schema_version: 1, target: { kind: 'project', reference: 'anima' }, permissions: ['workspace_read'], validation_criteria: [{ label: 'npm test' }], limits: { max_attempts: 1 } };
const makeItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'item-1', userId: 'u', sourceMessageId: 'm', state: 'approved', impactLevel: 'low', capability: 'programming', originalRequest: 'x',
  intent: { execution_spec: spec },
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'corrigir soma', includedScope: ['calculator.py'], excludedScope: ['deploy'], expectedEffects: ['testes verdes'], risks: [] } },
  proposalVersion: 2, createdAt: new Date('2026-07-21T10:00:00Z'), updatedAt: new Date('2026-07-21T10:00:00Z'), ...overrides,
});

const T0 = new Date('2026-07-21T12:00:00Z');
const at = (secondsFromT0: number): Date => new Date(T0.getTime() + secondsFromT0 * 1000);

const makeInput = (overrides: Partial<AcquireWorkClaimInput> = {}): AcquireWorkClaimInput => ({
  claimId: 'claim-a', item: makeItem(), ownerInstanceId: 'supervisor-1', expectedProposalVersion: 2,
  openClaim: null, claimWithSameId: null, now: T0, leaseSeconds: 300, ...overrides,
});

const grantedClaim = (overrides: Partial<AcquireWorkClaimInput> = {}): WorkClaim => {
  const decision = acquireWorkClaim(makeInput(overrides));
  if (decision.outcome !== 'granted') throw new Error(`esperava claim concedido, veio ${decision.outcome}`);
  return decision.claim;
};

describe('claim exclusivo — aquisição', () => {
  test('item elegível e livre concede claim com validade e sem tentativa', () => {
    expect(acquireWorkClaim(makeInput())).toEqual({
      outcome: 'granted', supersededClaimId: null,
      claim: { claimId: 'claim-a', workItemId: 'item-1', approvedProposalVersion: 2, ownerInstanceId: 'supervisor-1', acquiredAt: T0, expiresAt: at(300), attemptId: null, release: null },
    });
  });

  test('claim concedido não afirma execução: a tentativa continua ausente', () => expect(grantedClaim().attemptId).toBeNull());

  test.each([
    ['claim vazio', { claimId: '  ' }],
    ['dono vazio', { ownerInstanceId: '' }],
    ['validade zero', { leaseSeconds: 0 }],
    ['validade fracionada', { leaseSeconds: 1.5 }],
    ['versão esperada inválida', { expectedProposalVersion: 0 }],
  ])('entrada ambígua falha fechada (%s)', (_label, overrides) =>
    expect(acquireWorkClaim(makeInput(overrides))).toMatchObject({ outcome: 'denied', reason: 'invalid_claim_request' }));
});

describe('claim exclusivo — exclusividade e concorrência', () => {
  test('dois supervisores disputando o mesmo item: só um recebe o claim', () => {
    const first = acquireWorkClaim(makeInput({ claimId: 'claim-a', ownerInstanceId: 'supervisor-1' }));
    expect(first.outcome).toBe('granted');
    const second = acquireWorkClaim(makeInput({ claimId: 'claim-b', ownerInstanceId: 'supervisor-2', openClaim: grantedClaim(), now: at(1) }));
    expect(second).toMatchObject({ outcome: 'denied', reason: 'held_by_active_claim' });
  });

  test('o mesmo supervisor com claim novo também é recusado enquanto houver claim ativo', () =>
    expect(acquireWorkClaim(makeInput({ claimId: 'claim-b', openClaim: grantedClaim(), now: at(1) }))).toMatchObject({ outcome: 'denied', reason: 'held_by_active_claim' }));

  test('a recusa aponta o claim vencedor e sua validade', () => {
    const decision = acquireWorkClaim(makeInput({ claimId: 'claim-b', ownerInstanceId: 'supervisor-2', openClaim: grantedClaim() }));
    expect(decision.outcome === 'denied' && decision.explanation).toContain('claim-a');
  });
});

describe('claim exclusivo — replay do mesmo comando', () => {
  test('reenviar o mesmo claim ativo devolve o claim existente sem novo efeito', () => {
    const claim = grantedClaim();
    expect(acquireWorkClaim(makeInput({ claimWithSameId: claim, openClaim: claim, now: at(30) }))).toEqual({ outcome: 'replayed', claim });
  });

  test('replay é reconhecido mesmo depois de o item sair de aprovado', () => {
    const claim = { ...grantedClaim(), attemptId: 'attempt-1' };
    expect(acquireWorkClaim(makeInput({ item: makeItem({ state: 'in_progress' }), claimWithSameId: claim, openClaim: claim, now: at(30) })))
      .toEqual({ outcome: 'replayed', claim });
  });

  test('mesmo claim id com outra correlação é conflito, não replay', () =>
    expect(acquireWorkClaim(makeInput({ claimWithSameId: { ...grantedClaim(), ownerInstanceId: 'supervisor-2' } })))
      .toMatchObject({ outcome: 'denied', reason: 'claim_identity_conflict' }));

  test('claim já liberado não ressuscita', () => {
    const released = releaseWorkClaim(grantedClaim(), 'released_without_attempt', at(10));
    expect(released.outcome).toBe('released');
    if (released.outcome !== 'released') return;
    expect(acquireWorkClaim(makeInput({ claimWithSameId: released.claim, now: at(20) }))).toMatchObject({ outcome: 'denied', reason: 'claim_already_released' });
  });
});

describe('claim exclusivo — elegibilidade e checkpoints humanos', () => {
  test('item não aprovado não é reivindicável', () =>
    expect(acquireWorkClaim(makeInput({ item: makeItem({ state: 'proposed' }) }))).toMatchObject({ outcome: 'denied', reason: 'not_eligible', gaps: ['proposal_not_approved', 'human_decision_pending'] }));

  test.each<WorkItem['state']>(['review', 'changes_requested'])('item aguardando decisão humana (%s) é ignorado', state =>
    expect(acquireWorkClaim(makeInput({ item: makeItem({ state }) }))).toMatchObject({ outcome: 'denied', reason: 'not_eligible', gaps: ['human_decision_pending'] }));

  test('item bloqueado aguardando dependência não é reivindicável', () =>
    expect(acquireWorkClaim(makeInput({ item: makeItem({ state: 'blocked' }) }))).toMatchObject({ outcome: 'denied', reason: 'not_eligible', gaps: ['work_blocked_unresolved'] }));

  test('especificação incompleta bloqueia o claim com as lacunas exatas', () =>
    expect(acquireWorkClaim(makeInput({ item: makeItem({ intent: {} }) })))
      .toMatchObject({ outcome: 'denied', reason: 'not_eligible', gaps: ['target_missing', 'permissions_not_declared', 'validation_criteria_missing', 'limits_missing'] }));

  test('proposta revisada desde a leitura invalida o claim pretendido', () =>
    expect(acquireWorkClaim(makeInput({ expectedProposalVersion: 1 }))).toMatchObject({ outcome: 'denied', reason: 'proposal_version_changed' }));
});

describe('claim exclusivo — expiração e retomada', () => {
  test('claim vence exatamente ao atingir o horário de expiração', () => {
    const claim = grantedClaim();
    expect(deriveWorkClaimStatus(claim, at(299))).toBe('active');
    expect(deriveWorkClaimStatus(claim, at(300))).toBe('expired');
  });

  test('claim expirado é substituído de forma auditável, preservando o anterior', () => {
    const abandoned = grantedClaim();
    const decision = acquireWorkClaim(makeInput({ claimId: 'claim-b', ownerInstanceId: 'supervisor-2', openClaim: abandoned, now: at(301) }));
    expect(decision).toMatchObject({ outcome: 'granted', supersededClaimId: 'claim-a', claim: { claimId: 'claim-b', ownerInstanceId: 'supervisor-2' } });
    expect(abandoned.release).toBeNull();
  });

  test('retomar com o mesmo claim expirado é recusado — a substituição precisa ser explícita', () => {
    const claim = grantedClaim();
    expect(acquireWorkClaim(makeInput({ claimWithSameId: claim, openClaim: claim, now: at(301) }))).toMatchObject({ outcome: 'denied', reason: 'claim_expired' });
  });

  test('liberar claim expirado registra a razão sem apagar histórico', () => {
    const decision = releaseWorkClaim(grantedClaim(), 'expired', at(301));
    expect(decision).toMatchObject({ outcome: 'released', claim: { claimId: 'claim-a', acquiredAt: T0, release: { reason: 'expired', releasedAt: at(301) } } });
  });
});

describe('claim exclusivo — no máximo uma tentativa por claim', () => {
  test('a tentativa é iniciada uma única vez sob o claim', () => {
    const decision = bindAttemptToWorkClaim(grantedClaim(), 'attempt-1', at(5));
    expect(decision).toMatchObject({ outcome: 'bound', claim: { attemptId: 'attempt-1' } });
  });

  test('reentregar a mesma tentativa é idempotente', () => {
    const bound = bindAttemptToWorkClaim(grantedClaim(), 'attempt-1', at(5));
    if (bound.outcome !== 'bound') throw new Error('esperava vínculo');
    expect(bindAttemptToWorkClaim(bound.claim, 'attempt-1', at(9))).toEqual({ outcome: 'replayed', claim: bound.claim });
  });

  test('uma segunda tentativa sob o mesmo claim é recusada', () => {
    const bound = bindAttemptToWorkClaim(grantedClaim(), 'attempt-1', at(5));
    if (bound.outcome !== 'bound') throw new Error('esperava vínculo');
    expect(bindAttemptToWorkClaim(bound.claim, 'attempt-2', at(9))).toMatchObject({ outcome: 'denied', reason: 'attempt_already_bound' });
  });

  test('claim expirado não inicia tentativa', () =>
    expect(bindAttemptToWorkClaim(grantedClaim(), 'attempt-1', at(301))).toMatchObject({ outcome: 'denied', reason: 'claim_expired' }));

  test('claim liberado não inicia tentativa', () => {
    const released = releaseWorkClaim(grantedClaim(), 'released_without_attempt', at(10));
    if (released.outcome !== 'released') throw new Error('esperava liberação');
    expect(bindAttemptToWorkClaim(released.claim, 'attempt-1', at(11))).toMatchObject({ outcome: 'denied', reason: 'claim_released' });
  });

  test('tentativa sem identificador falha fechada', () =>
    expect(bindAttemptToWorkClaim(grantedClaim(), '  ', at(5))).toMatchObject({ outcome: 'denied', reason: 'invalid_attempt_reference' }));
});

describe('claim exclusivo — liberação coerente', () => {
  const bound = (): WorkClaim => {
    const decision = bindAttemptToWorkClaim(grantedClaim(), 'attempt-1', at(5));
    if (decision.outcome !== 'bound') throw new Error('esperava vínculo');
    return decision.claim;
  };

  test('liberar após a tentativa terminar preserva o vínculo', () =>
    expect(releaseWorkClaim(bound(), 'attempt_finished', at(60))).toMatchObject({ outcome: 'released', claim: { attemptId: 'attempt-1', release: { reason: 'attempt_finished' } } }));

  test('repetir a liberação com a mesma razão é idempotente', () => {
    const first = releaseWorkClaim(bound(), 'attempt_finished', at(60));
    if (first.outcome !== 'released') throw new Error('esperava liberação');
    expect(releaseWorkClaim(first.claim, 'attempt_finished', at(90))).toEqual({ outcome: 'replayed', claim: first.claim });
  });

  test('liberar de novo com outra razão não reescreve o histórico', () => {
    const first = releaseWorkClaim(bound(), 'attempt_finished', at(60));
    if (first.outcome !== 'released') throw new Error('esperava liberação');
    expect(releaseWorkClaim(first.claim, 'expired', at(90))).toMatchObject({ outcome: 'denied', reason: 'release_reason_conflict' });
  });

  test('"attempt_finished" sem tentativa iniciada é incoerente', () =>
    expect(releaseWorkClaim(grantedClaim(), 'attempt_finished', at(60))).toMatchObject({ outcome: 'denied', reason: 'release_reason_incoherent' }));

  test('"released_without_attempt" com tentativa iniciada é incoerente', () =>
    expect(releaseWorkClaim(bound(), 'released_without_attempt', at(60))).toMatchObject({ outcome: 'denied', reason: 'release_reason_incoherent' }));
});

describe('claim exclusivo — payloads append-only', () => {
  test('aquisição projeta correlação, posse e substituição', () =>
    expect(buildWorkClaimedPayload(grantedClaim(), 'claim-anterior')).toEqual({
      schema_version: 1,
      data: { claim_id: 'claim-a', work_item_id: 'item-1', approved_proposal_version: 2, owner_instance_id: 'supervisor-1', acquired_at: T0.toISOString(), expires_at: at(300).toISOString(), superseded_claim_id: 'claim-anterior' },
    }));

  test('claim ainda não liberado não produz payload de liberação', () => expect(buildWorkClaimReleasedPayload(grantedClaim())).toBeNull());

  test('liberação projeta razão, horário e tentativa associada', () => {
    const released = releaseWorkClaim(grantedClaim(), 'expired', at(301));
    if (released.outcome !== 'released') throw new Error('esperava liberação');
    expect(buildWorkClaimReleasedPayload(released.claim)).toEqual({
      schema_version: 1,
      data: { claim_id: 'claim-a', work_item_id: 'item-1', approved_proposal_version: 2, owner_instance_id: 'supervisor-1', attempt_id: null, reason: 'expired', released_at: at(301).toISOString() },
    });
  });
});
