import { buildProposalRevision } from '@anima/core';
import { createClient } from '@/lib/supabase/server';
import { operationResponse } from '@/lib/work-orchestration/http';
import { serializeWorkItem } from '@/lib/work-orchestration/serialize';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';

export async function POST(request:Request){
  const client=await createClient();const{data:{user}}=await client.auth.getUser();if(!user)return Response.json({ok:false,error:{code:'authentication_required'}},{status:401});
  const input=await request.json() as {workItemId?:unknown;expectedProposalVersion?:unknown;requestedChanges?:unknown};
  if(typeof input.workItemId!=='string'||typeof input.expectedProposalVersion!=='number'||typeof input.requestedChanges!=='string')return Response.json({ok:false,error:{code:'invalid_input',message:'Correção inválida.'}},{status:400});
  const service=createWorkOrchestrationService(client);const current=await service.getItem(input.workItemId);if(!current.ok)return operationResponse(current,serializeWorkItem);
  const revision=buildProposalRevision(current.value,input.requestedChanges);
  const result=await service.requestProposalRevision({workItemId:input.workItemId,expectedProposalVersion:input.expectedProposalVersion,...revision});
  return operationResponse(result,serializeWorkItem);
}
