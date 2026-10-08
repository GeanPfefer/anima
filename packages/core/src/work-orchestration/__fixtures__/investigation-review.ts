import type { Json } from '@anima/types';
import type { WorkEvent, WorkItem } from '../types';
import { computeInvestigationVerifierOpinion, renderInvestigationEvidence, renderInvestigationSummary, type InvestigationExecutionV1 } from '../investigation-result';

export const investigationItem: WorkItem = {
  id: '10000000-0000-0000-0000-000000000001', userId: 'owner', sourceMessageId: 'message',
  state: 'review', impactLevel: 'low', capability: 'research', originalRequest: 'Audit contracts',
  intent: { investigation_question: 'Audit contracts', investigation_provenance: {
    kind: 'investigation_preparation', origin: 'cli_propose_investigation_v1', reference: 'INV-10',
    baseSha: 'a'.repeat(40), preparedAt: '2026-10-08T00:00:00.000Z',
  }, execution_spec: { schema_version: 1, executor: 'investigation-v1', effect_class: 'read_only',
    base_sha: 'a'.repeat(40), verifier_requirement: 'advisory', permissions: ['workspace_read'],
    target: { kind: 'project', reference: 'anima' }, limits: { max_attempts: 1, max_duration_minutes: 30 },
    validation_criteria: [{ label: 'Report with evidence and gaps' }] } },
  proposalVersion: 2, proposal: { schemaVersion: 1, data: {
    summary: 'Audit', objective: 'Audit contracts', expectedEffects: ['Answer the question'],
    includedScope: ['packages/core'], excludedScope: ['database'], risks: [],
  } }, createdAt: new Date('2026-10-08T00:00:00Z'), updatedAt: new Date('2026-10-08T00:00:00Z'),
};
export function investigationFixture(outcome: InvestigationExecutionV1['outcome'] = 'partial') {
  const investigation: InvestigationExecutionV1 = {
    schemaVersion: 1, outcome, findings: [
      { statement: 'Contract exists', status: 'established', evidence: [{ kind: 'file_at_commit', path: 'src/contract.ts', commit: 'a'.repeat(40), lines: { start: 1, end: 3 } }] },
      { statement: 'Likely consequence', status: 'inferred', evidence: [{ kind: 'commit', commit: 'a'.repeat(40) }] },
      { statement: 'Unknown runtime', status: 'undetermined', evidence: [] },
    ], gaps: outcome === 'conclusive' ? [] : ['Runtime not audited'],
    hostVerification: { baseSha: 'a'.repeat(40), snapshotHead: 'a'.repeat(40), snapshotClean: true,
      snapshotDetached: true, prohibitedRefsBefore: [], evidenceDiagnostics: [] },
  };
  const summary = renderInvestigationSummary(investigation);
  const references = investigation.findings.flatMap(f => f.evidence.map(renderInvestigationEvidence));
  const limitations = ['A/B are attestations. Semantic truth requires human review.'];
  const result: WorkEvent = { id: 'result', seq: 100, workItemId: investigationItem.id, type: 'result_submitted',
    author: 'executor', proposalVersion: 2, occurredAt: new Date('2026-10-08T00:01:00Z'), payload: { schema_version: 1, data: {
      origin: 'executor', work_item_id: investigationItem.id, approved_proposal_version: 2, attempt_id: 'attempt',
      summary, limitations, result_references: references, handoff_reference: 'investigation:result',
      executor_signal: { origin: 'executor', workItemId: investigationItem.id, approvedProposalVersion: 2,
        attemptId: 'attempt', kind: 'result', sequence: 1, summary, investigation: investigation as unknown as Json,
        resultReferences: references, limitations, validations: [], handoffReference: 'investigation:result' },
    } } };
  const opinion = computeInvestigationVerifierOpinion({ workItemId: investigationItem.id, attemptId: 'attempt',
    approvedProposalVersion: 2, resultEventId: result.id, investigation, referencesResolve: true, prohibitedRefsAbsent: true });
  const verifier: WorkEvent = { id: 'opinion', seq: 101, workItemId: investigationItem.id,
    type: 'verifier_opinion_recorded', author: 'system', proposalVersion: 2, occurredAt: new Date('2026-10-08T00:02:00Z'),
    payload: { schema_version: 1, data: { work_item_id: investigationItem.id, attempt_id: 'attempt',
      approved_proposal_version: 2, opinion: opinion as unknown as Json } } };
  const accepted: WorkEvent = { id: 'accept', seq: 102, workItemId: investigationItem.id, type: 'result_accepted', author: 'user',
    proposalVersion: 2, occurredAt: new Date('2026-10-08T00:03:00Z'), payload: { schema_version: 1, data: { accepted_result_event_id: 'result' } } };
  return { investigation, result, verifier, accepted, opinion };
}
