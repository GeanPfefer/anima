/** @jest-environment node */
import { computeAutonomyEvidence, type AutonomyEvidenceInput, type AutonomyEvidenceLease } from './autonomy-evidence';
import type { WorkEvent } from './work-orchestration/types';
const now = new Date('2026-10-14T12:00:00Z');
const contextData = (over: Record<string, unknown> = {}, evidenceOver: Record<string, unknown> = {}) => ({
  work_item_id: 'a', attempt_id: 'att-1', approved_proposal_version: 1, origin: 'host', recorded_by: 'trusted_system_writer',
  execution_mode: 'unattended', actor_kind: 'automated_runner',
  evidence: { schemaVersion: 1, workItemId: 'a', attemptId: 'att-1', approvedProposalVersion: 1, executionMode: 'unattended', actorKind: 'automated_runner', ...evidenceOver },
  authority: { approval_author: 'system', approval_authority: 'autonomous_policy', approved_seq: 1, classified_seq: 2, leases_observed: 0, human_acts_after_mandate: 0 },
  ...over,
});
function event(type: WorkEvent['type'], author: WorkEvent['author'] = 'system', data: WorkEvent['payload'] = {}, day = '2026-10-13', workItemId = 'a'): WorkEvent {
  return { id: `${type}-${author}-${day}`, workItemId, type, author, proposalVersion: 1,
    payload: { data }, occurredAt: new Date(`${day}T12:00:00Z`) };
}
function fixture(): AutonomyEvidenceInput {
  return { now, items: [{ id: 'a', state: 'review' }], leases: [], events: [
    event('work_approved', 'system', { authority: 'autonomous_policy' }, '2026-10-10'),
    event('work_intelligence_classified', 'system', { classification: { provenance: { kind: 'system_assessed' } } }, '2026-10-10'),
    event('execution_started', 'anima', { attempt_id: 'att-1' }, '2026-10-11'),
    event('host_observed_execution_context_recorded', 'system', contextData(), '2026-10-11'),
    event('result_submitted', 'executor'),
  ] };
}
const lease = (overrides: Partial<AutonomyEvidenceLease> = {}): AutonomyEvidenceLease => ({
  workItemId: 'a', proposalVersion: 1, issuedAt: '2026-10-12T12:00:00Z',
  expiresAt: '2026-10-15T12:00:00Z', revokedAt: null, ...overrides,
});
const compute = (overrides: Partial<AutonomyEvidenceInput> = {}) => computeAutonomyEvidence({ ...fixture(), ...overrides });

describe('Evidência observada de autonomia', () => {
  test('verifica até review somente com todos os requisitos positivos', () => {
    const summary = compute();
    expect(summary.unattendedVerifiedUntilReview).toBe(1);
    expect(summary.unattendedVerifiedFullCycle).toBe(0);
    expect(summary.verdict).toBe('unattended_verified');
    expect(summary.windows[0].classes.unattended_verified).toBe(1);
  });
  test('conta atos humanos por tipo e por item concluído', () => {
    const events = [event('work_approved', 'user'), event('input_provided', 'user'), event('result_accepted', 'user'),
      event('result_accepted', 'system', {}, '2026-10-13', 'b'), event('work_approved', 'anima')];
    const summary = compute({ events, items: [{ id: 'a', state: 'completed' }, { id: 'b', state: 'completed' }] });
    expect(summary.windows[0].humanActsPerCompleted).toEqual({ mean: 1.5, min: 0, max: 3, total: 3 });
    expect(summary.windows[0].humanActsByType).toEqual({ work_approved: 1, input_provided: 1, result_accepted: 1 });
  });
  test('separa atos de política dos atos humanos', () => {
    const summary = compute({ items: [{ id: 'a', state: 'completed' }], events: [...fixture().events, event('result_accepted')] });
    expect(summary.windows[0].policyActsPerCompleted).toEqual({ mean: 2, total: 2 });
    expect(summary.windows[0].policyActs).toEqual({ approved: 1, classified: 1 });
    expect(summary.windows[0].humanActsPerCompleted?.total).toBe(0);
    expect(summary.unattendedVerifiedFullCycle).toBe(1);
  });
  test('conta leases ativos expirados e revogados por janela e item', () => {
    const summary = compute({ leases: [lease(), lease({ expiresAt: now.toISOString() }), lease({ revokedAt: now.toISOString() }), lease({ issuedAt: '2026-09-01T00:00:00Z' })] });
    expect(summary.windows[0].leases).toEqual({ issued: 3, active: 1, expired: 1, revoked: 1 });
    expect(summary.windows[1].leases?.issued).toBe(4);
    expect(summary.windows[0].reviewWithLease).toBe(1);
    expect(summary.windows[0].classes.human_observed).toBe(1);
  });
  test('separa attempts dos atos humanos', () => {
    const summary = compute({ events: [...fixture().events, event('work_claimed', 'user'), event('execution_failed', 'user'), event('attempt_abandoned', 'user')] });
    expect(summary.windows[0].attempts).toEqual({ claimed: 1, resultSubmitted: 1, failed: 1, abandoned: 1, itemsWithFailedAttempt: 1 });
    expect(summary.windows[0].humanActsByType).toEqual({});
  });
  test('distingue quatorze dias do histórico completo', () => {
    const summary = compute({ items: [{ id: 'a', state: 'completed' }], events: [event('result_accepted', 'user', {}, '2026-09-01')] });
    expect(summary.windows[0].completedItems).toBe(0);
    expect(summary.windows[1].completedItems).toBe(1);
  });
  test('mantém item sem eventos como evidência insuficiente', () => {
    const summary = compute({ events: [] });
    expect(summary.coverage.itemsWithoutEvents).toBe(1);
    expect(summary.unattendedVerifiedUntilReview).toBe(0);
    expect(summary.verdict).toBe('insufficient_evidence');
  });
  test('resultado sem prova positiva permanece desconhecido', () => {
    const summary = compute({ events: [event('result_submitted')] });
    expect(summary.windows[0].classes.unknown).toBe(1);
    expect(summary.verdict).toBe('unknown');
    expect(summary.limitations).toContain('execution_mode_fact_absent');
  });
  test('rejeita alegações de execução sem autor system', () => {
    for (const author of ['user', 'anima', 'executor'] as const) {
      const summary = compute({ events: fixture().events.map(e => e.type === 'host_observed_execution_context_recorded' ? { ...e, author } : e) });
      expect(summary.coverage.rejectedExecutionModeFacts).toBe(1);
      expect(summary.coverage.unattendedFactsValid).toBe(0);
      expect(summary.unattendedVerifiedUntilReview).toBe(0);
    }
  });
  test('ignora instância declarada e autoria de proposta como prova', () => {
    const summary = compute({ events: [event('work_proposed', 'anima', { owner_instance_id: 'resident-host' }), event('result_submitted')] });
    expect(summary.windows[0].classes.unknown).toBe(1);
    expect(summary.unattendedVerifiedUntilReview).toBe(0);
  });
  test('lease expirado ainda comprova supervisão', () => {
    const summary = compute({ leases: [lease({ expiresAt: '2026-10-13T00:00:00Z' })] });
    expect(summary.unattendedVerifiedUntilReview).toBe(0);
    expect(summary.windows[0].classes.human_observed).toBe(1);
  });
  test('lease revogado ainda comprova supervisão', () => {
    expect(compute({ leases: [lease({ revokedAt: now.toISOString() })] }).unattendedVerifiedUntilReview).toBe(0);
  });
  test('supervisor autenticado como user conta como humano', () => {
    const summary = compute({ events: [...fixture().events, event('work_approved', 'user', {}, '2026-10-12')] });
    expect(summary.windows[0].humanActsByType.work_approved).toBe(1);
    expect(summary.windows[0].classes.human_observed).toBe(1);
  });
  test('janela vazia exibe médias sem dados e contagens nulas', () => {
    const summary = compute({ events: [], items: [] });
    expect(summary.windows[0].humanActsPerCompleted).toBeNull();
    expect(summary.windows[0].policyActsPerCompleted).toBeNull();
    expect(summary.windows[0].completedItems).toBe(0);
    expect(summary.windows[0].attempts.failed).toBe(0);
  });
  test('leases indisponíveis fecham a conclusão', () => {
    const summary = compute({ leases: null });
    expect(summary.verdict).toBe('insufficient_evidence');
    expect(summary.windows[0].classes.insufficient_evidence).toBe(1);
    expect(summary.windows[0].leases).toBeNull();
    expect(summary.limitations).toContain('leases_unavailable');
  });
  test('início supervisionado impede verificação unattended', () => {
    expect(compute({ events: [...fixture().events, event('work_started', 'system', { reason: 'supervised_execution' })] }).unattendedVerifiedUntilReview).toBe(0);
  });
  test('início user desqualifica sem ser somado aos atos', () => {
    const summary = compute({ events: [...fixture().events, event('work_started', 'user', {}, '2026-10-12')] });
    expect(summary.windows[0].humanActsByType).toEqual({});
    expect(summary.windows[0].userStarts).toBe(1);
    expect(summary.windows[0].classes.human_observed).toBe(1);
  });
  test('falhas não alteram atos humanos', () => {
    const events = [...fixture().events, event('work_approved', 'user', {}, '2026-10-12')];
    expect(compute({ events }).windows[0].humanActsByType).toEqual(compute({ events: [...events, event('execution_failed')] }).windows[0].humanActsByType);
  });
  test('aceite humano posterior permite verificação até review mas não ciclo completo', () => {
    const summary = compute({ items: [{ id: 'a', state: 'completed' }], events: [...fixture().events, event('result_accepted', 'user', {}, '2026-10-14')] });
    expect(summary.unattendedVerifiedUntilReview).toBe(1);
    expect(summary.unattendedVerifiedFullCycle).toBe(0);
  });
  test('conclusão sem aceite fica fora das médias', () => {
    const summary = compute({ items: [{ id: 'a', state: 'completed' }] });
    expect(summary.coverage.itemsWithoutReferenceTime).toBe(1);
    expect(summary.windows[1].humanActsPerCompleted).toBeNull();
  });
  test('cada requisito positivo é necessário para verificação', () => {
    for (const type of ['work_approved', 'work_intelligence_classified', 'result_submitted', 'execution_started', 'host_observed_execution_context_recorded']) {
      expect(compute({ events: fixture().events.filter(e => e.type !== type) }).unattendedVerifiedUntilReview).toBe(0);
    }
  });
  describe('fato A2-0 de contexto de execução', () => {
    const withContext = (data: Record<string, unknown>, mutate: Partial<WorkEvent> = {}) => compute({
      events: fixture().events.map(e => e.type === 'host_observed_execution_context_recorded' ? { ...e, payload: { data } as WorkEvent['payload'], ...mutate } : e),
    });
    test('fato íntegro conta como válido e não como rejeitado', () => {
      const summary = compute();
      expect(summary.coverage.executionModeFactsObserved).toBe(1);
      expect(summary.coverage.unattendedFactsValid).toBe(1);
      expect(summary.coverage.rejectedExecutionModeFacts).toBe(0);
      expect(summary.limitations).not.toContain('execution_mode_fact_absent');
    });
    test('legado: execution_mode em evento host antigo nunca vale como prova', () => {
      const events = fixture().events.filter(e => e.type !== 'host_observed_execution_context_recorded')
        .concat(event('host_observed_gate_evidence_recorded', 'system', { execution_mode: 'unattended' }, '2026-10-11'));
      const summary = compute({ events });
      expect(summary.unattendedVerifiedUntilReview).toBe(0);
      expect(summary.coverage.unattendedFactsValid).toBe(0);
      expect(summary.coverage.rejectedExecutionModeFacts).toBe(1);
    });
    test('campos de topo divergentes da evidência assinada são rejeitados', () => {
      const summary = withContext(contextData({ execution_mode: 'supervised' }));
      expect(summary.coverage.rejectedExecutionModeFacts).toBe(1);
      expect(summary.unattendedVerifiedUntilReview).toBe(0);
    });
    test('unattended com ator humano é rejeitado', () => {
      const summary = withContext(contextData({ actor_kind: 'human_operator' }, { actorKind: 'human_operator' }));
      expect(summary.coverage.rejectedExecutionModeFacts).toBe(1);
      expect(summary.unattendedVerifiedUntilReview).toBe(0);
    });
    test('sem recorded_by do Trusted System Writer ou sem origem host é rejeitado', () => {
      expect(withContext(contextData({ recorded_by: 'executor' })).unattendedVerifiedUntilReview).toBe(0);
      expect(withContext(contextData({ origin: 'executor' })).unattendedVerifiedUntilReview).toBe(0);
    });
    test('divergência de attempt: fato de outra attempt não verifica a corrente', () => {
      const summary = withContext(contextData({ attempt_id: 'att-OLD' }, { attemptId: 'att-OLD' }));
      expect(summary.coverage.rejectedExecutionModeFacts).toBe(0);
      expect(summary.unattendedVerifiedUntilReview).toBe(0);
    });
    test('divergência de versão aprovada não verifica', () => {
      const summary = withContext(contextData({ approved_proposal_version: 2 }, { approvedProposalVersion: 2 }));
      expect(summary.unattendedVerifiedUntilReview).toBe(0);
    });
    test('autoridade com lease observada ou ato humano após o mandato não verifica', () => {
      const authority = { approval_author: 'system', approval_authority: 'autonomous_policy', approved_seq: 1, classified_seq: 2 };
      expect(withContext(contextData({ authority: { ...authority, leases_observed: 1, human_acts_after_mandate: 0 } })).unattendedVerifiedUntilReview).toBe(0);
      expect(withContext(contextData({ authority: { ...authority, leases_observed: 0, human_acts_after_mandate: 1 } })).unattendedVerifiedUntilReview).toBe(0);
    });
    test('autoria diferente de system invalida o fato', () => {
      for (const author of ['user', 'anima', 'executor'] as const) {
        expect(withContext(contextData(), { author }).unattendedVerifiedUntilReview).toBe(0);
      }
    });
    test('modo supervised ou manual registrado não verifica unattended', () => {
      expect(withContext(contextData({ execution_mode: 'supervised' }, { executionMode: 'supervised' })).unattendedVerifiedUntilReview).toBe(0);
      expect(withContext(contextData({ execution_mode: 'manual', actor_kind: 'human_operator' }, { executionMode: 'manual', actorKind: 'human_operator' })).unattendedVerifiedUntilReview).toBe(0);
    });
  });
  test('cálculo é puro determinístico e não produz maturidade', () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const result = computeAutonomyEvidence(input);
    expect(computeAutonomyEvidence(input)).toEqual(result);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(/maturity|authority|readiness/);
  });
});
