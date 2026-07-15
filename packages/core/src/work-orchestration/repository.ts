import type { CreateWorkProposalCommand, ReviewWorkResultCommand, ReviseWorkProposalCommand, StartWorkCommand, SubmitWorkResultCommand } from './commands';
import type { WorkOperationResult } from './errors';
import type { ApprovalDecision, WorkEvent, WorkItem, WorkItemId } from './types';
export interface ResolveApprovalInput { workItemId: WorkItemId; expectedProposalVersion: number; decision: ApprovalDecision; }
export interface WorkOrchestrationRepository {
  createProposal(command: CreateWorkProposalCommand): Promise<WorkOperationResult<WorkItem>>;
  reviseProposal(command: ReviseWorkProposalCommand): Promise<WorkOperationResult<WorkItem>>;
  resolveApproval(command: ResolveApprovalInput): Promise<WorkOperationResult<WorkItem>>;
  startWork(command: StartWorkCommand): Promise<WorkOperationResult<WorkItem>>;
  submitResult(command: SubmitWorkResultCommand): Promise<WorkOperationResult<WorkItem>>;
  reviewResult(command: ReviewWorkResultCommand): Promise<WorkOperationResult<WorkItem>>;
  getItem(id: WorkItemId): Promise<WorkOperationResult<WorkItem>>;
  findItemsBySourceMessageId(sourceMessageId: string): Promise<WorkOperationResult<readonly WorkItem[]>>;
  listEvents(id: WorkItemId): Promise<WorkOperationResult<readonly WorkEvent[]>>;
}
