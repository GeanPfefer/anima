import { readHumanResumeAuthorization, type HumanResumeAuthorization } from './human-resume';

// Autoridade humana de retomada (V1): um codec PURO e fail-closed. A prova aqui é
// determinística — vocabulário fechado, faixas fixas, sem I/O. O contrato inteiro
// tem de estar presente e bem-formado; qualquer campo fora do previsto invalida.
const REF = 'docs/registros/2026-09-02-recovery-budget-transferido-esgotado.md';
const validDiagnosis = () => ({
  reference: REF,
  priorApiAssumption: 'exports_absent',
  correctedApiAssumption: 'exports_present',
  apiPath: 'packages/core/src/project-intake.ts',
  exports: ['parseProjectIntake', 'serializeProjectIntake'],
  syntaxFailure: 'unbalanced_block',
  anchorFailure: 'no_match_cause_unproven',
});
const validCompute = () => ({ placement: 'local', preferred: 'qwen3-coder:latest', fallback: 'qwen2.5-coder:14b', paid: false });
const base = (overrides: Record<string, unknown> = {}): unknown => ({
  schemaVersion: 1,
  requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  reason: 'Retomada humana limitada apos revisar a nova evidencia.',
  additionalAttempts: 1,
  aggregateCeiling: 4,
  diagnosis: validDiagnosis(),
  planRevision: 'inspect_existing_exports_and_current_reads_v1',
  compute: validCompute(),
  ...overrides,
});
const withDiagnosis = (o: Record<string, unknown>) => base({ diagnosis: { ...validDiagnosis(), ...o } });
const withCompute = (o: Record<string, unknown>) => base({ compute: { ...validCompute(), ...o } });

describe('readHumanResumeAuthorization — validação fail-closed', () => {
  test('aceita uma autorização bem-formada e a devolve verbatim', () => {
    const v = base();
    expect(readHumanResumeAuthorization(v)).toBe(v);
  });

  test('é determinístico: a mesma entrada devolve o mesmo resultado', () => {
    const v = base();
    expect(readHumanResumeAuthorization(v)).toBe(readHumanResumeAuthorization(v));
  });

  test.each([null, undefined, 42, 'x', [], [base()]])('entrada não-objeto (%p) é rejeitada', (v) => {
    expect(readHumanResumeAuthorization(v)).toBeNull();
  });

  test('rejeita chave extra no topo', () => {
    expect(readHumanResumeAuthorization(base({ extra: 1 }))).toBeNull();
  });

  test.each(['schemaVersion', 'requestId', 'reason', 'additionalAttempts', 'aggregateCeiling', 'diagnosis', 'planRevision', 'compute'])(
    'rejeita ausência do campo obrigatório %s',
    (field) => {
      const v = base() as Record<string, unknown>;
      delete v[field];
      expect(readHumanResumeAuthorization(v)).toBeNull();
    },
  );

  test('schemaVersion deve ser exatamente 1', () => {
    expect(readHumanResumeAuthorization(base({ schemaVersion: 2 }))).toBeNull();
    expect(readHumanResumeAuthorization(base({ schemaVersion: '1' }))).toBeNull();
  });

  test.each(['not-a-uuid', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', 'aaaaaaaa-aaaa-4aaa-8aaa'])('rejeita requestId não-UUID (%p)', (requestId) => {
    expect(readHumanResumeAuthorization(base({ requestId }))).toBeNull();
  });

  test('reason exige entre 10 e 500 caracteres (trim)', () => {
    expect(readHumanResumeAuthorization(base({ reason: 'curto' }))).toBeNull();
    expect(readHumanResumeAuthorization(base({ reason: '         x        ' }))).toBeNull();
    expect(readHumanResumeAuthorization(base({ reason: 'a'.repeat(501) }))).toBeNull();
    expect(readHumanResumeAuthorization(base({ reason: 42 }))).toBeNull();
  });

  test('additionalAttempts é fixo em 1 (nunca reseta o teto)', () => {
    expect(readHumanResumeAuthorization(base({ additionalAttempts: 2 }))).toBeNull();
    expect(readHumanResumeAuthorization(base({ additionalAttempts: 0 }))).toBeNull();
  });

  test.each([1, 5, 3.5, '4'])('aggregateCeiling fora de {2,3,4} inteiro é rejeitado (%p)', (aggregateCeiling) => {
    expect(readHumanResumeAuthorization(base({ aggregateCeiling }))).toBeNull();
  });

  test.each([2, 3, 4])('aggregateCeiling %p é aceito', (aggregateCeiling) => {
    expect(readHumanResumeAuthorization(base({ aggregateCeiling }))).not.toBeNull();
  });

  test('planRevision é um vocabulário fechado', () => {
    expect(readHumanResumeAuthorization(base({ planRevision: 'outro' }))).toBeNull();
  });

  // --- diagnosis ---
  test('rejeita chave extra ou ausente no diagnosis', () => {
    expect(readHumanResumeAuthorization(withDiagnosis({ extra: 1 }))).toBeNull();
    const v = base() as Record<string, unknown>;
    const d = { ...validDiagnosis() } as Record<string, unknown>;
    delete d.apiPath;
    expect(readHumanResumeAuthorization({ ...v, diagnosis: d })).toBeNull();
  });

  test.each([
    'diagnosis.md',
    'docs/registros/../secret.md',
    'docs/registros/nome.txt',
    'docs/outro/nome.md',
  ])('reference deve casar docs/registros/<slug>.md (%p rejeitado)', (reference) => {
    expect(readHumanResumeAuthorization(withDiagnosis({ reference }))).toBeNull();
  });

  test('priorApiAssumption/correctedApiAssumption são vocabulário fechado', () => {
    expect(readHumanResumeAuthorization(withDiagnosis({ priorApiAssumption: 'exports_present' }))).toBeNull();
    expect(readHumanResumeAuthorization(withDiagnosis({ correctedApiAssumption: 'exports_absent' }))).toBeNull();
  });

  test('syntaxFailure/anchorFailure são vocabulário fechado', () => {
    expect(readHumanResumeAuthorization(withDiagnosis({ syntaxFailure: 'other' }))).toBeNull();
    expect(readHumanResumeAuthorization(withDiagnosis({ anchorFailure: 'known' }))).toBeNull();
  });

  test.each([
    '/etc/passwd.ts',
    'packages/../secret.ts',
    'packages/core/src/impl.py',
    'packages/core/src/impl',
  ])('apiPath deve ser um caminho relativo .ts/.tsx (%p rejeitado)', (apiPath) => {
    expect(readHumanResumeAuthorization(withDiagnosis({ apiPath }))).toBeNull();
  });

  test('exports: 1 a 8, únicos, identificadores válidos', () => {
    expect(readHumanResumeAuthorization(withDiagnosis({ exports: [] }))).toBeNull();
    expect(readHumanResumeAuthorization(withDiagnosis({ exports: Array.from({ length: 9 }, (_, i) => `e${i}`) }))).toBeNull();
    expect(readHumanResumeAuthorization(withDiagnosis({ exports: ['dup', 'dup'] }))).toBeNull();
    expect(readHumanResumeAuthorization(withDiagnosis({ exports: ['1bad'] }))).toBeNull();
    expect(readHumanResumeAuthorization(withDiagnosis({ exports: ['ok', 42] }))).toBeNull();
    expect(readHumanResumeAuthorization(withDiagnosis({ exports: ['valid_$Name'] }))).not.toBeNull();
  });

  // --- compute ---
  test('rejeita chave extra ou ausente no compute', () => {
    expect(readHumanResumeAuthorization(withCompute({ extra: 1 }))).toBeNull();
    const c = { ...validCompute() } as Record<string, unknown>;
    delete c.fallback;
    expect(readHumanResumeAuthorization(base({ compute: c }))).toBeNull();
  });

  test('compute.placement deve ser local (sem cloud/burst)', () => {
    expect(readHumanResumeAuthorization(withCompute({ placement: 'remote' }))).toBeNull();
  });

  test('compute.paid deve ser false (sem compute pago)', () => {
    expect(readHumanResumeAuthorization(withCompute({ paid: true }))).toBeNull();
  });

  test('compute.preferred/fallback devem casar o padrão de modelo', () => {
    expect(readHumanResumeAuthorization(withCompute({ preferred: 'bad model!' }))).toBeNull();
    expect(readHumanResumeAuthorization(withCompute({ fallback: '' }))).toBeNull();
    expect(readHumanResumeAuthorization(withCompute({ preferred: 'a'.repeat(101) }))).toBeNull();
  });

  test('o tipo estreitado expõe additionalAttempts:1 e placement local', () => {
    const parsed = readHumanResumeAuthorization(base()) as HumanResumeAuthorization;
    expect(parsed.additionalAttempts).toBe(1);
    expect(parsed.compute.placement).toBe('local');
    expect(parsed.compute.paid).toBe(false);
  });
});
