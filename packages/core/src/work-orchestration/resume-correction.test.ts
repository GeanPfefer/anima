import { readAutonomousExecutionSpec } from './eligibility';
import { validateCorrectionSuccessor } from './recovery-successor';
import type { WorkItem } from './types';
import {
  deriveRootAuthorityScope,
  classifyCumulativeCorrectionFiles,
  deriveResumeCorrectionSuccessor,
  validateStructuredReworkPaths,
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
  reworkFiles: [],
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

  test('remaining vazio + rework explícito de todos os arquivos tocados é derivável, sem duplicação', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input({ preservedFiles: [IMPL, TEST], reworkFiles: [TEST, IMPL, TEST] })));
    expect(candidate.proposal.data.includedScope).toEqual([IMPL, TEST]);
    expect(validateCorrectionSuccessor(original, candidate)).toMatchObject({ valid: true });
  });

  test('arquivo tocado explicitamente autorizado reabre; tocado não autorizado permanece preservado', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input({ preservedFiles: [IMPL, TEST], reworkFiles: [TEST] })));
    expect(candidate.proposal.data.includedScope).toEqual([TEST]);
    expect(candidate.proposal.data.excludedScope).toContain(IMPL);
    expect(candidate.proposal.data.excludedScope).not.toContain(TEST);
  });

  test('rework fora do escopo aprovado recusa fail-closed', () => {
    expect(deriveResumeCorrectionSuccessor(input({ reworkFiles: ['fora/do/escopo.ts'] }))).toMatchObject({
      ok: false, refusals: expect.arrayContaining(['rework_files_out_of_scope']),
    });
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
      expect(refusals({ preservedFiles: [IMPL, TEST], reworkFiles: [] })).toContain('remaining_scope_empty');
    });
    test('lineage inválida (sequência/idempotência)', () => {
      expect(refusals({ recoverySequence: 0 })).toContain('lineage_input_invalid');
      expect(refusals({ idempotencyKey: 'nope' })).toContain('lineage_input_invalid');
    });
  });
});

describe('validateCorrectionSuccessor — rejeita ampliação de envelope', () => {
  test('aceita escopo original completo na correction quando o rework o autoriza', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input({ preservedFiles: [IMPL, TEST], reworkFiles: [IMPL, TEST] })));
    expect(validateCorrectionSuccessor(original, candidate)).toMatchObject({ valid: true });
  });
  test('recusa escopo ampliado sem composição explícita coerente', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input()));
    const forged = { ...candidate, proposal: { ...candidate.proposal, data: { ...candidate.proposal.data, includedScope: [IMPL, TEST] } } };
    const result = validateCorrectionSuccessor(original, forged);
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.gaps).toContain('correction_scope_invalid');
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
const SCOPE_REMAINING = `A revisão é cumprida alterando apenas ${TEST} (rework explícito: nenhum; restante: ${TEST}).`;
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
    // O meta-critério funcional ("as validações passam") é estruturalmente uma
    // gate-assertion: o produtor determinístico a marca, então o Verifier a aceita
    // como prova suficiente ao passar (mantém a convergência legítima em verified).
    expect(gate?.claimKind).toBe('gate_assertion');
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

  // Regressão (prova real bd4092af, 2026-09-25): o gate do ORIGINAL já declarava `covers`
  // apontando para o aceite do ORIGINAL. O sucessor substitui o aceite pelos critérios da
  // correção; herdar aqueles `covers` gerava `criterion_covers_unknown_acceptance` (Verifier
  // rejected) em TODO sucessor — e marcá-los `gate_assertion` superestimaria afirmações
  // substantivas como provadas por um gate verde.
  test('covers herdados do aceite do original não viajam para o sucessor ⇒ VERIFIED sem violações', () => {
    const ORIGINAL_ACCEPTANCE = 'dedup ordenado preserva a primeira ocorrência';
    const withCovers: WorkItem = {
      ...original,
      proposal: { ...original.proposal, data: { ...original.proposal.data, expectedEffects: [ORIGINAL_ACCEPTANCE] } },
      intent: { execution_spec: {
        ...(original.intent['execution_spec'] as Record<string, unknown>),
        validation_criteria: [{ label: 'test', command: 'npm test --workspace=apps/web -- chat-surface.test.ts', covers: [ORIGINAL_ACCEPTANCE], claim_kind: 'substantive' }],
      } } as WorkItem['intent'],
    };
    const candidate = ok(deriveResumeCorrectionSuccessor(input({ original: withCovers })));
    const spec = readAutonomousExecutionSpec(candidate.intent)!;
    const gate = spec.validationCriteria.find(c => c.label === 'test')!;
    expect(gate.covers).toEqual([FUNCTIONAL]);
    expect(gate.claimKind).toBe('gate_assertion');
    const attemptId = 'b0000000-0000-4000-8000-0000000000ab';
    const handoff = buildWorktreeHandoff({
      workItemId: 'successor-1', attemptId, approvedProposalVersion: 1,
      executorId: 'worktree-v1', backendId: 'fake', model: null,
      baseSha: BASE_SHA, branch: `anima-work/${attemptId}`, commitSha: COMMIT_SHA, status: 'succeeded',
      changedFiles: [TEST], diffFiles: [{ path: TEST, insertions: 8, deletions: 0 }],
      gates: [{ label: 'test', command: gate.command!, exitCode: 0, outcome: 'passed' }],
    });
    if (!handoff.ok) throw new Error(handoff.explanation);
    const observed = buildHostObservedGitEvidence({
      workItemId: 'successor-1', attemptId, approvedProposalVersion: 1,
      baseSha: BASE_SHA, observedCommitSha: COMMIT_SHA,
      observedChangedFiles: [TEST], observedDiffFiles: [{ path: TEST, insertions: 8, deletions: 0 }],
      observedAt: '2026-09-25T06:24:07.000Z',
    });
    if (!observed.ok) throw new Error(observed.explanation);
    const report = verifyWorkResult({
      expected: { workItemId: 'successor-1', attemptId, approvedProposalVersion: 1 },
      authorized: {
        includedScope: candidate.proposal.data.includedScope, excludedScope: candidate.proposal.data.excludedScope,
        validationCriteria: spec.validationCriteria, acceptanceCriteria: candidate.proposal.data.expectedEffects,
      },
      handoff: handoff.value, observed: observed.value,
    });
    expect(report.findings.filter(f => f.code === 'criterion_covers_unknown_acceptance')).toEqual([]);
    expect(report.verdict).toBe('verified');
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

// Revisão humana pode EXIGIR provas adicionais (ex.: o build real do Next.js, que pega
// exports inválidos de Route Handler que jest + tsc não pegam). Só acrescenta prova.
describe('deriveResumeCorrectionSuccessor — gates adicionais exigidos pela revisão', () => {
  const build = { label: 'Gate exigido pela revisão: npm run build --workspace=@anima/web', command: 'npm run build --workspace=@anima/web' };
  const criteriaOf = (candidate: ReturnType<typeof ok>) =>
    (candidate.intent as { execution_spec: { validation_criteria: Array<Record<string, unknown>> } }).execution_spec.validation_criteria;

  test('o gate exigido entra no spec como prova por comando do critério funcional (gate_assertion)', () => {
    const candidate = ok(deriveResumeCorrectionSuccessor(input({ additionalValidations: [build] })));
    const criteria = criteriaOf(candidate);
    expect(criteria).toContainEqual(expect.objectContaining({
      label: build.label, command: build.command, proof: 'gate', claim_kind: 'gate_assertion',
      covers: ['As validações declaradas da unidade (gates) passam sobre a correção retomada.'],
    }));
    // Os gates herdados continuam lá (nada é removido nem afrouxado).
    expect(criteria.filter(c => typeof c.command === 'string').map(c => c.command))
      .toEqual(['npm test --workspace=apps/web -- chat-surface.test.ts', build.command]);
    expect(candidate.proposal.data.objective).toContain('Gates adicionais exigidos pela revisão: npm run build --workspace=@anima/web');
    expect(validateCorrectionSuccessor(original, candidate)).toMatchObject({ valid: true });
  });

  test('gate repetido ou já herdado não duplica', () => {
    const inherited = { label: 'dup', command: 'npm test --workspace=apps/web -- chat-surface.test.ts' };
    const candidate = ok(deriveResumeCorrectionSuccessor(input({ additionalValidations: [build, build, inherited] })));
    expect(criteriaOf(candidate).filter(c => typeof c.command === 'string')).toHaveLength(2);
  });

  test('gate sem rótulo ou comando é recusado (fail-closed)', () => {
    const result = deriveResumeCorrectionSuccessor(input({ additionalValidations: [{ label: ' ', command: 'npm run build' }] }));
    expect(result).toMatchObject({ ok: false, refusals: expect.arrayContaining(['additional_validation_invalid']) });
  });

  test('sem gates adicionais o candidato é idêntico ao anterior (compatibilidade)', () => {
    expect(ok(deriveResumeCorrectionSuccessor(input({ additionalValidations: [] })))).toEqual(ok(deriveResumeCorrectionSuccessor(input())));
  });
});


describe('validateStructuredReworkPaths — autoridade explícita fail-closed', () => {
  test('lista vazia recusa', () => {
    expect(validateStructuredReworkPaths([], [IMPL, TEST], [])).toEqual({ ok: false, refusals: ['rework_paths_empty'] });
  });
  test.each(['', '   ', '/abs.ts', 'C:relative.ts', 'C:\\abs.ts', '../file.ts', 'a/../file.ts',
    'a..ts', 'a//b.ts', 'a/./b.ts', 'a/', '././a.ts', '*', '?', '[a]', ']a', '{a}', 'a}'])('recusa malformed: %s', path => {
    expect(validateStructuredReworkPaths([path], [path], [])).toEqual({ ok: false, refusals: ['rework_paths_malformed'] });
  });
  test.each(['chat-surface.ts', 'apps/web/lib/ai', `${IMPL}.extra`, 'fora.ts'])('não aceita basename, substring ou path alheio: %s', path => {
    expect(validateStructuredReworkPaths([path], [IMPL, TEST], [])).toEqual({ ok: false, refusals: ['rework_paths_not_in_scope'] });
  });
  test('exclusão prevalece sobre inclusão pela mesma chave', () => {
    expect(validateStructuredReworkPaths([IMPL], [IMPL, TEST], [IMPL.toUpperCase()])).toEqual({ ok: false, refusals: ['rework_paths_excluded'] });
  });
  test('canonicaliza, deduplica e emite grafia/ordem aprovadas', () => {
    const paths = [TEST, `  ./${IMPL} `.replace(/\//g, '\\'), IMPL.toUpperCase(), TEST];
    expect(validateStructuredReworkPaths(paths, [IMPL, TEST], [])).toEqual({ ok: true, reworkFiles: [IMPL, TEST] });
    expect(validateStructuredReworkPaths([...paths].reverse(), [IMPL, TEST], [])).toEqual({ ok: true, reworkFiles: [IMPL, TEST] });
  });
  test('acumula recusas estáveis sem emitir autoridade parcial', () => {
    expect(validateStructuredReworkPaths(['*', 'fora.ts', IMPL, '*'], [IMPL, TEST], [IMPL])).toEqual({
      ok: false, refusals: ['rework_paths_malformed', 'rework_paths_not_in_scope', 'rework_paths_excluded'],
    });
  });
});

test('auditoria estruturada é a única diferença do spec para os mesmos fatos de correção', () => {
  const legacy = ok(deriveResumeCorrectionSuccessor(input({ reworkFiles: [IMPL] })));
  const structured = ok(deriveResumeCorrectionSuccessor(input({ reworkFiles: [IMPL], reworkSource: 'structured' })));
  const legacySpec = legacy.intent['execution_spec'] as Record<string, unknown>;
  const structuredSpec = structured.intent['execution_spec'] as Record<string, unknown>;
  expect(structured).toEqual({ ...legacy, intent: { ...legacy.intent, execution_spec: {
    ...legacySpec, correction_scope: { ...(legacySpec['correction_scope'] as Record<string, unknown>), rework_source: 'structured' },
  } } });
  expect(legacySpec['correction_scope']).not.toHaveProperty('rework_source');
  expect(structuredSpec['resume_from_checkpoint']).toEqual(legacySpec['resume_from_checkpoint']);
  expect(structuredSpec['validation_criteria']).toEqual(legacySpec['validation_criteria']);
  expect(structured.recoverySequence).toBe(legacy.recoverySequence);
  expect(structured.idempotencyKey).toBe(legacy.idempotencyKey);
});


describe('SDC-05 — autoridade da raiz e reabertura preservada', () => {
  const database = 'packages/types/src/database.ts';
  const rootExcluded = 'packages/core/src/work-orchestration/replan.ts';
  const includedScope = [database, ...Array.from({ length: 11 }, (_, i) => `src/file${i}.ts`)];
  const excludedScope = [rootExcluded, ...Array.from({ length: 7 }, (_, i) => `excluded/file${i}.ts`)];
  const rootAuthority = { includedScope, excludedScope };
  const root = { ...original, proposal: { ...original.proposal, data: { ...original.proposal.data, ...rootAuthority } } };
  const first = ok(deriveResumeCorrectionSuccessor(input({ original: root, preservedFiles: includedScope.slice(0, 8) })));
  const current = { ...root, intent: first.intent, proposal: first.proposal };

  test('SDC-03 real: duas corrections derivadas, exclusões e auditoria preservadas', () => {
    const validation = validateStructuredReworkPaths([database], current.proposal.data.includedScope, current.proposal.data.excludedScope, rootAuthority);
    if (!validation.ok) throw new Error('reabertura recusada');
    expect(validation.reopenedFiles).toEqual([database]);
    const second = ok(deriveResumeCorrectionSuccessor(input({ original: current,
      preservedFiles: includedScope.slice(8, 9), reworkFiles: validation.reworkFiles,
      reopenedFiles: validation.reopenedFiles, reworkSource: 'structured' })));
    expect(second.proposal.data.includedScope).toEqual([...includedScope.slice(9), database]);
    expect(second.proposal.data.excludedScope).not.toContain(database);
    expect(second.proposal.data.excludedScope).toEqual(expect.arrayContaining([...excludedScope, ...includedScope.slice(1, 9)]));
    const spec = second.intent['execution_spec'] as Record<string, unknown>;
    expect(spec['correction_scope']).toMatchObject({ rework_scope: [database], reopened_scope: [database], rework_source: 'structured' });
    expect(spec['resume_from_checkpoint']).toBeDefined();
    expect(validateCorrectionSuccessor(current, second, { rootAuthority })).toMatchObject({ valid: true });
    expect(validateCorrectionSuccessor(current, second)).toMatchObject({ valid: false, gaps: expect.arrayContaining(['correction_scope_invalid']) });
    expect(validateCorrectionSuccessor(current, second, { rootAuthority: { includedScope: [], excludedScope } })).toMatchObject({ valid: false, gaps: expect.arrayContaining(['correction_scope_invalid']) });
  });

  test.each(['never.ts', rootExcluded, '/absolute.ts', '../outside.ts', 'src/*.ts', 'src//file.ts', 'src/./file.ts', '', 'database.ts', 'types/src/database.ts'])('recusa %s', path => {
    expect(validateStructuredReworkPaths([path], current.proposal.data.includedScope, current.proposal.data.excludedScope, rootAuthority).ok).toBe(false);
  });
  test('sem autoridade preserva recusa atual; root-excluded vence inclusão conflitante', () => {
    expect(validateStructuredReworkPaths([database], current.proposal.data.includedScope, current.proposal.data.excludedScope).ok).toBe(false);
    expect(validateStructuredReworkPaths([database], [database], [], { includedScope: [database], excludedScope: [database] }).ok).toBe(false);
    expect(deriveRootAuthorityScope({ includedScope: ['Src/A.ts', 'src/b.ts'], excludedScope: ['SRC\\B.TS'] })).toEqual(['Src/A.ts']);
  });
  test('canonicaliza pela chave, emite ordem e grafia da raiz', () => {
    expect(validateStructuredReworkPaths([' ./PACKAGES\\TYPES\\SRC\\DATABASE.TS ', database], [], [database], rootAuthority))
      .toEqual({ ok: true, reworkFiles: [database], reopenedFiles: [database] });
  });
  test('não adiciona chave aos specs legado ou estruturado sem reabertura', () => {
    for (const reworkSource of [undefined, 'structured' as const]) {
      const candidate = ok(deriveResumeCorrectionSuccessor(input({ reworkFiles: [TEST], reworkSource })));
      expect((candidate.intent['execution_spec'] as Record<string, unknown>)['correction_scope']).not.toHaveProperty('reopened_scope');
    }
  });
});


describe('preservação cumulativa multinível', () => {
  const inherited = 'packages/types/src/database.ts';
  const rootAuthority = { includedScope: [IMPL, TEST, inherited, 'root-excluded.ts'], excludedScope: ['root-excluded.ts'] };
  const hop: WorkItem = { ...original, proposal: { ...original.proposal, data: {
    ...original.proposal.data, excludedScope: [...original.proposal.data.excludedScope, inherited],
  } }, intent: { execution_spec: { ...(original.intent['execution_spec'] as object), correction_scope: {} } } };
  const classify = (overrides: Partial<Parameters<typeof classifyCumulativeCorrectionFiles>[0]> = {}) => classifyCumulativeCorrectionFiles({
    observedChangedFiles: [IMPL, inherited, 'unexpected.ts', 'root-excluded.ts'],
    includedScope: [IMPL, TEST], excludedScope: [inherited, 'root-excluded.ts'], reopenedFiles: [],
    rootAuthority, isCorrectionHop: true, ...overrides,
  });
  test('classifica toda a evidência em ordem e grafia de origem por pathKey', () => {
    expect(classify()).toEqual({ preserved: [IMPL], inherited: [inherited], unexplained: ['unexpected.ts', 'root-excluded.ts'] });
    expect(classify({ observedChangedFiles: [inherited.toUpperCase().replace(/\//g, '\\'), TEST], reopenedFiles: [inherited] })).toEqual({
      preserved: [inherited.toUpperCase().replace(/\//g, '\\'), TEST], inherited: [], unexplained: [],
    });
  });
  test.each([{ rootAuthority: null }, { isCorrectionHop: false }, { excludedScope: [] }])('sem prova suficiente não herda: %j', overrides => {
    expect(classify(overrides).inherited).toEqual([]);
    expect(classify(overrides).unexplained).toContain(inherited);
  });
  const candidate = () => ok(deriveResumeCorrectionSuccessor(input({ original: hop, inheritedPreservedFiles: [inherited] })));
  test('herdado permanece exclu?do sem duplicação e sem autoridade efetiva', () => {
    const result = candidate();
    expect(result.proposal.data.includedScope).toEqual([TEST]);
    expect(result.proposal.data.excludedScope.filter(file => file === inherited)).toEqual([inherited]);
    expect((result.intent['execution_spec'] as Record<string, unknown>)['correction_scope']).toMatchObject({ inherited_preserved_scope: [inherited] });
    expect((ok(deriveResumeCorrectionSuccessor(input())).intent['execution_spec'] as Record<string, Record<string, unknown>>)['correction_scope']).not.toHaveProperty('inherited_preserved_scope');
    expect(validateCorrectionSuccessor(hop, result, { rootAuthority, observedChangedFiles: [IMPL, inherited] })).toMatchObject({ valid: true });
    expect(validateCorrectionSuccessor(hop, result, { rootAuthority })).toMatchObject({ valid: true });
    expect(validateCorrectionSuccessor(hop, result)).toMatchObject({ valid: false, gaps: expect.arrayContaining(['correction_scope_invalid']) });
  });
  test('revalida independentemente predecessor, raiz, excluded e evidência cumulativa', () => {
    const result = candidate();
    for (const predecessor of [original, { ...hop, proposal: { ...hop.proposal, data: { ...hop.proposal.data, includedScope: [IMPL, TEST, inherited] } } },
      { ...hop, proposal: { ...hop.proposal, data: { ...hop.proposal.data, excludedScope: [] } } }]) {
      expect(validateCorrectionSuccessor(predecessor, result, { rootAuthority })).toMatchObject({ valid: false, gaps: expect.arrayContaining(['correction_scope_invalid']) });
    }
    expect(validateCorrectionSuccessor(hop, result, { rootAuthority: { ...rootAuthority, excludedScope: [inherited] } })).toMatchObject({ valid: false });
    expect(validateCorrectionSuccessor(hop, result, { rootAuthority, observedChangedFiles: [IMPL, inherited, 'unexpected.ts'] })).toMatchObject({ valid: false, gaps: expect.arrayContaining(['correction_scope_invalid']) });
    for (const field of ['rework_scope', 'remaining_scope', 'effective_scope', 'inherited_preserved_scope']) {
      const forged = JSON.parse(JSON.stringify(result)) as typeof result;
      const scope = (forged.intent['execution_spec'] as Record<string, Record<string, unknown>>)['correction_scope']!;
      scope[field] = field === 'inherited_preserved_scope' ? [IMPL] : [inherited];
      expect(validateCorrectionSuccessor(hop, forged, { rootAuthority })).toMatchObject({ valid: false, gaps: expect.arrayContaining(['correction_scope_invalid']) });
    }
    for (const data of [{ ...result.proposal.data, includedScope: [TEST, inherited] }, { ...result.proposal.data, excludedScope: [] }]) {
      expect(validateCorrectionSuccessor(hop, { ...result, proposal: { ...result.proposal, data } }, { rootAuthority })).toMatchObject({ valid: false });
    }
  });
});
