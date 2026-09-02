import type { AttachWorkContextCommand, CreateWorkProposalCommand, FinishWorkExecutionCommand, ReleaseManualWorkCommand, RequestProposalRevisionCommand, ReviewWorkResultCommand, ReviseWorkProposalCommand, StartWorkCommand, StartWorkExecutionCommand, SubmitWorkResultCommand, WithdrawApprovedWorkCommand } from './commands';
import type { WorkOperationResult } from './errors';
import type { DecideIntegrationCommand, IntegrationDecisionOutcome } from './integration-decision';
import type { ApprovalDecision, WorkContextSnapshot, WorkEvent, WorkItem, WorkItemId } from './types';
export interface ResolveApprovalInput { workItemId: WorkItemId; expectedProposalVersion: number; decision: ApprovalDecision; }
export interface WorkOrchestrationRepository {
  createProposal(command: CreateWorkProposalCommand): Promise<WorkOperationResult<WorkItem>>;
  reviseProposal(command: ReviseWorkProposalCommand): Promise<WorkOperationResult<WorkItem>>;
  requestProposalRevision(command:RequestProposalRevisionCommand):Promise<WorkOperationResult<WorkItem>>;
  resolveApproval(command: ResolveApprovalInput): Promise<WorkOperationResult<WorkItem>>;
  startWork(command: StartWorkCommand): Promise<WorkOperationResult<WorkItem>>;
  releaseManualWork(command: ReleaseManualWorkCommand): Promise<WorkOperationResult<WorkItem>>;
  // Retira canonicamente um plano APROVADO NÃO INICIADO obsoleto antes da execução
  // (approved → work_cancelled → cancelled). Ato do dono; fail-closed em qualquer
  // outro estado ou com histórico de execução.
  withdrawApprovedWork(command: WithdrawApprovedWorkCommand): Promise<WorkOperationResult<WorkItem>>;
  submitResult(command: SubmitWorkResultCommand): Promise<WorkOperationResult<WorkItem>>;
  startExecution(command: StartWorkExecutionCommand): Promise<WorkOperationResult<WorkItem>>;
  finishExecution(command: FinishWorkExecutionCommand): Promise<WorkOperationResult<WorkItem>>;
  reviewResult(command: ReviewWorkResultCommand): Promise<WorkOperationResult<WorkItem>>;
  // ADR-002 — segunda aprovação humana da integração (persiste integration_decided;
  // NÃO muda o estado do item, NÃO integra, NÃO publica).
  decideIntegration(command: DecideIntegrationCommand): Promise<WorkOperationResult<IntegrationDecisionOutcome>>;
  attachContext(command: AttachWorkContextCommand): Promise<WorkOperationResult<WorkContextSnapshot>>;
  getItem(id: WorkItemId): Promise<WorkOperationResult<WorkItem>>;
  findItemsBySourceMessageId(sourceMessageId: string): Promise<WorkOperationResult<readonly WorkItem[]>>;
  // UX-04 — itens NÃO terminais do usuário autenticado (isolados por RLS), em
  // ordem determinística (mais recentes primeiro). Base da consulta de histórico.
  findResumableWorkItems(): Promise<WorkOperationResult<readonly WorkItem[]>>;
  listEvents(id: WorkItemId): Promise<WorkOperationResult<readonly WorkEvent[]>>;
  // Eventos de UM tipo em TODOS os itens do usuário autenticado (isolados por RLS,
  // como findResumableWorkItems — sem filtro de item). Leitura machine-scoped: a base
  // do Resource Governor para o custo de um workload agregado por toda a máquina, não só
  // um item. Ordem determinística por sequência global.
  listEventsByType(eventType: WorkEvent['type']): Promise<WorkOperationResult<readonly WorkEvent[]>>;
  listContexts(id: WorkItemId): Promise<WorkOperationResult<readonly WorkContextSnapshot[]>>;
}
