import type { CoderTranscript, CoderTranscriptEntry } from '@anima/core';
import type { HostValidationFeedback } from './coder-backend';
import { anchorMatchEvidence, sha256, type EditOperation, type ServedRead } from './ollama-protocol';

const normalized = (s: string): string => s.replace(/\r\n|\r/g, '\n');
// Always redact, including innocuous-looking identifiers: source may contain secrets.
const shape = (s: string): string => s.slice(0, 160).replace(/[^\s{}()[\];:,.='"+\-*/<>!?]/g, 'x');
const fingerprints = (s: string) => ({ fingerprint: sha256(s), normalizedFingerprint: sha256(normalized(s)), length: s.length, structure: shape(s) });

export class OllamaTranscript {
  private readonly entries: CoderTranscriptEntry[] = [];
  private truncated = false;
  private termination = 'returned';
  private readonly slices = new Map<number, string[]>();
  failed(error: unknown): void {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    this.termination = /^ollama_[a-z_]+$/.test(code) ? code : 'failed';
  }
  constructor(private readonly feedback: HostValidationFeedback | undefined) {}
  private add(entry: Omit<CoderTranscriptEntry, 'step'>): number {
    if (this.entries.length >= 256) { this.truncated = true; return 0; }
    const step = this.entries.length + 1;
    this.entries.push({ ...entry, step });
    return step;
  }
  read(read: ServedRead, round: number): void {
    const step = this.add({ round, phase: 'read', operation: 'read', operationStep: null, path: read.path,
      readRefs: [], anchorReadRefs: [], readHash: read.sha256, expectedHash: null, ...fingerprints(read.slice),
      lines: [...read.slice.matchAll(/^\s*(\d+)\| /gm)].map(m => Number(m[1])).slice(0, 200),
      clipped: read.slice.includes('trecho truncado por limite'), rawMatchCount: null, matchCount: null, result: 'served' });
    // Keep contiguous served ranges only; never bridge an omitted region.
    const chunks: string[] = []; let previous = -1;
    for (const line of read.slice.split('\n')) {
      const m = /^\s*(\d+)\| (.*)$/.exec(line);
      if (!m) { previous = -1; continue; }
      const n = Number(m[1]);
      if (n !== previous + 1) chunks.push(m[2]!); else chunks[chunks.length - 1] += '\n' + m[2]!;
      previous = n;
    }
    if (step) this.slices.set(step, chunks);
  }
  edit(op: EditOperation, original: string | null, round: number): number {
    const anchor = op.kind === 'replace_exact' ? op.before : op.kind === 'insert' ? op.anchor : '';
    const readHash = original === null ? null : sha256(original);
    const expectedHash = op.kind === 'create_file' ? null : op.expectedFileSha256;
    const counts = anchor && original !== null ? anchorMatchEvidence(original, anchor) : { rawMatchCount: null, matchCount: null };
    const result = expectedHash !== null && readHash !== expectedHash ? 'stale_read'
      : counts.matchCount === 0 ? 'invalid_anchor' : counts.matchCount !== null && counts.matchCount > 1 ? 'ambiguous_anchor'
      : counts.matchCount === 1 ? counts.rawMatchCount === 0 ? 'normalized_match' : 'exact_match' : 'not_applicable';
    const readRefs = this.entries.filter(e => e.phase === 'read' && e.path === op.path && e.readHash === readHash).map(e => e.step);
    return this.add({ round, phase: 'edit', operation: op.kind, operationStep: null, path: op.path,
      readRefs, anchorReadRefs: anchor ? readRefs.filter(ref => this.slices.get(ref)?.some(chunk => anchorMatchEvidence(chunk, anchor).matchCount > 0)) : [],
      readHash, expectedHash, ...fingerprints(anchor), lines: [], clipped: anchor.length > 160, ...counts, result });
  }
  application(steps: readonly number[], result: 'applied' | 'batch_failed' | 'write_failed'): void {
    for (const step of steps) {
      const source = this.entries[step - 1];
      if (source) this.add({ ...source, operationStep: step, phase: 'application', result });
    }
  }
  value(): CoderTranscript {
    const call = this.feedback?.retryIndex ?? 0;
    return { schemaVersion: 1, call, previousCall: call > 0 ? call - 1 : null,
      gateFingerprint: this.feedback?.kind === 'gate-failure' ? sha256(JSON.stringify(this.feedback.failedGate)) : null,
      diffFingerprint: this.feedback?.kind === 'gate-failure' ? this.feedback.diffSha256 : null,
      termination: this.termination, truncated: this.truncated, entries: [...this.entries] };
  }
}
