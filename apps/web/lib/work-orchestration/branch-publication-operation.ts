import {beginProtectedIntegration,recordBranchPublished,type BranchPublicationReceipt,type ProtectedIntegrationProvider,type ProtectedIntegrationRequest} from '@anima/core';
import type{Database,Json}from'@anima/types';import type{SupabaseClient}from'@supabase/supabase-js';
export type PersistBranchReceipt=(request:ProtectedIntegrationRequest,receipt:BranchPublicationReceipt)=>Promise<{readonly action:'recorded'|'replayed';readonly eventSeq:number}>;
export async function publishAndPersistAuthorizedBranch(request:ProtectedIntegrationRequest,provider:ProtectedIntegrationProvider,persist:PersistBranchReceipt,signal?:AbortSignal){
  if(provider.id!==request.target.providerId)throw new Error('Provider divergente da request autorizada.');
  const receipt=await provider.publishBranch(request,signal);
  const projected=recordBranchPublished(beginProtectedIntegration(request),receipt);
  if(!projected.ok)throw new Error(projected.explanation);
  const persistence=await persist(request,receipt);
  return{state:projected.value,receipt,persistence};
}
export const supabaseBranchReceiptPersistence=(client:SupabaseClient<Database>):PersistBranchReceipt=>async(request,receipt)=>{const{data,error}=await client.rpc('record_branch_published',{work_item_id:request.correlation.workItemId,expected_proposal_version:request.correlation.approvedProposalVersion,authorization_decision_id:request.authorizationDecisionId,receipt:receipt as unknown as Json});if(error)throw error;const value=data as{action?:unknown;event_seq?:unknown}|null;if((value?.action!=='recorded'&&value?.action!=='replayed')||typeof value.event_seq!=='number')throw new Error('Persistência de branch retornou outcome ambíguo.');return{action:value.action,eventSeq:value.event_seq};};
