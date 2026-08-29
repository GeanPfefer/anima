import { readAutonomousExecutionSpec } from './eligibility';
import { validateRecoverySuccessor } from './recovery-successor';
import type { WorkRecoveryAssessment } from './recovery-successor-types';
import type { WorkItem } from './types';
import {
  decompositionIdempotencySeed,
  deriveDecompositionSuccessor,
  type DecompositionDiagnostic,
  type DecompositionInput,
} from './decomposition';

const BASE_SHA = 'a'.repeat(40);
const COMMIT_SHA = 'b'.repeat(40);
const BRANCH = 'anima-work/fb79667c-dc13-4122-b094-1c3be10ce2fc';
const KEY = 'a4000000-0000-4000-8000-000000000001';

const SCOPE = [
  'packages/core/src/work-routing.ts',
  'packages/core/src/work-routing.test.ts',
  'apps/web/resource-governor.ts',
  'apps/web/resource-governor.test.ts',
] as const;

const original: WorkItem = {
  id: '0cedae21-433d-4842-8fbd-9045c5128bcf', userId: 'u', sourceMessageId: 'm', state: 'failed',
  impactLevel: 'structural', capability: 'programming', originalRequest: 'local first', proposalVersion: 2,
  proposal: {
    schemaVersion: 1,
    data: {
      summary: 'política completa', objective: 'routing + governor',
      includedScope: [...SCOPE], excludedScope: ['cloud'], expectedEffects: ['política'], risks: ['capacidade'],
    },
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
  workItemId: original.id, proposalVersion: 2, failureEventId: 'f', sourceAttemptId: 'a', attemptsUsed: 2, maxAttempts: 2,
  decision: { failureKind: 'no_progress', normalizedCode: 'ollama_no_effective_edits', action: 'decompose', reason: 'task_should_be_decomposed' },
};

// O checkpoint tocou 2 dos 4 arquivos do escopo → foco estritamente menor.
const diagnostic: DecompositionDiagnostic = {
  failingGates: [{ label: 'test', command: 'npm test' }],
  changedFiles: ['packages/core/src/work-routing.ts', 'packages/core/src/work-routing.test.ts'],
  checkpoint: { baseSha: BASE_SHA, branch: BRANCH, commitSha: COMMIT_SHA },
};

const input = (overrides: Partial<DecompositionInput> = {}): DecompositionInput => ({
  original, assessment, diagnostic, recoverySequence: 1, idempotencyKey: KEY, ...overrides,
});

const ok = (result: ReturnType<typeof deriveDecompositionSuccessor>) => {
  if (!result.ok) throw new Error(`esperava sucesso, veio: ${result.refusals.join(', ')}`);
  return result.candidate;
};

describe('deriveDecompositionSuccessor — caminho governado', () => {
  test('produz um candidato que PASSA na validação de successor sem ampliar autoridade', () => {
    const candidate = ok(deriveDecompositionSuccessor(input()));
    expect(validateRecoverySuccessor(original, assessment, candidate)).toMatchObject({ valid: true });
  });

  test('reduz o escopo a um subconjunto ESTRITO e byte-idêntico do original', () => {
    const candidate = ok(deriveDecompositionSuccessor(input()));
    expect(candidate.proposal.data.includedScope).toEqual([
      'packages/core/src/work-routing.ts',
      'packages/core/src/work-routing.test.ts',
    ]);
    expect(candidate.proposal.data.includedScope.length).toBeLessThan(SCOPE.length);
    // Cada entrada é uma string exata do escopo original (não reescrita).
    for (const entry of candidate.proposal.data.includedScope) expect(SCOPE).toContain(entry);
  });

  test('exclui explicitamente os arquivos que saíram do escopo', () => {
    const candidate = ok(deriveDecompositionSuccessor(input()));
    expect(candidate.proposal.data.excludedScope).toEqual(expect.arrayContaining([
      'cloud', 'apps/web/resource-governor.ts', 'apps/web/resource-governor.test.ts',
    ]));
  });

  test('preserva capacidade, impacto, alvo, permissões, budget e dependências', () => {
    const candidate = ok(deriveDecompositionSuccessor(input()));
    expect(candidate.capability).toBe(original.capability);
    expect(candidate.impactLevel).toBe(original.impactLevel);
    const spec = readAutonomousExecutionSpec(candidate.intent);
    const originalSpec = readAutonomousExecutionSpec(original.intent)!;
    expect(spec).not.toBeNull();
    expect(spec!.target).toEqual(originalSpec.target);
    expect(spec!.permissions).toEqual(originalSpec.permissions);
    expect(spec!.limits.maxAttempts).toBe(originalSpec.limits.maxAttempts);
    expect(spec!.dependsOnWorkItemIds).toEqual(originalSpec.dependsOnWorkItemIds);
    expect(spec!.dependsOnWorkItemIds).not.toContain(original.id);
  });

  test('grava a proveniência de retomada no execution_spec, ignorada pelo parser', () => {
    const candidate = ok(deriveDecompositionSuccessor(input()));
    const raw = (candidate.intent['execution_spec'] as Record<string, unknown>)['resume_from_checkpoint'];
    expect(raw).toEqual({ base_sha: BASE_SHA, branch: BRANCH, commit_sha: COMMIT_SHA });
    // O parser de spec continua lendo o alvo normalmente, sem tropeçar no campo extra.
    expect(readAutonomousExecutionSpec(candidate.intent)!.target.reference).toBe('anima');
  });

  test('a semente de idempotência é estável e insensível a caixa', () => {
    expect(decompositionIdempotencySeed(original.id, COMMIT_SHA))
      .toBe(decompositionIdempotencySeed(original.id.toUpperCase(), COMMIT_SHA.toUpperCase()));
  });

  test('casa arquivos do diagnóstico com o escopo mesmo com barras invertidas', () => {
    const candidate = ok(deriveDecompositionSuccessor(input({
      diagnostic: {
        ...diagnostic,
        changedFiles: ['packages\\core\\src\\work-routing.ts', 'packages\\core\\src\\work-routing.test.ts'],
      },
    })));
    expect(candidate.proposal.data.includedScope).toEqual([
      'packages/core/src/work-routing.ts',
      'packages/core/src/work-routing.test.ts',
    ]);
  });
});

describe('deriveDecompositionSuccessor — recusas fail-closed', () => {
  test('recusa quando a estratégia decidida não é decompose', () => {
    const retry: WorkRecoveryAssessment = {
      ...assessment,
      decision: { ...assessment.decision, action: 'retry', reason: 'transient_retry_within_budget' },
    };
    const result = deriveDecompositionSuccessor(input({ assessment: retry }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.refusals).toContain('strategy_not_decompose');
  });

  test('recusa quando o original não está failed', () => {
    const result = deriveDecompositionSuccessor(input({ original: { ...original, state: 'in_progress' } }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.refusals).toContain('original_not_failed');
  });

  test('recusa quando o assessment não corresponde ao original', () => {
    const mismatch: WorkRecoveryAssessment = { ...assessment, proposalVersion: 99 };
    const result = deriveDecompositionSuccessor(input({ assessment: mismatch }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.refusals).toContain('assessment_mismatch');
  });

  test('recusa quando nenhum arquivo do diagnóstico está no escopo (foco vazio)', () => {
    const result = deriveDecompositionSuccessor(input({
      diagnostic: { ...diagnostic, changedFiles: ['docs/registros/algo.md'] },
    }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.refusals).toContain('focus_empty');
  });

  test('recusa quando o foco não reduz o escopo (todos os arquivos mudaram)', () => {
    const result = deriveDecompositionSuccessor(input({
      diagnostic: { ...diagnostic, changedFiles: [...SCOPE] },
    }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.refusals).toContain('scope_not_reducible');
  });

  test.each([
    ['sem gates', { ...diagnostic, failingGates: [] }],
    ['sem arquivos', { ...diagnostic, changedFiles: [] }],
    ['sha de commit inválido', { ...diagnostic, checkpoint: { ...diagnostic.checkpoint, commitSha: 'nope' } }],
    ['base igual ao commit', { ...diagnostic, checkpoint: { ...diagnostic.checkpoint, commitSha: BASE_SHA } }],
    ['branch fora do namespace do Anima', { ...diagnostic, checkpoint: { ...diagnostic.checkpoint, branch: 'main' } }],
  ] as const)('recusa diagnóstico incompleto: %s', (_label, bad) => {
    const result = deriveDecompositionSuccessor(input({ diagnostic: bad as DecompositionDiagnostic }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.refusals).toContain('diagnostic_incomplete');
  });

  test.each([
    ['sequência inválida', { recoverySequence: 0 }],
    ['idempotencyKey não-uuid', { idempotencyKey: 'not-a-uuid' }],
  ] as const)('recusa entrada de lineage inválida: %s', (_label, bad) => {
    const result = deriveDecompositionSuccessor(input(bad));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.refusals).toContain('lineage_input_invalid');
  });

  test('não introduz autoridade financeira (validação de successor não acusa)', () => {
    const candidate = ok(deriveDecompositionSuccessor(input()));
    const result = validateRecoverySuccessor(original, assessment, candidate);
    expect(result.valid).toBe(true);
    expect(JSON.stringify(candidate)).not.toMatch(/paid_compute|financial_authorization|auto.?provision/i);
  });
});
