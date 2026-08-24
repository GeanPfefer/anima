import type { Enums } from '@anima/types';

export type OperationalWorkItemInput = {
  readonly id: string;
  readonly state: Enums<'work_state'>;
  readonly capability: Enums<'work_capability'>;
  readonly updatedAt: string;
};

export type OperationalWorkEventInput = {
  readonly workItemId: string;
  readonly eventType: Enums<'work_event_type'>;
  readonly author: Enums<'work_event_author'>;
  readonly occurredAt: string;
};

export type OperationalWorkFocusInput = {
  readonly workItemId: string;
  readonly updatedAt: string;
};

export type OperationalItemSnapshot = {
  readonly itemRef: string;
  readonly capability: Enums<'work_capability'>;
  readonly state: Enums<'work_state'>;
  readonly stateObservedAt: string;
  readonly latestEvent?: {
    readonly type: Enums<'work_event_type'>;
    readonly occurredAt: string;
  };
};

export type OperationalProjectSnapshot = {
  readonly generatedAt: string;
  readonly temporalSemantics: {
    readonly current: 'work_items projection at generatedAt';
    readonly recent: 'latest unresolved event in the bounded event sequence; no wall-clock TTL inferred';
    readonly historical: 'events superseded by a later current projection remain trajectory only';
  };
  readonly coverage: {
    readonly itemCount: number;
    readonly eventCount: number;
    readonly oldestEventAt: string | null;
    readonly newestEventAt: string | null;
  };
  readonly activeWork: readonly OperationalItemSnapshot[];
  readonly recentlyFailed: readonly OperationalItemSnapshot[];
  readonly awaitingReview: readonly OperationalItemSnapshot[];
  readonly blocked: readonly OperationalItemSnapshot[];
  readonly currentFocus: { readonly itemRef: string; readonly observedAt: string } | null;
  readonly recentVerifiedEvidence: readonly {
    readonly itemRef: string;
    readonly type: 'host_observed_evidence_recorded' | 'host_observed_gate_evidence_recorded' | 'host_observed_coder_evidence_recorded' | 'verifier_opinion_recorded';
    readonly occurredAt: string;
  }[];
  readonly uncertainties: readonly string[];
};

const ACTIVE_STATES = new Set<Enums<'work_state'>>(['approved', 'in_progress', 'blocked', 'review', 'changes_requested']);
const VERIFIED_EVENT_TYPES = new Set<OperationalProjectSnapshot['recentVerifiedEvidence'][number]['type']>([
  'host_observed_evidence_recorded',
  'host_observed_gate_evidence_recorded',
  'host_observed_coder_evidence_recorded',
  'verifier_opinion_recorded',
]);
const SUCCESS_AFTER_FAILURE = new Set<Enums<'work_event_type'>>(['result_submitted', 'result_accepted']);

const descending = (left: string, right: string) => right.localeCompare(left);

export function buildOperationalProjectSnapshot(input: {
  readonly generatedAt: string;
  readonly items: readonly OperationalWorkItemInput[];
  readonly events: readonly OperationalWorkEventInput[];
  readonly focus: OperationalWorkFocusInput | null;
  readonly itemsTruncated?: boolean;
  readonly eventsTruncated?: boolean;
}): OperationalProjectSnapshot {
  const orderedEvents = [...input.events].sort((left, right) => descending(left.occurredAt, right.occurredAt));
  const eventsByItem = new Map<string, OperationalWorkEventInput[]>();
  for (const event of orderedEvents) eventsByItem.set(event.workItemId, [...(eventsByItem.get(event.workItemId) ?? []), event]);
  const snapshots = [...input.items]
    .sort((left, right) => descending(left.updatedAt, right.updatedAt))
    .map(item => {
      const latest = eventsByItem.get(item.id)?.[0];
      return {
        itemRef: item.id,
        capability: item.capability,
        state: item.state,
        stateObservedAt: item.updatedAt,
        ...(latest ? { latestEvent: { type: latest.eventType, occurredAt: latest.occurredAt } } : {}),
      } satisfies OperationalItemSnapshot;
    });
  const unresolvedFailure = (item: OperationalItemSnapshot): boolean => {
    const events = eventsByItem.get(item.itemRef) ?? [];
    const failureIndex = events.findIndex(event => event.eventType === 'execution_failed');
    if (failureIndex < 0) return item.state === 'failed';
    return !events.slice(0, failureIndex).some(event => SUCCESS_AFTER_FAILURE.has(event.eventType));
  };
  const uncertainties: string[] = [];
  if (input.items.length === 0) uncertainties.push('No work item metadata was visible in the read-only projection.');
  if (input.events.length === 0) uncertainties.push('No event sequence was visible; recency and evidence cannot be inferred.');
  if (input.itemsTruncated) uncertainties.push('The item projection reached its bound; items outside the window may exist.');
  if (input.eventsTruncated) uncertainties.push('The event projection reached its bound; older trajectory may be incomplete.');
  if (input.focus && !input.items.some(item => item.id === input.focus?.workItemId)) {
    uncertainties.push('The current focus points outside the bounded item projection.');
  }
  return {
    generatedAt: input.generatedAt,
    temporalSemantics: {
      current: 'work_items projection at generatedAt',
      recent: 'latest unresolved event in the bounded event sequence; no wall-clock TTL inferred',
      historical: 'events superseded by a later current projection remain trajectory only',
    },
    coverage: {
      itemCount: input.items.length,
      eventCount: input.events.length,
      oldestEventAt: orderedEvents.at(-1)?.occurredAt ?? null,
      newestEventAt: orderedEvents[0]?.occurredAt ?? null,
    },
    activeWork: snapshots.filter(item => ACTIVE_STATES.has(item.state)),
    recentlyFailed: snapshots.filter(unresolvedFailure),
    awaitingReview: snapshots.filter(item => item.state === 'review'),
    blocked: snapshots.filter(item => item.state === 'blocked'),
    currentFocus: input.focus ? { itemRef: input.focus.workItemId, observedAt: input.focus.updatedAt } : null,
    recentVerifiedEvidence: orderedEvents
      .filter((event): event is OperationalWorkEventInput & { eventType: OperationalProjectSnapshot['recentVerifiedEvidence'][number]['type'] } => VERIFIED_EVENT_TYPES.has(event.eventType as OperationalProjectSnapshot['recentVerifiedEvidence'][number]['type']))
      .slice(0, 20)
      .map(event => ({ itemRef: event.workItemId, type: event.eventType, occurredAt: event.occurredAt })),
    uncertainties,
  };
}

export function operationalStateForContext(snapshot: OperationalProjectSnapshot): string {
  const attention = new Map<string, string[]>();
  const mark = (items: readonly OperationalItemSnapshot[], label: string) => {
    for (const item of items) attention.set(item.itemRef, [...(attention.get(item.itemRef) ?? []), label]);
  };
  mark(snapshot.activeWork, 'active');
  mark(snapshot.recentlyFailed, 'unresolved_failure');
  mark(snapshot.awaitingReview, 'awaiting_review');
  mark(snapshot.blocked, 'blocked');
  const byRef = new Map([...snapshot.activeWork, ...snapshot.recentlyFailed].map(item => [item.itemRef, item]));
  const triage = [...attention].flatMap(([itemRef, reasons]) => {
    const item = byRef.get(itemRef) ?? snapshot.awaitingReview.find(candidate => candidate.itemRef === itemRef)
      ?? snapshot.blocked.find(candidate => candidate.itemRef === itemRef);
    return item ? [{ ...item, attention: reasons }] : [];
  });
  const encode = (items: typeof triage, omitted: number): string => JSON.stringify({
    generatedAt: snapshot.generatedAt,
    temporalSemantics: snapshot.temporalSemantics,
    coverage: snapshot.coverage,
    currentFocus: snapshot.currentFocus,
    triage: items,
    uncertainties: [...snapshot.uncertainties, ...(omitted > 0 ? [`${omitted} triage entries omitted by context bound.`] : [])],
  });
  let visible = triage;
  let value = encode(visible, 0);
  while (value.length > 2_400 && visible.length > 0) {
    visible = visible.slice(0, -1);
    value = encode(visible, triage.length - visible.length);
  }
  return value;
}

export function operationalEvidenceForContext(snapshot: OperationalProjectSnapshot): string {
  const encode = (events: OperationalProjectSnapshot['recentVerifiedEvidence'], omitted: number): string => JSON.stringify({
      generatedAt: snapshot.generatedAt,
      eventCoverage: snapshot.coverage,
      recentVerifiedEvidence: events,
      temporalSemantics: snapshot.temporalSemantics,
      ...(omitted > 0 ? { uncertainty: `${omitted} evidence entries omitted by context bound.` } : {}),
    });
  let visible = snapshot.recentVerifiedEvidence;
  let value = encode(visible, 0);
  while (value.length > 2_400 && visible.length > 0) {
    visible = visible.slice(0, -1);
    value = encode(visible, snapshot.recentVerifiedEvidence.length - visible.length);
  }
  return value;
}
