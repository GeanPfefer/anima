import type { CreateWorkProposalCommand, ResolveWorkApprovalCommand, ReviseWorkProposalCommand, StartWorkCommand, SubmitWorkResultCommand } from './commands';
import { failure, type WorkOperationResult } from './errors';
import type { WorkOrchestrationRepository } from './repository';
import type { ApprovalDecision, WorkEvent, WorkItem, WorkItemId } from './types';
import { isValidApprovalDecision, isValidProposalVersion, isValidWorkIntent, isValidWorkProposal, isValidWorkResult } from './validation';
const invalid = <T>(message: string): WorkOperationResult<T> => failure('invalid_input', message);
export class WorkOrchestrationService {
  constructor(private readonly repository: WorkOrchestrationRepository) {}
  createProposal(command: CreateWorkProposalCommand): Promise<WorkOperationResult<WorkItem>> {
    if (!command.sourceMessageId || !isValidWorkIntent(command.intent) || !isValidWorkProposal(command.proposal)) return Promise.resolve(invalid('Proposta inválida.'));
    return this.repository.createProposal(command);
  }
  reviseProposal(command: ReviseWorkProposalCommand): Promise<WorkOperationResult<WorkItem>> {
    if (!this.validVersion(command.expectedProposalVersion) || !isValidWorkIntent(command.intent) || !isValidWorkProposal(command.proposal)) return Promise.resolve(invalid('Revisão inválida.'));
    return this.repository.reviseProposal(command);
  }
  resolveApproval(command: ResolveWorkApprovalCommand): Promise<WorkOperationResult<WorkItem>> {
    if (!this.validVersion(command.expectedProposalVersion) || !isValidApprovalDecision(command.decision)) return Promise.resolve(invalid('Decisão inválida.'));
    return this.repository.resolveApproval(command);
  }
  startWork(command: StartWorkCommand): Promise<WorkOperationResult<WorkItem>> {
    if (!this.validVersion(command.expectedProposalVersion)) return Promise.resolve(invalid('Versão inválida.'));
    return this.repository.startWork(command);
  }
  submitResult(command: SubmitWorkResultCommand): Promise<WorkOperationResult<WorkItem>> {
    if (!this.validVersion(command.expectedProposalVersion) || !isValidWorkResult(command.result)) return Promise.resolve(invalid('Resultado inválido.'));
    return this.repository.submitResult(command);
  }
  getItem(id: WorkItemId): Promise<WorkOperationResult<WorkItem>> { return id ? this.repository.getItem(id) : Promise.resolve(invalid('Item inválido.')); }
  listEvents(id: WorkItemId): Promise<WorkOperationResult<readonly WorkEvent[]>> { return id ? this.repository.listEvents(id) : Promise.resolve(invalid('Item inválido.')); }
  private validVersion(value: number): boolean { return isValidProposalVersion(value); }
}
export const approvalDecisionContext = (decision: ApprovalDecision): Record<string, string> => decision.type === 'request_changes' ? { requested_changes: decision.requestedChanges } : decision.type === 'defer' ? { reason: decision.reason } : {};
