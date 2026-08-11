import {buildProtectedIntegrationRequest,projectBranchPublicationReceipt,projectIntegrationBoundary,projectWorktreeHandoff,type IntegrationTarget,type ProtectedIntegrationProvider,type WorkEvent}from'@anima/core';
import type{Database}from'@anima/types';import type{SupabaseClient}from'@supabase/supabase-js';
import{publishAndPersistAuthorizedBranch,supabaseBranchReceiptPersistence}from'./branch-publication-operation';
import{createWorkOrchestrationService}from'./server';

// Precondições fail-closed sobre o estado persistido: a publicação não pôde ser
// derivada/reconciliada porque um fato exigido está ausente, divergente ou já
// não vale. São distintas de um erro inesperado (bug/infra): carregam um código
// estável para o mapeamento HTTP tratá-las como 409, nunca como 500. Nunca
// carregam caminho, remote, stderr ou qualquer dado sensível.
export type BranchPublicationPreconditionCode='authorization_not_found'|'handoff_not_found'|'request_not_derivable'|'item_mismatch'|'receipt_projection_conflict'|'remote_drift';
export class BranchPublicationPrecondition extends Error{constructor(readonly code:BranchPublicationPreconditionCode,message:string){super(message);this.name='BranchPublicationPrecondition';}}

export type BranchPublicationReader=(workItemId:string)=>Promise<readonly WorkEvent[]>;
export async function executeAuthorizedBranchPublication(input:{readonly workItemId:string;readonly target:IntegrationTarget;readonly provider:ProtectedIntegrationProvider;readonly readEvents:BranchPublicationReader;readonly persist:ReturnType<typeof supabaseBranchReceiptPersistence>;readonly signal?:AbortSignal}){
  const events=await input.readEvents(input.workItemId);const boundary=projectIntegrationBoundary(events);const handoff=projectWorktreeHandoff(events);
  if(boundary===null)throw new BranchPublicationPrecondition('authorization_not_found','Fronteira de integração persistida não encontrada.');
  if(handoff===null)throw new BranchPublicationPrecondition('handoff_not_found','WorktreeHandoffV1 persistido e correlacionado não encontrado.');
  const built=buildProtectedIntegrationRequest(boundary,handoff,input.target);if(!built.ok)throw new BranchPublicationPrecondition('request_not_derivable',built.explanation);const request=built.value;
  if(request.correlation.workItemId!==input.workItemId)throw new BranchPublicationPrecondition('item_mismatch','Item solicitado diverge da autorização persistida.');
  const persisted=projectBranchPublicationReceipt(events,request);if(!persisted.ok)throw new BranchPublicationPrecondition('receipt_projection_conflict',persisted.explanation);
  if(persisted.value){const observed=await input.provider.inspectBranch(request,input.signal);if(observed===null)throw new BranchPublicationPrecondition('remote_drift','A branch publicada persistida não existe mais no remote.');return{status:'already_persisted' as const,request,receipt:persisted.value,observed};}
  const outcome=await publishAndPersistAuthorizedBranch(request,input.provider,input.persist,input.signal);return{status:'published' as const,request,...outcome};
}

export async function executeAuthorizedBranchPublicationWithSupabase(client:SupabaseClient<Database>,input:{readonly workItemId:string;readonly target:IntegrationTarget;readonly provider:ProtectedIntegrationProvider;readonly signal?:AbortSignal}){
  const service=createWorkOrchestrationService(client);return executeAuthorizedBranchPublication({...input,readEvents:async id=>{const result=await service.listEvents(id);if(!result.ok)throw new Error(result.error.message);return result.value;},persist:supabaseBranchReceiptPersistence(client)});
}
