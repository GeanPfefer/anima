import { WorkOrchestrationService, interpretWorkRequest, type ApprovalDecision, type ResultReviewDecision, type WorkItem } from '@anima/core';
import { SupabaseWorkOrchestrationRepository } from '@anima/supabase';
import { supabase } from './supabase';

const service = () => new WorkOrchestrationService(new SupabaseWorkOrchestrationRepository(supabase));

export async function proposeWorkForMessage(message: string, sourceMessageId: string): Promise<WorkItem | null> {
  const interpretation = interpretWorkRequest(message, sourceMessageId);
  if (interpretation.kind !== 'work_candidate') return null;
  const created = await service().createProposal(interpretation.command);
  if (!created.ok) return null;
  await service().attachContext({workItemId:created.value.id,expectedProposalVersion:created.value.proposalVersion,references:[{kind:'message',id:sourceMessageId}]});
  return created.value;
}

export async function loadWorkItems(sourceMessageIds: readonly string[]): Promise<Record<string, WorkItem>> {
  const entries = await Promise.all(sourceMessageIds.map(async sourceMessageId => {
    const result = await service().findItemsBySourceMessageId(sourceMessageId);
    return result.ok && result.value.length > 0 ? [sourceMessageId, result.value.at(-1)!] as const : null;
  }));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, WorkItem] => entry !== null));
}

export async function decideWork(item: WorkItem, decision: ApprovalDecision): Promise<WorkItem | null> {
  const result = await service().resolveApproval({workItemId:item.id,expectedProposalVersion:item.proposalVersion,decision});
  return result.ok ? result.value : null;
}
export async function requestProposalCorrection(item: WorkItem, requestedChanges: string): Promise<WorkItem | null> {
  const requested = await service().resolveApproval({workItemId:item.id,expectedProposalVersion:item.proposalVersion,decision:{type:'request_changes',requestedChanges}});
  if (!requested.ok) return null;
  const revised = await service().reviseProposal({workItemId:item.id,expectedProposalVersion:item.proposalVersion,intent:item.intent,proposal:{...item.proposal,data:{...item.proposal.data,summary:requestedChanges,objective:requestedChanges}}});
  return revised.ok ? revised.value : null;
}
export async function startWork(item: WorkItem): Promise<WorkItem | null> {
  const result = await service().startWork({workItemId:item.id,expectedProposalVersion:item.proposalVersion});
  return result.ok ? result.value : null;
}
export async function submitWorkResult(item: WorkItem, summary: string, references: readonly string[]): Promise<WorkItem | null> {
  const result = await service().submitResult({workItemId:item.id,expectedProposalVersion:item.proposalVersion,result:{summary,resultReferences:references}});
  return result.ok ? result.value : null;
}
export async function reviewWorkResult(item: WorkItem, decision: ResultReviewDecision): Promise<WorkItem | null> {
  const result = await service().reviewResult({workItemId:item.id,expectedProposalVersion:item.proposalVersion,decision});
  return result.ok ? result.value : null;
}
