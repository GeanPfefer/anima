import { validateCorrectionSuccessor, type WorkEvent, type WorkItem } from '@anima/core';
import { planCorrectionFromReview, type ReviewCorrectionFacts } from './review-correction-orchestration';

const ATTEMPT = '0aaf828c-fa1d-4c76-8503-64df7a5041c9';
const BASE_SHA = 'a'.repeat(40);
const COMMIT_SHA = 'b'.repeat(40);
const RESULT_ID = 'e7209bf4-1e93-48ae-8967-25442c508e0b';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const IMPL = 'apps/web/lib/ai/chat-surface.ts';
const TEST = 'apps/web/lib/ai/chat-surface.test.ts';

const original: WorkItem = {
  id: '71445254-c514-41c0-a86a-d9878f04e5e8', userId: 'u', sourceMessageId: 'm', state: 'changes_requested',
  impactLevel: 'low', capability: 'programming', originalRequest: 'dedup allowlist', proposalVersion: 1,
  proposal: {
    schemaVersion: 1,
    data: { summary: 'dedup', objective: 'dedup + testes', includedScope: [IMPL, TEST], excludedScope: ['supabase/'], expectedEffects: ['dedup'], risks: ['semântica'] },
  },
  intent: {
    execution_spec: {
      schema_version: 1, target: { kind: 'project', reference: 'anima' },
      permissions: ['workspace_read', 'workspace_write_isolated'],
      validation_criteria: [{ label: 'test', command: 'npm test --workspace=apps/web -- chat-surface.test.ts' }],
      limits: { max_attempts: 3, max_duration_minutes: 30 }, depends_on_work_item_ids: [],
    },
  },
  createdAt: new Date(), updatedAt: new Date(),
};

const gitEvidenceEvent = (o: { attemptId?: string; changedFiles?: string[] } = {}): WorkEvent => {
  const attemptId = o.attemptId ?? ATTEMPT;
  const changedFiles = o.changedFiles ?? [IMPL];
  return {
    id: 'ev-git', workItemId: original.id, type: 'host_observed_evidence_recorded', author: 'system', proposalVersion: 1, occurredAt: new Date(),
    payload: { data: { work_item_id: original.id, attempt_id: attemptId, approved_proposal_version: 1, evidence: {
      schemaVersion: 1, workItemId: original.id, attemptId, approvedProposalVersion: 1,
      baseSha: BASE_SHA, observedCommitSha: COMMIT_SHA, observedChangedFiles: changedFiles,
      observedDiffSummary: { filesChanged: changedFiles.length, insertions: changedFiles.length, deletions: 0, files: changedFiles.map(path => ({ path, insertions: 1, deletions: 0 })) },
      observedAt: '2026-08-29T00:00:00.000Z', coverage: { git: true, gates: false },
    } } },
  };
};

const resultEvent = (o: { id?: string; attemptId?: string } = {}): WorkEvent => ({
  id: o.id ?? RESULT_ID, workItemId: original.id, type: 'result_submitted', author: 'executor', proposalVersion: 1, occurredAt: new Date(),
  payload: { data: { work_item_id: original.id, attempt_id: o.attemptId ?? ATTEMPT, summary: 'resultado' } },
});

const reviewEvent = (o: { requestedChanges?: string; reviewedResultEventId?: string } = {}): WorkEvent => ({
  id: 'ev-review', workItemId: original.id, type: 'changes_requested', author: 'user', proposalVersion: 1, occurredAt: new Date(),
  payload: { data: {
    requested_changes: o.requestedChanges ?? 'Ampliar os testes para provar deduplicação ordenada e preservação da primeira ocorrência.',
    reviewed_result_event_id: o.reviewedResultEventId ?? RESULT_ID, reviewed_proposal_version: 1,
  } },
});

const facts = (overrides: Partial<ReviewCorrectionFacts> = {}): ReviewCorrectionFacts => ({
  original, events: [gitEvidenceEvent(), resultEvent(), reviewEvent()], existingRecoverySequences: [], ...overrides,
});

const okPlan = (result: ReturnType<typeof planCorrectionFromReview>) => {
  if (!result.ok) throw new Error(`esperava plano, veio bloqueio: ${result.reason} ${result.refusals?.join(',') ?? ''}`);
  return result;
};

describe('planCorrectionFromReview — correção governada por retomada', () => {
  test('deriva candidato válido, escopo=restante, retomando do checkpoint revisado', () => {
    const plan = okPlan(planCorrectionFromReview(facts()));
    expect(validateCorrectionSuccessor(original, plan.candidate)).toMatchObject({ valid: true });
    expect(plan.candidate.proposal.data.includedScope).toEqual([TEST]);
    expect(plan.candidate.proposal.data.excludedScope).toEqual(expect.arrayContaining(['supabase/', IMPL]));
    const resume = (plan.candidate.intent['execution_spec'] as Record<string, unknown>)['resume_from_checkpoint'];
    expect(resume).toEqual({ base_sha: BASE_SHA, branch: `anima-work/${ATTEMPT}`, commit_sha: COMMIT_SHA });
    expect(plan.idempotencyKey).toMatch(UUID);
  });

  test('sequência de lineage avança após terminal e replaya a unidade ativa', () => {
    expect(okPlan(planCorrectionFromReview(facts({ existingRecoverySequences: [] }))).recoverySequence).toBe(1);
    expect(okPlan(planCorrectionFromReview(facts({ existingRecoverySequences: [2, 4] }))).recoverySequence).toBe(5);
    expect(okPlan(planCorrectionFromReview(facts({ existingRecoverySequences: [1], activeRecoverySequence: 1 }))).recoverySequence).toBe(1);
    expect(okPlan(planCorrectionFromReview(facts({ existingRecoverySequences: [1], activeRecoverySequence: 1 }))).idempotencyKey)
      .toBe(okPlan(planCorrectionFromReview(facts())).idempotencyKey);
    const second = okPlan(planCorrectionFromReview(facts({ existingRecoverySequences: [1] })));
    expect(second.recoverySequence).toBe(2);
    expect(second.idempotencyKey).not.toBe(okPlan(planCorrectionFromReview(facts())).idempotencyKey);
    expect(second.idempotencyKey).toBe(okPlan(planCorrectionFromReview(facts({ existingRecoverySequences: [1], activeRecoverySequence: 2 }))).idempotencyKey);
  });

  describe('bloqueios fail-closed', () => {
    test('item não está em changes_requested', () => {
      expect(planCorrectionFromReview(facts({ original: { ...original, state: 'review' } }))).toMatchObject({ ok: false, reason: 'item_unavailable' });
    });
    test('sem pedido de revisão persistido', () => {
      expect(planCorrectionFromReview(facts({ events: [gitEvidenceEvent(), resultEvent()] }))).toMatchObject({ ok: false, reason: 'review_request_missing' });
    });
    test('resultado revisado não encontrado (referência solta)', () => {
      expect(planCorrectionFromReview(facts({ events: [gitEvidenceEvent(), reviewEvent({ reviewedResultEventId: 'inexistente' })] }))).toMatchObject({ ok: false, reason: 'reviewed_result_missing' });
    });
    test('checkpoint de OUTRA tentativa não serve (correlação)', () => {
      expect(planCorrectionFromReview(facts({ events: [gitEvidenceEvent({ attemptId: 'outra' }), resultEvent(), reviewEvent()] }))).toMatchObject({ ok: false, reason: 'checkpoint_evidence_missing' });
    });
    test('checkpoint tocou TODO o escopo ⇒ derivação recusa (nada restante)', () => {
      const result = planCorrectionFromReview(facts({ events: [gitEvidenceEvent({ changedFiles: [IMPL, TEST] }), resultEvent(), reviewEvent()] }));
      expect(result).toMatchObject({ ok: false, reason: 'derivation_refused' });
      if (!result.ok) expect(result.refusals).toContain('remaining_scope_empty');
    });
  });
});
