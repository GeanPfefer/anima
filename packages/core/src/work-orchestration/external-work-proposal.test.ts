import { evaluateAutonomousApprovalEnvelope } from './autonomous-authorization';
import { lintAcceptanceContract, lintItemAcceptanceContract } from './acceptance-contract-lint';
import { evaluateAutonomousEligibility, readAutonomousExecutionSpec } from './eligibility';
import { externalTargetToSpecTarget } from './external-target';
import {
  boundTestNameResolvable, buildExternalWorkProposal, listStaticJestTestNames, isExactTestFile, isExternalWorkEnvelope, isSafeExternalScopePath, validateExternalWorkInput, type ExternalWorkInput,
} from './external-work-proposal';
import { singleItemContractRefusal } from './single-item-execution';
import { deriveGateTestReport } from './gate-test-report';
import { buildHostObservedGateEvidence } from './host-observed-gate-evidence';
import { buildHostObservedGitEvidence } from './host-observed-evidence';
import { buildWorktreeHandoff } from './worktree-handoff';
import { verifyWorkResult, type WorkResultVerificationInput } from './work-verification';
import type { WorkItem } from './types';

const BASE = 'b'.repeat(40);
const ROOT = 'a'.repeat(40);
const specTarget = (reference = 'ext:shop', baseSha = BASE) => externalTargetToSpecTarget({
  reference, identity: { repoRootCanonical: 'C:\\work\\shop', gitCommonDirCanonical: 'C:\\work\\shop\\.git', rootCommitSha: ROOT, baseSha },
});
const NOW = '2026-10-25T12:00:00.000Z';

// Fixture conceitual da PROOF-EXT-01 (clamp). Conteúdo REAL de src/clamp.test.js do laboratório.
const CLAMP_TEST_SOURCE = `'use strict';

const { clamp } = require('./clamp');

describe('clamp', () => {
  test('retorna min quando o valor está abaixo do mínimo', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  test('mantém o valor quando está dentro do intervalo', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  test('retorna max quando o valor excede o máximo', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  test('aceita os limites exatos', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});
`;
const T = {
  below: 'clamp retorna min quando o valor está abaixo do mínimo',
  inside: 'clamp mantém o valor quando está dentro do intervalo',
  above: 'clamp retorna max quando o valor excede o máximo',
  exact: 'clamp aceita os limites exatos',
};
const FILE = 'src/clamp.test.js';

/** Contrato corrigido para o clamp: A1+A2 provados por testes nomeados; A3 por gate; A4 (asserções não enfraquecidas) por revisão humana. */
const clampInput = (extra: Partial<ExternalWorkInput> = {}): ExternalWorkInput => ({
  reference: 'ext:shop', objective: 'Corrigir clamp(value, min, max) quando o valor excede o máximo', scope: ['src/clamp.js', FILE], excluded: ['package.json', 'package-lock.json'],
  acceptance: [
    { id: 'A1', text: 'clamp(15, 0, 10) devolve 10' },
    { id: 'A2', text: 'Os demais comportamentos de clamp continuam corretos' },
    { id: 'A3', text: 'npm test passa' },
    { id: 'A4', text: 'Os testes existentes não foram removidos nem enfraquecidos' },
  ],
  gates: [{ command: 'npm test', covers: ['A3'] }],
  bindings: [{ covers: ['A1', 'A2'], file: FILE, minNewTests: 0, boundTests: [T.below, T.inside, T.above, T.exact] }],
  reviews: ['A4'],
  backend: 'codex-cli', ...extra,
});
const built = (input: ExternalWorkInput = clampInput()) => { const r = buildExternalWorkProposal(input, specTarget(), NOW); if (!r.ok) throw new Error(r.code); return r.command; };
const itemOf = (command: ReturnType<typeof built>, state = 'approved'): WorkItem => ({ ...command, id: 'i', userId: 'u', sourceMessageId: 's', state, originalRequest: 'x', proposalVersion: 1, createdAt: new Date(0), updatedAt: new Date(0) }) as unknown as WorkItem;

describe('validação de entrada e de provas', () => {
  test('o exemplo do clamp é válido', () => expect(validateExternalWorkInput(clampInput())).toBeNull());
  test.each([
    ['target_reference_invalid', { reference: 'anima' }], ['target_reference_invalid', { reference: 'project:anima' }],
    ['objective_invalid', { objective: '  ' }], ['scope_invalid', { scope: [] }], ['scope_invalid', { scope: ['../x'] }],
    ['excluded_invalid', { excluded: [] }], ['excluded_invalid', { excluded: undefined }],
    ['backend_invalid', { backend: 'openai' }], ['model_required_for_ollama', { backend: 'ollama', model: undefined }], ['model_invalid_for_codex', { model: 'gpt-x' }],
    ['max_attempts_invalid', { maxAttempts: 4 }], ['max_minutes_invalid', { maxMinutes: 61 }],
    ['gates_invalid', { gates: [] }], ['gates_invalid', { gates: [{ command: 'rm -rf /' }] }], ['gates_invalid', { gates: [{ command: 'npm test && id' }] }],
    ['acceptance_invalid', { acceptance: [] }], ['acceptance_invalid', { acceptance: [{ id: 'x1', text: 't' }] }],
    ['acceptance_invalid', { acceptance: [{ id: 'A1', text: 'a' }, { id: 'A1', text: 'b' }] }],
    ['acceptance_invalid', { acceptance: [{ id: 'A1', text: 'mesmo   texto' }, { id: 'A2', text: 'mesmo texto' }] }],
  ] as const)('%s', (code, patch) => expect(validateExternalWorkInput({ ...clampInput(), ...patch })).toBe(code));

  test('critério sem cobertura é recusado (nomeando o id)', () => {
    expect(validateExternalWorkInput(clampInput({ reviews: [] }))).toBe('acceptance_uncovered:A4');
    expect(validateExternalWorkInput(clampInput({ gates: [{ command: 'npm test' }] }))).toBe('acceptance_uncovered:A3');
  });
  test('referência a efeito desconhecido é recusada (gate, binding e revisão)', () => {
    expect(validateExternalWorkInput(clampInput({ gates: [{ command: 'npm test', covers: ['A3', 'A9'] }] }))).toBe('cover_unknown:A9');
    expect(validateExternalWorkInput(clampInput({ bindings: [{ covers: ['A1', 'A7'], file: FILE, minNewTests: 0, boundTests: [T.above] }] }))).toBe('cover_unknown:A7');
    expect(validateExternalWorkInput(clampInput({ reviews: ['A4', 'A5'] }))).toBe('cover_unknown:A5');
  });
  test('critério coberto duas vezes é recusado (mesma regra do planner e do lint)', () => {
    expect(validateExternalWorkInput(clampInput({ gates: [{ command: 'npm test', covers: ['A3', 'A1'] }] }))).toBe('acceptance_covered_twice:A1');
    expect(validateExternalWorkInput(clampInput({ reviews: ['A4', 'A3'] }))).toBe('acceptance_covered_twice:A3');
  });
  test('sem nenhuma prova automática a proposta terminaria inconclusive: recusada', () => {
    expect(validateExternalWorkInput(clampInput({
      acceptance: [{ id: 'A1', text: 'revisar manualmente' }], gates: [{ command: 'npm test' }], bindings: [], reviews: ['A1'],
    }))).toBe('no_automated_proof');
  });
  test('gate desconhecido/duplicado e comando fora da allowlist são recusados', () => {
    expect(validateExternalWorkInput(clampInput({ gates: [{ command: 'npm test', covers: ['A3'] }, { command: 'npm test' }] }))).toBe('gate_duplicate:npm test');
    expect(validateExternalWorkInput(clampInput({ gates: [{ command: 'npx jest', covers: ['A3'] }] }))).toBe('gates_invalid');
    expect(validateExternalWorkInput(clampInput({ gates: [{ command: 'npm test', covers: [] }] }))).toBe('gate_covers_empty');
  });
  test.each([
    ['binding_file_invalid:src/clamp.js', { covers: ['A1', 'A2'], file: 'src/clamp.js', minNewTests: 0, boundTests: [T.above] }],
    ['binding_file_invalid:src', { covers: ['A1', 'A2'], file: 'src', minNewTests: 0, boundTests: [T.above] }],
    ['binding_file_outside_scope:src/outro.test.js', { covers: ['A1', 'A2'], file: 'src/outro.test.js', minNewTests: 0, boundTests: [T.above] }],
    ['binding_vacuous', { covers: ['A1', 'A2'], file: FILE, minNewTests: 0, boundTests: [] }],
    ['binding_min_new_tests_invalid', { covers: ['A1', 'A2'], file: FILE, minNewTests: -1, boundTests: [T.above] }],
    ['binding_bound_tests_invalid', { covers: ['A1', 'A2'], file: FILE, minNewTests: 0, boundTests: [T.above, T.above] }],
    ['binding_covers_empty', { covers: [], file: FILE, minNewTests: 0, boundTests: [T.above] }],
  ])('binding inválido: %s', (code, binding) => expect(validateExternalWorkInput(clampInput({ bindings: [binding] }))).toBe(code));
  test('mesmo arquivo em dois bindings é recusado', () => {
    expect(validateExternalWorkInput(clampInput({ acceptance: [{ id: 'A1', text: 'um' }, { id: 'A2', text: 'dois' }], gates: [{ command: 'npm test' }], reviews: [],
      bindings: [{ covers: ['A1'], file: FILE, minNewTests: 0, boundTests: [T.above] }, { covers: ['A2'], file: FILE, minNewTests: 0, boundTests: [T.below] }] }))).toBe(`binding_file_duplicate:${FILE}`);
  });
  test('helpers de caminho', () => {
    expect(isSafeExternalScopePath('src/')).toBe(true); expect(isSafeExternalScopePath('src//x')).toBe(false);
    expect(isExactTestFile(FILE)).toBe(true); expect(isExactTestFile('src/clamp.js')).toBe(false); expect(isExactTestFile('src/*.test.js')).toBe(false);
  });
});

describe('nomes de teste resolvíveis no arquivo real (sem executar o alvo)', () => {
  test('lista estática do arquivo do clamp', () => expect([...listStaticJestTestNames(CLAMP_TEST_SOURCE)].sort()).toEqual(Object.values(T).sort()));
  test('aninhamento, irmãos, .only/.skip, comentários e títulos dinâmicos', () => {
    const src = [
      "// describe('fantasma', () => { test('x', () => {}) })",
      "/* test('bloco', () => {}) */",
      "describe('a', () => {",
      "  describe('b', () => { it('c', () => {}); });",
      "  test.skip('d', () => {});",
      "  test(`e ${1}`, () => {});",
      "});",
      "test('topo', () => {});",
      "test.each([1])('dinamico %s', () => {});",
    ].join('\n');
    expect([...listStaticJestTestNames(src)].sort()).toEqual(['a b c', 'a d', 'topo']);
  });
  test.each(Object.values(T))('%s', name => expect(boundTestNameResolvable(CLAMP_TEST_SOURCE, name)).toBe(true));
  test.each(['clamp retorna max quando excede', 'retorna max quando o valor excede o máximo', 'clamp', '', 'outro describe retorna min quando o valor está abaixo do mínimo'])(
    'inexistente: %j', name => expect(boundTestNameResolvable(CLAMP_TEST_SOURCE, name)).toBe(false));
});

describe('buildExternalWorkProposal — acceptance_contract v2', () => {
  test('contrato v2 do clamp: critérios, covers canônicos e provas declaradas', () => {
    const command = built();
    const spec = (command.intent as unknown as { execution_spec: Record<string, any> }).execution_spec;
    expect(spec).toMatchObject({ schema_version: 1, acceptance_contract: 2, executor: 'worktree', coder_backend: 'codex-cli', model: 'default', base_sha: BASE,
      permissions: ['workspace_read', 'workspace_write_isolated'], verifier_requirement: 'required_fail_closed', limits: { max_attempts: 1, max_duration_minutes: 30 }, target: specTarget() });
    expect(spec.validation_criteria).toEqual([
      { label: 'npm test', command: 'npm test', proof: 'gate', claim_kind: 'gate_assertion', covers: ['npm test passa'] },
      { label: `Teste vinculado: ${FILE}`, proof: 'gate', claim_kind: 'test_binding', covers: ['clamp(15, 0, 10) devolve 10', 'Os demais comportamentos de clamp continuam corretos'],
        target_paths: [FILE], command: `npm test -- ${FILE}`,
        binding: { test_files: [FILE], min_new_tests: 0, bound_tests: Object.values(T).map(full_name => ({ file: FILE, full_name })) } },
      { label: 'Revisão humana: Os testes existentes não foram removidos nem enfraquecidos', proof: 'human_review', covers: ['Os testes existentes não foram removidos nem enfraquecidos'] },
    ]);
    expect(command.proposal.data.expectedEffects).toEqual(clampInput().acceptance.map(a => a.text));
    expect(isExternalWorkEnvelope(command.intent)).toBe(true);
  });

  test('compatível com lintAcceptanceContract, elegibilidade autônoma e a fronteira do Single-Item', () => {
    const item = itemOf(built());
    expect(lintItemAcceptanceContract(item)).toEqual({ mode: 'v2', findings: [] });
    expect(evaluateAutonomousEligibility(item).eligible).toBe(true);
    expect(singleItemContractRefusal(item.intent)).toBeNull();
  });

  test('o lint real recusaria um contrato com cobertura falsa', () => {
    const spec = readAutonomousExecutionSpec(built().intent as never)!;
    const forged = spec.validationCriteria.map(c => c.proof === 'human_review' ? { ...c, covers: ['texto que não é aceite'] } : c);
    expect(lintAcceptanceContract(built().proposal.data.expectedEffects, forged).map(f => f.code)).toContain('covers_unknown_acceptance');
  });

  test('NÃO é auto-aprovável (envelope de auto-aprovação recusa target externo)', () => {
    const c = built();
    expect(evaluateAutonomousApprovalEnvelope({ state: 'proposed', impactLevel: 'low', capability: 'programming', intent: c.intent, proposal: c.proposal, governorVerdict: 'permit' }).authorized).toBe(false);
  });

  test('contrato inconsistente é recusado antes de existir (nenhum comando é produzido)', () => {
    for (const patch of [{ reviews: [] }, { gates: [{ command: 'npm test', covers: ['A9'] }] }, { bindings: [] }] as Partial<ExternalWorkInput>[]) {
      expect(buildExternalWorkProposal(clampInput(patch), specTarget(), NOW)).toMatchObject({ ok: false });
    }
    expect(buildExternalWorkProposal(clampInput(), specTarget('ext:other'), NOW)).toEqual({ ok: false, code: 'target_reference_mismatch' });
    expect(buildExternalWorkProposal(clampInput(), { kind: 'project', reference: 'anima' }, NOW)).toMatchObject({ ok: false });
  });

  test('somente gates com covers (sem binding nem revisão) também é um contrato v2 válido', () => {
    const input = clampInput({ acceptance: [{ id: 'A1', text: 'npm run typecheck passa' }, { id: 'A2', text: 'npm test passa' }],
      gates: [{ command: 'npm run typecheck', covers: ['A1'] }, { command: 'npm test', covers: ['A2'] }], bindings: [], reviews: [] });
    expect(buildExternalWorkProposal(input, specTarget(), NOW)).toMatchObject({ ok: true });
  });
});

// ─── Verifier real (não flexibilizado) sobre o contrato produzido ─────────────────────────────

describe('Verifier: o contrato v2 do clamp alcança `verified`; a falta de prova continua não alcançando', () => {
  const COMMIT = 'c'.repeat(40);
  const BRANCH = 'anima-work/attempt-1';
  const TREE = 'd'.repeat(40);
  const report = (names: readonly string[], failing: readonly string[] = []) => {
    const failed = failing.length;
    const r = deriveGateTestReport({
      success: failed === 0, numTotalTestSuites: 1, numFailedTestSuites: failed ? 1 : 0, numRuntimeErrorTestSuites: 0,
      numTotalTests: names.length, numPassedTests: names.length - failed, numFailedTests: failed, numPendingTests: 0, numTodoTests: 0,
      testResults: [{ name: `/repo/${FILE}`, status: failed ? 'failed' : 'passed', message: '',
        assertionResults: names.map(fullName => ({ fullName, title: fullName, ancestorTitles: [], status: failing.includes(fullName) ? 'failed' : 'passed', failureMessages: [], invocations: 1 })) }],
    }, { rootDir: '/repo' });
    if (r.status !== 'ok') throw new Error(r.reason);
    return r.report;
  };
  const input = (over: { drop?: 'testReport'; names?: readonly string[]; npmExit?: number } = {}): WorkResultVerificationInput => {
    const command = built();
    const spec = readAutonomousExecutionSpec(command.intent as never)!;
    const labels = { npm: 'npm test', binding: `Teste vinculado: ${FILE}` };
    const handoff = buildWorktreeHandoff({
      workItemId: 'w', attemptId: 'attempt-1', approvedProposalVersion: 1, executorId: 'worktree-v1', backendId: 'codex-cli:default', model: null,
      baseSha: BASE, branch: BRANCH, commitSha: COMMIT, status: (over.npmExit ?? 0) === 0 ? 'succeeded' : 'failed', changedFiles: ['src/clamp.js'],
      diffFiles: [{ path: 'src/clamp.js', insertions: 2, deletions: 1 }],
      gates: [{ label: labels.npm, command: 'npm test', exitCode: over.npmExit ?? 0, outcome: (over.npmExit ?? 0) === 0 ? 'passed' : 'failed' },
        { label: labels.binding, command: `npm test -- ${FILE}`, exitCode: 0, outcome: 'passed' }],
    });
    if (!handoff.ok) throw new Error(handoff.explanation);
    const git = buildHostObservedGitEvidence({ workItemId: 'w', attemptId: 'attempt-1', approvedProposalVersion: 1, baseSha: BASE, observedCommitSha: COMMIT, observedTreeSha: TREE,
      observedChangedFiles: ['src/clamp.js'], observedDiffFiles: [{ path: 'src/clamp.js', insertions: 2, deletions: 1 }], observedAt: '2026-10-25T12:00:00.000Z' });
    if (!git.ok) throw new Error(git.explanation);
    const names = over.names ?? Object.values(T);
    const gates = [
      { label: labels.npm, command: 'npm test', exitCode: over.npmExit ?? 0, durationMs: 1000, timedOut: false, cancelled: false, worktreeTree: { before: TREE, after: TREE } },
      { label: labels.binding, command: `npm test -- ${FILE}`, exitCode: 0, durationMs: 800, timedOut: false, cancelled: false,
        worktreeTree: { before: TREE, after: TREE },
        ...(over.drop === 'testReport' ? {} : { testReport: report(names) }),
        baseline: { baseExitCode: 1, baseTimedOut: false, baseCancelled: false, testReport: report(Object.values(T), [T.above]),
          targets: [{ path: FILE, existedAtBase: true, changed: false }] } },
    ];
    const gatesEvidence = buildHostObservedGateEvidence({ workItemId: 'w', attemptId: 'attempt-1', approvedProposalVersion: 1, observedAt: '2026-10-25T12:00:01.000Z', gates,
      changeAuthorization: { declaredScope: command.proposal.data.includedScope as string[], excludedScope: command.proposal.data.excludedScope as string[], changedFiles: ['src/clamp.js'] } });
    if (!gatesEvidence.ok) throw new Error(gatesEvidence.explanation);
    return {
      expected: { workItemId: 'w', attemptId: 'attempt-1', approvedProposalVersion: 1 },
      authorized: { includedScope: command.proposal.data.includedScope as string[], excludedScope: command.proposal.data.excludedScope as string[],
        acceptanceCriteria: command.proposal.data.expectedEffects as string[], validationCriteria: spec.validationCriteria },
      handoff: handoff.value, observed: git.value, observedGates: gatesEvidence.value,
    };
  };
  const codes = (r: ReturnType<typeof verifyWorkResult>) => r.findings.map(f => f.code);

  test('com as provas declaradas e executadas: verified, sem lacunas; A4 fica pendente de revisão humana (não é prova)', () => {
    const r = verifyWorkResult(input());
    expect(r.summary.gaps).toBe(0); expect(r.summary.violations).toBe(0);
    expect(r.verdict).toBe('verified');
    expect(codes(r)).toEqual(expect.arrayContaining(['test_binding_satisfied', 'acceptance_criterion_covered', 'human_review_pending']));
    expect(r.findings.filter(f => f.code === 'acceptance_criterion_covered').map(f => f.subject)).toEqual([
      'clamp(15, 0, 10) devolve 10', 'Os demais comportamentos de clamp continuam corretos', 'npm test passa']); // A1/A2 (vínculo) e A3 (gate_assertion)
  });
  test('sem o relatório de testes do vínculo, A1/A2 NÃO ficam provados (inconclusive)', () => {
    const r = verifyWorkResult(input({ drop: 'testReport' }));
    expect(r.verdict).toBe('inconclusive');
    expect(codes(r)).toContain('test_report_missing');
  });
  test('se o teste vinculado de A1 deixasse de existir, o vínculo não é satisfeito', () => {
    const r = verifyWorkResult(input({ names: [T.below, T.inside, T.exact] }));
    expect(r.verdict).not.toBe('verified'); expect(codes(r)).toContain('test_binding_unmet');
  });
  test('gate npm test falhando: rejeitado', () => expect(verifyWorkResult(input({ npmExit: 1 })).verdict).toBe('rejected'));
  test('REPRODUÇÃO da PROOF-EXT-01: o contrato v1 (aceites em texto, sem covers) continua inconclusive no mesmo Verifier', () => {
    const legacy = input();
    const result = verifyWorkResult({ ...legacy, authorized: { ...legacy.authorized, validationCriteria: [{ label: 'npm test', command: 'npm test', proof: 'gate', claimKind: 'gate_assertion' }],
      acceptanceCriteria: ['clamp(15, 0, 10) retorna 10', 'demais comportamentos permanecem', 'npm test passa'] } });
    expect(result.verdict).toBe('inconclusive');
    expect(codes(result).filter(c => c === 'acceptance_criterion_without_evidence')).toHaveLength(3);
  });
});
