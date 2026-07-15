import type { ApprovalDecision, ProposalVersion, ResultReviewDecision, SourceMessageId, WorkCapability, WorkImpactLevel, WorkIntent, WorkItemId, WorkProposal, WorkResultInput } from './types';
export interface CreateWorkProposalCommand { sourceMessageId: SourceMessageId; impactLevel: WorkImpactLevel; capability: WorkCapability; intent: WorkIntent; proposal: WorkProposal; }
export interface ReviseWorkProposalCommand { workItemId: WorkItemId; expectedProposalVersion: ProposalVersion; intent: WorkIntent; proposal: WorkProposal; }
export interface ResolveWorkApprovalCommand { workItemId: WorkItemId; expectedProposalVersion: ProposalVersion; decision: ApprovalDecision; }
export interface StartWorkCommand { workItemId: WorkItemId; expectedProposalVersion: ProposalVersion; }
export interface SubmitWorkResultCommand { workItemId: WorkItemId; expectedProposalVersion: ProposalVersion; result: WorkResultInput; }
export interface ReviewWorkResultCommand { workItemId: WorkItemId; expectedProposalVersion: ProposalVersion; decision: ResultReviewDecision; }
