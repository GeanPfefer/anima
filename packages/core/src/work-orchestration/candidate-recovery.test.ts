import {
  deriveCandidateRecoveryCheckpoint,
  isRelativeRepoPath,
  readCandidateRecoveryAuthorization,
} from './candidate-recovery';

const ATTEMPT = '96000000-0000-4000-8000-0000000000a1';
const valid = (): Record<string, unknown> => ({
  schemaVersion: 1,
  kind: 'production_candidate_incorrect_v1',
  requestId: '96000000-0000-4000-8000-0000000000b1',
  reason: 'Candidato com erro de tipo real em produção',
  finding: 'production_candidate_incorrect',
  candidateCommitSha: 'a'.repeat(40),
  sourceAttemptId: ATTEMPT,
  gate: { label: 'typecheck', command: 'npm run typecheck --workspace=apps/web', exitCode: 2 },
  location: { path: 'apps/web/lib/x.ts', line: 12 },
  observedError: "TS2322: Type 'string' is not assignable to type 'number'.",
  evidenceReference: 'docs/registros/2026-10-03-x.md',
  corrections: [{ kind: 'type_error', instruction: 'Alinhar o tipo retornado ao contrato público.' }],
  additionalAttempts: 1,
});
const withChange = (change: Record<string, unknown>) => ({ ...valid(), ...change });

describe('readCandidateRecoveryAuthorization', () => {
  test('aceita autorização válida (com e sem line)', () => {
    expect(readCandidateRecoveryAuthorization(valid())).not.toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ location: { path: 'a/b.ts' } }))).not.toBeNull();
  });

  test('recusa chave extra e chave ausente', () => {
    expect(readCandidateRecoveryAuthorization(withChange({ extra: 1 }))).toBeNull();
    const { reason: _reason, ...missing } = valid();
    expect(readCandidateRecoveryAuthorization(missing)).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ gate: { label: 'a', command: 'b', exitCode: 1, x: 1 } }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ location: { path: 'a.ts', extra: 1 } }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ corrections: [{ kind: 'type_error', instruction: 'Corrigir o tipo.', x: 1 }] }))).toBeNull();
  });

  test('recusa não-objeto', () => {
    for (const value of [null, undefined, 'x', 1, [], [valid()]]) expect(readCandidateRecoveryAuthorization(value)).toBeNull();
  });

  test('recusa schemaVersion, kind, finding e additionalAttempts inválidos', () => {
    expect(readCandidateRecoveryAuthorization(withChange({ schemaVersion: 2 }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ kind: 'harness_defect_fixed_v1' }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ finding: 'test_code_incorrect' }))).toBeNull();
    for (const n of [0, 2, '1', null]) expect(readCandidateRecoveryAuthorization(withChange({ additionalAttempts: n }))).toBeNull();
  });

  test('recusa kind de correção fora do enum e repetido', () => {
    expect(readCandidateRecoveryAuthorization(withChange({ corrections: [{ kind: 'resolve_imports', instruction: 'Resolver os imports.' }] }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ corrections: [
      { kind: 'type_error', instruction: 'Alinhar o tipo retornado.' },
      { kind: 'type_error', instruction: 'Alinhar outro tipo retornado.' },
    ] }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ corrections: [
      { kind: 'type_error', instruction: 'Alinhar o tipo retornado.' },
      { kind: 'test_failure', instruction: 'Corrigir a asserção falha.' },
      { kind: 'build_error', instruction: 'Corrigir o erro de build.' },
    ] }))).not.toBeNull();
  });

  test('recusa corrections vazias ou acima de 3', () => {
    expect(readCandidateRecoveryAuthorization(withChange({ corrections: [] }))).toBeNull();
    const four = ['type_error', 'test_failure', 'build_error', 'behavior_gap'].map(kind => ({ kind, instruction: 'Instrução suficiente.' }));
    expect(readCandidateRecoveryAuthorization(withChange({ corrections: four }))).toBeNull();
  });

  test('recusa path absoluto, com .. ou malformado', () => {
    for (const path of ['/etc/passwd', 'C:/x.ts', '../x.ts', 'a/../x.ts', 'a\\b.ts', '', 'a//b.ts', './a.ts']) {
      expect(readCandidateRecoveryAuthorization(withChange({ location: { path } }))).toBeNull();
    }
    expect(isRelativeRepoPath('apps/web/a.ts')).toBe(true);
    expect(isRelativeRepoPath(3)).toBe(false);
  });

  test('recusa line inválida', () => {
    for (const line of [0, -1, 1.5, '3']) expect(readCandidateRecoveryAuthorization(withChange({ location: { path: 'a.ts', line } }))).toBeNull();
  });

  test('recusa sha e UUID inválidos', () => {
    expect(readCandidateRecoveryAuthorization(withChange({ candidateCommitSha: 'abc' }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ candidateCommitSha: 'A'.repeat(40) }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ requestId: 'nao-uuid' }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ sourceAttemptId: 'nao-uuid' }))).toBeNull();
  });

  test('aplica limites de tamanho', () => {
    expect(readCandidateRecoveryAuthorization(withChange({ reason: 'curto' }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ reason: 'x'.repeat(501) }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ reason: 'x'.repeat(500) }))).not.toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ observedError: 'curto' }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ observedError: 'x'.repeat(401) }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ corrections: [{ kind: 'type_error', instruction: 'curta' }] }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ corrections: [{ kind: 'type_error', instruction: 'x'.repeat(601) }] }))).toBeNull();
  });

  test('recusa evidenceReference fora de docs/registros e gate malformado', () => {
    expect(readCandidateRecoveryAuthorization(withChange({ evidenceReference: 'docs/outro/x.md' }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ evidenceReference: 'docs/registros/../x.md' }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ gate: { label: '', command: 'npm test', exitCode: 1 } }))).toBeNull();
    expect(readCandidateRecoveryAuthorization(withChange({ gate: { label: 'a', command: 'npm test', exitCode: 1.5 } }))).toBeNull();
  });
});

describe('deriveCandidateRecoveryCheckpoint', () => {
  test('deriva base, commit e branch da attempt de origem', () => {
    expect(deriveCandidateRecoveryCheckpoint({ baseSha: 'b'.repeat(40), candidateCommitSha: 'a'.repeat(40), sourceAttemptId: ATTEMPT }))
      .toEqual({ base_sha: 'b'.repeat(40), commit_sha: 'a'.repeat(40), branch: `anima-work/${ATTEMPT}` });
  });
  test('recusa base igual ao commit e valores inválidos', () => {
    expect(deriveCandidateRecoveryCheckpoint({ baseSha: 'a'.repeat(40), candidateCommitSha: 'a'.repeat(40), sourceAttemptId: ATTEMPT })).toBeNull();
    expect(deriveCandidateRecoveryCheckpoint({ baseSha: 'x', candidateCommitSha: 'a'.repeat(40), sourceAttemptId: ATTEMPT })).toBeNull();
    expect(deriveCandidateRecoveryCheckpoint({ baseSha: 'b'.repeat(40), candidateCommitSha: 'a'.repeat(40), sourceAttemptId: 'x' })).toBeNull();
  });
});
