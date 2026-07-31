import type { AttachWorkContextCommand, CreateWorkProposalCommand, FinishWorkExecutionCommand, RequestProposalRevisionCommand, ReviewWorkResultCommand, ReviseWorkProposalCommand, StartWorkCommand, StartWorkExecutionCommand, SubmitWorkResultCommand } from './commands';
import type { WorkOperationResult } from './errors';
import type { ApprovalDecision, WorkContextSnapshot, WorkEvent, WorkItem, WorkItemId } from './types';
export interface ResolveApprovalInput { workItemId: WorkItemId; expectedProposalVersion: number; decision: ApprovalDecision; }
export interface WorkOrchestrationRepository {
  createProposal(command: CreateWorkProposalCommand): Promise<WorkOperationResult<WorkItem>>;
  reviseProposal(command: ReviseWorkProposalCommand): Promise<WorkOperationResult<WorkItem>>;
  requestProposalRevision(command:RequestProposalRevisionCommand):Promise<WorkOperationResult<WorkItem>>;
  resolveApproval(command: ResolveApprovalInput): Promise<WorkOperationResult<WorkItem>>;
  startWork(command: StartWorkCommand): Promise<WorkOperationResult<WorkItem>>;
  submitResult(command: SubmitWorkResultCommand): Promise<WorkOperationResult<WorkItem>>;
  startExecution(command: StartWorkExecutionCommand): Promise<WorkOperationResult<WorkItem>>;
  finishExecution(command: FinishWorkExecutionCommand): Promise<WorkOperationResult<WorkItem>>;
  reviewResult(command: ReviewWorkResultCommand): Promise<WorkOperationResult<WorkItem>>;
  attachContext(command: AttachWorkContextCommand): Promise<WorkOperationResult<WorkContextSnapshot>>;
  getItem(id: WorkItemId): Promise<WorkOperationResult<WorkItem>>;
  findItemsBySourceMessageId(sourceMessageId: string): Promise<WorkOperationResult<readonly WorkItem[]>>;
  // UX-04 — itens NÃO terminais do usuário autenticado (isolados por RLS), em
  // ordem determinística (mais recentes primeiro). Base da consulta de histórico.
  findResumableWorkItems(): Promise<WorkOperationResult<readonly WorkItem[]>>;
  listEvents(id: WorkItemId): Promise<WorkOperationResult<readonly WorkEvent[]>>;
  listContexts(id: WorkItemId): Promise<WorkOperationResult<readonly WorkContextSnapshot[]>>;
}
