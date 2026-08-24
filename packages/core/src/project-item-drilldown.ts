import type { Json } from '@anima/types';
import {
  containsSensitiveData,
  projectAutonomousExecution,
  projectHostObservedCoderEvidence,
  projectHostObservedEvidence,
  projectHostObservedGateEvidence,
  projectVerifierOpinionHistory,
  type WorkEvent,
  type WorkItem,
} from './work-orchestration';

const MAX_TIMELINE = 20;
const MAX_SAFE_TEXT = 240;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const PREFIX = /\b[0-9a-f]{8,12}\b/i;
const ORDINALS: Readonly<Record<string, number>> = { primeira: 0, primeiro: 0, segunda: 1, segundo: 1, terceira: 2, terceiro: 2, quarta: 3, quarto: 3, quinta: 4, quinto: 4 };

export type ProjectItemReferenceCandidate = {
  readonly id: string;
  readonly state: WorkItem['state'];
  readonly capability: WorkItem['capability'];
  readonly updatedAt: string;
};

export type ProjectItemResolution =
  | { readonly kind: 'resolved'; readonly itemId: string; readonly basis: 'stable_id' | 'unique_prefix' | 'ordinal' | 'current_focus' | 'unique_candidate' }
  | { readonly kind: 'clarification_required'; readonly candidates: readonly { readonly itemRef: string; readonly state: WorkItem['state']; readonly capability: WorkItem['capability'] }[] }
  | { readonly kind: 'not_found' };

export type ProjectItemDrilldownProjection = {
  readonly schemaVersion: 1;
  readonly itemRef: string;
  readonly capability: WorkItem['capability'];
  readonly currentState: WorkItem['state'];
  readonly proposalVersion: number;
  readonly observedAt: string;
  readonly stateObservedAt: string;
  readonly timeline: readonly { readonly type: WorkEvent['type']; readonly author: WorkEvent['author']; readonly occurredAt: string; readonly proposalVersion: number | null }[];
  readonly timelineCoverage: { readonly included: number; readonly total: number; readonly olderEventsOmitted: number };
  readonly latestAttempt: null | { readonly attemptRef: string; readonly status: string; readonly startedAt: string; readonly executorRef: string | null; readonly latestCheckpoint: null | { readonly completedSteps: number; readonly remainingSteps: number; readonly signalSequence: number } };
  readonly latestFailure: null | { readonly observedAt: string; readonly unresolved: boolean; readonly cause: { readonly status: 'known' | 'unknown'; readonly code: string | null; readonly safeMessage: string | null } };
  readonly result: null | { readonly observedAt: string; readonly accepted: boolean };
  readonly verifier: null | { readonly verdict: string; readonly checks: number; readonly violations: number; readonly gaps: number };
  readonly evidence: {
    readonly coder: null | { readonly backendRef: string; readonly outcome: string; readonly durationMs: number; readonly observedAt: string };
    readonly gates: null | { readonly total: number; readonly passed: number; readonly failed: number; readonly durationMs: number; readonly observedAt: string };
    readonly git: null | { readonly commitRef: string; readonly filesChanged: number; readonly insertions: number; readonly deletions: number; readonly observedAt: string };
  };
  readonly knownUnknowns: readonly string[];
};

const normalize = (value: string) => value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const newestFirst = (a: ProjectItemReferenceCandidate, b: ProjectItemReferenceCandidate) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
const publicCandidate = (candidate: ProjectItemReferenceCandidate) => ({ itemRef: candidate.id, state: candidate.state, capability: candidate.capability });

export function isProjectItemDrilldownQuestion(message: string): boolean {
  const value = normalize(message.trim());
  return value.length >= 8 && /(?:esse item|dessa falha|dessas falhas|uma dessas falhas|primeir[oa] falha|segund[oa] falha|terceir[oa] falha|por que .{0,24}falh|o que aconteceu .{0,24}item|evidencia .{0,24}item|ultima tentativa|item [0-9a-f]{8})/.test(value);
}

export function resolveProjectItemReference(input: {
  readonly message: string;
  readonly candidates: readonly ProjectItemReferenceCandidate[];
  readonly currentFocusId?: string | null;
}): ProjectItemResolution {
  const ordered = [...input.candidates].sort(newestFirst);
  const exact = input.message.match(UUID)?.[0]?.toLowerCase();
  if (exact) return ordered.some(candidate => candidate.id.toLowerCase() === exact)
    ? { kind: 'resolved', itemId: exact, basis: 'stable_id' } : { kind: 'not_found' };
  const prefix = input.message.match(PREFIX)?.[0]?.toLowerCase();
  if (prefix) {
    const matches = ordered.filter(candidate => candidate.id.toLowerCase().startsWith(prefix));
    if (matches.length === 1) return { kind: 'resolved', itemId: matches[0]!.id, basis: 'unique_prefix' };
    return matches.length > 1 ? { kind: 'clarification_required', candidates: matches.slice(0, 5).map(publicCandidate) } : { kind: 'not_found' };
  }
  const value = normalize(input.message);
  const ordinal = Object.entries(ORDINALS).find(([word]) => value.includes(`${word} falha`))?.[1];
  if (ordinal !== undefined) {
    const failed = ordered.filter(candidate => candidate.state === 'failed');
    return failed[ordinal] ? { kind: 'resolved', itemId: failed[ordinal]!.id, basis: 'ordinal' } : { kind: 'not_found' };
  }
  if (/esse item|neste item|desse item/.test(value) && input.currentFocusId && ordered.some(candidate => candidate.id === input.currentFocusId)) {
    return { kind: 'resolved', itemId: input.currentFocusId, basis: 'current_focus' };
  }
  const relevant = /falha|falh/.test(value) ? ordered.filter(candidate => candidate.state === 'failed') : ordered;
  if (relevant.length === 1) return { kind: 'resolved', itemId: relevant[0]!.id, basis: 'unique_candidate' };
  return relevant.length > 1
    ? { kind: 'clarification_required', candidates: relevant.slice(0, 5).map(publicCandidate) }
    : { kind: 'not_found' };
}

const object = (value: Json | undefined): Record<string, Json | undefined> | null =>
  value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object' ? value : null;
const data = (event: WorkEvent) => object(object(event.payload)?.data);
const safeText = (value: Json | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_SAFE_TEXT || containsSensitiveData(trimmed)
    || /\b(?:token|secret|password|api[_-]?key|authorization)\s*[:=]/i.test(trimmed)) return null;
  return trimmed;
};

export function buildProjectItemDrilldownProjection(input: {
  readonly item: WorkItem;
  readonly events: readonly WorkEvent[];
  readonly observedAt: string;
}): ProjectItemDrilldownProjection {
  const events = input.events.filter(event => event.workItemId === input.item.id)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  const visible = events.slice(-MAX_TIMELINE);
  const failures = events.filter(event => event.type === 'execution_failed');
  const failure = failures.at(-1) ?? null;
  const failureIndex = failure ? events.indexOf(failure) : -1;
  const superseded = failureIndex >= 0 && events.slice(failureIndex + 1).some(event => ['execution_started', 'result_submitted', 'result_accepted'].includes(event.type));
  const failureData = failure ? data(failure) : null;
  const code = safeText(failureData?.code) ?? safeText(failureData?.reason);
  const message = safeText(failureData?.message);
  const execution = projectAutonomousExecution(input.item, events);
  const coder = projectHostObservedCoderEvidence(events);
  const gates = projectHostObservedGateEvidence(events);
  const git = projectHostObservedEvidence(events);
  const verifier = projectVerifierOpinionHistory(events).at(-1) ?? null;
  const submitted = [...events].reverse().find(event => event.type === 'result_submitted') ?? null;
  const accepted = submitted ? events.some(event => event.type === 'result_accepted' && event.occurredAt >= submitted.occurredAt) : false;
  const unknowns: string[] = [];
  if (failure && !code && !message) unknowns.push('A causa detalhada da falha não está disponível na projeção governada.');
  if (!verifier) unknowns.push('Nenhum parecer tipado do Verifier foi encontrado para este item.');
  if (events.length > MAX_TIMELINE) unknowns.push(`${events.length - MAX_TIMELINE} eventos anteriores foram omitidos pelo limite da timeline.`);
  return {
    schemaVersion: 1,
    itemRef: input.item.id,
    capability: input.item.capability,
    currentState: input.item.state,
    proposalVersion: input.item.proposalVersion,
    observedAt: input.observedAt,
    stateObservedAt: input.item.updatedAt.toISOString(),
    timeline: visible.map(event => ({ type: event.type, author: event.author, occurredAt: event.occurredAt.toISOString(), proposalVersion: event.proposalVersion })),
    timelineCoverage: { included: visible.length, total: events.length, olderEventsOmitted: events.length - visible.length },
    latestAttempt: execution ? {
      attemptRef: execution.attemptId, status: execution.status, startedAt: execution.startedAt,
      executorRef: execution.executorId,
      latestCheckpoint: execution.latestCheckpoint ? {
        completedSteps: execution.latestCheckpoint.completedSteps,
        remainingSteps: execution.latestCheckpoint.remainingSteps,
        signalSequence: execution.latestCheckpoint.signalSequence,
      } : null,
    } : null,
    latestFailure: failure ? {
      observedAt: failure.occurredAt.toISOString(), unresolved: !superseded,
      cause: { status: code || message ? 'known' : 'unknown', code, safeMessage: message },
    } : null,
    result: submitted ? { observedAt: submitted.occurredAt.toISOString(), accepted } : null,
    verifier: verifier ? { verdict: verifier.verdict, checks: verifier.summary.checks, violations: verifier.summary.violations, gaps: verifier.summary.gaps } : null,
    evidence: {
      coder: coder ? { backendRef: coder.backendId, outcome: coder.outcome, durationMs: coder.durationMs, observedAt: coder.observedAt } : null,
      gates: gates ? {
        total: gates.gates.length,
        passed: gates.gates.filter(gate => gate.outcome === 'passed').length,
        failed: gates.gates.filter(gate => gate.outcome !== 'passed').length,
        durationMs: gates.gates.reduce((sum, gate) => sum + gate.durationMs, 0),
        observedAt: gates.observedAt,
      } : null,
      git: git ? {
        commitRef: git.observedCommitSha,
        filesChanged: git.observedChangedFiles.length,
        insertions: git.observedDiffSummary.insertions,
        deletions: git.observedDiffSummary.deletions,
        observedAt: git.observedAt,
      } : null,
    },
    knownUnknowns: unknowns,
  };
}

export function projectItemDrilldownForContext(projection: ProjectItemDrilldownProjection): string {
  return JSON.stringify(projection);
}

export function projectItemDrilldownStateForContext(projection: ProjectItemDrilldownProjection): string {
  return JSON.stringify({
    itemRef: projection.itemRef,
    capability: projection.capability,
    currentState: projection.currentState,
    proposalVersion: projection.proposalVersion,
    observedAt: projection.observedAt,
    stateObservedAt: projection.stateObservedAt,
    latestAttempt: projection.latestAttempt,
    latestFailure: projection.latestFailure,
    result: projection.result,
    knownUnknowns: projection.knownUnknowns,
  });
}

export function projectItemDrilldownEvidenceForContext(projection: ProjectItemDrilldownProjection): string {
  return JSON.stringify({
    itemRef: projection.itemRef,
    observedAt: projection.observedAt,
    timeline: projection.timeline,
    timelineCoverage: projection.timelineCoverage,
    verifier: projection.verifier,
    evidence: projection.evidence,
  });
}
