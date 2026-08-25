import { authenticateRequest } from '@/lib/supabase/request-auth';
export async function POST(request:Request){
  const auth=await authenticateRequest(request);if(!auth)return Response.json({ok:false,error:{code:'authentication_required'}},{status:401});
  const body=await request.json().catch(()=>null) as {workItemId?:unknown;expectedProposalVersion?:unknown;requestId?:unknown}|null;
  if(typeof body?.workItemId!=='string'||!Number.isInteger(body.expectedProposalVersion)||typeof body.requestId!=='string')return Response.json({ok:false,error:{code:'invalid_execution_request'}},{status:400});
  const result=await auth.client.rpc('request_autonomous_execution',{p_work_item_id:body.workItemId,p_expected_proposal_version:body.expectedProposalVersion as number,p_request_id:body.requestId});
  if(result.error)return Response.json({ok:false,error:{code:result.error.code,message:result.error.message}},{status:409});
  return Response.json({ok:true,value:result.data});
}
