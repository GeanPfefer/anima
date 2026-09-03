/** Explicit human authority. V1: one extension of an exhausted minimal-test replan. */
export interface HumanResumeAuthorization {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly reason: string;
  readonly additionalAttempts: 1;
  readonly aggregateCeiling: number;
  readonly diagnosis: {
    readonly reference: string;
    readonly priorApiAssumption: 'exports_absent';
    readonly correctedApiAssumption: 'exports_present';
    readonly apiPath: string;
    readonly exports: readonly string[];
    readonly syntaxFailure: 'unbalanced_block';
    readonly anchorFailure: 'no_match_cause_unproven';
  };
  readonly planRevision: 'inspect_existing_exports_and_current_reads_v1';
  readonly compute: { readonly placement: 'local'; readonly preferred: string; readonly fallback: string; readonly paid: false };
}
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string) => Object.keys(v).sort().join(',') === names.split(',').sort().join(',');
export function readHumanResumeAuthorization(v: unknown): HumanResumeAuthorization | null {
  if (!obj(v) || !keys(v,'schemaVersion,requestId,reason,additionalAttempts,aggregateCeiling,diagnosis,planRevision,compute')
    || v.schemaVersion !== 1 || typeof v.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.requestId)
    || typeof v.reason !== 'string' || v.reason.trim().length < 10 || v.reason.length > 500
    || v.additionalAttempts !== 1 || !Number.isInteger(v.aggregateCeiling) || Number(v.aggregateCeiling) < 2 || Number(v.aggregateCeiling) > 4
    || v.planRevision !== 'inspect_existing_exports_and_current_reads_v1') return null;
  const d = v.diagnosis, c = v.compute;
  if (!obj(d) || !keys(d,'reference,priorApiAssumption,correctedApiAssumption,apiPath,exports,syntaxFailure,anchorFailure')
    || typeof d.reference !== 'string' || !/^docs\/registros\/[A-Za-z0-9_-]+\.md$/.test(d.reference)
    || d.priorApiAssumption !== 'exports_absent' || d.correctedApiAssumption !== 'exports_present'
    || d.syntaxFailure !== 'unbalanced_block' || d.anchorFailure !== 'no_match_cause_unproven'
    || typeof d.apiPath !== 'string' || !/^[A-Za-z0-9_/-]+\.[ct]sx?$/.test(d.apiPath) || d.apiPath.startsWith('/') || d.apiPath.includes('..')
    || !Array.isArray(d.exports) || d.exports.length < 1 || d.exports.length > 8
    || new Set(d.exports).size !== d.exports.length || d.exports.some(s => typeof s !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,79}$/.test(s))) return null;
  if (!obj(c) || !keys(c,'placement,preferred,fallback,paid') || c.placement !== 'local' || c.paid !== false
    || [c.preferred,c.fallback].some(s => typeof s !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(s))) return null;
  return v as unknown as HumanResumeAuthorization;
}
