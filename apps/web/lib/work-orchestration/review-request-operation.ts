import {beginProtectedIntegration,recordBranchPublished,recordReviewRequestCreated,type BranchPublicationReceipt,type ReviewRequestReceipt,type ReviewRequestProvider,type ProtectedIntegrationRequest} from '@anima/core';
import type{Database,Json}from'@anima/types';import type{SupabaseClient}from'@supabase/supabase-js';

// Orquestra a criação de review request espelhando branch-publication-operation.ts,
// com duas diferenças: reconcilia (inspect) ANTES de criar (o PR pode já existir
// após crash) e aplica a máquina de estados pura branch_published →
// review_request_created antes de persistir. O provider REAL (GitHub) é a fronteira
// humana (ADR-002, fase 3): aqui ele é INJETADO e nada de efeito externo é embutido;
// sem provider real, este caminho não é alcançável em produção.
export type PersistReviewReceipt=(request:ProtectedIntegrationRequest,receipt:ReviewRequestReceipt)=>Promise<{readonly action:'recorded'|'replayed';readonly eventSeq:number}>;

export async function createAndPersistReviewRequest(request:ProtectedIntegrationRequest,branchReceipt:BranchPublicationReceipt,provider:ReviewRequestProvider,persist:PersistReviewReceipt,signal?:AbortSignal){
  if(provider.id!==request.target.providerId)throw new Error('Provider divergente da request autorizada.');
  const existing=await provider.inspectReviewRequest(request,branchReceipt,signal);
  const receipt=existing??await provider.createReviewRequest(request,branchReceipt,signal);
  const branchState=recordBranchPublished(beginProtectedIntegration(request),branchReceipt);
  if(!branchState.ok)throw new Error(branchState.explanation);
  const reviewState=recordReviewRequestCreated(branchState.value,receipt);
  if(!reviewState.ok)throw new Error(reviewState.explanation);
  const persistence=await persist(request,receipt);
  return{state:reviewState.value,receipt,persistence};
}

export const supabaseReviewReceiptPersistence=(client:SupabaseClient<Database>):PersistReviewReceipt=>async(request,receipt)=>{const{data,error}=await client.rpc('record_review_request_created',{work_item_id:request.correlation.workItemId,expected_proposal_version:request.correlation.approvedProposalVersion,authorization_decision_id:request.authorizationDecisionId,receipt:receipt as unknown as Json});if(error)throw error;const value=data as{action?:unknown;event_seq?:unknown}|null;if((value?.action!=='recorded'&&value?.action!=='replayed')||typeof value.event_seq!=='number')throw new Error('Persistência de review request retornou outcome ambíguo.');return{action:value.action,eventSeq:value.event_seq};};
