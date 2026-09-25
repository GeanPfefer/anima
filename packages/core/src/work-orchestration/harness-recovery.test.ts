import { readHarnessDefectRecoveryAuthorization } from './harness-recovery';

const valid = {
  schemaVersion: 1, kind: 'harness_defect_fixed_v1', requestId: '96000000-0000-4000-8000-0000000000b1',
  reason: 'Defeito de harness corrigido: diff de arquivo novo', failureClass: 'harness',
  fixCommits: ['d17dcbe'.padEnd(40, '0')], evidenceReference: 'docs/registros/2026-09-25g-x.md', additionalAttempts: 1,
};

describe('readHarnessDefectRecoveryAuthorization', () => {
  test('aceita a autoridade canônica', () => { expect(readHarnessDefectRecoveryAuthorization(valid)).toEqual(valid); });
  test.each([
    ['falha de modelo não é recuperação de harness', { failureClass: 'model' }],
    ['mais de uma tentativa', { additionalAttempts: 2 }],
    ['commit abreviado', { fixCommits: ['d17dcbe'] }],
    ['commits repetidos', { fixCommits: ['a'.repeat(40), 'a'.repeat(40)] }],
    ['sem commit', { fixCommits: [] }],
    ['evidência fora de docs/registros', { evidenceReference: 'notes.md' }],
    ['motivo vago', { reason: 'fix' }],
    ['requestId inválido', { requestId: 'x' }],
  ])('recusa %s', (_label, patch) => { expect(readHarnessDefectRecoveryAuthorization({ ...valid, ...patch })).toBeNull(); });
  test('recusa campos extras (ex.: dinheiro misturado à recuperação)', () => {
    expect(readHarnessDefectRecoveryAuthorization({ ...valid, maxUsd: 3 })).toBeNull();
  });
});
