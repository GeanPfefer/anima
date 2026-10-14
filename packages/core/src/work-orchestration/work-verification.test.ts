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
        validation_criteria: [{ label: 'unit', command: 'npm test', covers: ['e'], claim_kind: 'gate_assertion' }],
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
        validation_criteria: [{ label: 'unit', command: 'npm test', covers: ['round-trip', 'extra fields'], claim_kind: 'gate_assertion' }],
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
        validation_criteria: [{ label: 'unit', command: 'npm test', covers: [effects[2]!], claim_kind: 'gate_assertion' }],
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

// ============================================================
// Cobertura HETEROGÊNEA: nem toda prova é um gate. Um critério de aceite pode ser
// provado por EXECUÇÃO (gate) OU por INVARIANTE DE ESCOPO (contenção observada pelo
// host). Mirror do contrato de um sucessor de correção: um critério funcional
// (gate) + dois de escopo (só o test file mudou / impl intacta).
// ============================================================
describe('verifyWorkResult — critérios de aceite provados por escopo (não só gate)', () => {
  const FUNC = 'Os gates de validação da correção passam.';
  const SCOPE_ONLY = 'A correção altera apenas src/test.ts.';
  const SCOPE_INTACT = 'A implementação src/impl.ts permanece intacta.';

  const gitObserved = (over: Partial<Parameters<typeof buildHostObservedGitEvidence>[0]> = {}): HostObservedGitEvidenceV1 => {
    const built = buildHostObservedGitEvidence({
      workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
      baseSha: BASE, observedCommitSha: COMMIT,
      observedChangedFiles: ['src/test.ts'],
      observedDiffFiles: [{ path: 'src/test.ts', insertions: 20, deletions: 0 }],
      observedAt: '2026-09-02T12:00:00.000Z', ...over,
    });
    if (!built.ok) throw new Error(built.explanation);
    return built.value;
  };

  // Contrato base do sucessor de correção: 1 gate funcional + 1 critério de escopo
  // que cobre os DOIS invariantes de escopo. Handoff/observado tocam SÓ o test file.
  const scopeInput = (overrides: Partial<WorkResultVerificationInput> = {}): WorkResultVerificationInput => ({
    expected: { workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2 },
    authorized: {
      includedScope: ['src/test.ts'],
      excludedScope: ['src/impl.ts'],
      validationCriteria: [
        { label: 'unit', command: 'npm test', covers: [FUNC], claimKind: 'gate_assertion' },
        { label: 'Contenção de escopo', proof: 'scope', covers: [SCOPE_ONLY, SCOPE_INTACT] },
      ],
      acceptanceCriteria: [FUNC, SCOPE_ONLY, SCOPE_INTACT],
    },
    handoff: handoffWith({ changedFiles: ['src/test.ts'], diffFiles: [{ path: 'src/test.ts', insertions: 20, deletions: 0 }] }),
    observed: gitObserved(),
    ...overrides,
  });

  test('CASO 1 — escopo respeitado + observado independente ⇒ critério de escopo PROVADO', () => {
    const report = verifyWorkResult(scopeInput());
    expect(report.verdict).toBe('verified');
    const covered = report.findings.find(f => f.code === 'scope_criterion_covered');
    expect(covered?.provenance).toBe('independent');
    // Os DOIS invariantes de escopo ficam com evidência.
    const acceptanceCovered = report.findings.filter(f => f.code === 'acceptance_criterion_covered').map(f => f.subject);
    expect(acceptanceCovered).toEqual(expect.arrayContaining([SCOPE_ONLY, SCOPE_INTACT]));
  });

  test('CASO 2 — arquivo excluído alterado (observado) ⇒ violação, NUNCA verified, escopo não coberto', () => {
    const report = verifyWorkResult(scopeInput({
      handoff: handoffWith({ changedFiles: ['src/test.ts', 'src/impl.ts'], diffFiles: [{ path: 'src/test.ts', insertions: 20, deletions: 0 }, { path: 'src/impl.ts', insertions: 1, deletions: 0 }] }),
      observed: gitObserved({ observedChangedFiles: ['src/test.ts', 'src/impl.ts'], observedDiffFiles: [{ path: 'src/test.ts', insertions: 20, deletions: 0 }, { path: 'src/impl.ts', insertions: 1, deletions: 0 }] }),
    }));
    expect(report.verdict).toBe('rejected');
    expect(codes(report)).toContain('change_in_excluded_scope');
    // Os critérios de escopo NÃO são cobertos (fail-closed).
    const missing = report.findings.filter(f => f.code === 'acceptance_criterion_without_evidence').map(f => f.subject);
    expect(missing).toEqual(expect.arrayContaining([SCOPE_ONLY, SCOPE_INTACT]));
  });

  test('CASO 3 — critério funcional exige gate, gate ausente ⇒ gap ⇒ inconclusive', () => {
    const report = verifyWorkResult(scopeInput({
      authorized: {
        includedScope: ['src/test.ts'], excludedScope: ['src/impl.ts'],
        validationCriteria: [
          { label: 'gate-que-nao-rodou', command: 'npm run focused', covers: [FUNC], claimKind: 'gate_assertion' },
          { label: 'Contenção de escopo', proof: 'scope', covers: [SCOPE_ONLY, SCOPE_INTACT] },
        ],
        acceptanceCriteria: [FUNC, SCOPE_ONLY, SCOPE_INTACT],
      },
    }));
    expect(report.verdict).toBe('inconclusive');
    expect(codes(report)).toContain('criterion_without_gate_coverage');
    expect(report.findings.filter(f => f.code === 'acceptance_criterion_without_evidence').map(f => f.subject)).toContain(FUNC);
    // Mas os critérios de escopo continuam PROVADOS pela observação.
    expect(report.findings.filter(f => f.code === 'acceptance_criterion_covered').map(f => f.subject)).toEqual(expect.arrayContaining([SCOPE_ONLY, SCOPE_INTACT]));
  });

  test('CASO 4 — cobertura heterogênea completa (gate + escopo) ⇒ verified, 0 gaps', () => {
    const report = verifyWorkResult(scopeInput());
    expect(report.verdict).toBe('verified');
    expect(report.summary.gaps).toBe(0);
    expect(report.summary.violations).toBe(0);
    const acceptanceCovered = report.findings.filter(f => f.code === 'acceptance_criterion_covered').map(f => f.subject);
    expect(acceptanceCovered).toEqual(expect.arrayContaining([FUNC, SCOPE_ONLY, SCOPE_INTACT]));
    expect(codes(report)).toEqual(expect.arrayContaining(['criterion_covered', 'scope_criterion_covered']));
  });

  test('CASO 5 — só evidência ATESTADA de escopo (sem observação independente) ⇒ não conta, inconclusive', () => {
    // Sem `observed`: o escopo recai na atestação do executor, que NÃO basta como
    // prova de escopo. O gate funcional passa, mas os invariantes de escopo ficam sem prova.
    const report = verifyWorkResult(scopeInput({ observed: undefined }));
    expect(report.verdict).toBe('inconclusive');
    expect(codes(report)).toContain('scope_criterion_uncovered');
    expect(report.findings.filter(f => f.code === 'acceptance_criterion_without_evidence').map(f => f.subject)).toEqual(expect.arrayContaining([SCOPE_ONLY, SCOPE_INTACT]));
    // A prova de EXECUÇÃO (gate) continua válida — evidência do tipo certo.
    expect(report.findings.filter(f => f.code === 'acceptance_criterion_covered').map(f => f.subject)).toContain(FUNC);
  });
});

// ============================================================
// SUFICIÊNCIA SEMÂNTICA por CLASSE DE AFIRMAÇÃO (claim_kind): separa a ASSOCIAÇÃO
// declarada (`covers`) da PROVA suficiente. Um gate SUBSTANTIVO verde é só associação
// (lacuna); um gate_assertion verde prova o critério que afirma que os gates passam.
// ============================================================
describe('verifyWorkResult — suficiência semântica por claim_kind (gate_assertion × substantive)', () => {
  const SUBSTANTIVE = 'O parser rejeita flags desconhecidas e argumentos posicionais.';
  const GATE_ASSERTION = 'As validações declaradas do trabalho passam.';

  test('REGRESSÃO CENTRAL: aceite SUBSTANTIVO coberto só por gate verde ⇒ inconclusive, NUNCA verified', () => {
    // O padrão do falso positivo histórico (seq4→seq5): gate verde associado por
    // covers, sem demonstração material suficiente do comportamento exigido.
    const result = verifyWorkResult(baseInput({
      authorized: {
        includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'],
        validationCriteria: [{ label: 'unit', command: 'npm test', covers: [SUBSTANTIVE], claimKind: 'substantive' }],
        acceptanceCriteria: [SUBSTANTIVE],
      },
    }));
    expect(result.verdict).toBe('inconclusive');
    expect(codes(result)).toContain('acceptance_substantive_gate_insufficient');
    expect(codes(result)).not.toContain('acceptance_criterion_covered');
    // Lacuna (inconclusive), NÃO rejected: não há violação independente.
    expect(result.summary.violations).toBe(0);
    expect(result.summary.gaps).toBeGreaterThan(0);
    // A VALIDAÇÃO rodou e passou (criterion_covered) — é o ACEITE que não está provado.
    expect(codes(result)).toContain('criterion_covered');
    expect(result.findings.find(f => f.code === 'acceptance_substantive_gate_insufficient')?.provenance).toBe('independent');
  });

  test('DEFAULT FAIL-CLOSED: aceite coberto por gate SEM claim_kind ⇒ conservador (insuficiente)', () => {
    const result = verifyWorkResult(baseInput({
      authorized: {
        includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'],
        validationCriteria: [{ label: 'unit', command: 'npm test', covers: [SUBSTANTIVE] }],
        acceptanceCriteria: [SUBSTANTIVE],
      },
    }));
    expect(result.verdict).toBe('inconclusive');
    expect(codes(result)).toContain('acceptance_substantive_gate_insufficient');
    expect(codes(result)).not.toContain('acceptance_criterion_covered');
  });

  test('CONTROLE POSITIVO: aceite gate_assertion + gate host-observado PASS ⇒ verified', () => {
    const result = verifyWorkResult(baseInput({
      authorized: {
        includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'],
        validationCriteria: [{ label: 'unit', command: 'npm test', covers: [GATE_ASSERTION], claimKind: 'gate_assertion' }],
        acceptanceCriteria: [GATE_ASSERTION],
      },
      observedGates: gateEvidenceWith(),
    }));
    expect(result.verdict).toBe('verified');
    expect(result.findings.filter(f => f.code === 'acceptance_criterion_covered').map(f => f.subject)).toContain(GATE_ASSERTION);
    expect(codes(result)).toContain('gates_independently_observed');
  });

  test('gate_assertion mas gate FALHOU (host-observado) ⇒ nunca verified e aceite não coberto', () => {
    const result = verifyWorkResult(baseInput({
      authorized: {
        includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'],
        validationCriteria: [{ label: 'unit', command: 'npm test', covers: [GATE_ASSERTION], claimKind: 'gate_assertion' }],
        acceptanceCriteria: [GATE_ASSERTION],
      },
      observedGates: gateEvidenceWith({ gates: [{ label: 'unit', command: 'npm test', exitCode: 1, durationMs: 50, timedOut: false, cancelled: false }] }),
    }));
    expect(result.verdict).toBe('rejected');
    expect(codes(result)).toContain('gate_failed');
    expect(result.findings.some(f => f.code === 'acceptance_criterion_covered')).toBe(false);
  });

  test('covers de aceite inexistente continua violação, mesmo com claim_kind gate_assertion', () => {
    const result = verifyWorkResult(baseInput({
      authorized: {
        includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'],
        validationCriteria: [{ label: 'unit', command: 'npm test', covers: ['aceite fantasma'], claimKind: 'gate_assertion' }],
        acceptanceCriteria: [GATE_ASSERTION],
      },
    }));
    expect(result.verdict).toBe('rejected');
    expect(codes(result)).toContain('criterion_covers_unknown_acceptance');
  });

  test('cobertura MISTA: mesmo aceite por gate substantivo E gate_assertion ⇒ a prova suficiente vence', () => {
    const result = verifyWorkResult(baseInput({
      authorized: {
        includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'],
        validationCriteria: [
          { label: 'unit', command: 'npm test', covers: [GATE_ASSERTION], claimKind: 'substantive' },
          { label: 'unit', command: 'npm test', covers: [GATE_ASSERTION], claimKind: 'gate_assertion' },
        ],
        acceptanceCriteria: [GATE_ASSERTION],
      },
      observedGates: gateEvidenceWith(),
    }));
    expect(result.verdict).toBe('verified');
    expect(result.findings.filter(f => f.code === 'acceptance_criterion_covered').map(f => f.subject)).toContain(GATE_ASSERTION);
    expect(codes(result)).not.toContain('acceptance_substantive_gate_insufficient');
  });
});

describe('revisão humana pendente', () => {
  const input = (automatic = false): WorkResultVerificationInput => {
    const base = baseInput();
    return { ...base, authorized: { ...base.authorized, acceptanceCriteria: ['humano', 'humano', ...(automatic ? ['auto'] : [])], validationCriteria: [
      { label: 'human', proof: 'human_review', covers: ['humano'] },
      ...(automatic ? [{ label: 'unit', command: 'npm test', claimKind: 'gate_assertion' as const, covers: ['auto'] }] : []),
    ] } };
  };
  test.each([false, true])('pendência não fecha aceite; prova automática = %s', automatic => {
    const report = verifyWorkResult(input(automatic));
    expect(report.humanReview.pending).toEqual(['humano']);
    expect(report.findings.filter(f => f.code === 'acceptance_criterion_covered').map(f => f.subject)).toEqual(automatic ? ['auto'] : []);
    expect(report.findings.find(f => f.code === 'human_review_pending')).toMatchObject({ severity: 'ok', provenance: 'attested', subject: 'humano' });
    expect(report.verdict).toBe(automatic ? 'verified' : 'inconclusive');
    expect(codes(report).includes('no_automated_acceptance_proof')).toBe(!automatic);
  });
  test('sem handoff também registra pendências e lacuna automática', () => {
    const report = verifyWorkResult({ ...input(), handoff: null });
    expect(report.humanReview.pending).toEqual(['humano']);
    expect(codes(report)).toContain('no_automated_acceptance_proof');
  });
  test('prova suficiente vence revisão e covers desconhecido continua violação', () => {
    const base = input(true);
    const report = verifyWorkResult({ ...base, authorized: { ...base.authorized, validationCriteria: [...base.authorized.validationCriteria,
      { label: 'human-auto', proof: 'human_review', covers: ['auto', 'fora'] },
    ] } });
    expect(report.humanReview.pending).toEqual(['humano']);
    expect(codes(report)).toContain('criterion_covers_unknown_acceptance');
    expect(report.verdict).toBe('rejected');
  });
  test('legado mantém achados e contagens com lista humana vazia', () => {
    const base = baseInput();
    expect(verifyWorkResult(base)).toEqual(verifyWorkResult({ ...base, authorized: { ...base.authorized, acceptanceCriteria: [] } }));
    expect(verifyWorkResult(base).humanReview.pending).toEqual([]);
  });
});

test('revisão humana não suplanta scope observado nem torna contrato vazio inconclusivo', () => {
  const base = baseInput();
  const built = buildHostObservedGitEvidence({ workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2, baseSha: BASE, observedCommitSha: COMMIT, observedChangedFiles: ['src/a.ts'], observedDiffFiles: [{ path: 'src/a.ts', insertions: 3, deletions: 1 }], observedAt: '2026-08-14T12:00:00.000Z' });
  if (!built.ok) throw new Error(built.explanation);
  const report = verifyWorkResult({ ...base, observed: built.value, authorized: { ...base.authorized, acceptanceCriteria: ['escopo'], validationCriteria: [
    { label: 'scope', proof: 'scope', covers: ['escopo'] }, { label: 'human', proof: 'human_review', covers: ['escopo'] },
  ] } });
  expect(report.humanReview.pending).toEqual([]);
  expect(codes(report)).toContain('acceptance_criterion_covered');
  expect(codes(report)).not.toContain('no_automated_acceptance_proof');
  const empty = verifyWorkResult({ ...base, authorized: { ...base.authorized, acceptanceCriteria: [], validationCriteria: [{ label: 'human', proof: 'human_review' }] } });
  expect(empty.verdict).toBe('verified');
});
import { deriveGateTestReport, type GateTestFileV1, type GateTestV1 } from './gate-test-report';
import type { AutonomousValidationCriterion } from './eligibility';

describe('Verifier v5 — test_binding observado', () => {
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
  const gateInput = (mutate: (gate: NonNullable<WorkResultVerificationInput['observedGates']>['gates'][number]) =>
    NonNullable<WorkResultVerificationInput['observedGates']>['gates'][number]) => {
    const value = input();
    return { ...value, observedGates: { ...value.observedGates!, gates: [mutate(value.observedGates!.gates[0]!)] } };
  };
  const check = (value: WorkResultVerificationInput, code: string, violation = false) => {
    const result = verifyWorkResult(value);
    expect(codes(result)).toContain(code);
    expect(codes(result)).toContain('acceptance_test_binding_unmet');
    expect(codes(result)).not.toContain('test_binding_satisfied');
    expect(codes(result)).not.toContain('acceptance_criterion_covered');
    expect(result.verdict).toBe(violation ? 'rejected' : 'inconclusive');
    expect(result.findings.find(f => f.code === code)).toMatchObject({
      severity: violation ? 'violation' : 'gap', provenance: 'independent', subject: 'unit',
    });
  };
  test('arquivo novo satisfaz minNewTests, prova independente completa', () => {
    const value = input();
    const before = JSON.stringify(value);
    const result = verifyWorkResult(value);
    expect(result.verdict).toBe('verified');
    expect(result.findings.find(f => f.code === 'test_binding_satisfied')).toMatchObject({
      severity: 'ok', provenance: 'independent', subject: 'unit',
    });
    expect(codes(result)).toContain('acceptance_criterion_covered');
    expect(verifyWorkResult(value)).toEqual(result);
    expect(JSON.stringify(value)).toBe(before);
  });
  test('atestação passed nunca substitui observação', () => check({ ...input(), observedGates: null }, 'test_report_uncorrelated'));
  test('sem git ou autorização não prova', () => {
    check({ ...input(), observed: null }, 'test_report_uncorrelated');
    const value = input();
    check({ ...value, observedGates: { ...value.observedGates!, changeAuthorization: undefined } }, 'test_report_uncorrelated');
  });
  test('rótulo diferente não prova', () => check(gateInput(g => ({ ...g, label: 'other' })), 'test_report_uncorrelated'));
  test('correlação diferente não prova', () => {
    const value = input();
    expect(codes(verifyWorkResult({ ...value, observedGates: { ...value.observedGates!, attemptId: 'other' } })))
      .toContain('test_report_uncorrelated');
  });
  test('revisão diferente é violação antes de verificar presença de relatório', () => {
    const value = gateInput(g => ({ ...g, testReport: undefined }));
    check({ ...value, observedGates: { ...value.observedGates!, changeAuthorization: {
      ...value.observedGates!.changeAuthorization!, changedFiles: ['src/other.ts'],
    } } }, 'test_report_revision_mismatch', true);
  });
  test('igualdade normaliza caixa e barras só para revisão', () => {
    const value = input();
    expect(verifyWorkResult({ ...value, observedGates: { ...value.observedGates!, changeAuthorization: {
      ...value.observedGates!.changeAuthorization!, changedFiles: ['SRC\\A.TS', 'src/a.ts'],
    } } }).verdict).toBe('verified');
  });
  test('relatório inválido omitido pelo builder vira lacuna', () => {
    const value = input();
    const original = value.observedGates!.gates[0]!;
    const evidence = gateEvidenceWith({
      changeAuthorization: { declaredScope: ['src/a.ts'], excludedScope: [], changedFiles: ['src/a.ts'] },
      gates: [{ ...original, testReport: { ...original.testReport!, digest: 'invalid' } }],
    });
    expect(evidence.gates[0]!.testReport).toBeUndefined();
    check({ ...value, observedGates: evidence }, 'test_report_missing');
  });
  test('gate terminal falho nunca prova mesmo com relatório passed', () => {
    const result = verifyWorkResult(gateInput(g => ({ ...g, outcome: 'failed', exitCode: 1 })));
    expect(codes(result)).toContain('test_report_uncorrelated');
    expect(codes(result)).toContain('acceptance_test_binding_unmet');
    expect(result.verdict).toBe('rejected');
  });
  test('relatório ausente', () => check(gateInput(g => ({ ...g, testReport: undefined })), 'test_report_missing'));
  test('relatório apenas em gate anterior nunca prova reparo terminal', () => {
    const value = input();
    const gate = value.observedGates!.gates[0]!;
    check({ ...value, observedGates: { ...value.observedGates!, gates: [gate, { ...gate, testReport: undefined }] } }, 'test_report_missing');
  });
  test('arquivo ligado ausente', () => check(gateInput(g => ({ ...g, testReport: {
    ...g.testReport!, files: [{ ...g.testReport!.files[0]!, path: 'src/other.test.ts' }],
  } })), 'test_binding_unmet'));
  test('contradição exit 0 vs teste failed', () => check(gateInput(g => ({
    ...g, testReport: report(['new case'], { status: 'failed' }),
  })), 'test_report_contradicts_gate', true));
  test('contradição exit 0 vs suíte failed', () => check(gateInput(g => ({
    ...g, testReport: report(['new case'], {}, 'failed'),
  })), 'test_report_contradicts_gate', true));
  test.each(['pending', 'skipped', 'todo', 'disabled'] as const)('teste %s não executado', status =>
    check(gateInput(g => ({ ...g, testReport: report(['new case'], { status }) })), 'bound_test_not_executed'));
  test.each(['focused', 'unknown'] as const)('suíte %s não prova', suite =>
    check(gateInput(g => ({ ...g, testReport: report(['new case'], {}, suite) })), 'bound_test_not_executed'));
  test('runtimeError não prova', () => check(gateInput(g => ({ ...g, testReport: {
    ...g.testReport!, files: [{ ...g.testReport!.files[0]!, runtimeError: true }],
  } })), 'bound_test_not_executed'));
  test('retry não prova', () => check(gateInput(g => ({
    ...g, testReport: report(['new case'], { invocations: 2 }),
  })), 'test_report_flaky'));
  test('boundTests ausente no relatório', () => check(gateInput(g => ({
    ...g, testReport: report(['different case']),
  })), 'test_binding_unmet'));
  test('baseline ausente não conta testes como novos', () => check(gateInput(g => ({
    ...g, baseline: undefined,
  })), 'test_binding_baseline_missing'));
  test('arquivo existente exige baseline report', () => check(gateInput(g => ({
    ...g, baseline: { ...g.baseline!, targets: [{ path, existedAtBase: true, changed: true }] },
  })), 'test_binding_baseline_missing'));
  test('arquivo existente conta apenas nomes novos', () => {
    const value = gateInput(g => ({ ...g, testReport: report(['old case', 'new case']),
      baseline: { ...g.baseline!, targets: [{ path, existedAtBase: true, changed: true }],
        testReport: report(['old case']) } }));
    expect(verifyWorkResult(value).verdict).toBe('verified');
    check({ ...value, observedGates: { ...value.observedGates!, gates: [{
      ...value.observedGates!.gates[0]!, testReport: report(['new case']),
      baseline: { ...value.observedGates!.gates[0]!.baseline!, testReport: report(['new case']) },
    }] } }, 'test_binding_unmet');
  });
  test('teste removido é lacuna', () => check(gateInput(g => ({
    ...g, baseline: { ...g.baseline!, testReport: report(['removed']) },
  })), 'bound_test_removed'));
  test('boundTests pode provar sem baseline quando minNewTests é zero', () => {
    const value = gateInput(g => ({ ...g, baseline: undefined }));
    expect(verifyWorkResult({ ...value, authorized: { ...value.authorized,
      validationCriteria: [{ ...criterion, binding: { ...criterion.binding!, minNewTests: 0 } }],
    } }).verdict).toBe('verified');
  });
  test('outra prova automática suficiente mantém aceite coberto', () => {
    const value = gateInput(g => ({ ...g, testReport: undefined }));
    const result = verifyWorkResult({ ...value, authorized: { ...value.authorized, validationCriteria: [
      criterion, { label: 'unit', command: 'npm test', claimKind: 'gate_assertion', covers: ['behavior'] },
    ] } });
    expect(codes(result)).toContain('acceptance_criterion_covered');
    expect(codes(result)).not.toContain('acceptance_test_binding_unmet');
    expect(result.verdict).toBe('inconclusive');
  });
  test('human_review coexiste sem substituir binding', () => {
    const value = gateInput(g => ({ ...g, testReport: undefined }));
    check({ ...value, authorized: { ...value.authorized, validationCriteria: [
      criterion, { label: 'human', proof: 'human_review', covers: ['behavior'] },
    ] } }, 'test_report_missing');
    const green = input();
    const result = verifyWorkResult({ ...green, authorized: { ...green.authorized,
      acceptanceCriteria: ['behavior', 'human'], validationCriteria: [
        criterion, { label: 'human', proof: 'human_review', covers: ['human'] },
      ],
    } });
    expect(result.verdict).toBe('verified');
    expect(result.humanReview.pending).toEqual(['human']);
  });
  test('critérios binding em ordem e somente primeiro defeito por critério', () => {
    const value = gateInput(g => ({ ...g, testReport: undefined }));
    const result = verifyWorkResult({ ...value, authorized: { ...value.authorized, validationCriteria: [
      criterion, { ...criterion, label: 'second' },
    ] } });
    expect(result.findings.filter(f => ['test_report_missing', 'test_report_uncorrelated'].includes(f.code))
      .map(f => [f.code, f.subject])).toEqual([['test_report_missing', 'unit'], ['test_report_uncorrelated', 'second']]);
  });
});

describe('compatibilidade de evidência sem campos novos', () => {
  test('campos opcionais ausentes preservam parecer e contagens legados', () => {
    const value = baseInput({ observedGates: gateEvidenceWith() });
    const expected = verifyWorkResult(value);
    expect(expected.verdict).toBe('verified');
    expect(expected.summary.violations).toBe(0);
    expect(expected.summary.gaps).toBe(0);
    expect(verifyWorkResult({ ...value, observedGates: { ...value.observedGates!,
      gates: value.observedGates!.gates.map(gate => ({ ...gate, worktreeTree: undefined, outputTail: undefined })) } })).toEqual(expected);
  });
});
