import { createClient } from '@/lib/supabase/server';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';

export async function POST(request:Request){
  const client=await createClient();
  const {data:{user}}=await client.auth.getUser();
  if(!user)return Response.json({ok:false,error:{code:'authentication_required'}},{status:401});
  const body=await request.json().catch(()=>null) as {workItemId?:unknown;expectedProposalVersion?:unknown}|null;
  if(typeof body?.workItemId!=='string'||!Number.isInteger(body.expectedProposalVersion)||Number(body.expectedProposalVersion)<1)return Response.json({ok:false,error:{code:'invalid_request'}},{status:400});
  const result=await ensurePlannedProjectClassification(client,body.workItemId,Number(body.expectedProposalVersion));
  return result.ok?Response.json({ok:true,value:result}):Response.json({ok:false,error:{code:result.code}},{status:409});
}
