import { computeInvestigationVerifierOpinion, INVESTIGATION_OUTPUT_SCHEMA, normalizeInvestigationTransport, parseInvestigationExecution, parseInvestigationResult, renderInvestigationSummary } from './investigation-result';

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
