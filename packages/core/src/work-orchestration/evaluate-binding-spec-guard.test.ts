/** @jest-environment node */
import { verifyWorkResult, type WorkResultVerificationInput } from './work-verification';
import { buildHostObservedGateEvidence } from './host-observed-gate-evidence';
import { buildHostObservedGitEvidence } from './host-observed-evidence';
import { buildWorktreeHandoff } from './worktree-handoff';
import { deriveGateTestReport } from './gate-test-report';
import type { AutonomousValidationCriterion } from './eligibility';

const path = 'src/a.test.ts';
const fullName = 'comprova comportamento';
const baseSha = 'a'.repeat(40);
const commitSha = 'b'.repeat(40);
const tree = 'c'.repeat(40);

const input = (boundFile = path, boundName = fullName): WorkResultVerificationInput => {
  const expected = { workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2 };
  const changedFiles = ['src/a.ts'];
  const diffFiles = [{ path: 'src/a.ts', insertions: 3, deletions: 1 }];
  const criterion: AutonomousValidationCriterion = {
    label: 'unit', command: 'npm test', proof: 'gate', claimKind: 'test_binding',
    covers: ['comportamento'], targetPaths: [path],
    binding: { testFiles: [path], minNewTests: 1, boundTests: [{ file: boundFile, fullName: boundName }] },
  };
  const report = deriveGateTestReport({
    success: true, numTotalTestSuites: 1, numFailedTestSuites: 0,
    numRuntimeErrorTestSuites: 0, numTotalTests: 1, numPassedTests: 1,
    numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    testResults: [{ name: '/repo/' + path, status: 'passed', message: '',
      assertionResults: [{ fullName, title: fullName, ancestorTitles: [], status: 'passed',
        failureMessages: [], invocations: 1 }] }],
  }, { rootDir: '/repo' });
  if (report.status !== 'ok') throw new Error(report.reason);
  const handoff = buildWorktreeHandoff({
    ...expected, executorId: 'worktree-v1', backendId: 'fake', model: null,
    baseSha, branch: 'anima-work/attempt-1', commitSha, status: 'succeeded',
    changedFiles, diffFiles,
    gates: [{ label: 'unit', command: 'npm test', exitCode: 0, outcome: 'passed' }],
  });
  if (!handoff.ok) throw new Error(handoff.explanation);
  const observed = buildHostObservedGitEvidence({
    ...expected, baseSha, observedCommitSha: commitSha, observedTreeSha: tree,
    observedChangedFiles: changedFiles, observedDiffFiles: diffFiles,
    observedAt: '2026-08-16T12:00:00.000Z',
  });
  if (!observed.ok) throw new Error(observed.explanation);
  const observedGates = buildHostObservedGateEvidence({
    ...expected, observedAt: '2026-08-16T12:00:00.000Z',
    changeAuthorization: { declaredScope: changedFiles, excludedScope: [], changedFiles },
    gates: [{ label: 'unit', command: 'npm test', exitCode: 0, durationMs: 1,
      timedOut: false, cancelled: false, testReport: report.report,
      worktreeTree: { before: tree, after: tree },
      baseline: { baseExitCode: 1, baseTimedOut: false, baseCancelled: false,
        targets: [{ path, existedAtBase: false, changed: true }] } }],
  });
  if (!observedGates.ok) throw new Error(observedGates.explanation);
  return {
    expected, handoff: handoff.value, observed: observed.value, observedGates: observedGates.value,
    authorized: { includedScope: changedFiles, excludedScope: [],
      acceptanceCriteria: ['comportamento'], validationCriteria: [criterion] },
  };
};

describe('guarda de especificação manual do vínculo', () => {
  test('arquivo fora do conjunto declarado gera lacuna sem lançar exceção', () => {
    const value = input('src/fora.test.ts');
    expect(() => verifyWorkResult(value)).not.toThrow();
    expect(verifyWorkResult(value).findings).toContainEqual(expect.objectContaining({
      code: 'test_binding_unmet', severity: 'gap',
    }));
  });

  test('referência externa não comprova vínculo nem cobre o aceite', () => {
    const result = verifyWorkResult(input('src/fora.test.ts'));
    const codes = result.findings.map(finding => finding.code);
    expect(codes).not.toContain('test_binding_satisfied');
    expect(codes).not.toContain('acceptance_criterion_covered');
    expect(codes).toContain('acceptance_test_binding_unmet');
    expect(result.verdict).not.toBe('verified');
  });

  test('arquivo declarado com teste aprovado mantém vínculo e aceite comprovados', () => {
    const result = verifyWorkResult(input());
    expect(result.verdict).toBe('verified');
    expect(result.findings.map(finding => finding.code)).toEqual(expect.arrayContaining([
      'test_binding_satisfied', 'acceptance_criterion_covered',
    ]));
  });

  test('nome completo ausente do relatório mantém lacuna de vínculo', () => {
    const result = verifyWorkResult(input(path, 'comportamento ausente'));
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: 'test_binding_unmet', severity: 'gap',
    }));
    expect(result.verdict).not.toBe('verified');
  });
});
