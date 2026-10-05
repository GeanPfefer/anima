import { applyInvestigationEvidenceRejections, type InvestigationResultV1, computeInvestigationVerifierOpinion, INVESTIGATION_OUTPUT_SCHEMA, normalizeInvestigationTransport, parseInvestigationExecution, parseInvestigationResult, renderInvestigationSummary } from './investigation-result';

const commit = 'a'.repeat(40);
const valid = () => ({ schemaVersion: 1, outcome: 'conclusive', gaps: [], findings: [{ statement: 'Contract exists.', status: 'established', evidence: [{ kind: 'file_at_commit', commit, path: 'src/file.ts', lines: { start: 1, end: 2 } }] }] });
describe('InvestigationResultV1', () => {
  test('strict transport normalizes null line ranges', () => {
    const result = valid();
    const parsed = parseInvestigationResult({ ...result, findings: [{ ...result.findings[0], evidence: [{ kind: 'file_at_commit', commit, path: 'src/file.ts', lines: null }] }] });
    expect(parsed?.findings[0]?.evidence[0]).toEqual({ kind: 'file_at_commit', commit, path: 'src/file.ts' });
    expect(INVESTIGATION_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(INVESTIGATION_OUTPUT_SCHEMA.required).toContain('outcome');
    expect(renderInvestigationSummary(parsed!)).toContain('[established] Contract exists.');
  });
  test.each(['established', 'inferred'])('%s needs evidence', status => {
    expect(parseInvestigationResult({ ...valid(), findings: [{ statement: 'Claim', status, evidence: [] }] })).toBeNull();
  });
  test('strict transport requires nullable line field and rejects fabricated host observations', () => {
    const result = valid();
    expect(normalizeInvestigationTransport(result)).not.toBeNull();
    expect(normalizeInvestigationTransport({ ...result, hostVerification: {} })).toBeNull();
    expect(normalizeInvestigationTransport({ ...result, findings: [{ ...result.findings[0], evidence: [{ kind: 'file_at_commit', commit, path: 'src/file.ts' }] }] })).toBeNull();
  });
  test('undetermined may have no evidence; inconclusive is a valid result', () => {
    expect(parseInvestigationResult({ schemaVersion: 1, outcome: 'inconclusive', findings: [], gaps: ['Required history unavailable.'] })).not.toBeNull();
    expect(parseInvestigationResult({ ...valid(), findings: [{ statement: 'Unknown', status: 'undetermined', evidence: [] }] })).not.toBeNull();
  });
  test.each(['partial', 'inconclusive'])('%s requires gaps', outcome => {
    expect(parseInvestigationResult({ ...valid(), outcome })).toBeNull();
  });
  test.each(['../file', '/tmp/file', 'C:/file', 'src\\file', 'src/../file', '.git/config', 'src//file', 'file\nname', 'src/file:part'])('unsafe evidence path %p', path => {
    const result = valid(); result.findings[0]!.evidence[0]!.path = path;
    expect(parseInvestigationResult(result)).toBeNull();
  });
  test('bad commits, line bounds, unknown types and secret content are rejected', () => {
    for (const evidence of [{ kind: 'commit', commit: 'short' }, { kind: 'url', commit }, { kind: 'file_at_commit', commit, path: 'file', lines: { start: 3, end: 2 } }]) {
      expect(parseInvestigationResult({ ...valid(), findings: [{ statement: 'Claim', status: 'inferred', evidence: [evidence] }] })).toBeNull();
    }
    expect(parseInvestigationResult({ ...valid(), gaps: ['api_key=secret'] })).toBeNull();
    expect(parseInvestigationResult({ ...valid(), findings: [], outcome: 'conclusive' })).toBeNull();
    expect(parseInvestigationResult({ ...valid(), findings: Array(41).fill(valid().findings[0]) })).toBeNull();
    expect(parseInvestigationResult({ ...valid(), gaps: ['x'.repeat(2001)] })).toBeNull();
    expect(parseInvestigationResult({ ...valid(), extra: 'unknown' })).toBeNull();
  });
  test('opinion distinguishes independent checks from disposed snapshot attestations', () => {
    const investigation = { ...valid(), hostVerification: { baseSha: commit, snapshotHead: commit, snapshotClean: true, snapshotDetached: true, prohibitedRefsBefore: [] } };
    expect(parseInvestigationExecution(investigation)).not.toBeNull();
    const input = { workItemId: 'work', attemptId: 'attempt', approvedProposalVersion: 1, resultEventId: 'result', investigation, referencesResolve: true, prohibitedRefsAbsent: true };
    const opinion = computeInvestigationVerifierOpinion(input);
    expect(opinion).toMatchObject({ verdict: 'verified', verifierVersion: 'investigation-verifier-v1', restsOnAttestedEvidence: true, summary: { attested: 2, independent: 3 }, evidenceBasis: { observedEventId: null, observedGateEventId: null, coverage: { git: false, gates: false } } });
    expect(opinion.findings.map(f => f.provenance)).toEqual(['attested', 'attested', 'independent', 'independent', 'independent']);
    expect(computeInvestigationVerifierOpinion({ ...input, referencesResolve: false }).verdict).toBe('inconclusive');
    expect(computeInvestigationVerifierOpinion({ ...input, prohibitedRefsAbsent: false }).verdict).toBe('inconclusive');
  });
});

describe('host line-range rejections', () => {
  const ref = { kind: 'file_at_commit' as const, commit, path: 'src/file.ts', lines: { start: 1, end: 3 } };
  const finding = (status: 'established' | 'inferred' | 'undetermined', count: number) => ({ statement: 'Original statement', status, evidence: Array.from({ length: count }, () => ref) });
  const result = (findings: InvestigationResultV1['findings']): InvestigationResultV1 => ({ schemaVersion: 1, outcome: 'conclusive', gaps: [], findings });
  const reject = (findingIndex: number, evidenceIndex = 0) => ({ findingIndex, evidenceIndex, actualLineCount: 2, reason: 'line_end_out_of_range' as const });
  test('CASE1 retains status and remaining refs, using original indices', () => {
    const input = result([finding('established', 3)]);
    const treated = applyInvestigationEvidenceRejections(input, [reject(0, 1)])!;
    expect(treated.result.findings[0]).toEqual({ ...input.findings[0], evidence: [ref, ref] });
    expect(treated.result.outcome).toBe('conclusive');
    expect(treated.diagnostics[0]).toMatchObject({ findingIndex: 0, evidenceIndex: 1, requestedLines: { start: 1, end: 3 }, actualLineCount: 2, findingDowngraded: false });
    expect(input.findings[0]!.evidence).toHaveLength(3);
  });
  test('CASE2/CASE4 downgrade only unsupported findings and conclusive becomes partial', () => {
    const input = result([finding('established', 1), finding('inferred', 1)]);
    const treated = applyInvestigationEvidenceRejections(input, [reject(0)])!;
    expect(treated.result.outcome).toBe('partial');
    expect(treated.result.findings[0]).toEqual({ statement: 'Original statement', status: 'undetermined', evidence: [] });
    expect(treated.result.findings[1]).toBe(input.findings[1]);
    expect(treated.diagnostics[0]!.findingDowngraded).toBe(true);
    expect(treated.result.gaps).toEqual(['Host: 1 evidence reference(s) failed line-range validation and were not accepted; 1 finding(s) downgraded to undetermined. See hostVerification.evidenceDiagnostics.']);
  });
  test('CASE3/no rejection returns identical result without a host gap', () => {
    const input = result([finding('undetermined', 0)]);
    expect(applyInvestigationEvidenceRejections(input, [])).toEqual({ result: input, diagnostics: [] });
    expect(applyInvestigationEvidenceRejections(input, [])!.result).toBe(input);
  });
  test.each(['conclusive', 'partial', 'inconclusive'] as const)('preserves %s when rejecting a ref from an already undetermined finding', outcome => {
    const input = { ...result([finding('undetermined', 1), finding('undetermined', 0)]), outcome, gaps: ['Model gap'] };
    const treated = applyInvestigationEvidenceRejections(input, [reject(0)])!;
    expect(treated.result.outcome).toBe(outcome);
    expect(treated.result.findings[0]).toEqual({ statement: 'Original statement', status: 'undetermined', evidence: [] });
    expect(treated.result.findings[1]).toBe(input.findings[1]);
    expect(treated.diagnostics[0]!.findingDowngraded).toBe(false);
    expect(treated.result.gaps).toEqual(['Model gap', 'Host: 1 evidence reference(s) failed line-range validation and were not accepted; 0 finding(s) downgraded to undetermined. See hostVerification.evidenceDiagnostics.']);
    expect(input.findings[0]!.evidence).toEqual([ref]);
  });
  test('partial becomes inconclusive when rejection downgrades its last supported finding', () => {
    const input = { ...result([finding('inferred', 1), finding('undetermined', 0)]), outcome: 'partial' as const, gaps: ['Model gap'] };
    const treated = applyInvestigationEvidenceRejections(input, [reject(0)])!;
    expect(treated.result.outcome).toBe('inconclusive');
    expect(treated.result.findings[0]).toEqual({ statement: 'Original statement', status: 'undetermined', evidence: [] });
    expect(treated.result.findings[1]).toBe(input.findings[1]);
    expect(treated.diagnostics[0]!.findingDowngraded).toBe(true);
    expect(treated.result.gaps[0]).toBe('Model gap');
  });
  test('CASE5 all refs rejected makes outcome inconclusive and preserves model gaps', () => {
    const input = { ...result([finding('established', 1), finding('inferred', 1), finding('undetermined', 0)]), gaps: ['Model gap'] };
    const treated = applyInvestigationEvidenceRejections(input, [reject(1), reject(0)])!;
    expect(treated.result.outcome).toBe('inconclusive');
    expect(treated.result.findings.every(f => f.status === 'undetermined' && f.evidence.length === 0)).toBe(true);
    expect(treated.result.findings[2]).toBe(input.findings[2]);
    expect(treated.result.gaps).toHaveLength(2);
    expect(treated.result.gaps[0]).toBe('Model gap');
    expect(treated.diagnostics.map(d => d.findingIndex)).toEqual([0, 1]);
    expect(parseInvestigationResult(treated.result)).not.toBeNull();
  });
  test('gap and diagnostic bounds fail closed rather than truncate', () => {
    expect(applyInvestigationEvidenceRejections({ ...result([finding('established', 1)]), gaps: Array(40).fill('Gap') }, [reject(0)])).toBeNull();
    const input = result([finding('established', 20), finding('inferred', 20), finding('established', 1)]);
    const rejections = input.findings.flatMap((f, fi) => f.evidence.map((_, ei) => reject(fi, ei)));
    expect(applyInvestigationEvidenceRejections(input, rejections)).toBeNull();
  });
  test('optional diagnostics are host-only and parsed with closed keys', () => {
    const treated = applyInvestigationEvidenceRejections(result([finding('established', 1)]), [reject(0)])!;
    const hostVerification = { baseSha: commit, snapshotHead: commit, snapshotClean: true, snapshotDetached: true, prohibitedRefsBefore: [] };
    const execution = { ...treated.result, hostVerification: { ...hostVerification, evidenceDiagnostics: treated.diagnostics } };
    expect(parseInvestigationExecution(execution)).toEqual(execution);
    expect(parseInvestigationExecution({ ...treated.result, hostVerification })).not.toBeNull();
    expect(parseInvestigationExecution({ ...treated.result, evidenceDiagnostics: treated.diagnostics })).toBeNull();
    for (const diagnostic of [{ ...treated.diagnostics[0], extra: true }, { ...treated.diagnostics[0], commit: 'bad' }, { ...treated.diagnostics[0], reason: 'unknown' }, { ...treated.diagnostics[0], requestedLines: { start: 1, end: 3, extra: true } }, { ...treated.diagnostics[0], actualLineCount: -1 }, { ...treated.diagnostics[0], findingIndex: 1.5 }]) {
      expect(parseInvestigationExecution({ ...execution, hostVerification: { ...hostVerification, evidenceDiagnostics: [diagnostic] } })).toBeNull();
    }
    expect(parseInvestigationExecution({ ...execution, hostVerification: { ...hostVerification, evidenceDiagnostics: Array(41).fill(treated.diagnostics[0]) } })).toBeNull();
    expect(normalizeInvestigationTransport({ ...valid(), evidenceDiagnostics: treated.diagnostics })).toBeNull();
    expect(normalizeInvestigationTransport(execution)).toBeNull();
  });
});
