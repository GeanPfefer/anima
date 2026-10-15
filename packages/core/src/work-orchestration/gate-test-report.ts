import type { Json } from '@anima/types';
import { containsSensitiveData } from './execution-attempt';

export const GATE_TEST_REPORT_LIMITS = {
  maxFiles: 200, maxTests: 2000, maxFullName: 400, maxPath: 300,
  maxFailureText: 500, maxTotalTestsPerEvidence: 4000,
} as const;
export type GateTestStatus = 'passed' | 'failed' | 'pending' | 'skipped' | 'todo' | 'disabled';
export interface GateTestV1 {
  readonly fullName: string;
  readonly status: GateTestStatus;
  readonly invocations: number;
  readonly retried: boolean;
  readonly failure?: string;
}
export interface GateTestFileV1 {
  readonly path: string;
  readonly suiteStatus: 'passed' | 'failed' | 'focused' | 'unknown';
  readonly runtimeError: boolean;
  readonly tests: readonly GateTestV1[];
}
export interface GateTestReportV1 {
  readonly schemaVersion: 1;
  readonly runner: 'jest';
  readonly source: 'host_json_report';
  readonly files: readonly GateTestFileV1[];
  readonly totals: {
    readonly suites: number; readonly suitesFailed: number; readonly suitesRuntimeError: number;
    readonly tests: number; readonly passed: number; readonly failed: number;
    readonly pending: number; readonly skipped: number; readonly todo: number; readonly disabled: number;
  };
  readonly digest: string;
}
type Reason = 'malformed' | 'inconsistent_totals' | 'unknown_status' | 'too_large'
  | 'path_outside_root' | 'duplicate_file' | 'duplicate_test' | 'sensitive_data' | 'empty_report';
export type GateTestReportDerivation = { readonly status: 'ok'; readonly report: GateTestReportV1 }
  | { readonly status: 'indeterminate'; readonly reason: Reason };
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const statuses: readonly string[] = ['passed', 'failed', 'pending', 'skipped', 'todo', 'disabled'];
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a), right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (difference) return difference;
  }
  return left.length - right.length;
}
const relative = (p: string) => !/^(?:\/|[a-z]:)/i.test(p) && !/[\\\x00-\x1f]/.test(p)
  && p.split('/').every(s => s !== '' && s !== '.' && s !== '..') && !/[?*]/.test(p);
const credential = (s: string) => containsSensitiveData(s)
  || /\bBearer\s+\S+|\bsk-[\w-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(s);
function sanitizeFailure(text: string): string {
  const clean = text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '');
  let privateKey = false;
  return clean.split(/\r?\n/).map(line => {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(line)) privateKey = true;
    if (privateKey) {
      if (/-----END [A-Z ]*PRIVATE KEY-----/i.test(line)) privateKey = false;
      return '[redacted]';
    }
    // Local paths are redacted separately; credential detection must happen first.
    if (/\b(password|passwd|secret|api[_-]?key|access[_-]?token|token)\s*[:=]|:\/\/[^\s/@:]+:[^\s/@]+@|\bBearer\s+\S+|\bsk-[\w-]+/i.test(line)) return '[redacted]';
    return line.replace(/\\\\[^\s"'<>)]*/g, '<path>').replace(/[a-z]:[\\/][^\s"'<>)]*/gi, '<path>')
      .replace(/(^|[\s("'=])\/[^\s"'<>)]*/g, '$1<path>');
  }).join(' ').replace(/\s+/g, ' ').trim().slice(0, GATE_TEST_REPORT_LIMITS.maxFailureText).trim();
}
function totalsOf(files: readonly GateTestFileV1[]): GateTestReportV1['totals'] {
  const t = { suites: files.length, suitesFailed: 0, suitesRuntimeError: 0,
    tests: 0, passed: 0, failed: 0, pending: 0, skipped: 0, todo: 0, disabled: 0 };
  for (const f of files) {
    if (f.suiteStatus === 'failed') t.suitesFailed++;
    if (f.runtimeError) t.suitesRuntimeError++;
    for (const test of f.tests) { t.tests++; t[test.status]++; }
  }
  return t;
}
const makeReport = (files: readonly GateTestFileV1[]): GateTestReportV1 => {
  const totals = totalsOf(files);
  return { schemaVersion: 1, runner: 'jest', source: 'host_json_report', files, totals,
    digest: sha256Hex(JSON.stringify({ files, totals })) };
};

/** Pure normalization only; a test result never establishes acceptance coverage. */
export function deriveGateTestReport(raw: unknown, options: { rootDir: string }): GateTestReportDerivation {
  const fail = (reason: Reason): GateTestReportDerivation => ({ status: 'indeterminate', reason });
  try {
    if (!object(raw) || !object(options) || !nonBlank(options.rootDir) || !Array.isArray(raw.testResults)
      || typeof raw.success !== 'boolean') return fail('malformed');
    const counters = ['numTotalTestSuites', 'numFailedTestSuites', 'numRuntimeErrorTestSuites',
      'numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests'] as const;
    if (!counters.every(k => integer(raw[k]))) return fail('malformed');
    if (raw.testResults.length > GATE_TEST_REPORT_LIMITS.maxFiles
      || (raw.numTotalTestSuites as number) > GATE_TEST_REPORT_LIMITS.maxFiles
      || (raw.numTotalTests as number) > GATE_TEST_REPORT_LIMITS.maxTests) return fail('too_large');
    const normalizedRoot = options.rootDir.replace(/\\/g, '/');
    const root = normalizedRoot === '/' ? '/' : normalizedRoot.replace(/\/+$/, '');
    const windows = /^[a-z]:\//i.test(root) || root.startsWith('//');
    if (!/^(?:\/|[a-z]:\/)/i.test(root) || root.split('/').includes('..')) return fail('path_outside_root');
    const files: GateTestFileV1[] = [];
    const paths = new Set<string>();
    let count = 0;
    for (const suite of raw.testResults) {
      if (!object(suite) || !nonBlank(suite.name) || typeof suite.status !== 'string'
        || typeof suite.message !== 'string' || !Array.isArray(suite.assertionResults)) return fail('malformed');
      const name = suite.name.replace(/\\/g, '/');
      const prefix = root === '/' ? '/' : root + '/';
      if (name.split('/').includes('..') || !(windows ? name.toLowerCase().startsWith(prefix.toLowerCase()) : name.startsWith(prefix))) return fail('path_outside_root');
      const path = name.slice(prefix.length);
      if (!relative(path)) return fail('path_outside_root');
      if (path.length > GATE_TEST_REPORT_LIMITS.maxPath) return fail('too_large');
      if (credential(path)) return fail('sensitive_data');
      const identity = windows ? path.toLowerCase() : path;
      if (paths.has(identity)) return fail('duplicate_file');
      paths.add(identity);
      const tests: GateTestV1[] = [];
      const groups = new Map<string, GateTestV1[]>();
      for (const assertion of suite.assertionResults) {
        if (!object(assertion) || !nonBlank(assertion.fullName) || typeof assertion.title !== 'string'
          || !Array.isArray(assertion.ancestorTitles) || !assertion.ancestorTitles.every(v => typeof v === 'string')
          || typeof assertion.status !== 'string' || !integer(assertion.invocations) || assertion.invocations < 1
          || !Array.isArray(assertion.failureMessages) || !assertion.failureMessages.every(v => typeof v === 'string')) return fail('malformed');
        if (!statuses.includes(assertion.status)) return fail('unknown_status');
        if (credential(assertion.fullName)) return fail('sensitive_data');
        if (++count > GATE_TEST_REPORT_LIMITS.maxTests || assertion.fullName.length > GATE_TEST_REPORT_LIMITS.maxFullName) return fail('too_large');
        const failure = assertion.failureMessages.length ? sanitizeFailure(assertion.failureMessages[0] as string) : undefined;
        const group = groups.get(assertion.fullName) ?? [];
        group.push({ fullName: assertion.fullName, status: assertion.status as GateTestStatus,
          invocations: assertion.invocations, retried: assertion.invocations > 1,
          ...(failure ? { failure } : {}) });
        groups.set(assertion.fullName, group);
      }
      const names = new Set<string>();
      for (const [original, group] of [...groups].sort(([a], [b]) => compare(a, b))) {
        group.sort((a, b) => compare(a.status, b.status) || a.invocations - b.invocations
          || compareCodePoints(a.failure ?? '', b.failure ?? ''));
        for (const [index, test] of group.entries()) {
          const fullName = index === 0 ? original : `${original} #${index + 1}`;
          if (fullName.length > GATE_TEST_REPORT_LIMITS.maxFullName) return fail('too_large');
          if (names.has(fullName)) return fail('duplicate_test');
          names.add(fullName);
          tests.push({ ...test, fullName });
        }
      }
      tests.sort((a, b) => compare(a.fullName, b.fullName));
      const suiteStatus = ['passed', 'failed', 'focused'].includes(suite.status)
        ? suite.status as GateTestFileV1['suiteStatus'] : 'unknown';
      files.push({ path, suiteStatus, runtimeError: suiteStatus === 'failed' && tests.length === 0 && suite.message.trim().length > 0, tests });
    }
    const report = makeReport(files.sort((a, b) => compare(a.path, b.path)));
    const t = report.totals;
    if (raw.numTotalTestSuites !== t.suites || raw.numFailedTestSuites !== t.suitesFailed
      || raw.numRuntimeErrorTestSuites !== t.suitesRuntimeError || raw.numTotalTests !== t.tests
      || raw.numPassedTests !== t.passed || raw.numFailedTests !== t.failed
      || raw.numPendingTests !== t.pending + t.skipped + t.disabled || raw.numTodoTests !== t.todo
      || raw.numTotalTests !== (raw.numPassedTests as number) + (raw.numFailedTests as number) + (raw.numPendingTests as number) + (raw.numTodoTests as number)
      || (raw.success && (t.failed > 0 || t.suitesFailed > 0 || t.suitesRuntimeError > 0))) return fail('inconsistent_totals');
    if (!t.suites || !t.tests) return fail('empty_report');
    return { status: 'ok', report };
  } catch { return fail('malformed'); }
}

/** Reconstruct canonical values, never trust persisted counts or digest. */
export function parseGateTestReport(value: Json | undefined): GateTestReportV1 | null {
  try {
    if (!object(value) || value.schemaVersion !== 1 || value.runner !== 'jest' || value.source !== 'host_json_report'
      || !Array.isArray(value.files) || !value.files.length || value.files.length > GATE_TEST_REPORT_LIMITS.maxFiles) return null;
    const files: GateTestFileV1[] = [];
    let count = 0;
    for (const f of value.files) {
      if (!object(f) || !nonBlank(f.path) || !relative(f.path) || credential(f.path)
        || f.path.length > GATE_TEST_REPORT_LIMITS.maxPath || !['passed', 'failed', 'focused', 'unknown'].includes(f.suiteStatus as string)
        || typeof f.runtimeError !== 'boolean' || !Array.isArray(f.tests)
        || (files.length && compare(files[files.length - 1]!.path, f.path) >= 0)) return null;
      const tests: GateTestV1[] = [];
      for (const t of f.tests) {
        if (!object(t) || !nonBlank(t.fullName) || t.fullName.length > GATE_TEST_REPORT_LIMITS.maxFullName
          || credential(t.fullName) || !statuses.includes(t.status as string) || !integer(t.invocations) || t.invocations < 1
          || typeof t.retried !== 'boolean' || t.retried !== (t.invocations > 1) || ++count > GATE_TEST_REPORT_LIMITS.maxTests
          || (tests.length && compare(tests[tests.length - 1]!.fullName, t.fullName) >= 0)
          || (t.failure !== undefined && (!nonBlank(t.failure) || sanitizeFailure(t.failure) !== t.failure))) return null;
        const test: GateTestV1 = { fullName: t.fullName, status: t.status as GateTestStatus,
          invocations: t.invocations, retried: t.retried,
          ...(t.failure === undefined ? {} : { failure: t.failure as string }) };
        if (Object.keys(t).some(k => !Object.keys(test).includes(k))) return null;
        tests.push(test);
      }
      if (f.runtimeError && (f.suiteStatus !== 'failed' || tests.length !== 0)) return null;
      const file: GateTestFileV1 = { path: f.path, suiteStatus: f.suiteStatus as GateTestFileV1['suiteStatus'], runtimeError: f.runtimeError, tests };
      if (Object.keys(f).some(k => !Object.keys(file).includes(k))) return null;
      files.push(file);
    }
    if (!count) return null;
    const report = makeReport(files);
    if (!object(value.totals) || Object.keys(value.totals).length !== Object.keys(report.totals).length
      || !Object.entries(report.totals).every(([k, v]) => (value.totals as Record<string, unknown>)[k] === v)
      || value.digest !== report.digest || Object.keys(value).some(k => !Object.keys(report).includes(k))) return null;
    return report;
  } catch { return null; }
}

/** SHA-256 with manual UTF-8 encoding, including replacement of lone surrogates. */
export function sha256Hex(text: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { cp = 0x10000 + ((cp - 0xd800) << 10) + next - 0xdc00; i++; }
      else cp = 0xfffd;
    } else if (cp >= 0xdc00 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | cp >>> 6, 0x80 | cp & 63);
    else if (cp < 0x10000) bytes.push(0xe0 | cp >>> 12, 0x80 | cp >>> 6 & 63, 0x80 | cp & 63);
    else bytes.push(0xf0 | cp >>> 18, 0x80 | cp >>> 12 & 63, 0x80 | cp >>> 6 & 63, 0x80 | cp & 63);
  }
  const bits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bits / 0x100000000), low = bits >>> 0;
  for (const word of [high, low]) for (let shift = 24; shift >= 0; shift -= 8) bytes.push(word >>> shift & 255);
  const k = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotr = (x: number, n: number) => x >>> n | x << (32 - n);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w: number[] = [];
    for (let i = 0; i < 16; i++) { const p = offset + i * 4; w[i] = bytes[p]! << 24 | bytes[p + 1]! << 16 | bytes[p + 2]! << 8 | bytes[p + 3]!; }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!, y = w[i - 2]!;
      w[i] = (w[i - 16]! + (rotr(x, 7) ^ rotr(x, 18) ^ x >>> 3) + w[i - 7]! + (rotr(y, 17) ^ rotr(y, 19) ^ y >>> 10)) | 0;
    }
    let [a,b,c,d,e,f,g,j] = h as [number,number,number,number,number,number,number,number];
    for (let i = 0; i < 64; i++) {
      const t1 = (j + (rotr(e,6) ^ rotr(e,11) ^ rotr(e,25)) + ((e & f) ^ (~e & g)) + k[i]! + w[i]!) | 0;
      const t2 = ((rotr(a,2) ^ rotr(a,13) ^ rotr(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      j=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    [a,b,c,d,e,f,g,j].forEach((v, i) => { h[i] = (h[i]! + v) | 0; });
  }
  return h.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}
