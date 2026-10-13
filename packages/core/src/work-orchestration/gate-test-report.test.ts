import type { Json } from '@anima/types';
import { deriveGateTestReport, parseGateTestReport, sha256Hex, GATE_TEST_REPORT_LIMITS } from './gate-test-report';

const assertion = (fullName: string, status = 'passed', invocations = 1, failureMessages: string[] = []) => ({
  fullName, title: fullName.split(' ').pop()!, ancestorTitles: ['nested', 'suite'],
  status, invocations, failureMessages, retryReasons: [],
});
const fixture = () => ({
  numTotalTestSuites: 3, numFailedTestSuites: 2, numRuntimeErrorTestSuites: 1,
  numTotalTests: 5, numPassedTests: 2, numFailedTests: 1, numPendingTests: 1, numTodoTests: 1, success: false,
  testResults: [
    { name: '/repo/z.test.ts', status: 'failed', message: 'one assertion failed', assertionResults: [
      assertion('nested suite fails', 'failed', 1, ['\u001b[31mFailure at /home/alice/repo/z.test.ts:4\u001b[0m\npassword=private\nBearer token\nsk-secret']),
      assertion('nested suite pending', 'pending'), assertion('nested suite todo', 'todo'),
      assertion('nested suite flaky', 'passed', 2),
    ] },
    { name: '/repo/import.test.ts', status: 'failed', message: 'import failed /home/alice/private', assertionResults: [] },
    { name: '/repo/a.test.ts', status: 'focused', message: '', assertionResults: [assertion('nested suite passes')] },
  ],
});
const derive = (raw: unknown = fixture(), rootDir = '/repo') => deriveGateTestReport(raw, { rootDir });
const report = () => { const r = derive(); if (r.status !== 'ok') throw new Error(r.reason); return r.report; };
const json = (v: unknown): Json => JSON.parse(JSON.stringify(v)) as Json;
const expectReason = (v: unknown, reason: string) => expect(derive(v)).toEqual({ status: 'indeterminate', reason });

const many = (count: number) => ({
  numTotalTestSuites: 1, numFailedTestSuites: 0, numRuntimeErrorTestSuites: 0,
  numTotalTests: count, numPassedTests: count, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true,
  testResults: [{ name: '/repo/a.test.ts', status: 'passed', message: '', assertionResults: Array.from({ length: count }, (_, i) => assertion(`test ${i}`)) }],
});

describe('SHA-256 puro', () => {
  test.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['Olá 🌍', 'e6585f4e6608e1d4b4465dcc945c22ab064cf721d05b858add808226542d8478'],
    ['a'.repeat(1000000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
  ])('vetor conhecido %#', (input, expected) => { expect(sha256Hex(input)).toBe(expected); });
  test('substitui surrogates isolados como UTF-8', () => {
    expect(sha256Hex('\ud800')).toBe(sha256Hex('\ufffd'));
    expect(sha256Hex('\udc00')).toBe(sha256Hex('\ufffd'));
  });
});

describe('deriveGateTestReport', () => {
  test('forma Jest 29, runtime error, focused, retry sem retryReasons e sanitização', () => {
    const r = report();
    expect(r.files.map(f => f.path)).toEqual(['a.test.ts', 'import.test.ts', 'z.test.ts']);
    expect(r.files[0]!.suiteStatus).toBe('focused');
    expect(r.files[1]).toMatchObject({ runtimeError: true, tests: [] });
    expect(r.files[2]!.tests.find(t => t.fullName.endsWith('flaky'))).toMatchObject({ invocations: 2, retried: true });
    expect(r.files[2]!.tests.find(t => t.status === 'failed')!.failure).toBe('Failure at <path> [redacted] [redacted] [redacted]');
    expect(r.totals).toEqual({ suites: 3, suitesFailed: 2, suitesRuntimeError: 1, tests: 5,
      passed: 2, failed: 1, pending: 1, skipped: 0, todo: 1, disabled: 0 });
    expect(r.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(r.digest).toBe(sha256Hex(JSON.stringify({ files: r.files, totals: r.totals })));
    expect(JSON.stringify(r)).not.toMatch(/\/repo|alice|retryReasons|commit|command|rootDir/);
  });
  test('ordenação e digest independem da ordem recebida, sem mutar input', () => {
    const raw = fixture(), original = JSON.stringify(raw);
    const shuffled = fixture(); shuffled.testResults.reverse();
    shuffled.testResults.forEach(f => f.assertionResults.reverse());
    expect(derive(shuffled)).toEqual(derive(raw));
    expect(JSON.stringify(raw)).toBe(original);
  });
  test.each(['skipped', 'disabled'])('status defensivo %s participa do contador pending do Jest', status => {
    const raw = fixture(); raw.testResults[0]!.assertionResults[1]!.status = status;
    const r = derive(raw); expect(r.status).toBe('ok');
    if (r.status === 'ok') { expect(r.report.totals.pending).toBe(0); expect(r.report.totals[status as 'skipped' | 'disabled']).toBe(1); }
  });
  test.each([null, [], 'text', 1, {}, { testResults: [] }])('entrada malformada %p', raw => expectReason(raw, 'malformed'));
  test.each(['fullName', 'title', 'ancestorTitles', 'status', 'invocations', 'failureMessages'])('assertion sem %s', field => {
    const raw = json(fixture()) as Record<string, unknown>;
    const suites = raw.testResults as { assertionResults: Record<string, unknown>[] }[];
    delete suites[0]!.assertionResults[0]![field]; expectReason(raw, 'malformed');
  });
  test('getters hostis nunca escapam', () => {
    expectReason({ get testResults(): unknown { throw new Error('hostile'); } }, 'malformed');
  });
  test('status desconhecido', () => { const r = fixture(); r.testResults[0]!.assertionResults[0]!.status = 'wat'; expectReason(r, 'unknown_status'); });
  test.each(['numTotalTestSuites', 'numFailedTestSuites', 'numRuntimeErrorTestSuites', 'numTotalTests',
    'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests'] as const)('inconsistência %s', field => {
    const r = fixture(); r[field]++; expectReason(r, 'inconsistent_totals');
  });
  test.each(['numTotalTests', 'success', 'testResults'])('tipo errado no topo %s', field => {
    expectReason({ ...fixture(), [field]: 'wrong' }, 'malformed');
  });
  test('success contraditório', () => expectReason({ ...fixture(), success: true }, 'inconsistent_totals'));
  test('runtime error sozinho contradiz success', () => {
    const r = many(1); r.testResults.push({ name: '/repo/import.ts', status: 'failed', message: 'bad import', assertionResults: [] });
    r.numTotalTestSuites = 2; r.numFailedTestSuites = 1; r.numRuntimeErrorTestSuites = 1;
    expectReason(r, 'inconsistent_totals');
  });
  test('arquivo duplicado', () => { const r = fixture(); r.testResults[1]!.name = r.testResults[0]!.name; expectReason(r, 'duplicate_file'); });
  test('teste duplicado na mesma suíte', () => { const r = fixture(); r.testResults[0]!.assertionResults[1]!.fullName = r.testResults[0]!.assertionResults[0]!.fullName; expectReason(r, 'duplicate_test'); });
  test.each(['/other/a.ts', '/repository/a.ts', '/repo/../a.ts', '/repo/a/../b.ts', 'a.ts', '/repo/./a.ts', '/repo//a.ts'])('path suspeito %s', name => {
    const r = fixture(); r.testResults[0]!.name = name; expectReason(r, 'path_outside_root');
  });
  test('raiz Windows case insensitive e barras mistas', () => {
    const r = fixture(); r.testResults.forEach(f => { f.name = f.name.replace('/repo/', 'c:\\REPO\\nested\\'); });
    const result = derive(r, 'C:\\repo\\'); expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.report.files[0]!.path).toBe('nested/a.test.ts');
  });
  test.each(['password=hidden', 'Bearer hidden', 'sk-hidden', '/home/alice/private'])('segredo no fullName %s', fullName => {
    const r = fixture(); r.testResults[0]!.assertionResults[0]!.fullName = fullName; expectReason(r, 'sensitive_data');
  });
  test('segredo no path', () => { const r = fixture(); r.testResults[0]!.name = '/repo/password=hidden.ts'; expectReason(r, 'sensitive_data'); });
  test('redige credenciais, chave privada multiline e caminhos Windows/POSIX antes de truncar', () => {
    const r = fixture(); r.testResults[0]!.assertionResults[0]!.failureMessages = [
      'at C:\\Users\\Alice\\test.ts:2\nhttps://user:pass@host\n-----BEGIN PRIVATE KEY-----\nsecret material\n-----END PRIVATE KEY-----\nat (/opt/repo/file.ts:3)\n' + 'x'.repeat(600), 'ignored',
    ];
    const result = derive(r); expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      const text = result.report.files[2]!.tests.find(t => t.status === 'failed')!.failure!;
      expect(text.length).toBe(500); expect(text).not.toMatch(/Alice|user:pass|secret material|\/opt|ignored/);
      expect(text).toContain('<path>'); expect(text).toContain('[redacted]');
      expect(parseGateTestReport(json(result.report))).toEqual(result.report);
    }
  });
  test('relatório vazio ou sem assertions', () => {
    const r = many(0); expectReason(r, 'empty_report'); r.numTotalTestSuites = 0; r.testResults = []; expectReason(r, 'empty_report');
  });
  test('limite arquivos', () => {
    const r = many(1); r.testResults = Array.from({ length: 201 }, (_, i) => ({ ...r.testResults[0]!, name: `/repo/${i}.ts` })); expectReason(r, 'too_large');
  });
  test('limite testes total e assertions sem confiar no topo', () => {
    expectReason(many(2001), 'too_large'); const r = many(2001); r.numTotalTests = 1; expectReason(r, 'too_large');
    expect(derive(many(2000)).status).toBe('ok');
  });
  test('limite fullName', () => { const r = fixture(); r.testResults[0]!.assertionResults[0]!.fullName = 'x'.repeat(401); expectReason(r, 'too_large'); });
  test('limite path relativo', () => { const r = fixture(); r.testResults[0]!.name = '/repo/' + 'x'.repeat(301); expectReason(r, 'too_large'); });
  test('limites públicos', () => expect(GATE_TEST_REPORT_LIMITS).toEqual({ maxFiles: 200, maxTests: 2000, maxFullName: 400, maxPath: 300, maxFailureText: 500, maxTotalTestsPerEvidence: 4000 }));
});

describe('parseGateTestReport fail-closed', () => {
  test('roundtrip e ordem de chaves externa irrelevante', () => {
    const r = report(); expect(parseGateTestReport(json(r))).toEqual(r);
    expect(parseGateTestReport(json({ digest: r.digest, totals: r.totals, files: r.files, source: r.source, runner: r.runner, schemaVersion: 1 }))).toEqual(r);
  });
  test.each([undefined, null, [], 'text', 12])('recusa %p', value => expect(parseGateTestReport(value)).toBeNull());
  test.each([
    (r: Record<string, unknown>) => { r.digest = '0'.repeat(64); },
    (r: Record<string, unknown>) => { r.schemaVersion = 2; },
    (r: Record<string, unknown>) => { r.runner = 'other'; },
    (r: Record<string, unknown>) => { r.commit = 'forbidden'; },
    (r: Record<string, unknown>) => { (r.totals as Record<string, unknown>).passed = 99; },
    (r: Record<string, unknown>) => { (r.files as unknown[]).reverse(); },
    (r: Record<string, unknown>) => { const files = r.files as { tests: Record<string, unknown>[] }[]; files[2]!.tests[0]!.status = 'passed'; },
    (r: Record<string, unknown>) => { const files = r.files as { tests: Record<string, unknown>[] }[]; files[2]!.tests.reverse(); },
    (r: Record<string, unknown>) => { const files = r.files as { tests: Record<string, unknown>[] }[]; files[0]!.tests[0]!.retried = true; },
    (r: Record<string, unknown>) => { const files = r.files as { tests: Record<string, unknown>[] }[]; files[0]!.tests[0]!.failure = 'password=secret'; },
    (r: Record<string, unknown>) => { const files = r.files as { tests: Record<string, unknown>[] }[]; files[0]!.tests[0]!.failure = 'x'.repeat(501); },
  ])('adulteração detectada %#', mutate => {
    const r = json(report()) as Record<string, unknown>; mutate(r); expect(parseGateTestReport(r as Json)).toBeNull();
  });
});

describe('fronteiras adicionais', () => {
  test.each([0, -1, 1.5, '2', null])('invocations inválido %p', invocations => {
    const raw = fixture();
    expectReason({ ...raw, testResults: [{ ...raw.testResults[0]!, assertionResults: [{ ...raw.testResults[0]!.assertionResults[0]!, invocations }] }] }, 'malformed');
  });
  test('retryReasons nunca define retried', () => {
    const raw = many(1);
    const enriched = { ...raw, testResults: [{ ...raw.testResults[0]!, assertionResults: [{ ...raw.testResults[0]!.assertionResults[0]!, retryReasons: ['previous failure'] }] }] };
    const r = derive(enriched); expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.report.files[0]!.tests[0]!.retried).toBe(false);
  });
  test('nomes iguais em suítes distintas são válidos', () => {
    const raw = many(1); raw.testResults.push({ ...raw.testResults[0]!, name: '/repo/b.ts' });
    raw.numTotalTestSuites = 2; raw.numTotalTests = 2; raw.numPassedTests = 2;
    expect(derive(raw).status).toBe('ok');
  });
  test('root POSIX / e suite desconhecida normalizada', () => {
    const raw = many(1); raw.testResults[0]!.status = 'other';
    const r = derive(raw, '/'); expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.report.files[0]).toMatchObject({ path: 'repo/a.test.ts', suiteStatus: 'unknown' });
  });
  test('Windows duplicado ignora casing e barras', () => {
    const raw = fixture(); raw.testResults[0]!.name = 'C:\\repo\\a.ts'; raw.testResults[1]!.name = 'c:/REPO/A.ts';
    expect(derive(raw, 'c:/repo')).toEqual({ status: 'indeterminate', reason: 'duplicate_file' });
  });
  test('parse valida estrutura e contagens mesmo com digest recalculado', () => {
    const r = report();
    const files = [...r.files].reverse();
    expect(parseGateTestReport(json({ ...r, files, digest: sha256Hex(JSON.stringify({ files, totals: r.totals })) }))).toBeNull();
    const totals = { ...r.totals, passed: 99 };
    expect(parseGateTestReport(json({ ...r, totals, digest: sha256Hex(JSON.stringify({ files: r.files, totals })) }))).toBeNull();
    const badFiles = r.files.map((f, i) => i ? f : { ...f, path: '../private' });
    expect(parseGateTestReport(json({ ...r, files: badFiles, digest: sha256Hex(JSON.stringify({ files: badFiles, totals: r.totals })) }))).toBeNull();
  });
  test.each(['fullName', 'status', 'invocations', 'retried', 'failure'])('parser revalida domínio %s', key => {
    const r = report();
    const replacements: Record<string, unknown> = { fullName: 'x'.repeat(401), status: 'unknown', invocations: 0, retried: 'false', failure: '\u001b[31munsafe' };
    const files = r.files.map((f, i) => i ? f : { ...f, tests: f.tests.map(t => ({ ...t, [key]: replacements[key] })) });
    expect(parseGateTestReport(json({ ...r, files, digest: sha256Hex(JSON.stringify({ files, totals: r.totals })) }))).toBeNull();
  });
});
