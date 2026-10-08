import type { Json } from '@anima/types';
import { parseInvestigationExecution, renderInvestigationSummary, type InvestigationExecutionV1 } from './investigation-result';
import { parseVerifierOpinion, type VerifierOpinionV1 } from './verifier-opinion';
import type { WorkEvent, WorkItem } from './types';

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const dataOf = (event: WorkEvent): Record<string, unknown> | null => {
  const envelope = object(event.payload);
  return envelope?.schema_version === 1 ? object(envelope.data) : null;
};
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === 'string');

export interface InvestigationSourceV1 {
  readonly eventId: string;
  readonly seq: number | null;
  readonly proposalVersion: number | null;
  readonly attemptId: string | null;
}
export interface InvestigationReviewV1 {
  readonly schemaVersion: 1;
  readonly status: 'not_submitted' | 'available' | 'invalid';
  readonly issue: 'invalid_payload' | 'correlation_mismatch' | 'stale_result' | null;
  readonly source: InvestigationSourceV1 | null;
  readonly investigation: InvestigationExecutionV1 | null;
  readonly limitations: readonly string[];
  readonly resultReferences: readonly string[];
  readonly handoffReference: string | null;
  readonly verifierRecorded: VerifierOpinionV1 | null;
  readonly humanReview: {
    readonly status: 'pending' | 'accepted';
    readonly eventId: string | null;
    readonly resultEventId: string | null;
  };
  /** Structural verifier checks never establish semantic acceptance coverage. */
  readonly automaticAcceptanceCoverage: 'not_applicable';
}

export function isInvestigationWork(item: WorkItem): boolean {
  return object(item.intent.execution_spec)?.executor === 'investigation-v1';
}

/** Ordered canonical events in; no Git, filesystem, verifier execution or writes.
 * Never fall back to an older valid result when the latest submission is invalid.
 */
export function projectInvestigationReview(item: WorkItem, events: readonly WorkEvent[]): InvestigationReviewV1 | null {
  if (!isInvestigationWork(item)) return null;
  const empty: InvestigationReviewV1 = {
    schemaVersion: 1, status: 'not_submitted', issue: null, source: null, investigation: null,
    limitations: [], resultReferences: [], handoffReference: null, verifierRecorded: null,
    humanReview: { status: 'pending', eventId: null, resultEventId: null },
    automaticAcceptanceCoverage: 'not_applicable',
  };
  const event = [...events].reverse().find(e => e.type === 'result_submitted');
  if (!event) return empty;
  const data = dataOf(event), signal = object(data?.executor_signal);
  const source: InvestigationSourceV1 = {
    eventId: event.id, seq: event.seq ?? null, proposalVersion: event.proposalVersion,
    attemptId: typeof data?.attempt_id === 'string' ? data.attempt_id : null,
  };
  const invalid = (issue: InvestigationReviewV1['issue']): InvestigationReviewV1 =>
    ({ ...empty, status: 'invalid', issue, source });
  if (event.workItemId !== item.id || event.author !== 'executor' || data?.origin !== 'executor'
    || data.work_item_id !== item.id || data.approved_proposal_version !== event.proposalVersion
    || !source.attemptId?.trim() || signal?.kind !== 'result' || signal.origin !== 'executor'
    || signal.workItemId !== item.id || signal.attemptId !== source.attemptId
    || signal.approvedProposalVersion !== event.proposalVersion || signal.worktreeHandoff !== undefined) return invalid('correlation_mismatch');
  if (event.proposalVersion !== item.proposalVersion) return invalid('stale_result');
  const investigation = parseInvestigationExecution(signal.investigation);
  const spec = object(item.intent.execution_spec);
  if (!investigation || spec?.effect_class !== 'read_only' || spec.base_sha !== investigation.hostVerification.baseSha
    || signal.summary !== renderInvestigationSummary(investigation) || data.summary !== signal.summary
    || !strings(data.limitations) || !strings(data.result_references)
    || typeof data.handoff_reference !== 'string' || data.handoff_reference !== signal.handoffReference
    || !data.handoff_reference.trim() || /^[a-z]:[\\/]|^[\\/]/i.test(data.handoff_reference)) return invalid('invalid_payload');
  // Match both the opinion envelope and its result basis. A different result's
  // verdict must not leak into this report, even within the same proposal.
  let verifierRecorded: VerifierOpinionV1 | null = null;
  let humanReview = empty.humanReview;
  const resultIndex = events.indexOf(event);
  for (const candidate of events.slice(resultIndex + 1)) {
    if (candidate.workItemId !== item.id || candidate.proposalVersion !== event.proposalVersion) continue;
    const d = dataOf(candidate);
    if (candidate.type === 'verifier_opinion_recorded' && candidate.author === 'system') {
      const opinion = parseVerifierOpinion(d?.opinion as Json | undefined);
      if (opinion?.verifierVersion === 'investigation-verifier-v1' && opinion.workItemId === item.id
        && opinion.attemptId === source.attemptId && opinion.approvedProposalVersion === event.proposalVersion
        && opinion.evidenceBasis.resultEventId === event.id && d?.work_item_id === item.id
        && d.attempt_id === source.attemptId && d.approved_proposal_version === event.proposalVersion) verifierRecorded = opinion;
    }
    if (candidate.type === 'result_accepted' && candidate.author === 'user' && d?.accepted_result_event_id === event.id) {
      humanReview = { status: 'accepted', eventId: candidate.id, resultEventId: event.id };
    }
  }
  return { ...empty, status: 'available', source, investigation, limitations: data.limitations,
    resultReferences: data.result_references, handoffReference: data.handoff_reference, verifierRecorded, humanReview };
}
