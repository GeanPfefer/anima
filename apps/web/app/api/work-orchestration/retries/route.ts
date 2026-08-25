import { authenticateRequest } from '@/lib/supabase/request-auth';

export async function POST(request:Request){
  const auth=await authenticateRequest(request);if(!auth)return Response.json({ok:false,error:{code:'authentication_required'}},{status:401});
  const body=await request.json().catch(()=>null) as {workItemId?:unknown;expectedProposalVersion?:unknown;failureEventId?:unknown;retryRequestId?:unknown}|null;
  if(typeof body?.workItemId!=='string'||!Number.isInteger(body.expectedProposalVersion)||typeof body.failureEventId!=='string'||typeof body.retryRequestId!=='string')
    return Response.json({ok:false,error:{code:'invalid_retry_request',message:'A solicitação de nova tentativa é inválida.'}},{status:400});
  const result=await auth.client.rpc('request_work_retry',{p_work_item_id:body.workItemId,p_expected_proposal_version:body.expectedProposalVersion as number,p_failure_event_id:body.failureEventId,p_retry_request_id:body.retryRequestId});
  if(result.error)return Response.json({ok:false,error:{code:result.error.code,message:result.error.message}},{status:409});
  return Response.json({ok:true,value:result.data});
}
