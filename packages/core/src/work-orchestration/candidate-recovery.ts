// ============================================================
// Recuperação governada de CANDIDATO com defeito real (ato humano).
//
// Um item `failed` cujo candidato foi produzido pelo coder, mas reprovou num gate por
// defeito real do código, recebe — por ato humano — exatamente UM sucessor na mesma
// lineage que RETOMA o checkpoint do candidato, com orçamento próprio de 1 attempt.
// Não é retry: a autoridade registra um diagnóstico factual; nada executa nem aprova.
// Puro, sem I/O. Espelha `private.validate_candidate_recovery_authorization` (SQL).
// ============================================================

export const candidateRecoveryCorrectionKinds = ['type_error', 'test_failure', 'build_error', 'behavior_gap'] as const;
export type CandidateRecoveryCorrectionKind = typeof candidateRecoveryCorrectionKinds[number];

export interface CandidateRecoveryAuthorization {
  readonly schemaVersion: 1;
  readonly kind: 'production_candidate_incorrect_v1';
  readonly requestId: string;
  readonly reason: string;
  readonly finding: 'production_candidate_incorrect';
  readonly candidateCommitSha: string;
  readonly sourceAttemptId: string;
  readonly gate: { readonly label: string; readonly command: string; readonly exitCode: number };
  readonly location: { readonly path: string; readonly line?: number };
  readonly observedError: string;
  readonly evidenceReference: string;
  readonly corrections: readonly { readonly kind: CandidateRecoveryCorrectionKind; readonly instruction: string }[];
  readonly additionalAttempts: 1;
}

export interface CandidateRecoveryCheckpoint {
  readonly base_sha: string;
  readonly commit_sha: string;
  readonly branch: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const EVIDENCE = /^docs\/registros\/[A-Za-z0-9_-]+\.md$/;
const KEYS = ['schemaVersion', 'kind', 'requestId', 'reason', 'finding', 'candidateCommitSha', 'sourceAttemptId', 'gate',
  'location', 'observedError', 'evidenceReference', 'corrections', 'additionalAttempts'];

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
const onlyKeys = (v: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean =>
  required.every(k => k in v) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const text = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.trim().length >= min && v.length <= max;

/** Path relativo ao repositório: sem absoluto, sem `..`, sem backslash. */
export function isRelativeRepoPath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= 300
    && !path.startsWith('/') && !/^[A-Za-z]:/.test(path) && !path.includes('\\')
    && !path.split('/').some(part => part === '..' || part === '' || part === '.');
}

/** Mesma régua de `private.validate_candidate_recovery_authorization`. */
export function readCandidateRecoveryAuthorization(value: unknown): CandidateRecoveryAuthorization | null {
  const v = record(value);
  if (!v || !onlyKeys(v, KEYS)) return null;
  if (v.schemaVersion !== 1 || v.kind !== 'production_candidate_incorrect_v1'
    || v.finding !== 'production_candidate_incorrect' || v.additionalAttempts !== 1) return null;
  if (typeof v.requestId !== 'string' || !UUID.test(v.requestId)) return null;
  if (typeof v.sourceAttemptId !== 'string' || !UUID.test(v.sourceAttemptId)) return null;
  if (typeof v.candidateCommitSha !== 'string' || !SHA.test(v.candidateCommitSha)) return null;
  if (!text(v.reason, 10, 500) || !text(v.observedError, 10, 400)) return null;
  if (typeof v.evidenceReference !== 'string' || !EVIDENCE.test(v.evidenceReference)) return null;
  const gate = record(v.gate);
  if (!gate || !onlyKeys(gate, ['label', 'command', 'exitCode'])
    || !text(gate.label, 1, 200) || !text(gate.command, 1, 500)
    || typeof gate.exitCode !== 'number' || !Number.isInteger(gate.exitCode)) return null;
  const location = record(v.location);
  if (!location || !onlyKeys(location, ['path'], ['line']) || !isRelativeRepoPath(location.path)) return null;
  if ('line' in location && (typeof location.line !== 'number' || !Number.isInteger(location.line)
    || location.line < 1 || location.line > 1_000_000)) return null;
  if (!Array.isArray(v.corrections) || v.corrections.length < 1 || v.corrections.length > 3) return null;
  const kinds = new Set<string>();
  for (const entry of v.corrections) {
    const c = record(entry);
    if (!c || !onlyKeys(c, ['kind', 'instruction'])
      || !candidateRecoveryCorrectionKinds.includes(c.kind as CandidateRecoveryCorrectionKind) || kinds.has(String(c.kind))
      || !text(c.instruction, 10, 600)) return null;
    kinds.add(String(c.kind));
  }
  return v as unknown as CandidateRecoveryAuthorization;
}

/** Checkpoint do successor: retoma o candidato anterior no branch da attempt de origem. */
export function deriveCandidateRecoveryCheckpoint(input: {
  readonly baseSha: string;
  readonly candidateCommitSha: string;
  readonly sourceAttemptId: string;
}): CandidateRecoveryCheckpoint | null {
  if (!SHA.test(input.baseSha) || !SHA.test(input.candidateCommitSha) || !UUID.test(input.sourceAttemptId)
    || input.baseSha === input.candidateCommitSha) return null;
  return { base_sha: input.baseSha, commit_sha: input.candidateCommitSha, branch: `anima-work/${input.sourceAttemptId}` };
}
