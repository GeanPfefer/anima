import { readAutonomousExecutionSpec } from './eligibility';
import { validateCorrectionSuccessor } from './recovery-successor';
import type { WorkItem } from './types';
import {
  deriveResumeCorrectionSuccessor,
  type DecompositionCheckpoint,
  type ResumeCorrectionInput,
} from './decomposition';
import { buildHostObservedGitEvidence, buildWorktreeHandoff, verifyWorkResult, type WorkResultVerificationInput } from './index';

const BASE_SHA = 'a'.repeat(40);
const COMMIT_SHA = 'b'.repeat(40);
const BRANCH = 'anima-work/0aaf828c-fa1d-4c76-8503-64df7a5041c9';
const KEY = 'c4000000-0000-4000-8000-000000000001';

// Escopo original: implementação + teste. O checkpoint tocou a implementação
// (verificada); a revisão pede só os testes → escopo restante = o arquivo de teste.
const IMPL = 'apps/web/lib/ai/chat-surface.ts';
const TEST = 'apps/web/lib/ai/chat-surface.test.ts';

const original: WorkItem = {
  id: '71445254-c514-41c0-a86a-d9878f04e5e8', userId: 'u', sourceMessageId: 'm', state: 'changes_requested',
  impactLevel: 'low', capability: 'programming', originalRequest: 'dedup allowlist', proposalVersion: 1,
  proposal: {
    schemaVersion: 1,
    data: {
      summary: 'dedup allowlist', objective: 'dedup ordenado + testes',
      includedScope: [IMPL, TEST], excludedScope: ['supabase/'], expectedEffects: ['dedup'], risks: ['semântica'],
    },
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

const checkpoint: DecompositionCheckpoint = { baseSha: BASE_SHA, branch: BRANCH, commitSha: COMMIT_SHA };

const input = (overrides: Partial<ResumeCorrectionInput> = {}): ResumeCorrectionInput => ({
  original,
  requestedChanges: 'Ampliar os testes para provar deduplicação ordenada e preservação da primeira ocorrência.',
  checkpoint,
  preservedFiles: [IMPL],
  recoverySequence: 1,
  idempotencyKey: KEY,
  ...overrides,
});

const ok = (result: ReturnType<typeof deriveResumeCorrectionSuccessor>) => {
  if (!result.ok) throw new Error(`esperava sucesso, veio: ${result.refusals.join(', ')}`);
  return result.candidate;
};

describe('deriveResumeCorrectionSuccessor — correção governada por retomada', () => {
  test('produz um candidato que PASSA em validateCorrectionSuccessor', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input()));
    expect(validateCorrectionSuccessor(original, candidate)).toMatchObject({ valid: true });
  });

  test('reduz o escopo ao RESTANTE (não tocado) — subconjunto estrito e byte-idêntico', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input()));
    expect(candidate.proposal.data.includedScope).toEqual([TEST]);
    expect(candidate.proposal.data.includedScope.length).toBeLessThan(original.proposal.data.includedScope.length);
    expect(candidate.proposal.data.includedScope[0]).toBe(TEST); // exata do escopo original
  });

  test('a implementação preservada entra em EXCLUÍDO (não reescrita em silêncio)', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input()));
    expect(candidate.proposal.data.excludedScope).toEqual(expect.arrayContaining(['supabase/', IMPL]));
    expect(candidate.proposal.data.includedScope).not.toContain(IMPL);
  });

  test('RETOMA do checkpoint: espelha o spec + resume_from_checkpoint + base_sha do checkpoint', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input()));
    const spec = candidate.intent['execution_spec'] as Record<string, unknown>;
    expect(spec['base_sha']).toBe(BASE_SHA);
    expect(spec['resume_from_checkpoint']).toEqual({ base_sha: BASE_SHA, branch: BRANCH, commit_sha: COMMIT_SHA });
    // Envelope de execução espelhado (target/permissões/limites intactos).
    const originalSpec = readAutonomousExecutionSpec(original.intent)!;
    const candidateSpec = readAutonomousExecutionSpec(candidate.intent)!;
    expect(candidateSpec.target).toEqual(originalSpec.target);
    expect(candidateSpec.permissions).toEqual(originalSpec.permissions);
    expect(candidateSpec.limits.maxAttempts).toBe(originalSpec.limits.maxAttempts);
  });

  test('preserva capacidade e impacto (nunca amplia)', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input()));
    expect(candidate.capability).toBe(original.capability);
    expect(candidate.impactLevel).toBe(original.impactLevel);
  });

  test('o objetivo carrega o pedido da revisão e cita o checkpoint', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input()));
    expect(candidate.proposal.data.objective).toContain('deduplicação ordenada');
    expect(candidate.proposal.data.objective).toContain(COMMIT_SHA.slice(0, 12));
  });

  describe('fail-closed', () => {
    const refusals = (o: Partial<ResumeCorrectionInput>) => {
      const r = deriveResumeCorrectionSuccessor(input(o));
      if (r.ok) throw new Error('esperava recusa');
      return r.refusals;
    };

    test('original que não está em changes_requested', () => {
      expect(refusals({ original: { ...original, state: 'failed' } })).toContain('original_not_changes_requested');
    });
    test('pedido de revisão vazio', () => {
      expect(refusals({ requestedChanges: '   ' })).toContain('requested_changes_empty');
    });
    test('checkpoint sem edit efetivo (base == commit) não é retomável', () => {
      expect(refusals({ checkpoint: { ...checkpoint, commitSha: BASE_SHA } })).toContain('checkpoint_incomplete');
    });
    test('branch fora do padrão anima-work', () => {
      expect(refusals({ checkpoint: { ...checkpoint, branch: 'main' } })).toContain('checkpoint_incomplete');
    });
    test('nenhum arquivo preservado dentro do escopo', () => {
      expect(refusals({ preservedFiles: [] })).toContain('preserved_files_out_of_scope');
      expect(refusals({ preservedFiles: ['fora/do/escopo.ts'] })).toContain('preserved_files_out_of_scope');
    });
    test('checkpoint tocou TODO o escopo — nada restante para corrigir', () => {
      expect(refusals({ preservedFiles: [IMPL, TEST] })).toContain('remaining_scope_empty');
    });
    test('lineage inválida (sequência/idempotência)', () => {
      expect(refusals({ recoverySequence: 0 })).toContain('lineage_input_invalid');
      expect(refusals({ idempotencyKey: 'nope' })).toContain('lineage_input_invalid');
    });
  });
});

describe('validateCorrectionSuccessor — rejeita ampliação de envelope', () => {
  test('recusa se o candidato não reduz o escopo (subconjunto não-estrito)', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input()));
    const notReduced = { ...candidate, proposal: { ...candidate.proposal, data: { ...candidate.proposal.data, includedScope: [IMPL, TEST] } } };
    expect(validateCorrectionSuccessor(original, notReduced)).toMatchObject({ valid: false });
  });
  test('recusa se a capacidade for ampliada', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input()));
    const escalated = { ...candidate, capability: 'research' as const };
    const result = validateCorrectionSuccessor(original, escalated);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.gaps).toContain('capability_changed');
  });
});

describe('deriveResumeCorrectionSuccessor — requisitos de prova heterogêneos (Verifier v2)', () => {
  const SHORT_COMMIT = COMMIT_SHA.slice(0, 12);
  const FUNCTIONAL = 'As validações declaradas da unidade (gates) passam sobre a correção retomada.';
  const SCOPE_REMAINING = `A revisão é cumprida adicionando trabalho apenas a ${TEST}.`;
  const SCOPE_INTACT = `A implementação já verificada (${IMPL}) permanece intacta, retomada do checkpoint ${SHORT_COMMIT}.`;

  test('o aceite carrega critério funcional (gate) + critérios de escopo', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input()));
    expect(candidate.proposal.data.expectedEffects).toEqual([FUNCTIONAL, SCOPE_REMAINING, SCOPE_INTACT]);
  });

  test('o execution_spec liga gate→funcional e ACRESCENTA um critério proof:scope', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input()));
    const spec = readAutonomousExecutionSpec(candidate.intent);
    expect(spec).not.toBeNull();
    const gate = spec!.validationCriteria.find(c => c.label === 'test');
    expect(gate?.covers).toEqual([FUNCTIONAL]);
    const scope = spec!.validationCriteria.find(c => c.proof === 'scope');
    expect(scope).toMatchObject({ proof: 'scope', covers: [SCOPE_REMAINING, SCOPE_INTACT] });
    expect(scope?.command).toBeUndefined();
  });

  // Determinação da §13: um sucessor CORRETAMENTE derivado pode alcançar VERIFIED
  // se só o test file mudar (escopo observado limpo) e os gates passarem — SEM rodar o coder.
  test('convergência: só o test file muda + gate verde ⇒ VERIFIED com cobertura completa', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input()));
    const spec = readAutonomousExecutionSpec(candidate.intent)!;
    const attemptId = 'b0000000-0000-4000-8000-0000000000aa';
    const handoff = buildWorktreeHandoff({
      workItemId: 'successor-1', attemptId, approvedProposalVersion: 1,
      executorId: 'worktree-v1', backendId: 'fake', model: null,
      baseSha: BASE_SHA, branch: `anima-work/${attemptId}`, commitSha: COMMIT_SHA, status: 'succeeded',
      changedFiles: [TEST], diffFiles: [{ path: TEST, insertions: 30, deletions: 0 }],
      gates: [{ label: 'test', command: spec.validationCriteria[0]!.command!, exitCode: 0, outcome: 'passed' }],
    });
    if (!handoff.ok) throw new Error(handoff.explanation);
    const observed = buildHostObservedGitEvidence({
      workItemId: 'successor-1', attemptId, approvedProposalVersion: 1,
      baseSha: BASE_SHA, observedCommitSha: COMMIT_SHA,
      observedChangedFiles: [TEST], observedDiffFiles: [{ path: TEST, insertions: 30, deletions: 0 }],
      observedAt: '2026-09-02T12:00:00.000Z',
    });
    if (!observed.ok) throw new Error(observed.explanation);
    const verification: WorkResultVerificationInput = {
      expected: { workItemId: 'successor-1', attemptId, approvedProposalVersion: 1 },
      authorized: {
        includedScope: candidate.proposal.data.includedScope,
        excludedScope: candidate.proposal.data.excludedScope,
        validationCriteria: spec.validationCriteria,
        acceptanceCriteria: candidate.proposal.data.expectedEffects,
      },
      handoff: handoff.value,
      observed: observed.value,
    };
    const report = verifyWorkResult(verification);
    expect(report.verdict).toBe('verified');
    expect(report.summary.gaps).toBe(0);
    expect(report.summary.violations).toBe(0);
    const covered = report.findings.filter(f => f.code === 'acceptance_criterion_covered').map(f => f.subject);
    expect(covered).toEqual(expect.arrayContaining([FUNCTIONAL, SCOPE_REMAINING, SCOPE_INTACT]));
  });

  // Prova NEGATIVA: se o coder tocar a implementação preservada (escopo excluído),
  // o Verifier detecta e NUNCA classifica como verified.
  test('prova negativa: tocar a implementação preservada ⇒ violação, nunca verified', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input()));
    const spec = readAutonomousExecutionSpec(candidate.intent)!;
    const attemptId = 'b0000000-0000-4000-8000-0000000000bb';
    const handoff = buildWorktreeHandoff({
      workItemId: 'successor-1', attemptId, approvedProposalVersion: 1,
      executorId: 'worktree-v1', backendId: 'fake', model: null,
      baseSha: BASE_SHA, branch: `anima-work/${attemptId}`, commitSha: COMMIT_SHA, status: 'succeeded',
      changedFiles: [TEST, IMPL], diffFiles: [{ path: TEST, insertions: 30, deletions: 0 }, { path: IMPL, insertions: 2, deletions: 1 }],
      gates: [{ label: 'test', command: spec.validationCriteria[0]!.command!, exitCode: 0, outcome: 'passed' }],
    });
    if (!handoff.ok) throw new Error(handoff.explanation);
    const observed = buildHostObservedGitEvidence({
      workItemId: 'successor-1', attemptId, approvedProposalVersion: 1,
      baseSha: BASE_SHA, observedCommitSha: COMMIT_SHA,
      observedChangedFiles: [TEST, IMPL], observedDiffFiles: [{ path: TEST, insertions: 30, deletions: 0 }, { path: IMPL, insertions: 2, deletions: 1 }],
      observedAt: '2026-09-02T12:00:00.000Z',
    });
    if (!observed.ok) throw new Error(observed.explanation);
    const report = verifyWorkResult({
      expected: { workItemId: 'successor-1', attemptId, approvedProposalVersion: 1 },
      authorized: {
        includedScope: candidate.proposal.data.includedScope,
        excludedScope: candidate.proposal.data.excludedScope,
        validationCriteria: spec.validationCriteria,
        acceptanceCriteria: candidate.proposal.data.expectedEffects,
      },
      handoff: handoff.value,
      observed: observed.value,
    });
    expect(report.verdict).toBe('rejected');
    expect(report.findings.map(f => f.code)).toContain('change_in_excluded_scope');
  });
});
