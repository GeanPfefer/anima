import type { Json } from '@anima/types';
import {
  buildWorktreeHandoff,
  computeVerifierOpinion,
  evaluateVerifierRequirement,
  planResultReview,
  readVerifierRequirement,
  WorkOrchestrationService,
  type VerifierOpinionV1,
  type WorkEvent,
  type WorkItem,
  type WorkOperationResult,
  type WorkOrchestrationRepository,
  type WorktreeHandoffV1,
} from './index';

// ─── Fixtures (mesma forma dos testes do Verifier) ───────────────────────────

const BASE = 'a'.repeat(40);
const COMMIT = 'b'.repeat(40);

const SPEC = {
  schema_version: 1,
  target: { kind: 'project', reference: 'anima' },
  permissions: ['workspace_read', 'workspace_write_isolated'],
  validation_criteria: [{ label: 'unit', command: 'npm test', covers: ['e'], claim_kind: 'gate_assertion' }],
  limits: { max_attempts: 3 },
};

const item = (verifierRequirement: string | null = 'required_fail_closed', overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'work-1', userId: 'user-1', sourceMessageId: 'msg-1',
  state: 'review', impactLevel: 'low', capability: 'programming',
  originalRequest: 'faça X',
  intent: {
    execution_spec: verifierRequirement === null ? { ...SPEC } : { ...SPEC, verifier_requirement: verifierRequirement },
  } as unknown as WorkItem['intent'],
  proposal: {
    schemaVersion: 1,
    data: { summary: 's', objective: 'o', includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'], expectedEffects: ['e'], risks: [] },
  },
  proposalVersion: 2, createdAt: new Date('2026-08-15T00:00:00Z'), updatedAt: new Date('2026-08-15T00:00:00Z'),
  ...overrides,
});

const handoff = (attemptId = 'attempt-1'): WorktreeHandoffV1 => {
  const built = buildWorktreeHandoff({
    workItemId: 'work-1', attemptId, approvedProposalVersion: 2,
    executorId: 'worktree-v1', backendId: 'fake', model: null,
    baseSha: BASE, branch: `anima-work/${attemptId}`, commitSha: COMMIT, status: 'succeeded',
    changedFiles: ['src/a.ts'], diffFiles: [{ path: 'src/a.ts', insertions: 3, deletions: 1 }],
    gates: [{ label: 'unit', command: 'npm test', exitCode: 0, outcome: 'passed' }],
  });
  if (!built.ok) throw new Error(built.explanation);
  return built.value;
};

let clock = 0;
const at = (): Date => new Date(Date.UTC(2026, 7, 15, 0, clock++));

const resultEvent = (id = 'ev-result', attemptId = 'attempt-1', proposalVersion = 2): WorkEvent => ({
  id, workItemId: 'work-1', type: 'result_submitted', author: 'executor', proposalVersion,
  payload: {
    schema_version: 1,
    data: {
      work_item_id: 'work-1', attempt_id: attemptId, approved_proposal_version: proposalVersion,
      summary: 'feito', result_references: [], executor_signal: { worktreeHandoff: handoff(attemptId) as unknown as Json },
    },
  } as unknown as Json,
  occurredAt: at(),
});

/** Parecer REAL computado sobre os eventos, com o veredito opcionalmente forçado. */
const opinionEvent = (events: readonly WorkEvent[], verdict?: VerifierOpinionV1['verdict'], id = `ev-op-${clock}`, evidence: 'complete' | 'incomplete' = 'complete'): WorkEvent => {
  const computed = computeVerifierOpinion(item(), events);
  if (!computed) throw new Error('sem parecer');
  // Base de evidência: no fluxo real a evidência git/gate do host é persistida ANTES
  // do Verifier; aqui ela é referenciada diretamente (o predicado só lê a base).
  const basis = evidence === 'complete'
    ? { ...computed.evidenceBasis, observedEventId: 'ev-git', observedGateEventId: 'ev-gate', coverage: { git: true, gates: true } }
    : computed.evidenceBasis;
  const opinion: VerifierOpinionV1 = { ...computed, ...(verdict === undefined ? {} : { verdict }), evidenceBasis: basis };
  return {
    id, workItemId: 'work-1', type: 'verifier_opinion_recorded', author: 'system', proposalVersion: 2,
    payload: {
      schema_version: 1,
      data: {
        work_item_id: opinion.workItemId, attempt_id: opinion.attemptId,
        approved_proposal_version: opinion.approvedProposalVersion, opinion: opinion as unknown as Json,
      },
    } as unknown as Json,
    occurredAt: at(),
  };
};

const withOpinion = (verdict?: VerifierOpinionV1['verdict']): WorkEvent[] => {
  const result = resultEvent();
  return [result, opinionEvent([result], verdict)];
};

// ─── Predicado ───────────────────────────────────────────────────────────────

describe('evaluateVerifierRequirement — lane com Verifier obrigatório', () => {
  test('marcador: ausente/advisory ⇒ advisory; required_fail_closed ou valor desconhecido ⇒ obrigatório', () => {
    expect(readVerifierRequirement({ execution_spec: {} })).toBe('advisory');
    expect(readVerifierRequirement({ execution_spec: { verifier_requirement: 'advisory' } })).toBe('advisory');
    expect(readVerifierRequirement({ execution_spec: { verifier_requirement: 'required_fail_closed' } })).toBe('required_fail_closed');
    expect(readVerifierRequirement({ execution_spec: { verifier_requirement: 'yes' } })).toBe('required_fail_closed');
  });

  test('1. verified correlacionado ⇒ satisfeito', () => {
    const evaluation = evaluateVerifierRequirement(item(), withOpinion(), 'ev-result');
    expect(evaluation).toMatchObject({ requirement: 'required_fail_closed', satisfied: true });
  });

  test('V0.1: parecer sem evidência git+gate do host ⇒ incompleto', () => {
    const result = resultEvent();
    const events = [result, opinionEvent([result], 'verified', 'ev-op-inc', 'incomplete')];
    expect(evaluateVerifierRequirement(item(), events, 'ev-result')).toMatchObject({ satisfied: false, reason: 'verifier_evidence_incomplete' });
  });

  test('2. rejected ⇒ recusado (não é resultado "bom")', () => {
    expect(evaluateVerifierRequirement(item(), withOpinion('rejected'), 'ev-result')).toMatchObject({ satisfied: false, reason: 'verifier_rejected' });
  });

  test('3. inconclusive ⇒ recusado', () => {
    expect(evaluateVerifierRequirement(item(), withOpinion('inconclusive'), 'ev-result')).toMatchObject({ satisfied: false, reason: 'verifier_inconclusive' });
  });

  test('4/5/6. Verifier lançou, persistência falhou ou não rodou ⇒ sem parecer ⇒ recusado', () => {
    // Os três modos deixam o mesmo rastro durável: nenhum `verifier_opinion_recorded`.
    expect(evaluateVerifierRequirement(item(), [resultEvent()], 'ev-result')).toMatchObject({ satisfied: false, reason: 'verifier_missing' });
    expect(evaluateVerifierRequirement(item(), [], undefined)).toMatchObject({ satisfied: false, reason: 'verifier_result_missing' });
  });

  test('7. parecer de outra attempt ⇒ não correlacionado', () => {
    const old = resultEvent('ev-old', 'attempt-0');
    const oldOpinion = opinionEvent([old], 'verified');
    const current = resultEvent('ev-new', 'attempt-1');
    expect(evaluateVerifierRequirement(item(), [old, oldOpinion, current], 'ev-new')).toMatchObject({ satisfied: false, reason: 'verifier_uncorrelated' });
  });

  test('8. resultado/versão stale ⇒ recusado', () => {
    const events = withOpinion();
    // Aceitar um resultado que não é o último.
    expect(evaluateVerifierRequirement(item(), events, 'ev-outro')).toMatchObject({ satisfied: false, reason: 'verifier_result_stale' });
    // Proposta revisada depois do resultado (versão do item avançou).
    expect(evaluateVerifierRequirement(item('required_fail_closed', { proposalVersion: 3 }), events, 'ev-result')).toMatchObject({ satisfied: false, reason: 'verifier_result_stale' });
    // Parecer verified sobre um resultado anterior não vale para um resultado novo.
    const first = resultEvent('ev-r1');
    const verifiedFirst = opinionEvent([first], 'verified');
    const second = resultEvent('ev-r2');
    expect(evaluateVerifierRequirement(item(), [first, verifiedFirst, second], 'ev-r2')).toMatchObject({ satisfied: false, reason: 'verifier_uncorrelated' });
  });

  test('parecer mais recente decide: rejected posterior derruba verified anterior', () => {
    const result = resultEvent();
    const events = [result, opinionEvent([result], 'verified'), opinionEvent([result], 'rejected')];
    expect(evaluateVerifierRequirement(item(), events, 'ev-result')).toMatchObject({ satisfied: false, reason: 'verifier_rejected' });
  });

  test('11. lane advisory (sem marcador) inalterado: sem parecer continua aceitável', () => {
    expect(evaluateVerifierRequirement(item(null), [resultEvent()], 'ev-result')).toEqual({ requirement: 'advisory', satisfied: true });
  });
});

// ─── Fronteira: aceite humano ────────────────────────────────────────────────

describe('Fronteira fail-closed no aceite (service.reviewResult / planResultReview)', () => {
  const success = async (): Promise<WorkOperationResult<WorkItem>> => ({ ok: true, value: item() });
  const repository = (workItem: WorkItem, events: readonly WorkEvent[] | null): WorkOrchestrationRepository => ({
    reviewResult: jest.fn(success),
    getItem: jest.fn(async () => ({ ok: true as const, value: workItem })),
    listEvents: jest.fn(async () => events === null
      ? { ok: false as const, error: { code: 'persistence_failure' as const, message: 'db down', retryable: true } }
      : { ok: true as const, value: events }),
  } as unknown as WorkOrchestrationRepository);
  const accept = { workItemId: 'work-1', expectedProposalVersion: 2, reviewedResultEventId: 'ev-result', decision: { type: 'accept' as const } };
  const requestChanges = { ...accept, decision: { type: 'request_changes' as const, requestedChanges: 'corrigir' } };

  test('9/10. verified NÃO aceita sozinho: só libera o aceite HUMANO pedido', async () => {
    const r = repository(item(), withOpinion());
    const service = new WorkOrchestrationService(r);
    // Nada é aceito sem o comando humano…
    expect(r.reviewResult).not.toHaveBeenCalled();
    // …e o comando humano é encaminhado exatamente uma vez.
    expect((await service.reviewResult(accept)).ok).toBe(true);
    expect(r.reviewResult).toHaveBeenCalledTimes(1);
    expect(r.reviewResult).toHaveBeenCalledWith(accept);
  });

  test.each([
    ['rejected', withOpinion('rejected'), 'verifier_rejected'],
    ['inconclusive', withOpinion('inconclusive'), 'verifier_inconclusive'],
    ['ausente', [resultEvent()], 'verifier_missing'],
  ])('aceite com parecer %s ⇒ recusado sem tocar o repositório de revisão', async (_name, events, reason) => {
    const r = repository(item(), events);
    const result = await new WorkOrchestrationService(r).reviewResult(accept);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_transition');
      expect(result.error.message).toContain(`verifier_requirement_unsatisfied:${reason}`);
    }
    expect(r.reviewResult).not.toHaveBeenCalled();
  });

  test('pedir mudanças continua livre (retrabalho), mesmo com parecer rejected', async () => {
    const r = repository(item(), withOpinion('rejected'));
    expect((await new WorkOrchestrationService(r).reviewResult(requestChanges)).ok).toBe(true);
    expect(r.reviewResult).toHaveBeenCalledTimes(1);
    expect(r.getItem).not.toHaveBeenCalled();
  });

  test('falha ao ler eventos ⇒ aceite recusado (não prova o lane)', async () => {
    const r = repository(item(), null);
    const result = await new WorkOrchestrationService(r).reviewResult(accept);
    expect(result.ok).toBe(false);
    expect(r.reviewResult).not.toHaveBeenCalled();
  });

  test('11. lane advisory: aceite sem parecer segue como antes', async () => {
    const r = repository(item(null), [resultEvent()]);
    expect((await new WorkOrchestrationService(r).reviewResult(accept)).ok).toBe(true);
    expect(r.reviewResult).toHaveBeenCalledTimes(1);
  });

  test('planResultReview: aceite recusado com motivo tipado; pedir mudanças planejado', () => {
    const events = withOpinion('rejected');
    expect(planResultReview(item(), events, { type: 'accept' })).toEqual({
      ok: false, reason: 'verifier_requirement_unsatisfied', verifier: 'verifier_rejected',
    });
    expect(planResultReview(item(), events, { type: 'request_changes', requestedChanges: 'x' }).ok).toBe(true);
    expect(planResultReview(item(), withOpinion(), { type: 'accept' }).ok).toBe(true);
    expect(planResultReview(item(null), [resultEvent()], { type: 'accept' }).ok).toBe(true);
  });
});
