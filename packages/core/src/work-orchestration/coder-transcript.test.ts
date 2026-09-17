import { validCoderTranscripts, type CoderCommandObservationV1, type CoderTranscript } from './index';

const HASH = 'a'.repeat(64);

const baseTranscript = (over: Partial<CoderTranscript> = {}): CoderTranscript => ({
  schemaVersion: 1, call: 0, previousCall: null, gateFingerprint: null, diffFingerprint: null,
  termination: 'ollama_submit_gate_unsatisfied', truncated: false, entries: [], ...over,
});

const obs = (over: Partial<CoderCommandObservationV1> = {}): CoderCommandObservationV1 => ({
  round: 3, editRevision: 1, state: 'dirty_unvalidated', kind: 'test',
  command: 'npm test -- post-turn-observation.test.ts', cwd: 'worktree',
  outcome: 'exit_nonzero', exitCode: 1, refusedReason: null,
  stdout: 'FAIL post-turn-observation.test.ts\nExpected: 0 Received: 1', stderr: '',
  outputTruncated: false, outputSha256: HASH, ...over,
});

describe('validCoderTranscripts — observabilidade EXEC/TEST/GIT (Parte A)', () => {
  test('aceita transcript sem observações (retrocompat aditiva)', () => {
    expect(validCoderTranscripts([baseTranscript()])).toBe(true);
  });

  test('aceita observações bounded e coerentes (test vermelho, git diff, refused)', () => {
    const t = baseTranscript({ commandObservations: [
      obs(),
      obs({ round: 5, kind: 'git_diff', outcome: 'exit0', exitCode: 0, stdout: '--- a/x\n+++ b/x\n+FIXED' }),
      obs({ round: 6, kind: 'exec', outcome: 'refused', exitCode: null, refusedReason: 'programa fora da allowlist', stdout: '', stderr: '', outputSha256: null }),
    ] });
    expect(validCoderTranscripts([t])).toBe(true);
  });

  test('rejeita segredo residual (JWT) que escapou da sanitização', () => {
    const jwt = 'eyJhbGciOiJI.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV';
    expect(validCoderTranscripts([baseTranscript({ commandObservations: [obs({ stdout: `leak ${jwt}` })] })])).toBe(false);
  });

  test('rejeita stdout acima do teto persistível', () => {
    expect(validCoderTranscripts([baseTranscript({ commandObservations: [obs({ stdout: 'x'.repeat(6001) })] })])).toBe(false);
  });

  test('rejeita command com dado sensível (caminho absoluto/credencial)', () => {
    expect(validCoderTranscripts([baseTranscript({ commandObservations: [obs({ command: 'npm test api_key=SECRET' })] })])).toBe(false);
  });

  test('rejeita incoerência: refused com exitCode não-nulo, e exit0 com exitCode≠0', () => {
    expect(validCoderTranscripts([baseTranscript({ commandObservations: [obs({ outcome: 'refused', exitCode: 1, refusedReason: 'x' })] })])).toBe(false);
    expect(validCoderTranscripts([baseTranscript({ commandObservations: [obs({ outcome: 'exit0', exitCode: 1 })] })])).toBe(false);
  });

  test('rejeita chave desconhecida no transcript (fail-closed)', () => {
    const bad = { ...baseTranscript(), extra: 1 } as unknown;
    expect(validCoderTranscripts([bad])).toBe(false);
  });
});
