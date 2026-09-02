import {
  buildHostObservedGateEvidence,
  buildHostObservedGitEvidence,
  buildWorktreeHandoff,
  presentWorkItem,
  verifyPersistedWorkResult,
  verifyWorkResult,
  type HostObservedGateEvidenceV1,
  type HostObservedGitEvidenceV1,
  type WorkEvent,
  type WorkItem,
  type WorkResultVerificationInput,
  type WorktreeHandoffV1,
} from './index';
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

describe('verifyWorkResult — gates observados pelo host (observed > attested)', () => {
  const base = (over: Partial<WorkResultVerificationInput> = {}): WorkResultVerificationInput => baseInput(over);

  test('gate observado passou + atestado passou ⇒ confirmação independente, verified', () => {
    const report = verifyWorkResult(base({ observedGates: gateEvidenceWith() }));
    expect(report.verdict).toBe('verified');
    const finding = report.findings.find(f => f.code === 'gates_independently_observed');
    expect(finding?.provenance).toBe('independent');
  });

  test('gate observado FALHOU + Executor atestou passou ⇒ rejected (mentira detectada)', () => {
    const report = verifyWorkResult(base({ observedGates: gateEvidenceWith({ gates: [{ label: 'unit', command: 'npm test', exitCode: 1, durationMs: 50, timedOut: false, cancelled: false }] }) }));
    expect(report.verdict).toBe('rejected');
    const codes = report.findings.map(f => f.code);
    expect(codes).toContain('attested_gate_contradicts_observed');
    expect(codes).toContain('gate_failed');
    expect(report.findings.find(f => f.code === 'gate_failed')?.provenance).toBe('independent');
  });

  test('gate observado por timeout (código 0 mas timedOut) ⇒ failed independente', () => {
    const report = verifyWorkResult(base({ observedGates: gateEvidenceWith({ gates: [{ label: 'unit', command: 'npm test', exitCode: 0, durationMs: 999, timedOut: true, cancelled: false }] }) }));
    expect(report.verdict).toBe('rejected');
    expect(report.findings.map(f => f.code)).toContain('gate_failed');
  });

  test('evidência de gate de outra tentativa ⇒ mismatch (violação) e recai na atestação', () => {
    const report = verifyWorkResult(base({ observedGates: gateEvidenceWith({ attemptId: 'attempt-OUTRA' }) }));
    expect(report.findings.map(f => f.code)).toContain('observed_gate_correlation_mismatch');
    expect(report.verdict).toBe('rejected');
  });

  test('sem evidência de gate observada ⇒ gates atestados (comportamento anterior), verified', () => {
    const report = verifyWorkResult(base());
    expect(report.verdict).toBe('verified');
    expect(report.findings.map(f => f.code)).toContain('gates_passed');
    expect(report.findings.some(f => f.code === 'gates_independently_observed')).toBe(false);
  });
});

describe('verifyWorkResult — retry INTERNO do mesmo attempt (classificação terminal FAIL→PASS)', () => {
  const base = (over: Partial<WorkResultVerificationInput> = {}): WorkResultVerificationInput => baseInput(over);

  test('FAIL→PASS do mesmo gate (label+command) ⇒ verified, sem gate_failed nem contradição', () => {
    // Evidência bruta preserva os DOIS (append-only); a classificação usa o terminal.
    const report = verifyWorkResult(base({
      observedGates: gateEvidenceWith({ gates: [
        { label: 'unit', command: 'npm test', exitCode: 1, durationMs: 50, timedOut: false, cancelled: false },
        { label: 'unit', command: 'npm test', exitCode: 0, durationMs: 80, timedOut: false, cancelled: false },
      ] }),
    }));
    expect(report.verdict).toBe('verified');
    const c = codes(report);
    expect(c).not.toContain('gate_failed');
    expect(c).not.toContain('attested_gate_contradicts_observed');
    expect(c).toContain('gates_independently_observed');
    expect(c).toContain('criterion_covered');
  });

  test('PASS→FAIL do mesmo gate ⇒ rejected, com gate_failed e attested_gate_contradicts_observed', () => {
    const report = verifyWorkResult(base({
      observedGates: gateEvidenceWith({ gates: [
        { label: 'unit', command: 'npm test', exitCode: 0, durationMs: 80, timedOut: false, cancelled: false },
        { label: 'unit', command: 'npm test', exitCode: 1, durationMs: 50, timedOut: false, cancelled: false },
      ] }),
    }));
    expect(report.verdict).toBe('rejected');
    const c = codes(report);
    expect(c).toContain('gate_failed');
    expect(c).toContain('attested_gate_contradicts_observed');
  });

  test('A FAIL→PASS + B FAIL terminal (gates distintos) ⇒ rejected por B, A coberto', () => {
    const report = verifyWorkResult(base({
      authorized: {
        includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'],
        validationCriteria: [{ label: 'A', command: 'npm test' }, { label: 'B', command: 'npm test' }],
      },
      handoff: handoffWith({ gates: [
        { label: 'A', command: 'npm test', exitCode: 0, outcome: 'passed' },
        { label: 'B', command: 'npm test', exitCode: 0, outcome: 'passed' },
      ] }),
      observedGates: gateEvidenceWith({ gates: [
        { label: 'A', command: 'npm test', exitCode: 1, durationMs: 50, timedOut: false, cancelled: false },
        { label: 'A', command: 'npm test', exitCode: 0, durationMs: 80, timedOut: false, cancelled: false },
        { label: 'B', command: 'npm test', exitCode: 1, durationMs: 40, timedOut: false, cancelled: false },
      ] }),
    }));
    expect(report.verdict).toBe('rejected');
    // Reprovado por B (terminal FAIL), enquanto A (terminal PASS) fica coberto.
    const gateFailed = report.findings.filter(f => f.code === 'gate_failed');
    expect(gateFailed.map(f => f.subject)).toEqual(['B']);
    expect(codes(report)).toContain('criterion_covered');
  });
});

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
    expect(report.summary).toMatchObject({ violations: 0, gaps: 0 });
    expect(report.summary.checks).toBe(report.findings.length);
    expect(report.summary.attested + report.summary.independent).toBe(report.findings.length);
    expect(codes(report)).toEqual(expect.arrayContaining([
      'correlation_verified', 'branch_ownership_verified', 'scope_respected', 'status_coherent', 'gates_passed', 'criterion_covered',
    ]));
    // Honestidade de independência: um `verified` de handoff de worktree SEMPRE
    // repousa em evidência atestada (gates/escopo). Nunca é prova independente.
    expect(report.restsOnAttestedEvidence).toBe(true);
    expect(report.findings.find(f => f.code === 'correlation_verified')?.provenance).toBe('independent');
    expect(report.findings.find(f => f.code === 'gates_passed')?.provenance).toBe('attested');
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

describe('verifyWorkResult — cross-check adversarial (independência)', () => {
  test('gate declarado passed com exitCode != 0 é contradição interna ⇒ rejected', () => {
    // Adversário: afirma outcome "passed" mas o código de saída observado contradiz.
    const report = verifyWorkResult(baseInput({
      handoff: handoffWith({ gates: [{ label: 'unit', command: 'npm test', exitCode: 3, outcome: 'passed' }] }),
    }));
    expect(report.verdict).toBe('rejected');
    expect(codes(report)).toContain('gate_exit_code_incoherent');
  });

  test('gate failed com exitCode 0 (timeout/cancel) NÃO é contradição', () => {
    // Só checamos passed⟹0; um failed com código 0 é legítimo (timeout/cancel).
    const report = verifyWorkResult(baseInput({
      handoff: handoffWith({ status: 'failed', gates: [{ label: 'unit', command: 'npm test', exitCode: 0, outcome: 'failed' }] }),
    }));
    expect(codes(report)).not.toContain('gate_exit_code_incoherent');
  });

  test('validação autodeclarada que contradiz o gate correspondente ⇒ rejected', () => {
    const report = verifyWorkResult(baseInput({ declaredValidations: [{ label: 'unit', outcome: 'failed' }] }));
    expect(report.verdict).toBe('rejected');
    expect(codes(report)).toContain('contradictory_validation_claim');
  });

  test('validações autodeclaradas consistentes com os gates ⇒ finding ok', () => {
    const report = verifyWorkResult(baseInput({ declaredValidations: [{ label: 'unit', outcome: 'passed' }] }));
    expect(report.verdict).toBe('verified');
    expect(codes(report)).toContain('validation_consistent_with_gates');
  });

  test('LIMITE FUNDAMENTAL: um handoff totalmente fabricado mas coerente retorna verified — mas o parecer marca que repousa em atestação', () => {
    // O Verifier V0 confere COERÊNCIA + consistência com o contrato, não a VERDADE.
    // Um Executor mal-comportado que emita gates/arquivos falsos porém coerentes
    // obtém `verified`. A honestidade fica em restsOnAttestedEvidence=true: o
    // veredito NÃO é prova independente; a evidência decisiva é atestada.
    const report = verifyWorkResult(baseInput());
    expect(report.verdict).toBe('verified');
    expect(report.restsOnAttestedEvidence).toBe(true);
    expect(report.findings.filter(f => f.code === 'gates_passed' || f.code === 'scope_respected').every(f => f.provenance === 'attested')).toBe(true);
  });

  test('rejeição por correlação é independente (restsOnAttestedEvidence=false)', () => {
    const report = verifyWorkResult(baseInput({ expected: { workItemId: 'work-1', attemptId: 'outra', approvedProposalVersion: 2 } }));
    expect(report.verdict).toBe('rejected');
    expect(report.restsOnAttestedEvidence).toBe(false);
  });

  test('ausência de evidência é independente (restsOnAttestedEvidence=false)', () => {
    const report = verifyWorkResult(baseInput({ handoff: null }));
    expect(report.verdict).toBe('inconclusive');
    expect(report.restsOnAttestedEvidence).toBe(false);
  });

  const observed = (over: Partial<Parameters<typeof buildHostObservedGitEvidence>[0]> = {}): HostObservedGitEvidenceV1 => {
    const built = buildHostObservedGitEvidence({
      workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
      baseSha: BASE, observedCommitSha: COMMIT,
      observedChangedFiles: ['src/a.ts'],
      observedDiffFiles: [{ path: 'src/a.ts', insertions: 3, deletions: 1 }],
      observedAt: '2026-08-14T12:00:00.000Z',
      ...over,
    });
    if (!built.ok) throw new Error(built.explanation);
    return built.value;
  };

  test('evidência observada consistente ⇒ escopo é INDEPENDENTE (não atestado)', () => {
    const report = verifyWorkResult(baseInput({ observed: observed() }));
    expect(report.verdict).toBe('verified');
    expect(codes(report)).toContain('scope_independently_observed');
    expect(report.findings.find(f => f.code === 'scope_respected')?.provenance).toBe('independent');
  });

  test('ATAQUE: executor mente (atesta só a.ts) mas o host observou z.ts no escopo excluído ⇒ rejected', () => {
    const report = verifyWorkResult(baseInput({
      // Atestado: só a.ts (em escopo). Observado pelo git: a.ts + z.ts (excluído).
      handoff: handoffWith({ changedFiles: ['src/a.ts'], diffFiles: [{ path: 'src/a.ts', insertions: 1, deletions: 0 }] }),
      authorized: { includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'], validationCriteria: [{ label: 'unit', command: 'npm test' }] },
      observed: observed({
        observedChangedFiles: ['src/a.ts', 'src/z.ts'],
        observedDiffFiles: [{ path: 'src/a.ts', insertions: 1, deletions: 0 }, { path: 'src/z.ts', insertions: 9, deletions: 0 }],
      }),
    }));
    expect(report.verdict).toBe('rejected');
    // A mentira é detectada por DUAS vias independentes.
    expect(codes(report)).toContain('attested_contradicts_observed');
    expect(codes(report)).toContain('change_in_excluded_scope');
    expect(report.findings.find(f => f.code === 'change_in_excluded_scope')?.provenance).toBe('independent');
  });

  test('resume: escopo usa somente o delta observado desde o checkpoint', () => {
    const resumedEvidence = {
      ...observed({
        observedChangedFiles: ['src/implementation.ts', 'src/test.ts'],
        observedDiffFiles: [
          { path: 'src/implementation.ts', insertions: 3, deletions: 1 },
          { path: 'src/test.ts', insertions: 8, deletions: 0 },
        ],
      }),
      observedChangedFilesSinceStart: ['src/test.ts'],
    } as HostObservedGitEvidenceV1 & { readonly observedChangedFilesSinceStart: readonly string[] };
    const report = verifyWorkResult(baseInput({
      handoff: handoffWith({
        changedFiles: ['src/implementation.ts', 'src/test.ts'],
        diffFiles: [
          { path: 'src/implementation.ts', insertions: 3, deletions: 1 },
          { path: 'src/test.ts', insertions: 8, deletions: 0 },
        ],
      }),
      authorized: {
        includedScope: ['src/test.ts'],
        excludedScope: ['src/implementation.ts'],
        validationCriteria: [{ label: 'unit', command: 'npm test' }],
      },
      observed: resumedEvidence,
    }));
    expect(report.verdict).toBe('verified');
    expect(codes(report)).not.toContain('change_in_excluded_scope');
    expect(codes(report)).toContain('scope_independently_observed');
  });

  test('resume: alteração realmente feita após o checkpoint em arquivo excluído é rejeitada', () => {
    const report = verifyWorkResult(baseInput({
      authorized: {
        includedScope: ['src/test.ts'],
        excludedScope: ['src/implementation.ts'],
        validationCriteria: [{ label: 'unit', command: 'npm test' }],
      },
      observed: observed({
        observedChangedFiles: ['src/implementation.ts', 'src/test.ts'],
        observedChangedFilesSinceStart: ['src/implementation.ts', 'src/test.ts'],
        observedDiffFiles: [
          { path: 'src/implementation.ts', insertions: 1, deletions: 0 },
          { path: 'src/test.ts', insertions: 8, deletions: 0 },
        ],
      }),
      handoff: handoffWith({
        changedFiles: ['src/implementation.ts', 'src/test.ts'],
        diffFiles: [
          { path: 'src/implementation.ts', insertions: 1, deletions: 0 },
          { path: 'src/test.ts', insertions: 8, deletions: 0 },
        ],
      }),
    }));
    expect(report.verdict).toBe('rejected');
    expect(codes(report)).toContain('change_in_excluded_scope');
  });

  test('divergência de commit observado × atestado ⇒ attested_contradicts_observed', () => {
    const report = verifyWorkResult(baseInput({ observed: observed({ observedCommitSha: 'c'.repeat(40) }) }));
    expect(report.verdict).toBe('rejected');
    expect(codes(report)).toContain('attested_contradicts_observed');
  });

  test('evidência observada de outra tentativa ⇒ observed_correlation_mismatch (independente)', () => {
    const report = verifyWorkResult(baseInput({ observed: observed({ attemptId: 'outra' }) }));
    expect(report.verdict).toBe('rejected');
    expect(codes(report)).toContain('observed_correlation_mismatch');
    expect(report.findings.find(f => f.code === 'observed_correlation_mismatch')?.provenance).toBe('independent');
  });

  test('caminho fora do escopo escondido no diffSummary (não em changedFiles) ⇒ rejected', () => {
    // Adversário: lista só arquivos em escopo em changedFiles, mas o numstat
    // (diffSummary.files) carrega um caminho no escopo excluído. O escopo deve
    // cobrir TODO caminho reportado, não só um campo.
    const report = verifyWorkResult(baseInput({
      handoff: handoffWith({
        changedFiles: ['src/a.ts'],
        diffFiles: [{ path: 'src/a.ts', insertions: 1, deletions: 0 }, { path: 'src/z.ts', insertions: 9, deletions: 0 }],
      }),
      authorized: { includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'], validationCriteria: [{ label: 'unit', command: 'npm test' }] },
    }));
    expect(report.verdict).toBe('rejected');
    expect(codes(report)).toContain('change_in_excluded_scope');
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
        validation_criteria: [{ label: 'unit', command: 'npm test', covers: ['e'] }],
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

  test('N critérios aprovados e apenas N-1 cobertos ⇒ gap explícito e inconclusive', () => {
    const candidate = item({
      intent: { execution_spec: {
        schema_version: 1, target: { kind: 'project', reference: 'proj' }, permissions: [],
        validation_criteria: [{ label: 'unit', command: 'npm test', covers: ['round-trip', 'extra fields'] }],
        limits: { max_attempts: 1 },
      } } as unknown as WorkItem['intent'],
      proposal: { schemaVersion: 1, data: {
        summary: 'PIN-02', objective: 'codec', includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'],
        expectedEffects: ['round-trip', 'extra fields', 'unknown version'], risks: [],
      } },
    });
    const report = verifyPersistedWorkResult(candidate, [resultEvent(handoffWith())]);
    expect(report.verdict).toBe('inconclusive');
    expect(report.findings.filter(f => f.code === 'acceptance_criterion_without_evidence').map(f => f.subject))
      .toEqual(['unknown version']);
  });

  test('PIN-02 reconstruído: gates verdes não escondem comportamentos sem prova', () => {
    const effects = [
      'Round-trip preserva integralmente uma ProjectIdeaV0 válida.',
      'Shape ausente, extra, malformado ou com versão desconhecida falha fechado.',
      'Teste focado e typecheck de packages/core passam.',
    ];
    const candidate = item({
      intent: { execution_spec: {
        schema_version: 1, target: { kind: 'project', reference: 'anima' }, permissions: [],
        validation_criteria: [{ label: 'unit', command: 'npm test', covers: [effects[2]!] }],
        limits: { max_attempts: 1 },
      } } as unknown as WorkItem['intent'],
      proposal: { schemaVersion: 1, data: { summary: 'PIN-02', objective: 'codec',
        includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'], expectedEffects: effects, risks: [] } },
    });
    const report = verifyPersistedWorkResult(candidate, [resultEvent(handoffWith())]);
    expect(report.verdict).toBe('inconclusive');
    expect(report.findings.filter(f => f.code === 'acceptance_criterion_covered').map(f => f.subject)).toEqual([effects[2]]);
    expect(report.findings.filter(f => f.code === 'acceptance_criterion_without_evidence').map(f => f.subject)).toEqual(effects.slice(0, 2));
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

  const hostEvidence = (over: Partial<Parameters<typeof buildHostObservedGitEvidence>[0]> = {}): HostObservedGitEvidenceV1 => {
    const built = buildHostObservedGitEvidence({
      workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
      baseSha: BASE, observedCommitSha: COMMIT,
      observedChangedFiles: ['src/a.ts'],
      observedDiffFiles: [{ path: 'src/a.ts', insertions: 3, deletions: 1 }],
      observedAt: '2026-08-14T12:00:00.000Z',
      ...over,
    });
    if (!built.ok) throw new Error(built.explanation);
    return built.value;
  };

  const hostEvidenceEvent = (evidence: HostObservedGitEvidenceV1, envelope?: { attemptId?: string }): WorkEvent => ({
    id: 'ev-host', workItemId: 'work-1', type: 'host_observed_evidence_recorded', author: 'system',
    proposalVersion: 2,
    payload: {
      schema_version: 1,
      data: {
        work_item_id: 'work-1', attempt_id: envelope?.attemptId ?? evidence.attemptId, approved_proposal_version: 2,
        origin: 'host', coverage: { git: true, gates: false }, evidence: evidence as unknown as Json,
      },
    } as unknown as Json,
    occurredAt: new Date('2026-08-14T00:01:00Z'),
  });

  test('evidência observada coerente com o atestado ⇒ escopo confirmado independentemente', () => {
    const report = verifyPersistedWorkResult(item(), [resultEvent(handoffWith()), hostEvidenceEvent(hostEvidence())]);
    expect(report.verdict).toBe('verified');
    const scope = report.findings.find(f => f.code === 'scope_independently_observed');
    expect(scope?.provenance).toBe('independent');
    // Git é independente, mas os gates continuam atestados: um verified honesto
    // ainda repousa em atestação (gates), nunca é prova independente total.
    expect(report.restsOnAttestedEvidence).toBe(true);
  });

  test('executor mente sobre os arquivos: host observa git divergente ⇒ rejected (mentira detectada)', () => {
    // O handoff atestado é limpo e em escopo; o host observou no git um arquivo e
    // um commit diferentes. É a prova do critério de aceitação: para Git, SIM.
    const observed = hostEvidence({
      observedCommitSha: 'c'.repeat(40),
      observedChangedFiles: ['src/evil.ts'],
      observedDiffFiles: [{ path: 'src/evil.ts', insertions: 9, deletions: 0 }],
    });
    const report = verifyPersistedWorkResult(item(), [resultEvent(handoffWith()), hostEvidenceEvent(observed)]);
    expect(report.verdict).toBe('rejected');
    const codesList = report.findings.map(f => f.code);
    expect(codesList).toContain('attested_contradicts_observed');
    expect(codesList).toContain('change_out_of_included_scope');
    expect(report.findings.find(f => f.code === 'attested_contradicts_observed')?.provenance).toBe('independent');
  });

  test('evidência observada com envelope incoerente é ignorada (recai na atestação, sem falso positivo)', () => {
    // O evento persiste uma evidência cuja tríade discorda do envelope do próprio
    // evento: a projeção vira ausência e o escopo recai no atestado — ainda verified.
    const report = verifyPersistedWorkResult(item(), [
      resultEvent(handoffWith()),
      hostEvidenceEvent(hostEvidence(), { attemptId: 'attempt-OTHER' }),
    ]);
    expect(report.verdict).toBe('verified');
    expect(report.findings.some(f => f.code === 'scope_independently_observed')).toBe(false);
    expect(report.findings.some(f => f.code === 'observed_correlation_mismatch')).toBe(false);
  });

  test('presentWorkItem anexa o parecer só quando há evidência durável', () => {
    const withEvidence = presentWorkItem(item(), [resultEvent(handoffWith())]);
    expect(withEvidence.verification?.verdict).toBe('verified');
    expect(withEvidence.verification?.advisory).toBe(true);
    // Sem handoff durável no log, o parecer não é anexado (não é ruído inconclusivo).
    const withoutEvidence = presentWorkItem(item({ state: 'proposed' }), []);
    expect(withoutEvidence.verification).toBeNull();
  });
});
