import { containsSensitiveData } from './execution-attempt';
import type { VerifierOpinionV1, VerifierOpinionFinding } from './verifier-opinion';

export type InvestigationEvidenceV1 =
  | { readonly kind: 'commit'; readonly commit: string }
  | { readonly kind: 'file_at_commit'; readonly commit: string; readonly path: string; readonly lines?: { readonly start: number; readonly end: number } };
export interface InvestigationResultV1 {
  readonly schemaVersion: 1;
  readonly findings: readonly { readonly statement: string; readonly status: 'established' | 'inferred' | 'undetermined'; readonly evidence: readonly InvestigationEvidenceV1[] }[];
  readonly gaps: readonly string[];
  readonly outcome: 'conclusive' | 'partial' | 'inconclusive';
}
/** Adapter observations survive disposal, but are attestations, not independent git events. */
export interface InvestigationExecutionV1 extends InvestigationResultV1 {
  readonly hostVerification: {
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
  if (!result || !h || !keys(h, ['baseSha', 'snapshotClean', 'snapshotHead', 'snapshotDetached', 'prohibitedRefsBefore'])
    || !isInvestigationCommit(h.baseSha) || h.snapshotHead !== h.baseSha || h.snapshotClean !== true || h.snapshotDetached !== true
    || !Array.isArray(h.prohibitedRefsBefore) || h.prohibitedRefsBefore.length > 2000
    || !h.prohibitedRefsBefore.every(r => text(r, 400) && r.startsWith('refs/heads/anima-work/'))) return null;
  return { ...result, hostVerification: { baseSha: h.baseSha, snapshotClean: true, snapshotHead: h.baseSha, snapshotDetached: true, prohibitedRefsBefore: h.prohibitedRefsBefore as string[] } };
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
