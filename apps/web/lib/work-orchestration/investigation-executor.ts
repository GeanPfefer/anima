import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  diagnoseInvestigationTransport, diagnoseInvestigationRejectionTreatment, applyInvestigationEvidenceRejections, INVESTIGATION_EVIDENCE_MAX_READABLE_BYTES, INVESTIGATION_OUTPUT_SCHEMA, isInvestigationCommit, parseInvestigationResult, normalizeInvestigationTransport, parseInvestigationExecution, renderInvestigationEvidence, renderInvestigationSummary,
  validateEffectClassCoherence, validateWorkExecutorRequest,
  type InvestigationFailureV1, type InvestigationEvidenceRejectionV1, type InvestigationExecutionV1, type InvestigationResultV1, type WorkExecutorAdapter,
  type WorkExecutorRequest, type WorkExecutorSignal, type WorkExecutorSignalInput,
} from '@anima/core';
import { buildCodexCliEnvironment, resolveCodexCliConfig, CODEX_CLI_DEFAULT_MODEL, CODEX_CLI_PROMPT_MAX_CHARS, type CodexCliProcessRunner } from './codex-cli-coder';
import { runProcess } from './worktree';

export interface InvestigationTarget { readonly repoRoot: string; readonly baseSha: string; }
export interface InvestigationExecutorOptions {
  /** Host resolves the authorized target/base, never the executor's output. */
  readonly targets: { resolve(reference: string): InvestigationTarget | null };
  readonly run?: CodexCliProcessRunner;
  readonly environmentSource?: Record<string, string | undefined>;
}
const successful = (r: Awaited<ReturnType<typeof runProcess>>): boolean => r.exitCode === 0 && !r.cancelled && !r.timedOut;
const git = (repo: string, args: readonly string[], timeoutMs = 15_000, signal?: AbortSignal) =>
  runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs, ...(signal ? { signal } : {}) });

/** Restrict comparison to forbidden names: an operator changing HEAD/ordinary refs in
 * the live checkout must not invalidate the detached governed snapshot. Existing
 * programming candidates are retained in the baseline; attempt-owned refs cannot preexist. */
export async function readProhibitedInvestigationRefs(repo: string, attemptId: string): Promise<readonly string[]> {
  const result = await git(repo, ['for-each-ref', '--format=%(refname)']);
  if (!successful(result) || result.stdout.length >= 200_000) throw new Error('ref_check_failed');
  return result.stdout.split(/\r?\n/).filter(r => r.startsWith('refs/heads/anima-work/') || r.includes(attemptId)).sort();
}
export const hasNewProhibitedInvestigationRefs = (before: readonly string[], after: readonly string[]): boolean => {
  const baseline = new Set(before);
  return after.some(ref => !baseline.has(ref));
};

/** Resolve git objects, not files on the live checkout. Blob mode excludes trees,
 * symlinks and submodules. Byte size cross-check fails closed on runProcess truncation. */
export async function inspectInvestigationEvidence(repo: string, result: InvestigationResultV1): Promise<{ ok: false; failure: InvestigationFailureV1 } | { ok: true; rejections: readonly InvestigationEvidenceRejectionV1[] }> {
  if (!parseInvestigationResult(result)) return { ok: false, failure: { version: 1, stage: 'structure', reason: 'result_invalid' } };
  const rejections: InvestigationEvidenceRejectionV1[] = [];
  for (const [findingIndex, finding] of result.findings.entries()) for (const [evidenceIndex, evidence] of finding.evidence.entries()) {
    const fail = (reason: Extract<InvestigationFailureV1, { stage: 'evidence' }>['reason']) =>
      ({ ok: false as const, failure: { version: 1 as const, stage: 'evidence' as const, reason, findingIndex, evidenceIndex } });
    // Classify observed Git outcomes only; unexpected exceptions reach the host catch.
    const unavailable = (r: Awaited<ReturnType<typeof git>>) => r.cancelled || r.timedOut;
    const commit = await git(repo, ['cat-file', '-t', evidence.commit]);
    if (unavailable(commit)) return fail('evidence_git_unavailable');
    if (!successful(commit) || commit.stdout.trim() !== 'commit') return fail('evidence_commit_missing');
    if (evidence.kind === 'commit') continue;
    const entry = await git(repo, ['ls-tree', evidence.commit, '--', evidence.path]);
    if (!successful(entry)) return fail('evidence_git_unavailable');
    if (entry.stdout === '') return fail('evidence_path_missing');
    if (!/^100(?:644|755) blob [a-f0-9]{40}\t/.test(entry.stdout)) return fail('evidence_path_not_regular_file');
    const objectName = `${evidence.commit}:${evidence.path}`;
    const type = await git(repo, ['cat-file', '-t', objectName]);
    if (!successful(type)) return fail('evidence_git_unavailable');
    if (type.stdout.trim() !== 'blob') return fail('evidence_object_not_blob');
    if (evidence.lines) {
      const size = await git(repo, ['cat-file', '-s', objectName]);
      if (!successful(size) || !/^\d+\s*$/.test(size.stdout)) return fail('evidence_git_unavailable');
      const actualByteSize = Number(size.stdout);
      if (!Number.isSafeInteger(actualByteSize)) return fail('evidence_git_unavailable');
      if (actualByteSize > INVESTIGATION_EVIDENCE_MAX_READABLE_BYTES) {
        rejections.push({ findingIndex, evidenceIndex, reason: 'range_not_validated_file_too_large', actualByteSize, maxReadableByteSize: INVESTIGATION_EVIDENCE_MAX_READABLE_BYTES });
        continue;
      }
      const content = await git(repo, ['cat-file', 'blob', objectName]);
      if (!successful(content)) return fail('evidence_git_unavailable');
      if (Buffer.byteLength(content.stdout, 'utf8') !== Number(size.stdout) || content.stdout.includes('\0')) return fail('evidence_content_invalid');
      const count = content.stdout.length === 0 ? 0 : content.stdout.split('\n').length - (content.stdout.endsWith('\n') ? 1 : 0);
      if (evidence.lines.end > count) rejections.push({ findingIndex, evidenceIndex, actualLineCount: count, reason: evidence.lines.start > count ? 'line_start_out_of_range' : 'line_end_out_of_range' });
    }
  }
  return { ok: true, rejections };
}

export async function resolveInvestigationEvidence(repo: string, result: InvestigationResultV1): Promise<boolean> {
  const inspection = await inspectInvestigationEvidence(repo, result);
  return inspection.ok && inspection.rejections.length === 0;
}

export function buildInvestigationPrompt(request: WorkExecutorRequest, baseSha: string): string {
  return [
    'ANIMA Investigation V0. Produce knowledge only. Do not EDIT, write, commit, create refs, execute gates/probes with effects, use network/browser, delegate, or change ANIMA state.',
    `Question: ${request.objective}`,
    `Authorized snapshot commit: ${baseSha}`,
    `Declared sources within this snapshot: ${JSON.stringify(request.includedScope)}`,
    `Excluded sources: ${JSON.stringify(request.excludedScope)}`,
    'Source scope is an instruction subject to human audit, not a guaranteed confidentiality boundary. Read-only isolates effects; it does not guarantee confinement of reads.',
    'Return only the strict InvestigationResultV1 JSON schema supplied with --output-schema. Cite file_at_commit evidence as file@commit:lines (relative file path, full 40-hex commit, optional start/end); commit evidence identifies a full commit.',
    'Omit lines (use null) unless the exact range was confirmed by reading the file. Never estimate the end of a file or cite a line beyond the last line (EOF). Prefer a few small ranges.',
    'For large files (> ~150 KB, such as extensive PRDs), omit lines (use null).',
    'established/inferred require evidence. undetermined may have none. partial/inconclusive require explicit gaps. Do not expose secrets or absolute local paths. Findings are subject to human review; resolving a citation does not prove its statement.',
  ].join('\n');
}

export class InvestigationExecutorAdapter implements WorkExecutorAdapter {
  readonly id = 'investigation-v1';
  private readonly attempts = new Map<string, { fingerprint: string; result: Promise<WorkExecutorSignalInput> }>();
  constructor(private readonly options: InvestigationExecutorOptions) {}

  async *execute(request: WorkExecutorRequest, signal: AbortSignal): AsyncIterable<WorkExecutorSignal> {
    const fingerprint = JSON.stringify(request);
    let attempt = this.attempts.get(request.attemptId);
    let result: WorkExecutorSignalInput;
    if (attempt && attempt.fingerprint !== fingerprint) {
      result = { kind: 'error', code: 'attempt_payload_conflict', retryable: false, message: 'Attempt payload changed.', handoffReference: 'investigation:conflict' };
    } else {
      if (!attempt) {
        attempt = { fingerprint, result: this.perform(request, signal).catch(() => ({ kind: 'error' as const, code: 'execution_failed' as const, retryable: true, message: 'Investigation host operation failed.', handoffReference: 'investigation:failure' })) };
        this.attempts.set(request.attemptId, attempt);
      }
      result = await attempt.result;
    }
    yield { ...result, workItemId: request.workItemId, attemptId: request.attemptId, approvedProposalVersion: request.approvedProposalVersion, origin: 'executor', sequence: 1 } as WorkExecutorSignal;
  }

  private async perform(request: WorkExecutorRequest, signal: AbortSignal): Promise<WorkExecutorSignalInput> {
    const error = (retryable: boolean, message: string, code: 'invalid_request' | 'execution_failed' = 'execution_failed', investigationFailure?: InvestigationFailureV1): WorkExecutorSignalInput =>
      ({ kind: 'error', code, retryable, message, handoffReference: 'investigation:failure', ...(investigationFailure ? { investigationFailure } : {}) });
    const invalid = validateEffectClassCoherence(request.effectClass, request.permissions, this.id) ?? validateWorkExecutorRequest(request);
    if (invalid) return error(false, invalid, 'invalid_request');
    const target = this.options.targets.resolve(request.target.reference);
    const config = resolveCodexCliConfig(null, this.options.environmentSource ?? process.env);
    if (!target || !isInvestigationCommit(target.baseSha) || !config.ok || request.taskSpec.verifierRequirement !== 'advisory') return error(false, 'Invalid target, CLI configuration or advisory lane.', 'invalid_request');
    const prompt = buildInvestigationPrompt(request, target.baseSha);
    if (prompt.length > CODEX_CLI_PROMPT_MAX_CHARS) return error(false, 'Investigation prompt exceeds CLI limit.', 'invalid_request');
    if (signal.aborted) return { kind: 'cancelled', acknowledged: true, handoffReference: 'investigation:cancelled' };
    const deadline = Date.now() + (request.limits.maxDurationMinutes ?? 30) * 60_000;
    const remaining = (): number => Math.max(1, deadline - Date.now());
    let temporary: string | undefined;
    let snapshot: string | undefined;
    let attached = false;
    let checkingIntegrity = false;
    let transportFailure: InvestigationFailureV1 | undefined;
    let outcome: WorkExecutorSignalInput = error(true, 'Investigation host operation failed.');
    try {
      const before = await readProhibitedInvestigationRefs(target.repoRoot, request.attemptId);
      if (before.some(ref => ref.includes(request.attemptId))) return error(false, 'Attempt-owned ref already exists.', 'invalid_request');
      temporary = await mkdtemp(join(tmpdir(), 'anima-investigation-'));
      snapshot = join(temporary, 'snapshot');
      const add = await git(target.repoRoot, ['worktree', 'add', '--detach', snapshot, target.baseSha], remaining(), signal);
      if (!successful(add)) throw new Error('snapshot_creation_failed');
      attached = true;
      const schemaPath = join(temporary, 'schema.json');
      const outputPath = join(temporary, 'result.json');
      await writeFile(schemaPath, JSON.stringify(INVESTIGATION_OUTPUT_SCHEMA), { flag: 'wx' });
      if (Date.now() >= deadline) throw new Error('deadline_expired');
      const cli = await (this.options.run ?? runProcess)(config.value.executable, [
        'exec', '--sandbox', 'read-only', '-c', 'approval_policy=never', '--ephemeral', '--cd', snapshot,
        '--output-schema', schemaPath, '-o', outputPath,
        ...(config.value.model !== CODEX_CLI_DEFAULT_MODEL ? ['--model', config.value.model] : []),
        ...(config.value.profile ? ['--profile', config.value.profile] : []), prompt,
      ], { cwd: snapshot, timeoutMs: remaining(), signal, env: buildCodexCliEnvironment(this.options.environmentSource) as NodeJS.ProcessEnv }).catch(() => null);
      // Integrity checks deliberately ignore an aborted CLI signal: the host must still
      // observe effect violations before considering cancellation or output validity.
      checkingIntegrity = true;
      const status = await git(snapshot, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored']);
      const head = await git(snapshot, ['rev-parse', 'HEAD']);
      const symbolic = await git(snapshot, ['symbolic-ref', '-q', 'HEAD']);
      const after = await readProhibitedInvestigationRefs(target.repoRoot, request.attemptId);
      checkingIntegrity = false;
      if (!successful(status) || status.stdout.length !== 0 || !successful(head) || head.stdout.trim().toLowerCase() !== target.baseSha.toLowerCase()
        || symbolic.exitCode !== 1 || symbolic.timedOut || symbolic.cancelled || symbolic.stdout.trim() !== '' || hasNewProhibitedInvestigationRefs(before, after)) {
        outcome = error(false, 'Governed snapshot or prohibited ref invariant violated.');
      } else if (signal.aborted || cli?.cancelled) {
        outcome = { kind: 'cancelled', acknowledged: true, handoffReference: 'investigation:cancelled' };
      } else if (!cli || !successful(cli) || Date.now() >= deadline) {
        outcome = error(true, 'Investigation CLI failed or deadline expired.');
      } else {
        let raw: unknown;
        transportFailure = { version: 1, stage: 'transport', reason: 'output_unavailable' };
        const size = await stat(outputPath);
        if (!size.isFile()) throw new Error('output_invalid');
        if (size.size > 100_000) {
          transportFailure = { version: 1, stage: 'transport', reason: 'output_too_large' };
          throw new Error('output_invalid');
        }
        const output = await readFile(outputPath, 'utf8');
        transportFailure = { version: 1, stage: 'transport', reason: 'output_not_json' };
        raw = JSON.parse(output) as unknown;
        transportFailure = undefined;
        const result = normalizeInvestigationTransport(raw);
        const inspection = result ? await inspectInvestigationEvidence(target.repoRoot, result) : null;
        const treated = result && inspection?.ok ? applyInvestigationEvidenceRejections(result, inspection.rejections) : null;
        if (!treated) {
          const failure = !result ? diagnoseInvestigationTransport(raw)
            : inspection && !inspection.ok ? inspection.failure
            : inspection?.ok ? diagnoseInvestigationRejectionTreatment(result, inspection.rejections) : null;
          outcome = error(true, 'Investigation structure or evidence does not resolve.', 'execution_failed', failure ?? undefined);
        } else {
          const result = treated.result;
          const investigation: InvestigationExecutionV1 = { ...result, hostVerification: { ...(treated.diagnostics.length ? { evidenceDiagnostics: treated.diagnostics } : {}), baseSha: target.baseSha, snapshotClean: true, snapshotHead: target.baseSha, snapshotDetached: true, prohibitedRefsBefore: before } };
          if (!parseInvestigationExecution(investigation)) throw new Error('host_observation_invalid');
          const resultReferences = [...new Set(result.findings.flatMap(f => f.evidence.map(renderInvestigationEvidence)))];
          outcome = { kind: 'result', summary: renderInvestigationSummary(result), investigation, resultReferences, validations: [],
            limitations: ['A/B are adapter attestations after snapshot disposal. No guarantee of confined reads, arbitrary filesystem integrity, absence of external/network effects, or semantic truth. Human review required.'], handoffReference: 'investigation:result' };
        }
      }
    } catch {
      // Diagnostics never copy raw CLI output, secrets, or absolute paths into signals.
      outcome = !checkingIntegrity && signal.aborted
        ? { kind: 'cancelled', acknowledged: true, handoffReference: 'investigation:cancelled' }
        : error(!checkingIntegrity, 'Investigation host operation or output validation failed.', 'execution_failed', transportFailure);
    } finally {
      if (attached && snapshot) {
        const removed = await git(target.repoRoot, ['worktree', 'remove', '--force', snapshot]);
        if (!successful(removed)) outcome = error(false, 'Snapshot disposal failed.');
      }
      if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => { outcome = error(false, 'Temporary artifact disposal failed.'); });
    }
    return outcome;
  }
}
