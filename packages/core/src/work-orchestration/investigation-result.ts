import { containsSensitiveData } from './execution-attempt';
import type { VerifierOpinionV1, VerifierOpinionFinding } from './verifier-opinion';

export type InvestigationEvidenceV1 =
  | { readonly kind: 'commit'; readonly commit: string }
  | { readonly kind: 'file_at_commit'; readonly commit: string; readonly path: string; readonly lines?: { readonly start: number; readonly end: number } };
export interface InvestigationEvidenceDiagnosticV1 {
  readonly findingIndex: number;
  readonly evidenceIndex: number;
  readonly kind: 'file_at_commit';
  readonly commit: string;
  readonly path: string;
  readonly requestedLines: { readonly start: number; readonly end: number };
  readonly actualLineCount: number;
  readonly reason: 'line_start_out_of_range' | 'line_end_out_of_range';
  readonly findingDowngraded: boolean;
}
export type InvestigationEvidenceRejectionV1 = Pick<InvestigationEvidenceDiagnosticV1, 'findingIndex' | 'evidenceIndex' | 'reason' | 'actualLineCount'>;
export interface InvestigationResultV1 {
  readonly schemaVersion: 1;
  readonly findings: readonly { readonly statement: string; readonly status: 'established' | 'inferred' | 'undetermined'; readonly evidence: readonly InvestigationEvidenceV1[] }[];
  readonly gaps: readonly string[];
  readonly outcome: 'conclusive' | 'partial' | 'inconclusive';
}
/** Adapter observations survive disposal, but are attestations, not independent git events. */
export interface InvestigationExecutionV1 extends InvestigationResultV1 {
  readonly hostVerification: {
    readonly evidenceDiagnostics?: readonly InvestigationEvidenceDiagnosticV1[];
    readonly baseSha: string;
    readonly snapshotClean: true;
    readonly snapshotHead: string;
    readonly snapshotDetached: true;
    readonly prohibitedRefsBefore: readonly string[];
  };
}
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const keys = (v: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(v).every(k => allowed.includes(k));
export const isInvestigationCommit = (v: unknown): v is string => typeof v === 'string' && /^[a-fA-F0-9]{40}$/.test(v);
const text = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !containsSensitiveData(v);
export const isInvestigationPath = (v: unknown): v is string => text(v, 400) && !/[\\:\x00-\x1f]/.test(v)
  && !v.startsWith('/') && v.split('/').every(p => p.length > 0 && p !== '.' && p !== '..' && p.toLowerCase() !== '.git');

export function parseInvestigationResult(value: unknown): InvestigationResultV1 | null {
  const root = object(value);
  if (!root || !keys(root, ['schemaVersion', 'findings', 'gaps', 'outcome', 'hostVerification']) || root.schemaVersion !== 1
    || !Array.isArray(root.findings) || root.findings.length > 40 || !Array.isArray(root.gaps) || root.gaps.length > 40
    || !root.gaps.every(g => text(g)) || (root.outcome !== 'conclusive' && root.outcome !== 'partial' && root.outcome !== 'inconclusive')) return null;
  const findings: InvestigationResultV1['findings'][number][] = [];
  for (const raw of root.findings) {
    const f = object(raw);
    if (!f || !keys(f, ['statement', 'status', 'evidence']) || !text(f.statement)
      || (f.status !== 'established' && f.status !== 'inferred' && f.status !== 'undetermined')
      || !Array.isArray(f.evidence) || f.evidence.length > 20 || (f.status !== 'undetermined' && f.evidence.length === 0)) return null;
    const evidence: InvestigationEvidenceV1[] = [];
    for (const rawEvidence of f.evidence) {
      const e = object(rawEvidence);
      if (!e || !isInvestigationCommit(e.commit)) return null;
      if (e.kind === 'commit' && keys(e, ['kind', 'commit'])) { evidence.push({ kind: e.kind, commit: e.commit }); continue; }
      if (e.kind !== 'file_at_commit' || !keys(e, ['kind', 'commit', 'path', 'lines']) || !isInvestigationPath(e.path)) return null;
      const lines = e.lines === undefined || e.lines === null ? null : object(e.lines);
      if (e.lines !== undefined && e.lines !== null && (!lines || !keys(lines, ['start', 'end'])
        || typeof lines.start !== 'number' || typeof lines.end !== 'number' || !Number.isSafeInteger(lines.start)
        || !Number.isSafeInteger(lines.end) || lines.start < 1 || lines.end < lines.start)) return null;
      evidence.push({ kind: e.kind, commit: e.commit, path: e.path, ...(lines ? { lines: { start: lines.start as number, end: lines.end as number } } : {}) });
    }
    findings.push({ statement: f.statement, status: f.status, evidence });
  }
  if (root.outcome === 'conclusive' ? findings.length === 0 : root.gaps.length === 0) return null;
  const result: InvestigationResultV1 = { schemaVersion: 1, findings, gaps: root.gaps as string[], outcome: root.outcome as InvestigationResultV1['outcome'] };
  return JSON.stringify(result).length <= 100_000 ? result : null;
}

export function parseInvestigationExecution(value: unknown): InvestigationExecutionV1 | null {
  const result = parseInvestigationResult(value);
  const h = object(object(value)?.hostVerification);
  if (!result || !h || !keys(h, ['baseSha', 'snapshotClean', 'snapshotHead', 'snapshotDetached', 'prohibitedRefsBefore', 'evidenceDiagnostics'])
    || !isInvestigationCommit(h.baseSha) || h.snapshotHead !== h.baseSha || h.snapshotClean !== true || h.snapshotDetached !== true
    || !Array.isArray(h.prohibitedRefsBefore) || h.prohibitedRefsBefore.length > 2000
    || !h.prohibitedRefsBefore.every(r => text(r, 400) && r.startsWith('refs/heads/anima-work/'))) return null;
  const diagnostics: InvestigationEvidenceDiagnosticV1[] = [];
  if (h.evidenceDiagnostics !== undefined) {
    if (!Array.isArray(h.evidenceDiagnostics) || h.evidenceDiagnostics.length > 40) return null;
    for (const raw of h.evidenceDiagnostics) {
      const d = object(raw), lines = object(d?.requestedLines);
      if (!d || !keys(d, ['findingIndex', 'evidenceIndex', 'kind', 'commit', 'path', 'requestedLines', 'actualLineCount', 'reason', 'findingDowngraded'])
        || !lines || !keys(lines, ['start', 'end']) || d.kind !== 'file_at_commit' || !isInvestigationCommit(d.commit) || !isInvestigationPath(d.path)
        || ![d.findingIndex, d.evidenceIndex, d.actualLineCount].every(v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)
        || typeof lines.start !== 'number' || typeof lines.end !== 'number' || !Number.isSafeInteger(lines.start) || !Number.isSafeInteger(lines.end)
        || lines.start < 1 || lines.end < lines.start || typeof d.findingDowngraded !== 'boolean'
        || (d.reason !== 'line_start_out_of_range' && d.reason !== 'line_end_out_of_range')) return null;
      diagnostics.push({ findingIndex: d.findingIndex as number, evidenceIndex: d.evidenceIndex as number, kind: 'file_at_commit', commit: d.commit, path: d.path,
        requestedLines: { start: lines.start, end: lines.end }, actualLineCount: d.actualLineCount as number, reason: d.reason, findingDowngraded: d.findingDowngraded });
    }
  }
  return { ...result, hostVerification: { ...(h.evidenceDiagnostics !== undefined ? { evidenceDiagnostics: diagnostics } : {}), baseSha: h.baseSha, snapshotClean: true, snapshotHead: h.baseSha, snapshotDetached: true, prohibitedRefsBefore: h.prohibitedRefsBefore as string[] } };
}

/** Reject only host-inspected EOF ranges; original indices are preserved in diagnostics. */
export function applyInvestigationEvidenceRejections(result: InvestigationResultV1, rejections: readonly InvestigationEvidenceRejectionV1[]): { result: InvestigationResultV1; diagnostics: readonly InvestigationEvidenceDiagnosticV1[] } | null {
  if (rejections.length === 0) return { result, diagnostics: [] };
  if (rejections.length > 40 || result.gaps.length >= 40 || !parseInvestigationResult(result)) return null;
  const rejected = new Map<string, InvestigationEvidenceRejectionV1>();
  for (const r of rejections) {
    if (![r.findingIndex, r.evidenceIndex, r.actualLineCount].every(v => Number.isSafeInteger(v) && v >= 0)) return null;
    const e = result.findings[r.findingIndex]?.evidence[r.evidenceIndex];
    const key = `${r.findingIndex}:${r.evidenceIndex}`;
    if (!e || e.kind !== 'file_at_commit' || !e.lines || rejected.has(key)
      || r.reason !== (e.lines.start > r.actualLineCount ? 'line_start_out_of_range' : e.lines.end > r.actualLineCount ? 'line_end_out_of_range' : null)) return null;
    rejected.set(key, r);
  }
  let downgraded = 0;
  const findings = result.findings.map((f, fi) => {
    const evidence = f.evidence.filter((_, ei) => !rejected.has(`${fi}:${ei}`));
    if (evidence.length === f.evidence.length) return f;
    if (evidence.length === 0 && f.status !== 'undetermined') {
      downgraded++;
      return { ...f, status: 'undetermined' as const, evidence };
    }
    return { ...f, evidence };
  });
  const diagnostics: InvestigationEvidenceDiagnosticV1[] = [];
  result.findings.forEach((f, fi) => f.evidence.forEach((e, ei) => {
    const r = rejected.get(`${fi}:${ei}`);
    if (r && e.kind === 'file_at_commit' && e.lines) diagnostics.push({ findingIndex: fi, evidenceIndex: ei, reason: r.reason, actualLineCount: r.actualLineCount, kind: e.kind, commit: e.commit, path: e.path,
      requestedLines: { ...e.lines }, findingDowngraded: f.status !== 'undetermined' && findings[fi]!.status === 'undetermined' });
  }));
  const treated: InvestigationResultV1 = { ...result, findings,
    outcome: downgraded > 0 && !findings.some(f => f.status !== 'undetermined') ? 'inconclusive' : downgraded > 0 && result.outcome === 'conclusive' ? 'partial' : result.outcome,
    gaps: [...result.gaps, `Host: ${diagnostics.length} evidence reference(s) failed line-range validation and were not accepted; ${downgraded} finding(s) downgraded to undetermined. See hostVerification.evidenceDiagnostics.`] };
  return parseInvestigationResult(treated) ? { result: treated, diagnostics } : null;
}

/** Validate the strict CLI transport separately from the normalized persisted form. */
export function normalizeInvestigationTransport(value: unknown): InvestigationResultV1 | null {
  const root = object(value);
  if (!root || !keys(root, ['schemaVersion', 'findings', 'gaps', 'outcome']) || !Array.isArray(root.findings)) return null;
  for (const raw of root.findings) {
    const finding = object(raw);
    if (!finding || !Array.isArray(finding.evidence)) return null;
    for (const rawEvidence of finding.evidence) {
      const evidence = object(rawEvidence);
      if (!evidence || (evidence.kind === 'file_at_commit' && !Object.prototype.hasOwnProperty.call(evidence, 'lines'))) return null;
    }
  }
  return parseInvestigationResult(value);
}


/** Closed, content-free diagnostics; EOF range rejections deliberately stay separate. */
export const INVESTIGATION_FAILURE_REASONS = {
  transport: ['output_unavailable', 'output_too_large', 'output_not_json'],
  structure: ['transport_shape_invalid', 'outcome_invariant_invalid', 'evidence_required_missing', 'limits_exceeded', 'evidence_ref_malformed', 'result_invalid'],
  evidence: ['evidence_commit_missing', 'evidence_path_missing', 'evidence_path_not_regular_file', 'evidence_object_not_blob', 'evidence_file_too_large', 'evidence_content_invalid', 'evidence_git_unavailable'],
  post_rejection: ['rejection_overflow', 'rejection_inconsistent', 'treated_result_invalid'],
} as const;
export type InvestigationFailureV1 = {
  [S in keyof typeof INVESTIGATION_FAILURE_REASONS]: {
    readonly version: 1; readonly stage: S; readonly reason: typeof INVESTIGATION_FAILURE_REASONS[S][number];
    readonly findingIndex?: number; readonly evidenceIndex?: number;
  }
}[keyof typeof INVESTIGATION_FAILURE_REASONS];

export function parseInvestigationFailure(value: unknown): InvestigationFailureV1 | null {
  const v = object(value);
  if (!v || !keys(v, ['version', 'stage', 'reason', 'findingIndex', 'evidenceIndex']) || v.version !== 1
    || typeof v.stage !== 'string' || !Object.prototype.hasOwnProperty.call(INVESTIGATION_FAILURE_REASONS, v.stage)) return null;
  const reasons: readonly string[] = INVESTIGATION_FAILURE_REASONS[v.stage as keyof typeof INVESTIGATION_FAILURE_REASONS];
  if (typeof v.reason !== 'string' || !reasons.includes(v.reason)) return null;
  for (const key of ['findingIndex', 'evidenceIndex']) if (Object.prototype.hasOwnProperty.call(v, key)
    && (v.stage !== 'evidence' || typeof v[key] !== 'number' || !Number.isSafeInteger(v[key]) || (v[key] as number) < 0)) return null;
  return { version: 1, stage: v.stage, reason: v.reason,
    ...(v.findingIndex !== undefined ? { findingIndex: v.findingIndex } : {}),
    ...(v.evidenceIndex !== undefined ? { evidenceIndex: v.evidenceIndex } : {}) } as InvestigationFailureV1;
}

/** The existing normalizer is authoritative: classification never expands acceptance. */
export function diagnoseInvestigationTransport(value: unknown): InvestigationFailureV1 | null {
  if (normalizeInvestigationTransport(value)) return null;
  const fail = (reason: typeof INVESTIGATION_FAILURE_REASONS.structure[number]): InvestigationFailureV1 => ({ version: 1, stage: 'structure', reason });
  const root = object(value);
  if (!root || !keys(root, ['schemaVersion', 'findings', 'gaps', 'outcome']) || !Array.isArray(root.findings)) return fail('transport_shape_invalid');
  if (root.findings.length > 40 || (Array.isArray(root.gaps) && root.gaps.length > 40)) return fail('limits_exceeded');
  for (const raw of root.findings) {
    const f = object(raw);
    if (!f || !keys(f, ['statement', 'status', 'evidence']) || !Array.isArray(f.evidence)) return fail('transport_shape_invalid');
    if (f.evidence.length > 20) return fail('limits_exceeded');
    if ((f.status === 'established' || f.status === 'inferred') && f.evidence.length === 0) return fail('evidence_required_missing');
    for (const rawEvidence of f.evidence) {
      const e = object(rawEvidence);
      if (!e || !keys(e, e.kind === 'commit' ? ['kind', 'commit'] : ['kind', 'commit', 'path', 'lines'])
        || (e.kind === 'file_at_commit' && !Object.prototype.hasOwnProperty.call(e, 'lines'))) return fail('transport_shape_invalid');
      if (!isInvestigationCommit(e.commit)) return fail('evidence_ref_malformed');
      if (e.kind === 'file_at_commit') {
        const lines = e.lines == null ? null : object(e.lines);
        if (!isInvestigationPath(e.path) || (e.lines != null && (!lines || !keys(lines, ['start', 'end'])
          || typeof lines.start !== 'number' || typeof lines.end !== 'number' || !Number.isSafeInteger(lines.start)
          || !Number.isSafeInteger(lines.end) || lines.start < 1 || lines.end < lines.start))) return fail('evidence_ref_malformed');
      }
    }
  }
  if (Array.isArray(root.gaps) && (root.outcome === 'conclusive' ? root.findings.length === 0
    : (root.outcome === 'partial' || root.outcome === 'inconclusive') && root.gaps.length === 0)) return fail('outcome_invariant_invalid');
  if (root.schemaVersion === 1 && Array.isArray(root.gaps) && root.gaps.every(g => text(g))
    && ['conclusive', 'partial', 'inconclusive'].includes(String(root.outcome))) {
    const parts = root.findings.map(f => parseInvestigationResult({ schemaVersion: 1, findings: [f], gaps: [], outcome: 'conclusive' }));
    if (parts.every(p => p !== null)) {
      const normalized = { schemaVersion: 1, findings: parts.flatMap(p => p!.findings), gaps: root.gaps, outcome: root.outcome };
      if (JSON.stringify(normalized).length > 100_000) return fail('limits_exceeded');
    }
  }
  return fail('result_invalid');
}

export function diagnoseInvestigationRejectionTreatment(result: InvestigationResultV1, rejections: readonly InvestigationEvidenceRejectionV1[]): InvestigationFailureV1 | null {
  if (applyInvestigationEvidenceRejections(result, rejections)) return null;
  const fail = (reason: typeof INVESTIGATION_FAILURE_REASONS.post_rejection[number]): InvestigationFailureV1 => ({ version: 1, stage: 'post_rejection', reason });
  if (rejections.length > 40 || result.gaps.length >= 40) return fail('rejection_overflow');
  if (!parseInvestigationResult(result)) return fail('treated_result_invalid');
  const seen = new Set<string>();
  for (const r of rejections) {
    const e = result.findings[r.findingIndex]?.evidence[r.evidenceIndex];
    const key = `${r.findingIndex}:${r.evidenceIndex}`;
    if (![r.findingIndex, r.evidenceIndex, r.actualLineCount].every(v => Number.isSafeInteger(v) && v >= 0)
      || !e || e.kind !== 'file_at_commit' || !e.lines || seen.has(key)
      || r.reason !== (e.lines.start > r.actualLineCount ? 'line_start_out_of_range' : e.lines.end > r.actualLineCount ? 'line_end_out_of_range' : null)) return fail('rejection_inconsistent');
    seen.add(key);
  }
  return fail('treated_result_invalid');
}

/** Codex strict output schema: every object closes its keys and requires every field.
 * Optional line ranges are transported as null, then normalized to absence. */
export const INVESTIGATION_OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['schemaVersion', 'findings', 'gaps', 'outcome'],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] }, outcome: { type: 'string', enum: ['conclusive', 'partial', 'inconclusive'] },
    gaps: { type: 'array', maxItems: 40, items: { type: 'string', minLength: 1, maxLength: 2000 } },
    findings: { type: 'array', maxItems: 40, items: {
      type: 'object', additionalProperties: false, required: ['statement', 'status', 'evidence'], properties: {
        statement: { type: 'string', minLength: 1, maxLength: 2000 }, status: { type: 'string', enum: ['established', 'inferred', 'undetermined'] },
        evidence: { type: 'array', maxItems: 20, items: { anyOf: [
          { type: 'object', additionalProperties: false, required: ['kind', 'commit'], properties: { kind: { type: 'string', enum: ['commit'] }, commit: { type: 'string', pattern: '^[a-fA-F0-9]{40}$' } } },
          { type: 'object', additionalProperties: false, required: ['kind', 'commit', 'path', 'lines'], properties: {
            kind: { type: 'string', enum: ['file_at_commit'] }, commit: { type: 'string', pattern: '^[a-fA-F0-9]{40}$' }, path: { type: 'string', maxLength: 400 },
            lines: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['start', 'end'], properties: { start: { type: 'integer', minimum: 1 }, end: { type: 'integer', minimum: 1 } } }] },
          } },
        ] } },
      },
    } },
  },
} as const;

export const renderInvestigationEvidence = (evidence: InvestigationEvidenceV1): string => evidence.kind === 'commit'
  ? `commit:${evidence.commit}`
  : `${evidence.path}@${evidence.commit}${evidence.lines ? `:${evidence.lines.start}-${evidence.lines.end}` : ''}`;
export const renderInvestigationSummary = (result: InvestigationResultV1): string =>
  [result.outcome, ...result.findings.map(f => `[${f.status}] ${f.statement}${f.evidence.length ? ` (${f.evidence.map(renderInvestigationEvidence).join(', ')})` : ''}`), ...result.gaps.map(g => `Gap: ${g}`)].join('\n');

/** No semantic judge: these five checks concern structure/references/effect observations only.
 * Existing finding codes retain their type; subjects identify investigation-specific properties. */
export function computeInvestigationVerifierOpinion(input: {
  readonly workItemId: string; readonly attemptId: string; readonly approvedProposalVersion: number; readonly resultEventId: string;
  readonly investigation: unknown; readonly referencesResolve: boolean; readonly prohibitedRefsAbsent: boolean;
}): VerifierOpinionV1 {
  const result = parseInvestigationExecution(input.investigation);
  const checks = [
    { subject: 'A:snapshot_clean', ok: result !== null, provenance: 'attested' as const },
    { subject: 'B:snapshot_head_detached_at_base', ok: result !== null, provenance: 'attested' as const },
    { subject: 'C:no_new_prohibited_refs', ok: input.prohibitedRefsAbsent, provenance: 'independent' as const },
    { subject: 'D:references_resolve', ok: input.referencesResolve, provenance: 'independent' as const },
    { subject: 'E:valid_structure', ok: result !== null, provenance: 'independent' as const },
  ];
  const findings: VerifierOpinionFinding[] = checks.map(c => ({ code: c.ok ? 'status_coherent' : 'missing_result_evidence', severity: c.ok ? 'ok' : 'gap', provenance: c.provenance, subject: c.subject }));
  const gaps = checks.filter(c => !c.ok).length;
  return { schemaVersion: 1, workItemId: input.workItemId, attemptId: input.attemptId, approvedProposalVersion: input.approvedProposalVersion,
    verifierVersion: 'investigation-verifier-v1', verdict: gaps ? 'inconclusive' : 'verified', restsOnAttestedEvidence: true,
    findings, summary: { violations: 0, gaps, checks: 5, attested: 2, independent: 3 },
    evidenceBasis: { resultEventId: input.resultEventId, observedEventId: null, observedGateEventId: null, coverage: { git: false, gates: false } } };
}
