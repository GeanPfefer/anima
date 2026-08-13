import {buildProtectedIntegrationRequest,projectBranchPublicationReceipt,projectReviewRequestReceipt,projectIntegrationBoundary,projectWorktreeHandoff,type IntegrationTarget,type ReviewRequestProvider,type WorkEvent}from'@anima/core';
import type{Database}from'@anima/types';import type{SupabaseClient}from'@supabase/supabase-js';
import{createAndPersistReviewRequest,supabaseReviewReceiptPersistence}from'./review-request-operation';
import{createWorkOrchestrationService}from'./server';

// Precondições fail-closed sobre o estado persistido para a criação de review
// request. Distintas de erro inesperado: código estável para o HTTP mapear como
// 409/404, nunca 500. NUNCA carregam caminho, remote, token ou dado sensível.
// `branch_not_published` é a ordenação do protocolo (ADR-002): review exige a
// branch já publicada e persistida.
export type ReviewRequestPreconditionCode='authorization_not_found'|'handoff_not_found'|'request_not_derivable'|'item_mismatch'|'branch_not_published'|'receipt_projection_conflict'|'remote_drift';
export class ReviewRequestPrecondition extends Error{constructor(readonly code:ReviewRequestPreconditionCode,message:string){super(message);this.name='ReviewRequestPrecondition';}}

export type ReviewRequestReader=(workItemId:string)=>Promise<readonly WorkEvent[]>;
export async function executeAuthorizedReviewRequest(input:{readonly workItemId:string;readonly target:IntegrationTarget;readonly provider:ReviewRequestProvider;readonly readEvents:ReviewRequestReader;readonly persist:ReturnType<typeof supabaseReviewReceiptPersistence>;readonly signal?:AbortSignal}){
  const events=await input.readEvents(input.workItemId);const boundary=projectIntegrationBoundary(events);const handoff=projectWorktreeHandoff(events);
  if(boundary===null)throw new ReviewRequestPrecondition('authorization_not_found','Fronteira de integração persistida não encontrada.');
  if(handoff===null)throw new ReviewRequestPrecondition('handoff_not_found','WorktreeHandoffV1 persistido e correlacionado não encontrado.');
  const built=buildProtectedIntegrationRequest(boundary,handoff,input.target);if(!built.ok)throw new ReviewRequestPrecondition('request_not_derivable',built.explanation);const request=built.value;
  if(request.correlation.workItemId!==input.workItemId)throw new ReviewRequestPrecondition('item_mismatch','Item solicitado diverge da autorização persistida.');
  // Ordenação: a branch precisa estar publicada e persistida antes do review request.
  const branch=projectBranchPublicationReceipt(events,request);if(!branch.ok)throw new ReviewRequestPrecondition('receipt_projection_conflict',branch.explanation);
  if(branch.value===null)throw new ReviewRequestPrecondition('branch_not_published','A branch precisa estar publicada e persistida antes do review request.');
  const persisted=projectReviewRequestReceipt(events,request);if(!persisted.ok)throw new ReviewRequestPrecondition('receipt_projection_conflict',persisted.explanation);
  if(persisted.value){const observed=await input.provider.inspectReviewRequest(request,branch.value,input.signal);if(observed===null)throw new ReviewRequestPrecondition('remote_drift','O review request persistido não existe mais no provider.');return{status:'already_persisted' as const,request,receipt:persisted.value,observed};}
  const outcome=await createAndPersistReviewRequest(request,branch.value,input.provider,input.persist,input.signal);return{status:'created' as const,request,...outcome};
}

export async function executeAuthorizedReviewRequestWithSupabase(client:SupabaseClient<Database>,input:{readonly workItemId:string;readonly target:IntegrationTarget;readonly provider:ReviewRequestProvider;readonly signal?:AbortSignal}){
  const service=createWorkOrchestrationService(client);return executeAuthorizedReviewRequest({...input,readEvents:async id=>{const result=await service.listEvents(id);if(!result.ok)throw new Error(result.error.message);return result.value;},persist:supabaseReviewReceiptPersistence(client)});
}
