/** @jest-environment node */
import { verifyWorkResult, type WorkResultVerificationInput } from './work-verification';
import { buildHostObservedGateEvidence, parseHostObservedGateEvidence, type HostObservedGateEvidenceV1 } from './host-observed-gate-evidence';
import { buildHostObservedGitEvidence } from './host-observed-evidence';
import { buildWorktreeHandoff, type WorktreeHandoffV1 } from './worktree-handoff';
import { deriveGateTestReport, type GateTestV1, type GateTestFileV1 } from './gate-test-report';
import type { AutonomousValidationCriterion } from './eligibility';
import type { Json } from '@anima/types';
const gateEvidenceWith = (over: Partial<Parameters<typeof buildHostObservedGateEvidence>[0]> = {}): HostObservedGateEvidenceV1 => {
  const built = buildHostObservedGateEvidence({
    workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
    gates: [{ label: 'unit', command: 'npm test', exitCode: 0, durationMs: 100, timedOut: false, cancelled: false }],
    observedAt: '2026-08-16T12:00:00.000Z', ...over,
  });
  if (!built.ok) throw new Error(built.explanation);
  return built.value;
};

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

describe('vínculo por árvore Git', () => {
  const path = 'src/a.test.ts';
  const report = (names: readonly string[] = ['new case'], test: Partial<GateTestV1> = {},
    suite: GateTestFileV1['suiteStatus'] = 'passed') => {
    const status = test.status ?? 'passed';
    const result = deriveGateTestReport({
      success: status !== 'failed' && suite !== 'failed',
      numTotalTestSuites: 1, numFailedTestSuites: suite === 'failed' ? 1 : 0,
      numRuntimeErrorTestSuites: 0, numTotalTests: names.length,
      numPassedTests: status === 'passed' ? names.length : 0,
      numFailedTests: status === 'failed' ? names.length : 0,
      numPendingTests: ['pending', 'skipped', 'disabled'].includes(status) ? names.length : 0,
      numTodoTests: status === 'todo' ? names.length : 0,
      testResults: [{ name: '/repo/' + path, status: suite, message: '',
        assertionResults: names.map(fullName => ({ fullName, title: fullName, ancestorTitles: [], status, failureMessages: [],
          invocations: test.invocations ?? 1 })) }],
    }, { rootDir: '/repo' });
    if (result.status !== 'ok') throw new Error(result.reason);
    return result.report;
  };
  const criterion: AutonomousValidationCriterion = { label: 'unit', command: 'npm test', proof: 'gate',
    claimKind: 'test_binding', covers: ['behavior'], targetPaths: [path],
    binding: { testFiles: [path], minNewTests: 1, boundTests: [{ file: path, fullName: 'new case' }] } };
  const input = (): WorkResultVerificationInput => {
    const git = buildHostObservedGitEvidence({ workItemId: 'work-1', attemptId: 'attempt-1',
      approvedProposalVersion: 2, baseSha: BASE, observedCommitSha: COMMIT,
      observedChangedFiles: ['src/a.ts'], observedDiffFiles: [{ path: 'src/a.ts', insertions: 3, deletions: 1 }],
      observedAt: '2026-08-14T12:00:00.000Z' });
    if (!git.ok) throw new Error(git.explanation);
    return baseInput({ observed: git.value,
      authorized: { includedScope: ['src/a.ts'], excludedScope: [], acceptanceCriteria: ['behavior'],
        validationCriteria: [criterion] },
      observedGates: gateEvidenceWith({ changeAuthorization: { declaredScope: ['src/a.ts'], excludedScope: [], changedFiles: ['src/a.ts'] },
        gates: [{ label: 'unit', command: 'npm test', exitCode: 0, durationMs: 1, timedOut: false,
          cancelled: false, testReport: report(), baseline: { baseExitCode: 1, baseTimedOut: false, baseCancelled: false,
            targets: [{ path, existedAtBase: false, changed: true }] } }] }),
    });
  };

  const tree = 'c'.repeat(40);
  const withTrees = (before: string | undefined, after: string | undefined, observedTreeSha: string | undefined) => {
    const value = input();
    return { ...value, observed: { ...value.observed!, ...(observedTreeSha ? { observedTreeSha } : {}) },
      observedGates: { ...value.observedGates!, gates: value.observedGates!.gates.map(gate => ({ ...gate,
        ...(before && after ? { worktreeTree: { before, after } } : {}) })) } };
  };
  test('árvores iguais comprovam vínculo independente', () => {
    const result = verifyWorkResult(withTrees(tree, tree, tree));
    expect(result.verdict).toBe('verified');
    expect(codes(result)).toContain('test_binding_satisfied');
  });
  test('árvore divergente da revisão produz violação', () => {
    const result = verifyWorkResult(withTrees(tree, tree, 'd'.repeat(40)));
    expect(result.verdict).toBe('rejected');
    expect(result.findings).toContainEqual(expect.objectContaining({ code: 'test_report_revision_mismatch', severity: 'violation' }));
    expect(codes(result)).toContain('acceptance_test_binding_unmet');
  });
  test('alteração durante gate produz lacuna antes da divergência', () => {
    const result = verifyWorkResult(withTrees(tree, 'd'.repeat(40), tree));
    expect(result.verdict).toBe('inconclusive');
    expect(result.findings).toContainEqual(expect.objectContaining({ code: 'test_report_tree_mutated', severity: 'gap' }));
    expect(codes(result)).toContain('acceptance_test_binding_unmet');
  });
  test('árvore presente em apenas um lado deixa vínculo incompleto', () => {
    for (const value of [withTrees(tree, tree, undefined), withTrees(undefined, undefined, tree)]) {
      const result = verifyWorkResult(value);
      expect(result.verdict).toBe('inconclusive');
      expect(codes(result)).toContain('test_report_tree_unbound');
      expect(codes(result)).toContain('acceptance_test_binding_unmet');
    }
  });
  test('ausência bilateral preserva comparação legada de arquivos', () => {
    expect(verifyWorkResult(withTrees(undefined, undefined, undefined))).toEqual(verifyWorkResult(input()));
    const value = input();
    const result = verifyWorkResult({ ...value, observedGates: { ...value.observedGates!,
      changeAuthorization: { ...value.observedGates!.changeAuthorization!, changedFiles: ['src/b.ts'] } } });
    expect(codes(result)).toContain('test_report_revision_mismatch');
    expect(result.verdict).toBe('rejected');
  });
  test('saída de falha sobrevive à reconstrução sem mudar parecer', () => {
    const value = input();
    const make = (include: boolean) => {
      const built = buildHostObservedGateEvidence({ workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
        observedAt: '2026-08-16T12:00:00.000Z', gates: [{ label: 'unit', command: 'npm test', exitCode: 1,
          durationMs: 1, timedOut: false, cancelled: false,
          ...(include ? { outputTail: { text: 'Comparação falhou\nlinha esperada', truncated: false } } : {}) }] });
      if (!built.ok) throw new Error(built.explanation);
      return built.value;
    };
    const evidence = make(true);
    const parsed = parseHostObservedGateEvidence(JSON.parse(JSON.stringify(evidence)) as Json);
    expect(parsed).toEqual(evidence);
    expect(parsed?.gates[0]?.outputTail?.text).toBe('Comparação falhou\nlinha esperada');
    expect(verifyWorkResult({ ...value, observedGates: parsed })).toEqual(verifyWorkResult({ ...value, observedGates: make(false) }));
  });
  test('árvores iguais ainda exigem conjunto de arquivos correspondente', () => {
    const value = withTrees(tree, tree, tree);
    const result = verifyWorkResult({ ...value, observedGates: { ...value.observedGates,
      changeAuthorization: { ...value.observedGates.changeAuthorization!, changedFiles: ['src/b.ts'] } } });
    expect(codes(result)).toContain('test_report_revision_mismatch');
  });
});
