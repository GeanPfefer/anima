import {
  buildWorktreeHandoff,
  verifyPersistedWorkResult,
  verifyWorkResult,
  type WorkEvent,
  type WorkItem,
  type WorkResultVerificationInput,
  type WorktreeHandoffV1,
} from './index';
import type { Json } from '@anima/types';

const BASE = 'a'.repeat(40);
const COMMIT = 'b'.repeat(40);
const BRANCH = 'anima-work/attempt-1';

const handoffWith = (overrides: Partial<Parameters<typeof buildWorktreeHandoff>[0]> = {}): WorktreeHandoffV1 => {
  const built = buildWorktreeHandoff({
    workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
    executorId: 'worktree-v1', backendId: 'fake', model: null,
    baseSha: BASE, branch: BRANCH, commitSha: COMMIT,
    status: 'succeeded',
    changedFiles: ['src/a.ts'],
    diffFiles: [{ path: 'src/a.ts', insertions: 3, deletions: 1 }],
    gates: [{ label: 'unit', command: 'npm test', exitCode: 0, outcome: 'passed' }],
    ...overrides,
  });
  if (!built.ok) throw new Error(built.explanation);
  return built.value;
};

const baseInput = (overrides: Partial<WorkResultVerificationInput> = {}): WorkResultVerificationInput => ({
  expected: { workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2 },
  authorized: {
    includedScope: ['src/a.ts'],
    excludedScope: ['src/z.ts'],
    validationCriteria: [{ label: 'unit', command: 'npm test' }],
  },
  handoff: handoffWith(),
  ...overrides,
});

const codes = (report: ReturnType<typeof verifyWorkResult>): string[] => report.findings.map(f => f.code);

describe('verifyWorkResult — caso positivo', () => {
  test('resultado limpo e coerente é verified', () => {
    const report = verifyWorkResult(baseInput());
    expect(report.verdict).toBe('verified');
    expect(report.summary).toEqual({ violations: 0, gaps: 0, checks: report.findings.length });
    expect(codes(report)).toEqual(expect.arrayContaining([
      'correlation_verified', 'branch_ownership_verified', 'scope_respected', 'status_coherent', 'gates_passed', 'criterion_covered',
    ]));
  });

  test('critério apenas declarado (sem comando) não bloqueia verified, mas fica visível', () => {
    const report = verifyWorkResult(baseInput({
      authorized: {
        includedScope: ['src/a.ts'], excludedScope: [],
        validationCriteria: [{ label: 'unit', command: 'npm test' }, { label: 'revisão manual' }],
      },
    }));
    expect(report.verdict).toBe('verified');
    expect(codes(report)).toContain('declared_criterion_unverifiable');
    expect(report.summary.gaps).toBe(0);
  });

  test('o parecer é sempre advisory e usa a correlação esperada', () => {
    const report = verifyWorkResult(baseInput());
    expect(report.advisory).toBe(true);
    expect(report.workItemId).toBe('work-1');
    expect(report.attemptId).toBe('attempt-1');
    expect(report.approvedProposalVersion).toBe(2);
  });
});

describe('verifyWorkResult — inconclusive (evidência insuficiente)', () => {
  test('sem handoff durável, o resultado não é verificável', () => {
    const report = verifyWorkResult(baseInput({ handoff: null }));
    expect(report.verdict).toBe('inconclusive');
    expect(codes(report)).toEqual(['missing_result_evidence']);
    // os ids do parecer vêm do esperado, mesmo sem evidência
    expect(report.attemptId).toBe('attempt-1');
  });

  test('critério com comando sem gate correspondente é lacuna, não violação', () => {
    const report = verifyWorkResult(baseInput({
      authorized: {
        includedScope: ['src/a.ts'], excludedScope: [],
        validationCriteria: [{ label: 'unit', command: 'npm test' }, { label: 'lint', command: 'npm run lint' }],
      },
    }));
    expect(report.verdict).toBe('inconclusive');
    expect(codes(report)).toContain('criterion_without_gate_coverage');
    expect(report.summary.violations).toBe(0);
    expect(report.summary.gaps).toBe(1);
  });
});

describe('verifyWorkResult — rejected (violação demonstrada)', () => {
  test('correlação divergente', () => {
    const report = verifyWorkResult(baseInput({
      expected: { workItemId: 'work-1', attemptId: 'attempt-2', approvedProposalVersion: 2 },
    }));
    expect(report.verdict).toBe('rejected');
    expect(codes(report)).toContain('correlation_mismatch');
    expect(report.attemptId).toBe('attempt-2');
  });

  test('alteração fora do escopo incluído', () => {
    const report = verifyWorkResult(baseInput({
      handoff: handoffWith({
        changedFiles: ['src/a.ts', 'src/b.ts'],
        diffFiles: [{ path: 'src/a.ts', insertions: 1, deletions: 0 }, { path: 'src/b.ts', insertions: 2, deletions: 0 }],
      }),
      authorized: { includedScope: ['src/a.ts'], excludedScope: [], validationCriteria: [{ label: 'unit', command: 'npm test' }] },
    }));
    expect(report.verdict).toBe('rejected');
    expect(codes(report)).toContain('change_out_of_included_scope');
  });

  test('alteração em arquivo do escopo excluído', () => {
    const report = verifyWorkResult(baseInput({
      handoff: handoffWith({
        changedFiles: ['src/a.ts', 'src/b.ts'],
        diffFiles: [{ path: 'src/a.ts', insertions: 1, deletions: 0 }, { path: 'src/b.ts', insertions: 2, deletions: 0 }],
      }),
      authorized: { includedScope: ['src/a.ts', 'src/b.ts'], excludedScope: ['src/b.ts'], validationCriteria: [{ label: 'unit', command: 'npm test' }] },
    }));
    expect(report.verdict).toBe('rejected');
    expect(codes(report)).toContain('change_in_excluded_scope');
  });

  test('gate reprovado com desfecho de falha', () => {
    const report = verifyWorkResult(baseInput({
      handoff: handoffWith({ status: 'failed', gates: [{ label: 'unit', command: 'npm test', exitCode: 1, outcome: 'failed' }] }),
    }));
    expect(report.verdict).toBe('rejected');
    expect(codes(report)).toEqual(expect.arrayContaining(['reported_failure', 'gate_failed']));
  });

  test('branch fora do namespace do Anima', () => {
    const report = verifyWorkResult(baseInput({ handoff: { ...handoffWith(), branch: 'main' } }));
    expect(report.verdict).toBe('rejected');
    expect(codes(report)).toContain('branch_not_owned');
  });
});

describe('verifyWorkResult — precedência e determinismo', () => {
  test('violação tem precedência sobre lacuna (rejected, não inconclusive)', () => {
    const report = verifyWorkResult(baseInput({
      handoff: handoffWith({
        changedFiles: ['src/a.ts', 'src/b.ts'],
        diffFiles: [{ path: 'src/a.ts', insertions: 1, deletions: 0 }, { path: 'src/b.ts', insertions: 2, deletions: 0 }],
      }),
      authorized: {
        includedScope: ['src/a.ts'], excludedScope: [],
        validationCriteria: [{ label: 'unit', command: 'npm test' }, { label: 'lint', command: 'npm run lint' }],
      },
    }));
    expect(report.summary.violations).toBeGreaterThan(0);
    expect(report.summary.gaps).toBeGreaterThan(0);
    expect(report.verdict).toBe('rejected');
  });

  test('mesma evidência ⇒ parecer idêntico (determinístico)', () => {
    const input = baseInput();
    expect(verifyWorkResult(input)).toEqual(verifyWorkResult(input));
  });
});

describe('verifyPersistedWorkResult — composição a partir de fatos persistidos', () => {
  const item = (overrides: Partial<WorkItem> = {}): WorkItem => ({
    id: 'work-1', userId: 'user-1', sourceMessageId: 'msg-1',
    state: 'review', impactLevel: 'low', capability: 'programming',
    originalRequest: 'faça X',
    intent: {
      execution_spec: {
        schema_version: 1, target: { kind: 'project', reference: 'proj' },
        permissions: ['workspace_read', 'workspace_write_isolated'],
        validation_criteria: [{ label: 'unit', command: 'npm test' }],
        limits: { max_attempts: 3 },
      },
    } as unknown as WorkItem['intent'],
    proposal: {
      schemaVersion: 1,
      data: { summary: 's', objective: 'o', includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'], expectedEffects: ['e'], risks: [] },
    },
    proposalVersion: 2, createdAt: new Date('2026-08-14T00:00:00Z'), updatedAt: new Date('2026-08-14T00:00:00Z'),
    ...overrides,
  });

  const resultEvent = (handoff: WorktreeHandoffV1, version = 2): WorkEvent => ({
    id: 'ev-result', workItemId: 'work-1', type: 'result_submitted', author: 'executor',
    proposalVersion: version,
    payload: {
      schema_version: 1,
      data: {
        work_item_id: 'work-1', attempt_id: handoff.attemptId, approved_proposal_version: version,
        summary: 'feito', result_references: ['worktree-branch:anima-work/attempt-1'],
        executor_signal: { worktreeHandoff: handoff as unknown as Json },
      },
    } as unknown as Json,
    occurredAt: new Date('2026-08-14T00:00:00Z'),
  });

  test('item + evento com handoff coerente ⇒ verified', () => {
    const report = verifyPersistedWorkResult(item(), [resultEvent(handoffWith())]);
    expect(report.verdict).toBe('verified');
    expect(report.workItemId).toBe('work-1');
    expect(report.approvedProposalVersion).toBe(2);
  });

  test('sem evento de resultado com handoff ⇒ inconclusive', () => {
    const report = verifyPersistedWorkResult(item(), []);
    expect(report.verdict).toBe('inconclusive');
    expect(report.findings.map(f => f.code)).toEqual(['missing_result_evidence']);
  });

  test('evidência sobre versão de proposta obsoleta ⇒ rejected (correlação)', () => {
    // O handoff/evento são da v2, mas o item já avançou para a v3.
    const report = verifyPersistedWorkResult(item({ proposalVersion: 3 }), [resultEvent(handoffWith(), 2)]);
    expect(report.verdict).toBe('rejected');
    expect(report.findings.map(f => f.code)).toContain('correlation_mismatch');
  });

  test('alteração fora do escopo da proposta ⇒ rejected', () => {
    const handoff = handoffWith({
      changedFiles: ['src/a.ts', 'src/fora.ts'],
      diffFiles: [{ path: 'src/a.ts', insertions: 1, deletions: 0 }, { path: 'src/fora.ts', insertions: 2, deletions: 0 }],
    });
    const report = verifyPersistedWorkResult(item(), [resultEvent(handoff)]);
    expect(report.verdict).toBe('rejected');
    expect(report.findings.map(f => f.code)).toContain('change_out_of_included_scope');
  });
});
