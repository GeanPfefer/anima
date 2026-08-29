import { validateRecoverySuccessor, type WorkEvent, type WorkItem, type WorkRecoveryAssessment } from '@anima/core';
import { planDecompositionFromFailure, uuidFromSeed, type DecompositionFacts } from './decomposition-orchestration';

const ATTEMPT = 'fb79667c-dc13-4122-b094-1c3be10ce2fc';
const BASE_SHA = 'a'.repeat(40);
const COMMIT_SHA = 'b'.repeat(40);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SCOPE = [
  'packages/core/src/work-routing.ts',
  'packages/core/src/work-routing.test.ts',
  'apps/web/resource-governor.ts',
  'apps/web/resource-governor.test.ts',
];

const original: WorkItem = {
  id: '0cedae21-433d-4842-8fbd-9045c5128bcf', userId: 'u', sourceMessageId: 'm', state: 'failed',
  impactLevel: 'structural', capability: 'programming', originalRequest: 'local first', proposalVersion: 2,
  proposal: {
    schemaVersion: 1,
    data: { summary: 'política', objective: 'routing + governor', includedScope: [...SCOPE], excludedScope: ['cloud'], expectedEffects: ['política'], risks: ['capacidade'] },
  },
  intent: {
    execution_spec: {
      schema_version: 1, target: { kind: 'project', reference: 'anima' },
      permissions: ['workspace_read', 'workspace_write_isolated'],
      validation_criteria: [{ label: 'test', command: 'npm test' }, { label: 'typecheck', command: 'npm run typecheck' }],
      limits: { max_attempts: 2, max_duration_minutes: 45 }, depends_on_work_item_ids: [],
    },
  },
  createdAt: new Date(), updatedAt: new Date(),
};

const assessment: WorkRecoveryAssessment = {
  workItemId: original.id, proposalVersion: 2, failureEventId: 'f', sourceAttemptId: ATTEMPT, attemptsUsed: 2, maxAttempts: 2,
  decision: { failureKind: 'no_progress', normalizedCode: 'ollama_no_effective_edits', action: 'decompose', reason: 'task_should_be_decomposed' },
};

const gitEvidenceEvent = (overrides: { attemptId?: string; changedFiles?: string[]; commitSha?: string } = {}): WorkEvent => {
  const attemptId = overrides.attemptId ?? ATTEMPT;
  const commitSha = overrides.commitSha ?? COMMIT_SHA;
  const changedFiles = overrides.changedFiles ?? ['packages/core/src/work-routing.ts', 'packages/core/src/work-routing.test.ts'];
  return {
    id: 'ev-git', workItemId: original.id, type: 'host_observed_evidence_recorded', author: 'system', proposalVersion: 2,
    occurredAt: new Date(),
    payload: {
      data: {
        work_item_id: original.id, attempt_id: attemptId, approved_proposal_version: 2,
        evidence: {
          schemaVersion: 1, workItemId: original.id, attemptId, approvedProposalVersion: 2,
          baseSha: BASE_SHA, observedCommitSha: commitSha,
          observedChangedFiles: changedFiles,
          observedDiffSummary: { filesChanged: changedFiles.length, insertions: changedFiles.length, deletions: 0, files: changedFiles.map(path => ({ path, insertions: 1, deletions: 0 })) },
          observedAt: '2026-08-29T00:00:00.000Z', coverage: { git: true, gates: false },
        },
      },
    },
  };
};

const gateEvidenceEvent = (overrides: { attemptId?: string; failing?: boolean } = {}): WorkEvent => {
  const attemptId = overrides.attemptId ?? ATTEMPT;
  const exitCode = overrides.failing === false ? 0 : 1;
  return {
    id: 'ev-gate', workItemId: original.id, type: 'host_observed_gate_evidence_recorded', author: 'system', proposalVersion: 2,
    occurredAt: new Date(),
    payload: {
      data: {
        work_item_id: original.id, attempt_id: attemptId, approved_proposal_version: 2,
        evidence: {
          schemaVersion: 1, workItemId: original.id, attemptId, approvedProposalVersion: 2,
          gates: [{ label: 'test', command: 'npm test', exitCode, durationMs: 1200, timedOut: false, cancelled: false }],
          observedAt: '2026-08-29T00:00:00.000Z', coverage: { gates: true },
        },
      },
    },
  };
};

const facts = (overrides: Partial<DecompositionFacts> = {}): DecompositionFacts => ({
  original, assessment, events: [gitEvidenceEvent(), gateEvidenceEvent()], existingRecoverySequences: [], ...overrides,
});

const okPlan = (result: ReturnType<typeof planDecompositionFromFailure>) => {
  if (!result.ok) throw new Error(`esperava plano, veio bloqueio: ${result.reason} ${result.refusals?.join(',') ?? ''}`);
  return result.plan;
};

describe('planDecompositionFromFailure — caminho governado', () => {
  test('monta o diagnóstico do checkpoint observado e deriva um candidato válido', () => {
    const plan = okPlan(planDecompositionFromFailure(facts()));
    expect(validateRecoverySuccessor(original, assessment, plan.candidate)).toMatchObject({ valid: true });
    expect(plan.candidate.proposal.data.includedScope).toEqual([
      'packages/core/src/work-routing.ts', 'packages/core/src/work-routing.test.ts',
    ]);
    expect(plan.diagnostic.checkpoint).toEqual({ baseSha: BASE_SHA, branch: `anima-work/${ATTEMPT}`, commitSha: COMMIT_SHA });
    expect(plan.idempotencyKey).toMatch(UUID);
  });

  test('a sequência de lineage é max(existentes)+1', () => {
    expect(okPlan(planDecompositionFromFailure(facts({ existingRecoverySequences: [] }))).recoverySequence).toBe(1);
    expect(okPlan(planDecompositionFromFailure(facts({ existingRecoverySequences: [1, 2] }))).recoverySequence).toBe(3);
  });

  test('a chave de idempotência é estável para o mesmo checkpoint', () => {
    const a = okPlan(planDecompositionFromFailure(facts())).idempotencyKey;
    const b = okPlan(planDecompositionFromFailure(facts({ existingRecoverySequences: [5] }))).idempotencyKey;
    expect(a).toBe(b); // não depende da sequência, só do commit do checkpoint
  });

  test('grava a proveniência de retomada apontando ao commit do checkpoint', () => {
    const plan = okPlan(planDecompositionFromFailure(facts()));
    const resume = (plan.candidate.intent['execution_spec'] as Record<string, unknown>)['resume_from_checkpoint'];
    expect(resume).toEqual({ base_sha: BASE_SHA, branch: `anima-work/${ATTEMPT}`, commit_sha: COMMIT_SHA });
  });
});

describe('planDecompositionFromFailure — bloqueios fail-closed', () => {
  test('bloqueia quando a estratégia não é decompose', () => {
    const retry: WorkRecoveryAssessment = { ...assessment, decision: { ...assessment.decision, action: 'retry', reason: 'transient_retry_within_budget' } };
    expect(planDecompositionFromFailure(facts({ assessment: retry }))).toMatchObject({ ok: false, reason: 'strategy_not_decompose' });
  });

  test('bloqueia quando o item não está failed', () => {
    expect(planDecompositionFromFailure(facts({ original: { ...original, state: 'in_progress' } }))).toMatchObject({ ok: false, reason: 'item_unavailable' });
  });

  test('bloqueia quando não há evidência de checkpoint da tentativa apontada', () => {
    expect(planDecompositionFromFailure(facts({ events: [gateEvidenceEvent()] }))).toMatchObject({ ok: false, reason: 'checkpoint_evidence_missing' });
    // Evidência git de OUTRA tentativa não serve.
    expect(planDecompositionFromFailure(facts({ events: [gitEvidenceEvent({ attemptId: 'outra-attempt' }), gateEvidenceEvent()] })))
      .toMatchObject({ ok: false, reason: 'checkpoint_evidence_missing' });
  });

  test('bloqueia quando nenhum gate reprovou (ou a evidência é de outra tentativa)', () => {
    expect(planDecompositionFromFailure(facts({ events: [gitEvidenceEvent()] }))).toMatchObject({ ok: false, reason: 'failing_gate_evidence_missing' });
    expect(planDecompositionFromFailure(facts({ events: [gitEvidenceEvent(), gateEvidenceEvent({ failing: false })] })))
      .toMatchObject({ ok: false, reason: 'failing_gate_evidence_missing' });
    expect(planDecompositionFromFailure(facts({ events: [gitEvidenceEvent(), gateEvidenceEvent({ attemptId: 'outra' })] })))
      .toMatchObject({ ok: false, reason: 'failing_gate_evidence_missing' });
  });

  test('bloqueia (derivation_refused) quando o checkpoint tocou tudo — escopo não redutível', () => {
    const result = planDecompositionFromFailure(facts({ events: [gitEvidenceEvent({ changedFiles: [...SCOPE] }), gateEvidenceEvent()] }));
    expect(result).toMatchObject({ ok: false, reason: 'derivation_refused' });
    if (!result.ok) expect(result.refusals).toContain('scope_not_reducible');
  });
});

describe('uuidFromSeed', () => {
  test('produz uma UUID válida, determinística e distinta por semente', () => {
    expect(uuidFromSeed('x')).toMatch(UUID);
    expect(uuidFromSeed('x')).toBe(uuidFromSeed('x'));
    expect(uuidFromSeed('x')).not.toBe(uuidFromSeed('y'));
  });
});
