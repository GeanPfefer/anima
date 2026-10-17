import type { WorkEvent, WorkState } from './work-orchestration/types';
import { EXECUTION_CONTEXT_EVENT_TYPE, readPersistedExecutionContext } from './work-orchestration/host-observed-execution-context';

export const AUTONOMY_EVIDENCE_VERSION = 'autonomy-evidence-v0';
export type AutonomyCycleClass = 'unattended_verified' | 'human_observed' | 'unknown' | 'insufficient_evidence';
export interface AutonomyEvidenceItem { id: string; state: WorkState }
export interface AutonomyEvidenceLease {
  workItemId: string; proposalVersion: number; issuedAt: string; expiresAt: string; revokedAt: string | null;
}
export interface AutonomyEvidenceInput {
  events: readonly WorkEvent[]; items: readonly AutonomyEvidenceItem[];
  leases: readonly AutonomyEvidenceLease[] | null; now: Date; windowDays?: number;
}
export interface AutonomyEvidenceWindow {
  label: 'last_14_days' | 'all_time'; days: number | null;
  completedItems: number; reviewItems: number;
  humanActsPerCompleted: { mean: number; min: number; max: number; total: number } | null;
  policyActsPerCompleted: { mean: number; total: number } | null;
  humanActsByType: Record<string, number>;
  userStarts: number; policyActs: { approved: number; classified: number };
  completedWithLease: number; reviewWithLease: number;
  classes: Record<AutonomyCycleClass, number>;
  leases: { issued: number; active: number; expired: number; revoked: number } | null;
  attempts: { claimed: number; resultSubmitted: number; failed: number; abandoned: number; itemsWithFailedAttempt: number };
}
export interface AutonomyEvidenceSummary {
  version: typeof AUTONOMY_EVIDENCE_VERSION; generatedAt: string; windowDays: number;
  windows: [AutonomyEvidenceWindow, AutonomyEvidenceWindow];
  unattendedVerifiedUntilReview: number; unattendedVerifiedFullCycle: number;
  verdict: 'insufficient_evidence' | 'unattended_verified' | 'unknown';
  coverage: {
    eventsRead: number; itemsRead: number; itemsWithoutEvents: number;
    leasesStatus: 'read' | 'unavailable'; executionModeFactsObserved: number;
    unattendedFactsValid: number; rejectedExecutionModeFacts: number; itemsWithoutReferenceTime: number;
  };
  limitations: string[];
}
const HUMAN_TYPES = new Set<string>([
  'work_approved', 'work_intelligence_classified', 'result_accepted', 'integration_effect_authorized',
  'changes_requested', 'proposal_changes_requested', 'work_cancelled', 'work_rejected', 'input_provided',
  'manual_work_released', 'work_deferred', 'work_paused', 'work_control_requested',
  // A2-0 R2: conceder/revogar mandato de aceite é ATO HUMANO (identidade dedicada de grantor, autor user).
  'work_mandate_granted', 'work_mandate_revoked',
]);
const HOST_TYPES = new Set<string>([
  'host_observed_evidence_recorded', 'host_observed_gate_evidence_recorded',
  'host_observed_coder_evidence_recorded', 'host_observed_node_lifecycle_recorded',
]);
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
const data = (event: WorkEvent) => object(object(event.payload).data);
const human = (event: WorkEvent) => event.author === 'user' && HUMAN_TYPES.has(event.type);
const userStart = (event: WorkEvent) => event.author === 'user' && event.type === 'work_started';
const policyApproval = (event: WorkEvent) => event.type === 'work_approved' && event.author === 'system' && data(event).authority === 'autonomous_policy';
const policyClassification = (event: WorkEvent) => event.type === 'work_intelligence_classified' && event.author === 'system' && object(object(data(event).classification).provenance).kind === 'system_assessed';
// Fato de modo: qualquer evento que DECLARA execution_mode (tipos host legados ou o fato A2-0). Só o fato A2-0
// com proveniência completa (readPersistedExecutionContext) é VÁLIDO; o resto conta como rejeitado.
const modeFact = (event: WorkEvent) => event.type === EXECUTION_CONTEXT_EVENT_TYPE
  || (HOST_TYPES.has(event.type) && typeof data(event).execution_mode === 'string');
const validModeFact = (event: WorkEvent) => readPersistedExecutionContext(event) !== null;
/** `unattended` válido para a attempt corrente do item: fato íntegro, runner automático, zero leases e zero
 * atos humanos depois do mandato (conferidos pelo banco no registro) e attempt/versão correlacionadas. */
function unattendedFactFor(history: readonly WorkEvent[]): boolean {
  const started = history.filter(event => event.type === 'execution_started').at(-1);
  if (!started) return false;
  return history.some(event => {
    const fact = readPersistedExecutionContext(event);
    return fact !== null && fact.executionMode === 'unattended' && fact.actorKind === 'automated_runner'
      && fact.authority.leasesObserved === 0 && fact.authority.humanActsAfterMandate === 0
      && fact.attemptId === data(started).attempt_id && fact.approvedProposalVersion === started.proposalVersion;
  });
}
function compare(a: WorkEvent, b: WorkEvent): number {
  if (a.seq !== undefined && b.seq !== undefined) return a.seq - b.seq;
  return a.occurredAt.getTime() - b.occurredAt.getTime();
}

/** Observação read-only; ausência de registro nunca comprova ausência de intervenção. */
export function computeAutonomyEvidence(input: AutonomyEvidenceInput): AutonomyEvidenceSummary {
  const { events, items, leases, now } = input;
  const windowDays = input.windowDays ?? 14;
  const byItem = new Map<string, WorkEvent[]>();
  for (const event of events) {
    const group = byItem.get(event.workItemId) ?? [];
    group.push(event); byItem.set(event.workItemId, group);
  }
  const observed = items.map(item => {
    const history = [...(byItem.get(item.id) ?? [])].sort(compare);
    const itemLeases = leases?.filter(lease => lease.workItemId === item.id) ?? [];
    const acts = history.filter(human);
    const starts = history.filter(userStart);
    const submitted = history.filter(event => event.type === 'result_submitted').at(-1);
    const accepted = history.filter(event => event.type === 'result_accepted').at(-1);
    const reference = item.state === 'completed' ? accepted : item.state === 'review' ? submitted : undefined;
    const verified = (item.state === 'review' || item.state === 'completed') && submitted !== undefined
      && history.some(policyApproval) && history.some(policyClassification)
      && ![...acts, ...starts].some(event => compare(event, submitted) <= 0)
      && leases !== null && itemLeases.length === 0 && unattendedFactFor(history)
      && !history.some(event => event.type === 'work_started' && data(event).reason === 'supervised_execution');
    const cycleClass: AutonomyCycleClass = history.length === 0 ? 'insufficient_evidence'
      : verified ? 'unattended_verified'
      : acts.length > 0 || starts.length > 0 || itemLeases.length > 0 ? 'human_observed'
      : leases === null ? 'insufficient_evidence' : 'unknown';
    return { item, history, acts, itemLeases, reference, cycleClass,
      fullCycle: verified && item.state === 'completed' && acts.length === 0 && starts.length === 0 && accepted !== undefined && accepted.author !== 'user' };
  });
  const makeWindow = (label: AutonomyEvidenceWindow['label'], days: number | null): AutonomyEvidenceWindow => {
    const contains = (time: number) => Number.isFinite(time) && time <= now.getTime()
      && (days === null || time >= now.getTime() - days * 86400000);
    const selected = observed.filter(entry => entry.reference && contains(entry.reference.occurredAt.getTime()));
    const completed = selected.filter(entry => entry.item.state === 'completed');
    const review = selected.filter(entry => entry.item.state === 'review');
    const counts = completed.map(entry => entry.acts.length);
    const total = counts.reduce((sum, count) => sum + count, 0);
    const policyTotal = completed.reduce((sum, entry) => sum + entry.history.filter(event => policyApproval(event) || policyClassification(event)).length, 0);
    const humanActsByType: Record<string, number> = {};
    const classes: Record<AutonomyCycleClass, number> = { unattended_verified: 0, human_observed: 0, unknown: 0, insufficient_evidence: 0 };
    for (const entry of selected) {
      classes[entry.cycleClass]++;
      for (const act of entry.acts) humanActsByType[act.type] = (humanActsByType[act.type] ?? 0) + 1;
    }
    const windowLeases = leases?.filter(lease => contains(new Date(lease.issuedAt).getTime()));
    const windowEvents = events.filter(event => contains(event.occurredAt.getTime()));
    const count = (type: string) => windowEvents.filter(event => event.type === type).length;
    return {
      label, days, completedItems: completed.length, reviewItems: review.length,
      humanActsPerCompleted: counts.length ? { mean: total / counts.length, min: Math.min(...counts), max: Math.max(...counts), total } : null,
      policyActsPerCompleted: counts.length ? { mean: policyTotal / counts.length, total: policyTotal } : null,
      humanActsByType, classes,
      userStarts: selected.reduce((sum, entry) => sum + entry.history.filter(userStart).length, 0),
      policyActs: {
        approved: selected.reduce((sum, entry) => sum + entry.history.filter(policyApproval).length, 0),
        classified: selected.reduce((sum, entry) => sum + entry.history.filter(policyClassification).length, 0),
      },
      completedWithLease: completed.filter(entry => entry.itemLeases.length > 0).length,
      reviewWithLease: review.filter(entry => entry.itemLeases.length > 0).length,
      leases: windowLeases ? {
        issued: windowLeases.length,
        active: windowLeases.filter(lease => lease.revokedAt === null && new Date(lease.expiresAt).getTime() > now.getTime()).length,
        expired: windowLeases.filter(lease => lease.revokedAt === null && new Date(lease.expiresAt).getTime() <= now.getTime()).length,
        revoked: windowLeases.filter(lease => lease.revokedAt !== null).length,
      } : null,
      attempts: { claimed: count('work_claimed'), resultSubmitted: count('result_submitted'), failed: count('execution_failed'), abandoned: count('attempt_abandoned'),
        itemsWithFailedAttempt: new Set(windowEvents.filter(event => event.type === 'execution_failed').map(event => event.workItemId)).size },
    };
  };
  const unattendedVerifiedUntilReview = observed.filter(entry => entry.cycleClass === 'unattended_verified').length;
  const executionModeFactsObserved = events.filter(modeFact).length;
  const limitations = ['actor_kind_not_recorded', 'supervision_lease_not_in_ledger', 'owner_instance_id_untrusted', 'work_proposed_authorship_not_autonomy', 'failure_code_unstructured', 'external_supervision_unrecorded'];
  if (!executionModeFactsObserved) limitations.push('execution_mode_fact_absent');
  if (leases === null) limitations.push('leases_unavailable');
  return {
    version: AUTONOMY_EVIDENCE_VERSION, generatedAt: now.toISOString(), windowDays,
    windows: [makeWindow('last_14_days', windowDays), makeWindow('all_time', null)],
    unattendedVerifiedUntilReview, unattendedVerifiedFullCycle: observed.filter(entry => entry.fullCycle).length,
    verdict: leases === null || !items.length || !events.length ? 'insufficient_evidence' : unattendedVerifiedUntilReview > 0 ? 'unattended_verified' : 'unknown',
    coverage: { eventsRead: events.length, itemsRead: items.length, itemsWithoutEvents: observed.filter(entry => !entry.history.length).length,
      leasesStatus: leases === null ? 'unavailable' : 'read', executionModeFactsObserved,
      unattendedFactsValid: [...byItem.values()].filter(unattendedFactFor).length,
      rejectedExecutionModeFacts: events.filter(event => modeFact(event) && !validModeFact(event)).length,
      itemsWithoutReferenceTime: observed.filter(entry => (entry.item.state === 'completed' || entry.item.state === 'review') && !entry.reference).length },
    limitations,
  };
}
