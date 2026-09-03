/** @jest-environment node */
import { validCoderTranscripts, parseHostObservedCoderEvidence, type CoderTranscript, type HostObservedCoderEvidenceV1 } from '@anima/core';
import { OllamaCoderBackend } from './ollama-coder';
import { sha256 } from './ollama-protocol';
import { persistHostObservedCoderEvidence } from './coder-evidence';
import type { HostValidationFeedback } from './coder-backend';

async function run(source: string, before: string, expected = sha256(source), feedback?: HostValidationFeedback, writeFails = false) {
  let text = source;
  let calls = 0;
  let transcript: CoderTranscript | undefined;
  const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({
    message: { content: JSON.stringify(calls++ === 0
      ? { action: 'read', reads: [{ path: 'test.ts', lineRange: [1, 10] }] }
      : { action: 'edit', operations: [{ kind: 'replace_exact', path: 'test.ts', expected_file_sha256: expected, before, after: 'changed' }] }) },
    prompt_eval_count: 100000, done_reason: 'stop', eval_count: 30,
  }) })) as unknown as typeof fetch;
  const backend = new OllamaCoderBackend({ model: 'fixture', fetchImpl });
  let error: unknown;
  try { await backend.edit({ objective: 'fixture', includedScope: ['test.ts'], excludedScope: [], hostValidationFeedback: feedback,
    onTranscript: t => { transcript = t; } }, {
    readFile: async () => text, writeFile: async (_p, value) => { if (writeFails) return false; text = value; return true; },
  }, new AbortController().signal); } catch (e) { error = e; }
  return { text, transcript: transcript!, error };
}

test.each([
  ['stale_read', 'hello', 'hello', sha256('old'), 1],
  ['invalid_anchor', 'hello', 'absent', sha256('hello'), 0],
  ['ambiguous_anchor', 'hello hello', 'hello', sha256('hello hello'), 2],
])('%s remains fail-closed and persists observed counts', async (result, source, before, hash, count) => {
  const r = await run(source, before, hash);
  expect(r.error).toBeDefined(); expect(r.text).toBe(source);
  expect(r.transcript.entries[1]).toMatchObject({ result, matchCount: count, readRefs: [1], readHash: sha256(source), expectedHash: hash });
  expect(r.transcript.entries[2]).toMatchObject({ phase: 'application', result: 'batch_failed', operationStep: 2, step: 3 });
  expect(validCoderTranscripts([r.transcript])).toBe(true);
});

test('READ H → EDIT H → applied, redacted and correlated', async () => {
  const secret = 'const password = "secret123";';
  const r = await run(secret, secret);
  expect(r.error).toBeUndefined(); expect(r.text).toBe('changed');
  expect(r.transcript.entries[0]).toMatchObject({ phase: 'read', round: 0, lines: [1], readHash: sha256(secret) });
  expect(r.transcript.entries[1]).toMatchObject({ result: 'exact_match', round: 1, readRefs: [1], anchorReadRefs: [1], fingerprint: sha256(secret), length: secret.length });
  expect(r.transcript.entries[2]).toMatchObject({ result: 'applied', operationStep: 2, step: 3 });
  expect(JSON.stringify(r.transcript)).not.toContain('secret123');
  expect(validCoderTranscripts([r.transcript])).toBe(true);
});

test('CRLF/LF normalized_match differs from exact_match; writer failure is not applied', async () => {
  const r = await run('a\r\nb', 'a\nb');
  expect(r.error).toBeUndefined();
  expect(r.transcript.entries[1]).toMatchObject({ result: 'normalized_match', rawMatchCount: 0, matchCount: 1 });
  const failed = await run('hello', 'hello', sha256('hello'), undefined, true);
  expect(failed.transcript.entries[2]?.result).toBe('write_failed');
});

test('repair keeps previous edit call and gate/diff; canonical persistence retains both calls even on failure', async () => {
  const first = await run('hello', 'hello');
  const feedback: HostValidationFeedback = { kind: 'gate-failure', retryIndex: 1, retryLimit: 1,
    failedGate: { label: 'gate', command: 'test', exitCode: 1, timedOut: false, cancelled: false },
    changedFiles: ['test.ts'], diffSha256: sha256('diff') };
  const repair = await run('changed', 'absent', sha256('changed'), feedback);
  expect(repair.transcript).toMatchObject({ call: 1, previousCall: 0, gateFingerprint: sha256(JSON.stringify(feedback.failedGate)), diffFingerprint: sha256('diff') });
  let saved: HostObservedCoderEvidenceV1 | undefined;
  const result = await persistHostObservedCoderEvidence({ workItemId: 'work', attemptId: 'attempt', approvedProposalVersion: 1 }, [
    { backendId: 'ollama', durationMs: 1, outcome: 'succeeded', transcripts: [first.transcript] },
    { backendId: 'ollama', durationMs: 1, outcome: 'failed', transcripts: [repair.transcript] },
  ], { record: async e => { saved = e; return { ok: true, action: 'recorded' }; } });
  expect(result.ok).toBe(true);
  expect(saved?.transcripts).toHaveLength(2);
  expect(parseHostObservedCoderEvidence(JSON.parse(JSON.stringify(saved)))?.transcripts).toEqual(saved?.transcripts);
  expect(saved?.attemptId).toBe('attempt');
});

test('unredacted/extra fields and broken READ references are refused by the evidence boundary', async () => {
  const { transcript } = await run('hello', 'hello');
  const bad = JSON.parse(JSON.stringify(transcript));
  bad.entries[1].structure = 'secret'; expect(validCoderTranscripts([bad])).toBe(false);
  bad.entries[1].structure = 'xxxx'; bad.entries[1].before = 'secret'; expect(validCoderTranscripts([bad])).toBe(false);
  delete bad.entries[1].before; bad.entries[1].readRefs = [99]; expect(validCoderTranscripts([bad])).toBe(false);
});
