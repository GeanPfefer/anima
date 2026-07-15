import type { Enums, Json } from '@anima/types';

export type WorkState = Enums<'work_state'>;
export type WorkEventType = Enums<'work_event_type'>;
export type WorkApprovalDecision = Enums<'work_approval_decision'>;
export type WorkReviewDecision = Enums<'work_review_decision'>;
export type WorkEventAuthor = Enums<'work_event_author'>;
export type WorkImpactLevel = Enums<'work_impact_level'>;
export type WorkCapability = Enums<'work_capability'>;
export type WorkItemId = string;
export type SourceMessageId = string;
export type ProposalVersion = number;
export type WorkIntent = Readonly<Record<string, Json>>;

export interface WorkProposalV1 {
  readonly schemaVersion: 1;
  readonly data: {
    readonly summary: string;
    readonly objective: string;
    readonly includedScope: readonly string[];
    readonly excludedScope: readonly string[];
    readonly expectedEffects: readonly string[];
    readonly risks: readonly string[];
  };
}
export type WorkProposal = WorkProposalV1;
export interface WorkResultInput { readonly summary: string; readonly resultReferences: readonly string[]; }
export type ResultReviewDecision =
  | { readonly type: 'accept' }
  | { readonly type: 'request_changes'; readonly requestedChanges: string };
export type ApprovalDecision =
  | { readonly type: 'approve' }
  | { readonly type: 'reject' }
  | { readonly type: 'request_changes'; readonly requestedChanges: string }
  | { readonly type: 'defer'; readonly reason: string };

export interface WorkItem {
  readonly id: WorkItemId; readonly userId: string; readonly sourceMessageId: SourceMessageId;
  readonly state: WorkState; readonly impactLevel: WorkImpactLevel; readonly capability: WorkCapability;
  readonly originalRequest: string; readonly intent: WorkIntent; readonly proposal: WorkProposal;
  readonly proposalVersion: ProposalVersion; readonly createdAt: Date; readonly updatedAt: Date;
}
export interface WorkEvent {
  readonly id: string; readonly workItemId: WorkItemId; readonly type: WorkEventType;
  readonly author: WorkEventAuthor; readonly proposalVersion: ProposalVersion | null;
  readonly payload: Json; readonly occurredAt: Date;
}
export interface WorkContextReference { readonly kind: string; readonly id: string; }
export interface WorkContextSnapshot {
  readonly id: string; readonly workItemId: WorkItemId; readonly version: number;
  readonly references: readonly WorkContextReference[]; readonly createdAt: Date;
}

const terminal = new Set<WorkState>(['completed', 'failed', 'rejected', 'cancelled']);
const waiting = new Set<WorkState>(['proposed', 'review', 'changes_requested']);
export const isTerminalWorkState = (state: WorkState): boolean => terminal.has(state);
export const isWaitingForUserWorkState = (state: WorkState): boolean => waiting.has(state);
export const isActiveWorkState = (state: WorkState): boolean => !terminal.has(state) && !waiting.has(state);
